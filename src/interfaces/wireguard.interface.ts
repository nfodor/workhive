export interface WireGuardConfig {
  privateKey: string;
  publicKey: string;
  address: string;
  dns?: string;
  endpoint: string;
  allowedIPs: string[];
  persistentKeepalive?: number;
}

export interface WireGuardStatus {
  active: boolean;
  publicKey?: string;
  endpoint?: string;
  transferRx?: string;
  transferTx?: string;
  lastHandshake?: string;
}
