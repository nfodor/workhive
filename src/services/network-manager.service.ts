import * as dbus from 'dbus-next';
import { NetworkManagerService } from '../interfaces/network-manager.interface';
import { WiFiNetwork, WiFiConnectionConfig, HotspotConfig } from '../interfaces/wifi.interface';
import { executeCommand } from '../utils/command.util';
import { NMConnection } from '../interfaces/nm-connection.interface';

export class NetworkManager implements NetworkManagerService {
  private bus!: dbus.MessageBus;
  private nmService!: dbus.ProxyObject;
  private devicePath?: string;

  constructor() {
    this.initialize().catch(console.error);
  }

  private async initialize() {
    try {
      // Connect to the system bus
      this.bus = dbus.systemBus();
      
      // Ensure NetworkManager is running
      try {
        await this.bus.requestName('org.freedesktop.NetworkManager.Test', 0);
        await this.bus.releaseName('org.freedesktop.NetworkManager.Test');
      } catch (e) {
        throw new Error('NetworkManager is not running. Please start it with: sudo systemctl start NetworkManager');
      }
      
      // Get NetworkManager service proxy
      this.nmService = await this.bus.getProxyObject(
        'org.freedesktop.NetworkManager',
        '/org/freedesktop/NetworkManager'
      );
      
      // Verify we can access NetworkManager
      const nm = this.nmService.getInterface('org.freedesktop.NetworkManager');
      await nm.GetDevices();
    } catch (error) {
      console.error('Failed to initialize NetworkManager:', error);
      throw new Error('Could not connect to NetworkManager. Make sure it is installed and running.');
    }
  }

  private async getWirelessDevice(): Promise<string> {
    if (this.devicePath) return this.devicePath;
    
    const nm = this.nmService.getInterface('org.freedesktop.NetworkManager');
    const devices = await nm.GetDevices();
    
    for (const device of devices) {
      const deviceObj = await this.bus.getProxyObject('org.freedesktop.NetworkManager', device);
      const deviceProps = deviceObj.getInterface('org.freedesktop.DBus.Properties');
      const deviceType = await deviceProps.Get('org.freedesktop.NetworkManager.Device', 'DeviceType');
      
      if (deviceType === 2) { // WiFi device
        this.devicePath = device;
        return device;
      }
    }
    throw new Error('No wireless device found');
  }

  async scanNetworks(): Promise<WiFiNetwork[]> {
    try {
      const devicePath = await this.getWirelessDevice();
      const device = await this.bus.getProxyObject('org.freedesktop.NetworkManager', devicePath);
      const wifi = device.getInterface('org.freedesktop.NetworkManager.Device.Wireless');
      
      await wifi.RequestScan({});
      await new Promise(resolve => setTimeout(resolve, 2000)); // Wait for scan
      
      const accessPoints = await wifi.GetAccessPoints();
      const networks: WiFiNetwork[] = [];
      
      for (const ap of accessPoints) {
        const apObj = await this.bus.getProxyObject('org.freedesktop.NetworkManager', ap);
        const apProps = apObj.getInterface('org.freedesktop.DBus.Properties');
        
        const ssid = await apProps.Get('org.freedesktop.NetworkManager.AccessPoint', 'Ssid');
        const strength = await apProps.Get('org.freedesktop.NetworkManager.AccessPoint', 'Strength');
        const flags = await apProps.Get('org.freedesktop.NetworkManager.AccessPoint', 'Flags');
        const wpaFlags = await apProps.Get('org.freedesktop.NetworkManager.AccessPoint', 'WpaFlags');
        
        const security = [];
        if (flags & 0x1) security.push('WEP');
        if (wpaFlags > 0) security.push('WPA');
        
        networks.push({
          ssid: Buffer.from(ssid).toString(),
          signal: strength,
          security
        });
      }
      
      return networks;
    } catch (error) {
      console.error('Failed to scan networks:', error);
      throw error;
    }
  }

  async connect(config: WiFiConnectionConfig): Promise<boolean> {
    try {
      const connection: NMConnection = {
        '802-11-wireless': {
          ssid: Buffer.from(config.ssid),
          mode: 'infrastructure',
          hidden: config.hidden || false
        },
        connection: {
          type: '802-11-wireless',
          id: config.ssid
        }
      };
      
      if (config.password) {
        connection['802-11-wireless-security'] = {
          'key-mgmt': 'wpa-psk',
          'psk': config.password
        };
      }
      
      // First check if we already have a connection for this network
      const settings = await this.nmService.getInterface('org.freedesktop.NetworkManager.Settings');
      const connections = await settings.ListConnections();
      
      // Look for existing connection
      let conn: string | undefined;
      for (const path of connections) {
        const connObj = await this.bus.getProxyObject('org.freedesktop.NetworkManager', path);
        const connIface = connObj.getInterface('org.freedesktop.NetworkManager.Settings.Connection');
        const settings = await connIface.GetSettings();
        
        if (settings?.connection?.id === config.ssid) {
          // Update existing connection
          await connIface.Update(connection);
          conn = path;
          break;
        }
      }
      
      if (!conn) {
        // Add new connection if none exists
        conn = await settings.AddConnection(connection);
      }
      
      const devicePath = await this.getWirelessDevice();
      const nm = this.nmService.getInterface('org.freedesktop.NetworkManager');
      await nm.ActivateConnection(conn, devicePath, '/');
      
      // Wait for connection to be established
      await new Promise(resolve => setTimeout(resolve, 2000));
      return true;
    } catch (error) {
      console.error('Failed to connect:', error);
      throw error;
    }
  }

  async disconnect(): Promise<boolean> {
    try {
      const devicePath = await this.getWirelessDevice();
      const device = await this.bus.getProxyObject('org.freedesktop.NetworkManager', devicePath);
      const deviceProps = device.getInterface('org.freedesktop.DBus.Properties');
      
      const activeConnection = await deviceProps.Get('org.freedesktop.NetworkManager.Device', 'ActiveConnection');
      if (activeConnection && activeConnection !== '/') {
        const nm = this.nmService.getInterface('org.freedesktop.NetworkManager');
        await nm.DeactivateConnection(activeConnection);
      }
      
      return true;
    } catch (error) {
      console.error('Failed to disconnect:', error);
      throw error;
    }
  }

  async startHotspot(config: HotspotConfig): Promise<boolean> {
    try {
      const connection: NMConnection = {
        '802-11-wireless': {
          ssid: Buffer.from(config.ssid),
          mode: 'ap',
          band: config.band === '5GHz' ? 'a' : 'bg',
          channel: config.channel || 1
        },
        '802-11-wireless-security': {
          'key-mgmt': 'wpa-psk',
          'psk': config.password
        },
        connection: {
          type: '802-11-wireless',
          id: `Hotspot-${config.ssid}`
        },
        ipv4: {
          method: 'shared'
        }
      };
      
      const settings = await this.nmService.getInterface('org.freedesktop.NetworkManager.Settings');
      const conn = await settings.AddConnection(connection);
      
      const devicePath = await this.getWirelessDevice();
      const nm = this.nmService.getInterface('org.freedesktop.NetworkManager');
      await nm.ActivateConnection(conn, devicePath, '/');
      
      return true;
    } catch (error) {
      console.error('Failed to start hotspot:', error);
      throw error;
    }
  }

  async stopHotspot(): Promise<boolean> {
    return this.disconnect();
  }

  async getStatus(): Promise<{
    connected: boolean;
    ssid?: string;
    mode: 'client' | 'hotspot' | 'disconnected';
  }> {
    try {
      const devicePath = await this.getWirelessDevice();
      const device = await this.bus.getProxyObject('org.freedesktop.NetworkManager', devicePath);
      const deviceProps = device.getInterface('org.freedesktop.DBus.Properties');
      
      const activeConnection = await deviceProps.Get('org.freedesktop.NetworkManager.Device', 'ActiveConnection');
      
      if (!activeConnection || activeConnection === '/') {
        return { connected: false, mode: 'disconnected' };
      }
      
      const activeConn = await this.bus.getProxyObject('org.freedesktop.NetworkManager', activeConnection);
      const activeConnProps = activeConn.getInterface('org.freedesktop.DBus.Properties');
      
      const connectionPath = await activeConnProps.Get('org.freedesktop.NetworkManager.Connection.Active', 'Connection');
      const connection = await this.bus.getProxyObject('org.freedesktop.NetworkManager', connectionPath);
      const connProps = connection.getInterface('org.freedesktop.DBus.Properties');
      
      const settings = await connProps.Get('org.freedesktop.NetworkManager.Settings.Connection', 'GetSettings');
      const ssid = settings['802-11-wireless']?.ssid;
      const mode = settings['802-11-wireless']?.mode;
      
      return {
        connected: true,
        ssid: ssid ? Buffer.from(ssid).toString() : undefined,
        mode: mode === 'ap' ? 'hotspot' : 'client'
      };
    } catch (error) {
      console.error('Failed to get status:', error);
      throw error;
    }
  }
}
