import { executeCommand } from '../utils/command.util';
import { WireGuardService } from './wireguard.service';
import { NetworkService } from './network.service';
import { WireGuardConfig, WireGuardStatus } from '../interfaces/wireguard.interface';
import { NetworkConfig } from '../utils/config.util';
import { ExportImportManager } from '../utils/export-import.util';

export interface NetworkInfo {
  ssid: string;
  signal: number;
  freq: string;
  security: string[];
}

export class NetworkControl {
  private wireguard: WireGuardService;
  private networkService: NetworkService;
  private exportImportManager: ExportImportManager;

  constructor() {
    this.wireguard = new WireGuardService();
    this.networkService = new NetworkService();
    this.exportImportManager = new ExportImportManager();
  }

  async scanNetworks(): Promise<NetworkInfo[]> {
    try {
      const { stdout } = await executeCommand('nmcli -f SSID,SIGNAL,FREQ,SECURITY device wifi list');
      return this.parseNmcliOutput(stdout);
    } catch (error) {
      console.error('Failed to scan networks:', error);
      throw error;
    }
  }

  async connect(ssid: string, password?: string): Promise<boolean> {
    try {
      const command = password 
        ? `nmcli device wifi connect "${ssid}" password "${password}"`
        : `nmcli device wifi connect "${ssid}"`;
      await executeCommand(command);
      return true;
    } catch (error) {
      console.error('Failed to connect:', error);
      return false;
    }
  }

  async disconnect(): Promise<boolean> {
    try {
      await executeCommand('nmcli device disconnect wlan0');
      return true;
    } catch (error) {
      console.error('Failed to disconnect:', error);
      return false;
    }
  }

  async startHotspot(ssid: string, password: string): Promise<boolean> {
    try {
      await executeCommand(`nmcli device wifi hotspot ssid "${ssid}" password "${password}"`);
      // Enable hairpin NAT for hotspot mode
      await this.networkService.enableHairpinNAT();
      return true;
    } catch (error) {
      console.error('Failed to start hotspot:', error);
      return false;
    }
  }

  async stopHotspot(): Promise<boolean> {
    try {
      const { stdout } = await executeCommand('nmcli connection show --active');
      const hotspotConn = stdout.split('\n')
        .find(line => line.includes('Hotspot'));
      
      if (hotspotConn) {
        const connName = hotspotConn.split(' ')[0];
        await executeCommand(`nmcli connection down "${connName}"`);
        // Disable hairpin NAT when stopping hotspot
        await this.networkService.disableHairpinNAT();
      }
      return true;
    } catch (error) {
      console.error('Failed to stop hotspot:', error);
      return false;
    }
  }

  async getStatus(): Promise<{
    connected: boolean;
    ssid?: string;
    mode: string;
    signal?: number;
    freq?: string;
    bitrate?: string;
    security?: string[];
    ipAddress?: string;
    gateway?: string;
  }> {
    try {
      // Get device status
      const { stdout: devStatus } = await executeCommand('nmcli device status');
      const wifiLine = devStatus.split('\n')
        .find(line => line.includes('wifi'));
      
      if (!wifiLine) {
        return { connected: false, mode: 'disconnected' };
      }

      const [device, type, state, connection] = wifiLine.split(/\s+/);
      const isConnected = state === 'connected';
      
      if (!isConnected) {
        return { connected: false, mode: type };
      }

      // Get connection details
      const { stdout: connDetails } = await executeCommand('nmcli -f SIGNAL,FREQ,RATE,SECURITY device wifi list --rescan no');
      const currentNetwork = connDetails.split('\n')
        .slice(1)
        .find(line => line.includes('*'));

      let signal, freq, bitrate, security;
      if (currentNetwork) {
        const [signalStr, freqStr, rateStr, ...securityParts] = currentNetwork.trim().replace('*', '').trim().split(/\s+/);
        signal = parseInt(signalStr, 10);
        freq = freqStr;
        bitrate = rateStr;
        security = securityParts;
      }

      // Get IP configuration
      const { stdout: ipConfig } = await executeCommand(`nmcli -g IP4.ADDRESS,IP4.GATEWAY connection show "${connection}"`);
      const [ipAddress, gateway] = ipConfig.split('\n').map(line => line.split('/')[0]);
      
      return {
        connected: true,
        ssid: connection !== '--' ? connection : undefined,
        mode: type,
        signal,
        freq,
        bitrate,
        security,
        ipAddress,
        gateway
      };
    } catch (error) {
      console.error('Failed to get status:', error);
      return { connected: false, mode: 'unknown' };
    }
  }

  private parseNmcliOutput(output: string): NetworkInfo[] {
    const lines = output.split('\n')
      .slice(1) // Skip header
      .filter(line => line.trim());
    
    return lines.map(line => {
      const [ssid, signal, freq, ...securityParts] = line.trim().split(/\s+/);
      return {
        ssid,
        signal: parseInt(signal, 10),
        freq,
        security: securityParts
      };
    });
  }

  // Configuration Management
  async saveCurrentSetup(id: string): Promise<void> {
    const status = await this.getStatus();
    await this.networkService.saveCurrentConfig(id, status);
  }

  async activateConfig(id: string): Promise<boolean> {
    const config = await this.networkService.activateConfig(id);
    if (config.mode === 'hotspot') {
      return this.startHotspot(config.ssid, config.password!);
    } else {
      return this.connect(config.ssid, config.password);
    }
  }

  async listConfigs(): Promise<Array<{ id: string; config: NetworkConfig }>> {
    return this.networkService.listSavedConfigs();
  }

  async deduplicateConfigs(): Promise<void> {
    await this.networkService.deduplicateConfigs();
  }

  // Device Management
  async updateDeviceAuth(allowedMacs: string[]): Promise<void> {
    await this.networkService.updateDeviceAuth(allowedMacs);
  }

  async updateDnsConfig(servers: string[]): Promise<void> {
    await this.networkService.updateDnsConfig(servers);
  }

  // Diagnostics
  async runDiagnostics(deep = false): Promise<any> {
    const networkDiag = await this.networkService.runDiagnostics(deep);
    const vpnStatus = await this.wireguard.getStatus();
    return {
      ...networkDiag,
      vpnStatus
    };
  }

  // WireGuard VPN
  async setupWireGuardWithQR(config: {
    endpoint: string;
    allowedIPs: string[];
    dns?: string;
    listenPort?: number;
    privateKey?: string;
  }): Promise<{ success: boolean; config?: WireGuardConfig }> {
    return this.wireguard.setup(config);
  }

  async getWireGuardStatus(): Promise<WireGuardStatus> {
    return this.wireguard.getStatus();
  }

  async stopWireGuard(): Promise<boolean> {
    return this.wireguard.stop();
  }

  // Connected Devices Management
  
  /**
   * Gets information about all devices connected to the hotspot
   */
  async getConnectedDevices(): Promise<Array<{
    ip: string;
    mac: string;
    hostname?: string;
    lastSeen?: string;
  }>> {
    try {
      // Check if we're in hotspot mode
      const status = await this.getStatus();
      if (!status.connected || status.mode !== 'ap') {
        return [];
      }

      const devices: Array<{
        ip: string;
        mac: string;
        hostname?: string;
        lastSeen?: string;
      }> = [];

      // Get device info from the ARP table
      const { stdout: arpOutput } = await executeCommand('arp -a');
      const arpLines = arpOutput.split('\n');

      // Get device info from dnsmasq lease file
      let leaseOutput = '';
      try {
        const { stdout } = await executeCommand('cat /var/lib/misc/dnsmasq.leases');
        leaseOutput = stdout;
      } catch (error) {
        // If dnsmasq leases file doesn't exist or can't be read, continue with ARP only
        console.error('Failed to read DHCP leases:', error);
      }
      const leaseLines = leaseOutput.split('\n');

      // Extract devices from ARP table
      for (const line of arpLines) {
        if (!line.includes('wlan0')) continue;

        const match = line.match(/\((\d+\.\d+\.\d+\.\d+)\) at ([0-9a-f:]+)/i);
        if (match) {
          const ip = match[1];
          const mac = match[2].toLowerCase();

          // Find hostname from leases if available
          const leaseInfo = leaseLines.find(lease => lease.includes(mac));
          let hostname;
          let lastSeen;
          
          if (leaseInfo) {
            const leaseParts = leaseInfo.split(' ');
            if (leaseParts.length >= 4) {
              hostname = leaseParts[3] !== '*' ? leaseParts[3] : undefined;
              // Convert lease timestamp to readable date
              const timestamp = parseInt(leaseParts[0]);
              if (!isNaN(timestamp)) {
                lastSeen = new Date(timestamp * 1000).toLocaleString();
              }
            }
          }

          devices.push({
            ip,
            mac,
            hostname,
            lastSeen
          });
        }
      }

      return devices;
    } catch (error) {
      console.error('Failed to get connected devices:', error);
      return [];
    }
  }

  /**
   * Gets detailed information about a specific device
   */
  async getDeviceDetails(ip: string): Promise<{
    ip: string;
    mac?: string;
    hostname?: string;
    vendor?: string;
    openPorts?: string[];
    pingResponse?: string;
    networkActivity?: string;
    dhcpInfo?: string;
    connectionTime?: string;
    signalStrength?: string;
  }> {
    try {
      const details: {
        ip: string;
        mac?: string;
        hostname?: string;
        vendor?: string;
        openPorts?: string[];
        pingResponse?: string;
        networkActivity?: string;
        dhcpInfo?: string;
        connectionTime?: string;
        signalStrength?: string;
      } = { ip };

      // Try to get MAC address
      try {
        const { stdout: arpOutput } = await executeCommand(`arp -a | grep ${ip}`);
        const macMatch = arpOutput.match(/at\s+([0-9a-f:]+)/i);
        if (macMatch) {
          details.mac = macMatch[1].toLowerCase();
        }
      } catch (error) {
        // Continue even if we can't get MAC
      }

      // Try to get hostname
      try {
        const { stdout } = await executeCommand(`nslookup ${ip} | grep name`);
        const nameMatch = stdout.match(/name\s*=\s*([^\s\.]+)/);
        if (nameMatch) {
          details.hostname = nameMatch[1];
        }
      } catch (error) {
        // Continue even if we can't get hostname
      }

      // Try to get ping response
      try {
        const { stdout } = await executeCommand(`ping -c 3 -W 1 ${ip}`);
        details.pingResponse = stdout.split('\n')
          .filter(line => line.includes('transmitted') || line.includes('min/avg/max'))
          .join('\n');
      } catch (error) {
        details.pingResponse = 'No response';
      }

      // Try to get signal strength for this device (if available)
      try {
        const { stdout } = await executeCommand(`iw dev wlan0 station dump | grep -A 15 ${details.mac || ''}`);
        const signalMatch = stdout.match(/signal:\s+(-\d+)/);
        if (signalMatch) {
          details.signalStrength = `${signalMatch[1]} dBm`;
        }

        const connTimeMatch = stdout.match(/connected time:\s+(\d+) seconds/);
        if (connTimeMatch) {
          const seconds = parseInt(connTimeMatch[1]);
          const hours = Math.floor(seconds / 3600);
          const minutes = Math.floor((seconds % 3600) / 60);
          const remainingSeconds = seconds % 60;
          details.connectionTime = `${hours}h ${minutes}m ${remainingSeconds}s`;
        }
      } catch (error) {
        // Continue even if we can't get signal strength
      }

      // Check for open ports
      try {
        const { stdout } = await executeCommand(`sudo nmap -sS -T4 -p 22,53,80,443,8080 ${ip}`);
        const openPorts = [];
        const portMatches = stdout.matchAll(/(\d+)\/tcp\s+open\s+(\S+)/g);
        for (const match of portMatches) {
          openPorts.push(`${match[1]} (${match[2]})`);
        }
        if (openPorts.length > 0) {
          details.openPorts = openPorts;
        }
      } catch (error) {
        // Continue even if nmap fails
      }

      // Get network activity
      try {
        const { stdout } = await executeCommand(`sudo tcpdump -i wlan0 -n src host ${ip} -c 5 -t`);
        details.networkActivity = stdout;
      } catch (error) {
        // Continue even if tcpdump fails
      }

      // Get DHCP information
      if (details.mac) {
        try {
          const { stdout } = await executeCommand(`cat /var/lib/misc/dnsmasq.leases | grep ${details.mac}`);
          if (stdout) {
            details.dhcpInfo = stdout;
          }
        } catch (error) {
          // Continue even if we can't get DHCP info
        }
      }

      return details;
    } catch (error) {
      console.error(`Failed to get details for device ${ip}:`, error);
      return { ip };
    }
  }

  /**
   * Gets the hotspot password for the active hotspot connection
   */
  async getHotspotPassword(ssid: string): Promise<string | undefined> {
    try {
      const { stdout } = await executeCommand(`nmcli -s -g 802-11-wireless-security.psk connection show "${ssid}"`);
      return stdout.trim();
    } catch (error) {
      console.error('Failed to get hotspot password:', error);
      return undefined;
    }
  }

  // Export and Import
  
  /**
   * Exports network configurations to a file
   */
  async exportNetworkConfigs(fileName?: string): Promise<string> {
    return this.exportImportManager.exportNetworkConfigs(fileName);
  }

  /**
   * Imports network configurations from a file
   */
  async importNetworkConfigs(filePath: string): Promise<{
    success: boolean;
    imported: number;
    errors?: string[];
  }> {
    return this.exportImportManager.importNetworkConfigs(filePath);
  }

  /**
   * Exports WireGuard configuration to a file
   */
  async exportWireGuardConfig(fileName?: string): Promise<string | null> {
    return this.exportImportManager.exportWireGuardConfig(fileName);
  }

  /**
   * Imports WireGuard configuration from a file
   */
  async importWireGuardConfig(filePath: string): Promise<{
    success: boolean;
    errors?: string[];
  }> {
    return this.exportImportManager.importWireGuardConfig(filePath);
  }
}
