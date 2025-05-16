
import fs from 'fs/promises';
import path from 'path';
import { ConfigManager, NetworkConfig } from './config.util';
import { WireGuardConfig } from '../interfaces/wireguard.interface';
import { executeCommand } from './command.util';
import { EncryptionUtil } from './encrypt.util';
import os from 'os';

export interface ExportData {
  version: string;
  timestamp: string;
  networks?: {
    id: string;
    config: NetworkConfig;
  }[];
  wireguard?: {
    config: WireGuardConfig;
    connectionName?: string;
  };
}

export class ExportImportManager {
  private configManager: ConfigManager;
  private exportDir: string;
  private currentVersion = '1.0.0';

  constructor() {
    this.configManager = new ConfigManager();
    this.exportDir = path.join(os.homedir(), 'wifi_exports');
  }

  async init(): Promise<void> {
    await fs.mkdir(this.exportDir, { recursive: true });
  }

  /**
   * Exports network configurations to a JSON file
   */
  async exportNetworkConfigs(fileName?: string): Promise<string> {
    await this.init();
    const configs = await this.configManager.listConfigs();
    
    // Create a deep copy and encrypt sensitive data before exporting
    const secureCopy = await Promise.all(configs.map(async ({ id, config }) => {
      const secureConfig = { ...config };
      
      // Encrypt password if present
      if (secureConfig.password) {
        secureConfig.password = await EncryptionUtil.encrypt(secureConfig.password);
      }
      
      return { id, config: secureConfig };
    }));
    
    const exportData: ExportData = {
      version: this.currentVersion,
      timestamp: new Date().toISOString(),
      networks: secureCopy
    };

    const outputFileName = fileName || `network_configs_${new Date().toISOString().replace(/:/g, '-')}.json`;
    const filePath = path.join(this.exportDir, outputFileName);
    
    await fs.writeFile(filePath, JSON.stringify(exportData, null, 2));
    return filePath;
  }

  /**
   * Imports network configurations from a JSON file
   */
  async importNetworkConfigs(filePath: string): Promise<{
    success: boolean;
    imported: number;
    errors?: string[];
  }> {
    try {
      const content = await fs.readFile(filePath, 'utf-8');
      const data = JSON.parse(content) as ExportData;
      
      if (!data.networks || !Array.isArray(data.networks)) {
        return { success: false, imported: 0, errors: ['Invalid export file format: networks array missing'] };
      }

      const errors: string[] = [];
      let importedCount = 0;

      for (const { id, config } of data.networks) {
        try {
          // Decrypt password if it's encrypted
          const importConfig = { ...config };
          
          if (importConfig.password && EncryptionUtil.isEncrypted(importConfig.password)) {
            try {
              importConfig.password = await EncryptionUtil.decrypt(importConfig.password);
            } catch (decryptError) {
              console.error(`Failed to decrypt password for config "${id}":`, decryptError);
              // Continue with encrypted password, which won't work but at least preserves the configuration
            }
          }
          
          await this.configManager.saveConfig(id, importConfig);
          importedCount++;
        } catch (error) {
          errors.push(`Failed to import configuration "${id}": ${error}`);
        }
      }

      return {
        success: importedCount > 0,
        imported: importedCount,
        errors: errors.length > 0 ? errors : undefined
      };
    } catch (error) {
      return {
        success: false,
        imported: 0,
        errors: [`Failed to read or parse export file: ${error}`]
      };
    }
  }

  /**
   * Exports WireGuard configuration to a JSON file
   */
  async exportWireGuardConfig(fileName?: string): Promise<string | null> {
    await this.init();
    try {
      // Read the WireGuard config file
      const { stdout: confContent } = await executeCommand('sudo cat /etc/wireguard/wg0.conf');
      
      if (!confContent.trim()) {
        throw new Error('WireGuard configuration not found');
      }

      // Parse the configuration
      const privateKeyMatch = confContent.match(/PrivateKey\s*=\s*([^\s]+)/);
      const addressMatch = confContent.match(/Address\s*=\s*([^\s]+)/);
      const dnsMatch = confContent.match(/DNS\s*=\s*([^\s]+)/);
      const publicKeyMatch = confContent.match(/PublicKey\s*=\s*([^\s]+)/);
      const endpointMatch = confContent.match(/Endpoint\s*=\s*([^\s]+)/);
      const allowedIPsMatch = confContent.match(/AllowedIPs\s*=\s*([^\n]+)/);
      const persistentKeepaliveMatch = confContent.match(/PersistentKeepalive\s*=\s*([^\s]+)/);

      if (!privateKeyMatch || !addressMatch || !publicKeyMatch || !endpointMatch || !allowedIPsMatch) {
        throw new Error('Invalid WireGuard configuration format');
      }

      // Create a secure copy of the configuration with encrypted private key
      const wgConfig: WireGuardConfig = {
        privateKey: await EncryptionUtil.encrypt(privateKeyMatch[1]), // Encrypt the private key
        address: addressMatch[1],
        publicKey: publicKeyMatch[1], // Public key can remain as-is since it's not sensitive
        endpoint: endpointMatch[1],
        allowedIPs: allowedIPsMatch[1].split(',').map(ip => ip.trim()),
        persistentKeepalive: persistentKeepaliveMatch ? parseInt(persistentKeepaliveMatch[1]) : undefined
      };

      if (dnsMatch) {
        wgConfig.dns = dnsMatch[1];
      }

      const exportData: ExportData = {
        version: this.currentVersion,
        timestamp: new Date().toISOString(),
        wireguard: {
          config: wgConfig,
          connectionName: 'wg0'
        }
      };

      const outputFileName = fileName || `wireguard_config_${new Date().toISOString().replace(/:/g, '-')}.json`;
      const filePath = path.join(this.exportDir, outputFileName);
      
      await fs.writeFile(filePath, JSON.stringify(exportData, null, 2));
      return filePath;
    } catch (error) {
      console.error('Failed to export WireGuard configuration:', error);
      return null;
    }
  }

  /**
   * Imports WireGuard configuration from a JSON file
   */
  async importWireGuardConfig(filePath: string): Promise<{
    success: boolean;
    errors?: string[];
  }> {
    try {
      const content = await fs.readFile(filePath, 'utf-8');
      const data = JSON.parse(content) as ExportData;
      
      if (!data.wireguard || !data.wireguard.config) {
        return { success: false, errors: ['Invalid export file format: WireGuard configuration missing'] };
      }

      const config = { ...data.wireguard.config };
      const connectionName = data.wireguard.connectionName || 'wg0';

      // Decrypt the private key if it's encrypted
      if (EncryptionUtil.isEncrypted(config.privateKey)) {
        try {
          config.privateKey = await EncryptionUtil.decrypt(config.privateKey);
        } catch (decryptError) {
          return { 
            success: false,
            errors: [`Failed to decrypt WireGuard private key: ${decryptError}`]
          };
        }
      }

      // Create WireGuard configuration
      const confContent = `[Interface]
PrivateKey = ${config.privateKey}
Address = ${config.address}
${config.dns ? `DNS = ${config.dns}` : ''}

[Peer]
PublicKey = ${config.publicKey}
AllowedIPs = ${config.allowedIPs.join(', ')}
Endpoint = ${config.endpoint}
PersistentKeepalive = ${config.persistentKeepalive || 25}`;

      // First make sure any existing WireGuard connection is stopped
      try {
        await executeCommand('sudo systemctl stop wg-quick@wg0', false);
        await executeCommand('sudo systemctl disable wg-quick@wg0', false);
      } catch {
        // Ignore errors if service doesn't exist
      }

      // Write the configuration to the file
      await executeCommand(`echo "${confContent}" | sudo tee /etc/wireguard/${connectionName}.conf > /dev/null`);
      await executeCommand(`sudo chmod 600 /etc/wireguard/${connectionName}.conf`);

      return { success: true };
    } catch (error) {
      return {
        success: false,
        errors: [`Failed to import WireGuard configuration: ${error}`]
      };
    }
  }
}
