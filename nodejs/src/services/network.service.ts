import { executeCommand } from '../utils/command.util';
import { ConfigManager, NetworkConfig } from '../utils/config.util';

export class NetworkService {
  private configManager: ConfigManager;

  constructor() {
    this.configManager = new ConfigManager();
  }

  async saveCurrentConfig(id: string, status: any): Promise<void> {
    if (!status.connected) {
      throw new Error('No active connection to save');
    }

    const config: NetworkConfig = {
      ssid: status.ssid!,
      mode: status.mode === 'ap' ? 'hotspot' : 'client',
      createdDate: new Date().toISOString(),
      lastUsed: new Date().toISOString(),
      interface: 'wlan0',
    };

    if (status.mode === 'ap') {
      const { stdout } = await executeCommand(`nmcli -g 802-11-wireless-security.psk connection show "${status.ssid}"`);
      if (stdout.trim()) {
        config.password = stdout.trim();
      }
    }

    await this.configManager.saveConfig(id, config);
  }

  async activateConfig(id: string): Promise<NetworkConfig> {
    const config = await this.configManager.loadConfig(id);
    if (!config) {
      throw new Error(`Config '${id}' not found`);
    }
    return config;
  }

  async listSavedConfigs(): Promise<Array<{ id: string; config: NetworkConfig }>> {
    return this.configManager.listConfigs();
  }

  async deduplicateConfigs(): Promise<void> {
    await this.configManager.deduplicateConfigs();
    await this.configManager.deduplicateNetworkProfiles();
  }

  async updateDeviceAuth(allowedMacs: string[]): Promise<void> {
    await this.configManager.updateDeviceAuth(allowedMacs);
  }

  async updateDnsConfig(servers: string[]): Promise<void> {
    await this.configManager.updateDnsConfig(servers);
  }

  async enableHairpinNAT(): Promise<void> {
    await this.configManager.setHairpinNAT(true);
  }

  async disableHairpinNAT(): Promise<void> {
    await this.configManager.setHairpinNAT(false);
  }

  async runDiagnostics(deep = false): Promise<any> {
    return this.configManager.runDiagnostics(deep);
  }
}
