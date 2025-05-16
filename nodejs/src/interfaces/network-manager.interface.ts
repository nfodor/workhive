import { WiFiNetwork, WiFiConnectionConfig, HotspotConfig } from '../interfaces/wifi.interface';

export interface NetworkManagerService {
  /**
   * Scan for available WiFi networks
   */
  scanNetworks(): Promise<WiFiNetwork[]>;
  
  /**
   * Connect to a WiFi network
   */
  connect(config: WiFiConnectionConfig): Promise<boolean>;
  
  /**
   * Disconnect from current network
   */
  disconnect(): Promise<boolean>;
  
  /**
   * Start hotspot mode
   */
  startHotspot(config: HotspotConfig): Promise<boolean>;
  
  /**
   * Stop hotspot mode
   */
  stopHotspot(): Promise<boolean>;
  
  /**
   * Get current connection status
   */
  getStatus(): Promise<{
    connected: boolean;
    ssid?: string;
    mode: 'client' | 'hotspot' | 'disconnected';
  }>;
}
