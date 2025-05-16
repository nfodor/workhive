import * as qrcode from 'qrcode-terminal';
import { executeCommand } from './command.util';

// ANSI color codes for terminal output
export const colors = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  underline: '\x1b[4m',
  blink: '\x1b[5m',
  reverse: '\x1b[7m',
  hidden: '\x1b[8m',
  
  black: '\x1b[30m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  white: '\x1b[37m',
  
  bgBlack: '\x1b[40m',
  bgRed: '\x1b[41m',
  bgGreen: '\x1b[42m',
  bgYellow: '\x1b[43m',
  bgBlue: '\x1b[44m',
  bgMagenta: '\x1b[45m',
  bgCyan: '\x1b[46m',
  bgWhite: '\x1b[47m'
};

// Icons for different status elements
export const icons = {
  network: '📶',
  wifi: '🌐',
  client: '💻',
  hotspot: '📡',
  ip: '🔗',
  strength: '📊',
  config: '📁',
  connected: '✅',
  disconnected: '❌',
  internet: '🌍',
  interface: '🔌',
  vpn: '🔒',
  vpnDisconnected: '🔓',
  path: '📍',
  server: '🖥️',
  gateway: '🚪',
  dns: '🔍',
  security: '🔐'
};

/**
 * Colorize text for terminal output
 * @param text Text to colorize
 * @param color Color to apply
 * @returns Colorized string
 */
export function colorize(text: string, color: keyof typeof colors): string {
  return colors[color] + text + colors.reset;
}

/**
 * Generate colorized signal strength bars visualization
 * @param strength Signal strength as a percentage
 * @returns Formatted string with colored signal bars
 */
export function generateSignalBars(strength: number): string {
  const bars = ['▁', '▂', '▃', '▄', '▅', '▆', '▇', '█'];
  const levels = Math.floor((strength / 100) * bars.length);
  
  // Colorize the signal bars based on strength
  let color: keyof typeof colors = 'red';
  if (strength > 70) color = 'green';
  else if (strength > 40) color = 'yellow';
  
  return colorize(bars.slice(0, levels).join(''), color) + 
         colorize(bars.slice(levels).map(() => '░').join(''), 'dim');
}

/**
 * Get public IP address
 * @returns Promise with the public IP or 'Not available'
 */
export async function getPublicIp(): Promise<string> {
  try {
    // Try multiple services in case one is down
    const services = [
      'curl -s https://ipinfo.io/ip',
      'curl -s https://api.ipify.org',
      'curl -s https://icanhazip.com',
      'curl -s https://ifconfig.me'
    ];
    
    for (const service of services) {
      try {
        const { stdout } = await executeCommand(service, false);
        const ip = stdout.trim();
        
        // Basic validation - check if output looks like an IP address
        if (ip && /^[\d\.]+$/.test(ip)) {
          return ip;
        }
      } catch {
        // Try next service
        continue;
      }
    }
    
    return 'Not available';
  } catch (error) {
    return 'Not available';
  }
}

/**
 * Format a label-value pair with optional icon and color
 * @param label The label text
 * @param value The value text
 * @param icon Optional icon to prepend
 * @param valueColor Optional color for the value
 * @returns Formatted string
 */
export function formatStatusLine(
  label: string, 
  value: string, 
  icon?: keyof typeof icons, 
  valueColor?: keyof typeof colors
): string {
  const iconStr = icon ? `${icons[icon]} ` : '';
  const valueStr = valueColor ? colorize(value, valueColor) : value;
  return `${iconStr}${colorize(label + ':', 'bold')} ${valueStr}`;
}

/**
 * Creates a styled section header for status outputs
 * @param title The section title
 * @returns Formatted string
 */
export function formatSectionHeader(title: string): string {
  const line = '─'.repeat(title.length + 4);
  return '\n' + colorize(`┌${line}┐`, 'cyan') + 
         '\n' + colorize(`│  ${title}  │`, 'cyan') + 
         '\n' + colorize(`└${line}┘`, 'cyan');
}

/**
 * Format VPN status with appropriate icons and colors
 * @param status VPN status object
 * @returns Array of formatted VPN status lines
 */
export function formatVpnStatus(status: { 
  active: boolean;
  endpoint?: string;
  transferRx?: string;
  transferTx?: string;
  lastHandshake?: string;
}): string[] {
  const lines: string[] = [];
  
  if (!status.active) {
    lines.push(formatStatusLine('VPN Status', 'Disconnected', 'vpnDisconnected', 'red'));
    return lines;
  }
  
  lines.push(formatStatusLine('VPN Status', 'Connected', 'vpn', 'green'));
  
  if (status.endpoint) {
    lines.push(formatStatusLine('Endpoint', status.endpoint, 'server'));
  }
  
  if (status.transferRx) {
    lines.push(formatStatusLine('Data Received', status.transferRx, undefined, 'cyan'));
  }
  
  if (status.transferTx) {
    lines.push(formatStatusLine('Data Sent', status.transferTx, undefined, 'magenta'));
  }
  
  if (status.lastHandshake) {
    lines.push(formatStatusLine('Last Handshake', status.lastHandshake));
  }
  
  return lines;
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
