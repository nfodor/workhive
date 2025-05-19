export interface WiFiNetwork {
  ssid: string;
  signal: number;
  security: string[]; // This will be an array of security protocols like ["WPA2", "PSK"]
  freq?: string;     // Frequency, e.g., "2412 MHz"
}

export interface WiFiConnectionConfig {
  ssid: string;
  password?: string;
  hidden?: boolean;
}

export interface HotspotConfig {
  ssid: string;
  password: string;
  band?: '2.4GHz' | '5GHz';
  channel?: number;
}

export interface VPNConfig {
  serverAddress: string;
  privateKey: string;
  publicKey: string;
  allowedIPs: string[];
}
