import { executeCommand } from './command.util';
import * as path from 'path';
import * as fs from 'fs/promises';
import * as os from 'os';

export interface NetworkConfig {
  ssid: string;
  mode: 'client' | 'hotspot';
  password?: string;
  hidden?: boolean;
  interface?: string;
  dns?: string;
  createdDate: string;
  lastUsed?: string;
  vpnEnabled?: boolean;
  captivePortal?: boolean;
  customDns?: {
    enabled: boolean;
    servers: string[];
  };
  deviceAuth?: {
    enabled: boolean;
    allowedMacs?: string[];
  };
}

export class ConfigManager {
  private configDir: string;
  private dnsmasqConfigPath = '/etc/NetworkManager/dnsmasq.d/custom-dns.conf';
  private dhcpConfigPath = '/etc/NetworkManager/dnsmasq.d/dhcp-options.conf';
  private defaultConfigPath: string;

  constructor() {
    const homeDir = os.homedir() || '/home/pi';
    this.configDir = path.join(homeDir, '.wifi_configs');
    this.defaultConfigPath = path.join(this.configDir, 'default-config.json');
  }

  async init() {
    await fs.mkdir(this.configDir, { recursive: true });
  }

  async saveConfig(id: string, config: NetworkConfig): Promise<void> {
    await this.init();
    const filePath = path.join(this.configDir, `${id}.json`);
    await fs.writeFile(filePath, JSON.stringify(config, null, 2));
  }

  async loadConfig(id: string): Promise<NetworkConfig | null> {
    try {
      const filePath = path.join(this.configDir, `${id}.json`);
      const content = await fs.readFile(filePath, 'utf-8');
      return JSON.parse(content);
    } catch {
      return null;
    }
  }

  async listConfigs(): Promise<Array<{ id: string; config: NetworkConfig }>> {
    await this.init();
    const files = await fs.readdir(this.configDir);
    const configs: Array<{ id: string; config: NetworkConfig }> = [];

    for (const file of files) {
      if (file.endsWith('.json')) {
        const id = path.basename(file, '.json');
        const config = await this.loadConfig(id);
        if (config) {
          configs.push({ id, config });
        }
      }
    }

    return configs;
  }

  async deduplicateConfigs(): Promise<void> {
    const configs = await this.listConfigs();
    const uniqueConfigs = new Map<string, { id: string; config: NetworkConfig; date: Date }>();

    // Group configs by SSID and mode
    for (const { id, config } of configs) {
      const key = `${config.ssid}:${config.mode}`;
      const currentDate = new Date(config.createdDate);
      const existing = uniqueConfigs.get(key);

      if (!existing || new Date(existing.config.createdDate) < currentDate) {
        uniqueConfigs.set(key, { id, config, date: currentDate });
      }
    }

    // Delete duplicates
    for (const { id, config } of configs) {
      const key = `${config.ssid}:${config.mode}`;
      const keeper = uniqueConfigs.get(key);
      if (keeper && keeper.id !== id) {
        const filePath = path.join(this.configDir, `${id}.json`);
        await fs.unlink(filePath);
      }
    }
  }

  async deduplicateNetworkProfiles(): Promise<void> {
    // Get all connection profiles
    const { stdout } = await executeCommand('nmcli -t -f NAME,TYPE connection');
    const wifiProfiles = stdout.split('\n')
      .filter(line => line.includes(':802-11-wireless'))
      .map(line => line.split(':')[0]);

    // Group by SSID
    const profilesBySSID = new Map<string, string[]>();
    
    for (const profile of wifiProfiles) {
      try {
        const { stdout: ssid } = await executeCommand(`nmcli -g 802-11-wireless.ssid connection show "${profile}"`);
        if (ssid) {
          const profiles = profilesBySSID.get(ssid.trim()) || [];
          profiles.push(profile);
          profilesBySSID.set(ssid.trim(), profiles);
        }
      } catch {
        // Skip if we can't get SSID
        continue;
      }
    }

    // Remove duplicates keeping the most recently used
    for (const [ssid, profiles] of profilesBySSID.entries()) {
      if (profiles.length > 1) {
        // Sort by last used time
        const sortedProfiles = await Promise.all(
          profiles.map(async profile => {
            try {
              const { stdout } = await executeCommand(`nmcli -g timestamp connection show "${profile}"`);
              return { profile, timestamp: parseInt(stdout.trim()) || 0 };
            } catch {
              return { profile, timestamp: 0 };
            }
          })
        );

        sortedProfiles.sort((a, b) => b.timestamp - a.timestamp);

        // Keep the most recent, delete others
        for (const { profile } of sortedProfiles.slice(1)) {
          await executeCommand(`sudo nmcli connection delete "${profile}"`);
        }
      }
    }
  }

  async updateDeviceAuth(allowedMacs: string[]): Promise<void> {
    // Update DHCP config to only allow specific MAC addresses
    const config = allowedMacs.map(mac => `dhcp-host=${mac}`).join('\n');
    await fs.writeFile(this.dhcpConfigPath, config, { encoding: 'utf-8' });
    await executeCommand('sudo systemctl restart NetworkManager');
  }

  async updateDnsConfig(servers: string[]): Promise<void> {
    // Update dnsmasq config with custom DNS servers
    const config = servers.map(server => `server=${server}`).join('\n');
    await fs.writeFile(this.dnsmasqConfigPath, config, { encoding: 'utf-8' });
    await executeCommand('sudo systemctl restart NetworkManager');
  }

  async setHairpinNAT(enable: boolean): Promise<void> {
    // Enable/disable hairpin NAT for the hotspot
    if (enable) {
      await executeCommand('sudo sysctl -w net.ipv4.conf.all.route_localnet=1');
      await executeCommand('sudo iptables -t nat -A POSTROUTING -o wlan0 -j MASQUERADE');
    } else {
      await executeCommand('sudo sysctl -w net.ipv4.conf.all.route_localnet=0');
      await executeCommand('sudo iptables -t nat -D POSTROUTING -o wlan0 -j MASQUERADE');
    }
  }

  async runDiagnostics(deep = false): Promise<{
    networkStatus: any;
    dnsStatus: any;
    dhcpStatus: any;
    systemLogs?: string[];
  }> {
    const networkStatus = await executeCommand('nmcli device status');
    const dnsStatus = await executeCommand('cat /etc/resolv.conf');
    const dhcpStatus = await executeCommand('ps aux | grep dnsmasq');
    
    let systemLogs;
    if (deep) {
      const { stdout } = await executeCommand('journalctl -u NetworkManager -n 100');
      systemLogs = stdout.split('\n');
    }

    return {
      networkStatus: networkStatus.stdout,
      dnsStatus: dnsStatus.stdout,
      dhcpStatus: dhcpStatus.stdout,
      systemLogs
    };
  }

  async setDefaultConfig(id: string): Promise<void> {
    await fs.writeFile(this.defaultConfigPath, JSON.stringify({ id }), 'utf-8');
  }

  async getDefaultConfig(): Promise<string | null> {
    try {
      if (await fs.access(this.defaultConfigPath).then(() => true).catch(() => false)) {
        const data = await fs.readFile(this.defaultConfigPath, 'utf-8');
        const { id } = JSON.parse(data);
        return id;
      }
      return null;
    } catch (error) {
      console.error('Error reading default config:', error);
      return null;
    }
  }
}