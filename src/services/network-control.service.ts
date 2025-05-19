import { executeCommand } from '../utils/command.util';
import { WireGuardService } from './wireguard.service';
import { NetworkService } from './network.service';
import { WireGuardConfig, WireGuardStatus } from '../interfaces/wireguard.interface';
import { NetworkConfig } from '../utils/config.util';
import { ExportImportManager } from '../utils/export-import.util';
import { WiFiNetwork } from '../interfaces/wifi.interface';

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

  // Network scanning and connection methods

  async scanNetworks(): Promise<WiFiNetwork[]> {
    try {
      const command = `nmcli -g SSID,SIGNAL,SECURITY,FREQ device wifi list --rescan yes`;

      const { stdout } = await executeCommand(command);

      const networks: WiFiNetwork[] = [];
      const outputLines = stdout.split('\n').filter(line => line.trim() !== '');

      for (const line of outputLines) {
        const fields = line.split(':');

        if (fields.length >= 3) {
          const ssid = fields[0] ? fields[0].replace(/\\:/g, ':').trim() : '';
          const signalStrengthStr = fields[1] || '0';
          const securityString = fields[2] || '';
          const frequency = fields.length > 3 && fields[3] ? fields[3].replace(/\\:/g, ':').trim() : '';

          if (ssid) {
            const signal = parseInt(signalStrengthStr, 10);
            networks.push({
              ssid: ssid,
              signal: isNaN(signal) ? 0 : signal,
              security: securityString.trim() ? securityString.trim().split(/\s+/).filter(s => s) : [],
              freq: frequency
            });
          }
        }
      }

      return networks.filter(n => n.ssid);
    } catch (e) {
      interface CommandError extends Error {
        cmd?: string;
        stdout?: string;
        stderr?: string;
        code?: number;
        killed?: boolean;
        signal?: NodeJS.Signals | null;
      }

      const error = e as CommandError;

      console.error('Failed to scan networks:', error.message || error);
      if (error && error.cmd && typeof error.stdout === 'string') {
        console.error(`Command was: ${error.cmd}`);
        console.error(`Command stdout was:\n${error.stdout}`);
      }
      if (error && error.cmd && typeof error.stderr === 'string') {
        console.error(`Command stderr was:\n${error.stderr}`);
      }
      return [];
    }
  }

  async connect(ssid: string, password?: string): Promise<boolean> {
    try {
      const command = password
        ? `nmcli device wifi connect "${ssid}" password "${password}"`
        : `nmcli device wifi connect "${ssid}"`;
      await executeCommand(command);
      return true;
    } catch (e) {
      interface CommandError extends Error {
        cmd?: string;
        stdout?: string;
        stderr?: string;
        code?: number;
        killed?: boolean;
        signal?: NodeJS.Signals | null;
      }

      const error = e as CommandError;
      console.error('Failed to connect:', error.message || error);
      if (error.cmd) console.error(`Command was: ${error.cmd}`);
      return false;
    }
  }

  async disconnect(): Promise<boolean> {
    try {
      await executeCommand('nmcli device disconnect wlan0');
      return true;
    } catch (e) {
      interface CommandError extends Error {
        cmd?: string;
        stdout?: string;
        stderr?: string;
        code?: number;
        killed?: boolean;
        signal?: NodeJS.Signals | null;
      }

      const error = e as CommandError;
      console.error('Failed to disconnect:', error.message || error);
      if (error.cmd) console.error(`Command was: ${error.cmd}`);
      return false;
    }
  }

  async startHotspot(ssid: string, password: string): Promise<boolean> {
    try {
      await executeCommand(`nmcli device wifi hotspot ssid "${ssid}" password "${password}"`);
      await this.networkService.enableHairpinNAT();
      return true;
    } catch (e) {
      interface CommandError extends Error {
        cmd?: string;
        stdout?: string;
        stderr?: string;
        code?: number;
        killed?: boolean;
        signal?: NodeJS.Signals | null;
      }

      const error = e as CommandError;
      console.error('Failed to start hotspot:', error.message || error);
      if (error.cmd) console.error(`Command was: ${error.cmd}`);
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
        await this.networkService.disableHairpinNAT();
      }
      return true;
    } catch (e) {
      interface CommandError extends Error {
        cmd?: string;
        stdout?: string;
        stderr?: string;
        code?: number;
        killed?: boolean;
        signal?: NodeJS.Signals | null;
      }

      const error = e as CommandError;
      console.error('Failed to stop hotspot:', error.message || error);
      if (error.cmd) console.error(`Command was: ${error.cmd}`);
      return false;
    }
  }

  async getStatus(): Promise<{
    connected: boolean;
    ssid?: string;
    mode: string; // 'wifi', 'ap', 'ethernet', 'disconnected', 'unknown'
    signal?: number;
    freq?: string;
    bitrate?: string;
    security?: string[];
    ipAddress?: string;
    gateway?: string;
    macAddress?: string;
    interfaceName?: string;
  }> {
    try {
      const { stdout: devStatusOutput } = await executeCommand('nmcli device status');
      const wifiDeviceLine = devStatusOutput.split('\n').find(line => line.startsWith('wlan0') || line.startsWith('wifi'));

      if (!wifiDeviceLine) {
        // Check for ethernet if no wifi line
        const ethDeviceLine = devStatusOutput.split('\n').find(line => (line.startsWith('eth0') || line.startsWith('ethernet')) && line.includes('connected'));
        if (ethDeviceLine) {
          const ethParts = ethDeviceLine.trim().split(/\s{2,}/);
          const ethInterfaceName = ethParts[0];
          const ethActiveConnectionName = ethParts.length > 3 ? ethParts.slice(3).join(' ') : 'Ethernet Connection';
          try {
            // For ethernet, GENERAL.HWADDR might work on the device, or we get it from ip link
            let macAddress;
            try {
              const { stdout: macStdout } = await executeCommand(`nmcli -g GENERAL.HWADDR dev show ${ethInterfaceName}`);
              macAddress = macStdout.trim();
            } catch (macError) {
              console.warn(`Could not get MAC for ${ethInterfaceName} via nmcli, trying ip link.`);
              // Fallback to ip link show
              const { stdout: ipLinkOut } = await executeCommand(`ip -brief link show ${ethInterfaceName}`);
              const match = ipLinkOut.match(/([0-9a-f]{2}:){5}[0-9a-f]{2}/i);
              if (match) macAddress = match[0];
            }

            const { stdout: ipConfig } = await executeCommand(`nmcli -g IP4.ADDRESS,IP4.GATEWAY connection show "${ethActiveConnectionName}"`);
            const [ipLine, gatewayLine] = ipConfig.split('\n');
            const ipAddress = ipLine ? ipLine.split('/')[0] : undefined;
            const gateway = gatewayLine ? gatewayLine.split('/')[0] : undefined;
            return { connected: true, mode: 'ethernet', ssid: ethActiveConnectionName, ipAddress, gateway, macAddress, interfaceName: ethInterfaceName };
          } catch (ipError) {
            console.warn(`Could not get IP details for ethernet connection ${ethActiveConnectionName}:`, ipError);
            return { connected: true, mode: 'ethernet', ssid: ethActiveConnectionName, interfaceName: ethInterfaceName };
          }
        }
        return { connected: false, mode: 'disconnected' };
      }

      const devParts = wifiDeviceLine.trim().split(/\s{2,}/);
      const interfaceName = devParts[0]; // This should be our wlan0 (or similar)
      const type = devParts[1];
      const state = devParts[2];
      let activeConnectionName = devParts.length > 3 ? devParts.slice(3).join(' ') : undefined;

      const isConnected = state === 'connected' && !!activeConnectionName && activeConnectionName !== '--';

      if (!isConnected || !activeConnectionName) {
        return { connected: false, mode: type === 'wifi' ? 'disconnected' : type, interfaceName };
      }

      let signal, freq, bitrate, securityTypes, macAddress;
      try {
        const { stdout: activeWifiDetails } = await executeCommand(`nmcli -t -f ACTIVE,SSID,SIGNAL,FREQ,RATE,SECURITY dev wifi list`);
        const activeLine = activeWifiDetails.split('\n').find(line => line.startsWith('yes:'));

        if (activeLine) {
          const parts = activeLine.split(':');
          // activeConnectionName = parts[1].replace(/\\:/g, ':'); // SSID from this command
          signal = parseInt(parts[2], 10);
          freq = parts[3].replace(/\\:/g, ':');
          bitrate = parts[4];
          securityTypes = parts[5] ? parts[5].trim().split(/\s+/).filter(s => s) : [];
        }
      } catch (wifiDetailsError) {
        console.warn(`Could not get detailed Wi-Fi info for ${activeConnectionName}:`, wifiDetailsError);
      }

      // Get MAC address for the specific Wi-Fi interface (e.g., wlan0)
      try {
        const { stdout: macStdout } = await executeCommand(`nmcli -g GENERAL.HWADDR dev show ${interfaceName}`);
        macAddress = macStdout.trim();
      } catch (macError) {
        console.warn(`Could not get MAC for ${interfaceName} via nmcli dev show, trying ip link.`);
        try {
          const { stdout: ipLinkOut } = await executeCommand(`ip -brief link show ${interfaceName}`);
          const match = ipLinkOut.match(/([0-9a-f]{2}:){5}[0-9a-f]{2}/i);
          if (match) macAddress = match[0];
        } catch (ipLinkError) {
          console.warn(`Failed to get MAC for ${interfaceName} via ip link:`, ipLinkError);
        }
      }

      let ipAddress, gateway;
      try {
        // Now get IP and Gateway for the connection, without GENERAL.HWADDR
        const { stdout: ipConfig } = await executeCommand(`nmcli -g IP4.ADDRESS,IP4.GATEWAY connection show "${activeConnectionName}"`);
        const [ipLine, gatewayLine] = ipConfig.split('\n'); // Expecting two lines
        ipAddress = ipLine ? ipLine.split('/')[0] : undefined;
        gateway = gatewayLine ? gatewayLine.split('/')[0] : undefined;
      } catch (ipError) {
        console.warn(`Could not get IP details for ${activeConnectionName}:`, ipError);
      }

      return {
        connected: true,
        ssid: activeConnectionName.replace(/\\:/g, ':'),
        mode: 'wifi',
        signal: isNaN(signal!) ? undefined : signal,
        freq,
        bitrate,
        security: securityTypes,
        ipAddress,
        gateway,
        macAddress, // MAC address obtained from 'nmcli dev show'
        interfaceName
      };
    } catch (e) {
      interface CommandError extends Error {
        cmd?: string;
        stdout?: string;
        stderr?: string;
        code?: number;
        killed?: boolean;
        signal?: NodeJS.Signals | null;
      }
      const error = e as CommandError;
      console.error('Failed to get status:', error.message || error);
      if (error.cmd) console.error(`Command was: ${error.cmd}`);
      if (error.stdout) console.error(`Stdout: ${error.stdout}`);
      if (error.stderr) console.error(`Stderr: ${error.stderr}`);
      return { connected: false, mode: 'unknown' };
    }
  }

  // Configuration Management
  async saveCurrentSetup(id: string): Promise<void> {
    const status = await this.getStatus();
    await this.networkService.saveCurrentConfig(id, status);
  }

  async activateConfig(id: string): Promise<boolean> {
    try {
      const config = await this.networkService.activateConfig(id);
      if (config.mode === 'hotspot') {
        const result = await this.startHotspot(config.ssid, config.password!);
        console.log(`WorkHive: Activated hotspot with SSID: ${config.ssid}`);
        return result;
      } else {
        const result = await this.connect(config.ssid, config.password);
        if (result && config.vpnEnabled) {
          console.log(`WorkHive: Connected to ${config.ssid}, starting VPN...`);
          await this.wireguard.startVPN();
        } else {
          console.log(`WorkHive: Connected to ${config.ssid}`);
        }
        return result;
      }
    } catch (e) {
      interface CommandError extends Error {
        cmd?: string;
        stdout?: string;
        stderr?: string;
        code?: number;
        killed?: boolean;
        signal?: NodeJS.Signals | null;
      }

      const error = e as CommandError;
      console.error(`Failed to activate config ${id}:`, error.message || error);
      if (error.cmd) console.error(`Command was: ${error.cmd}`);
      return false;
    }
  }

  async listConfigs(): Promise<Array<{ id: string; config: NetworkConfig }>> {
    return this.networkService.listSavedConfigs();
  }

  async deduplicateConfigs(): Promise<void> {
    await this.networkService.deduplicateConfigs();
  }

  async getDefaultConfig(): Promise<string | null> {
    return this.networkService.getDefaultConfig();
  }

  async setDefaultConfig(id: string): Promise<void> {
    return this.networkService.setDefaultConfig(id);
  }

  async reconnectLastWifi(): Promise<boolean> {
    try {
      const { stdout } = await executeCommand('nmcli -t -f NAME connection show');
      const connections = stdout.trim().split('\n');

      for (const connection of connections) {
        if (connection && connection !== 'lo') {
          try {
            console.log(`Attempting to connect to saved network: ${connection}`);
            await executeCommand(`nmcli connection up "${connection}"`);
            console.log(`Successfully connected to ${connection}`);
            return true;
          } catch (e) {
            interface CommandError extends Error {
              cmd?: string;
              stdout?: string;
              stderr?: string;
              code?: number;
              killed?: boolean;
              signal?: NodeJS.Signals | null;
            }

            const error = e as CommandError;
            console.log(`Failed to connect to ${connection}:`, error.message || error);
            if (error.cmd) console.error(`Command was: ${error.cmd}`);
          }
        }
      }
      return false;
    } catch (e) {
      interface CommandError extends Error {
        cmd?: string;
        stdout?: string;
        stderr?: string;
        code?: number;
        killed?: boolean;
        signal?: NodeJS.Signals | null;
      }

      const error = e as CommandError;
      console.error('Failed to reconnect to last WiFi:', error.message || error);
      if (error.cmd) console.error(`Command was: ${error.cmd}`);
      return false;
    }
  }

  // VPN Management
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

  async getConnectedDevices(): Promise<Array<{
    ip: string;
    mac: string;
    hostname?: string;
    lastSeen?: string;
  }>> {
    try {
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

      const { stdout: arpOutput } = await executeCommand('arp -a');
      const arpLines = arpOutput.split('\n');

      let leaseOutput = '';
      try {
        const { stdout } = await executeCommand('cat /var/lib/misc/dnsmasq.leases');
        leaseOutput = stdout;
      } catch (e) {
        interface CommandError extends Error {
          cmd?: string;
          stdout?: string;
          stderr?: string;
          code?: number;
          killed?: boolean;
          signal?: NodeJS.Signals | null;
        }

        const error = e as CommandError;
        console.error('Failed to read DHCP leases:', error.message || error);
        if (error.cmd) console.error(`Command was: ${error.cmd}`);
      }
      const leaseLines = leaseOutput.split('\n');

      for (const line of arpLines) {
        if (!line.includes('wlan0')) continue;

        const match = line.match(/\((\d+\.\d+\.\d+\.\d+)\) at ([0-9a-f:]+)/i);
        if (match) {
          const ip = match[1];
          const mac = match[2].toLowerCase();

          const leaseInfo = leaseLines.find(lease => lease.includes(mac));
          let hostname;
          let lastSeen;

          if (leaseInfo) {
            const leaseParts = leaseInfo.split(' ');
            if (leaseParts.length >= 4) {
              hostname = leaseParts[3] !== '*' ? leaseParts[3] : undefined;
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
    } catch (e) {
      interface CommandError extends Error {
        cmd?: string;
        stdout?: string;
        stderr?: string;
        code?: number;
        killed?: boolean;
        signal?: NodeJS.Signals | null;
      }

      const error = e as CommandError;
      console.error('Failed to get connected devices:', error.message || error);
      if (error.cmd) console.error(`Command was: ${error.cmd}`);
      return [];
    }
  }

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

      try {
        const { stdout: arpOutput } = await executeCommand(`arp -a | grep ${ip}`);
        const macMatch = arpOutput.match(/at\s+([0-9a-f:]+)/i);
        if (macMatch) {
          details.mac = macMatch[1].toLowerCase();
        }
      } catch (e) {
        interface CommandError extends Error {
          cmd?: string;
          stdout?: string;
          stderr?: string;
          code?: number;
          killed?: boolean;
          signal?: NodeJS.Signals | null;
        }

        const error = e as CommandError;
        console.error('Failed to get MAC address:', error.message || error);
        if (error.cmd) console.error(`Command was: ${error.cmd}`);
      }

      try {
        const { stdout } = await executeCommand(`nslookup ${ip} | grep name`);
        const nameMatch = stdout.match(/name\s*=\s*([^\s\.]+)/);
        if (nameMatch) {
          details.hostname = nameMatch[1];
        }
      } catch (e) {
        interface CommandError extends Error {
          cmd?: string;
          stdout?: string;
          stderr?: string;
          code?: number;
          killed?: boolean;
          signal?: NodeJS.Signals | null;
        }

        const error = e as CommandError;
        console.error('Failed to get hostname:', error.message || error);
        if (error.cmd) console.error(`Command was: ${error.cmd}`);
      }

      try {
        const { stdout } = await executeCommand(`ping -c 3 -W 1 ${ip}`);
        details.pingResponse = stdout.split('\n')
          .filter(line => line.includes('transmitted') || line.includes('min/avg/max'))
          .join('\n');
      } catch (e) {
        interface CommandError extends Error {
          cmd?: string;
          stdout?: string;
          stderr?: string;
          code?: number;
          killed?: boolean;
          signal?: NodeJS.Signals | null;
        }

        const error = e as CommandError;
        console.error('Failed to get ping response:', error.message || error);
        if (error.cmd) console.error(`Command was: ${error.cmd}`);
        details.pingResponse = 'No response';
      }

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
      } catch (e) {
        interface CommandError extends Error {
          cmd?: string;
          stdout?: string;
          stderr?: string;
          code?: number;
          killed?: boolean;
          signal?: NodeJS.Signals | null;
        }

        const error = e as CommandError;
        console.error('Failed to get signal strength:', error.message || error);
        if (error.cmd) console.error(`Command was: ${error.cmd}`);
      }

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
      } catch (e) {
        interface CommandError extends Error {
          cmd?: string;
          stdout?: string;
          stderr?: string;
          code?: number;
          killed?: boolean;
          signal?: NodeJS.Signals | null;
        }

        const error = e as CommandError;
        console.error('Failed to get open ports:', error.message || error);
        if (error.cmd) console.error(`Command was: ${error.cmd}`);
      }

      try {
        const { stdout } = await executeCommand(`sudo tcpdump -i wlan0 -n src host ${ip} -c 5 -t`);
        details.networkActivity = stdout;
      } catch (e) {
        interface CommandError extends Error {
          cmd?: string;
          stdout?: string;
          stderr?: string;
          code?: number;
          killed?: boolean;
          signal?: NodeJS.Signals | null;
        }

        const error = e as CommandError;
        console.error('Failed to get network activity:', error.message || error);
        if (error.cmd) console.error(`Command was: ${error.cmd}`);
      }

      if (details.mac) {
        try {
          const { stdout } = await executeCommand(`cat /var/lib/misc/dnsmasq.leases | grep ${details.mac}`);
          if (stdout) {
            details.dhcpInfo = stdout;
          }
        } catch (e) {
          interface CommandError extends Error {
            cmd?: string;
            stdout?: string;
            stderr?: string;
            code?: number;
            killed?: boolean;
            signal?: NodeJS.Signals | null;
          }

          const error = e as CommandError;
          console.error('Failed to get DHCP info:', error.message || error);
          if (error.cmd) console.error(`Command was: ${error.cmd}`);
        }
      }

      return details;
    } catch (e) {
      interface CommandError extends Error {
        cmd?: string;
        stdout?: string;
        stderr?: string;
        code?: number;
        killed?: boolean;
        signal?: NodeJS.Signals | null;
      }

      const error = e as CommandError;
      console.error(`Failed to get details for device ${ip}:`, error.message || error);
      if (error.cmd) console.error(`Command was: ${error.cmd}`);
      return { ip };
    }
  }

  async getHotspotPassword(ssid: string): Promise<string | undefined> {
    try {
      const { stdout } = await executeCommand(`nmcli -s -g 802-11-wireless-security.psk connection show "${ssid}"`);
      return stdout.trim();
    } catch (e) {
      interface CommandError extends Error {
        cmd?: string;
        stdout?: string;
        stderr?: string;
        code?: number;
        killed?: boolean;
        signal?: NodeJS.Signals | null;
      }

      const error = e as CommandError;
      console.error('Failed to get hotspot password:', error.message || error);
      if (error.cmd) console.error(`Command was: ${error.cmd}`);
      return undefined;
    }
  }

  async exportNetworkConfigs(fileName?: string): Promise<string> {
    return this.exportImportManager.exportNetworkConfigs(fileName);
  }

  async importNetworkConfigs(filePath: string): Promise<{
    success: boolean;
    imported: number;
    errors?: string[];
  }> {
    return this.exportImportManager.importNetworkConfigs(filePath);
  }

  async exportWireGuardConfig(fileName?: string): Promise<string | null> {
    return this.exportImportManager.exportWireGuardConfig(fileName);
  }

  async importWireGuardConfig(filePath: string): Promise<{
    success: boolean;
    errors?: string[];
  }> {
    return this.exportImportManager.importWireGuardConfig(filePath);
  }

  async updateDeviceAuth(allowedMacs: string[]): Promise<void> {
    return this.networkService.updateDeviceAuth(allowedMacs);
  }

  async updateDnsConfig(servers: string[]): Promise<void> {
    return this.networkService.updateDnsConfig(servers);
  }

  async runDiagnostics(deep = false): Promise<any> {
    return this.networkService.runDiagnostics(deep);
  }
}
