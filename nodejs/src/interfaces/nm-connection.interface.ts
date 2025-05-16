export interface NMConnection {
  '802-11-wireless': {
    ssid: Buffer;
    mode: string;
    hidden?: boolean;
    band?: string;
    channel?: number;
  };
  '802-11-wireless-security'?: {
    'key-mgmt': string;
    'psk': string;
  };
  connection: {
    type: string;
    id: string;
  };
  ipv4?: {
    method: string;
  };
}
