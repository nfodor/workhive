import * as qrcode from 'qrcode-terminal';

export function generateSignalBars(strength: number): string {
  const bars = ['▁', '▂', '▃', '▄', '▅', '▆', '▇', '█'];
  const levels = Math.floor((strength / 100) * bars.length);
  return bars.slice(0, levels).join('') + bars.slice(levels).map(() => '░').join('');
}

export function generateNetworkQR(ssid: string, password?: string): Promise<void> {
  return new Promise((resolve) => {
    const wifiString = password 
      ? `WIFI:S:${ssid};T:WPA;P:${password};;`
      : `WIFI:S:${ssid};T:nopass;;`;
    
    // Use the direct, synchronous approach without callbacks
    console.log(''); // Add a blank line before QR code
    qrcode.generate(wifiString, { small: true });
    
    // Resolve the promise after a small delay to ensure QR code has been displayed
    setTimeout(resolve, 100);
  });
}

export interface WireGuardConfig {
  privateKey: string;
  publicKey: string;
  address: string;
  dns?: string;
  endpoint: string;
  allowedIPs: string[];
  persistentKeepalive?: number;
}

export function generateWireGuardQR(config: WireGuardConfig): Promise<void> {
  return new Promise((resolve) => {
    const configText = [
      '[Interface]',
      `PrivateKey = ${config.privateKey}`,
      `Address = ${config.address}`,
      config.dns ? `DNS = ${config.dns}` : '',
      '',
      '[Peer]',
      `PublicKey = ${config.publicKey}`,
      `AllowedIPs = ${config.allowedIPs.join(', ')}`,
      `Endpoint = ${config.endpoint}`,
      config.persistentKeepalive ? `PersistentKeepalive = ${config.persistentKeepalive}` : ''
    ].filter(line => line).join('\n');

    // Use the direct, synchronous approach
    console.log(''); // Add a blank line before QR code
    qrcode.generate(configText, { small: true });
    
    // Resolve the promise after a small delay to ensure QR code has been displayed
    setTimeout(resolve, 100);
  });
}
