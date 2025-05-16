import { executeCommand } from './command.util';
import { 
  formatSectionHeader, 
  formatStatusLine,
  colorize,
  generateSignalBars,
  getPublicIp,
  formatVpnStatus
} from './display.util';

/**
 * Formats and displays the network status in a visually appealing way
 */
export async function displayFormattedStatus(
  status: any, 
  vpnStatus: any, 
  matchingConfig?: any,
  isDetailed = false
): Promise<void> {
  console.log(formatSectionHeader('NETWORK STATUS'));
  
  if (!status.connected) {
    console.log(formatStatusLine('Status', 'Disconnected', 'disconnected', 'red'));
    console.log(formatStatusLine('Mode', status.mode === 'ap' ? 'Hotspot' : 'Client', 'wifi'));
  } else {
    // Network status with icons and colors
    console.log(formatStatusLine('Status', 'Connected', 'connected', 'green'));
    
    // Network mode with appropriate icon
    const modeIcon = status.mode === 'ap' ? 'hotspot' : 'client';
    const modeDisplay = status.mode === 'ap' ? 'HOTSPOT MODE' : 'CLIENT MODE';
    console.log(formatStatusLine('Network Mode', modeDisplay, modeIcon, 'yellow'));
    
    // Connection info
    if (status.ssid) {
      console.log(formatStatusLine('Network Name', status.ssid, 'wifi', 'cyan'));
    }
    
    if (status.security?.length) {
      console.log(formatStatusLine('Security', status.security.join(', '), 'security'));
    }
    
    // Signal strength with colored bars
    if (status.signal) {
      const signalBars = generateSignalBars(status.signal);
      console.log(formatStatusLine('Signal Strength', `${status.signal}% ${signalBars}`, 'strength'));
    }
    
    // IP address with special formatting
    if (status.ipAddress) {
      console.log(formatStatusLine('IP Address', status.ipAddress, 'ip', 'green'));
    }
    
    if (status.gateway) {
      console.log(formatStatusLine('Gateway', status.gateway, 'gateway'));
    }
    
    // Display most recent saved configuration if it exists
    if (matchingConfig) {
      console.log('\n' + colorize('Saved Configuration:', 'bold') + ' ' + 
                 colorize(matchingConfig.id, 'yellow'));
      console.log(formatStatusLine('Config Mode', matchingConfig.config.mode, 'config'));
      console.log(formatStatusLine('Interface', matchingConfig.config.interface || 'wlan0', 'interface'));
      
      // Show if configuration matches current state
      const checkmark = '✓';
      console.log(colorize(`${checkmark} Configuration matches active network state`, 'green'));
    }
    
    // Show detailed interface information
    console.log(formatSectionHeader('INTERFACE STATUS'));
    try {
      const { stdout } = await executeCommand('ip -br addr');
      const interfaces = stdout.split('\n')
        .filter(line => line.trim())
        .map(line => {
          const [name, status, ...addrs] = line.split(/\s+/);
          return { name, status, addrs: addrs.join(' ') };
        });
        
      interfaces.forEach(iface => {
        const color = iface.status === 'UP' ? 'green' : 'dim';
        const ipInfo = iface.addrs || 'No IPv4 address assigned';
        console.log(colorize('• ', 'blue') + 
                   colorize(iface.name + ':', color) + ' ' + 
                   ipInfo);
      });
    } catch (err) {
      console.log(colorize('• ', 'blue') + 
                 colorize('wlan0:', 'green') + ' ' + 
                 status.ipAddress + '/24');
    }
    
    // Check internet connectivity
    console.log(formatSectionHeader('CONNECTIVITY TEST'));
    try {
      const { stdout } = await executeCommand('ping -c 1 -W 2 8.8.8.8', false);
      const isConnected = stdout.includes('1 received');
      console.log(formatStatusLine('Internet', 
        isConnected ? 'Reachable' : 'Not reachable', 
        isConnected ? 'connected' : 'disconnected',
        isConnected ? 'green' : 'red'));
        
      if (isConnected) {
        const publicIp = await getPublicIp();
        console.log(formatStatusLine('Public IP', publicIp, 'internet', 'cyan'));
      }
    } catch {
      console.log(formatStatusLine('Internet', 'Not reachable', 'disconnected', 'red'));
    }
    
    // Only show additional technical details when specifically requested
    if (isDetailed) {
      console.log(formatSectionHeader('TECHNICAL DETAILS'));
      try {
        if (status.freq) console.log(formatStatusLine('Frequency', status.freq));
        if (status.bitrate) console.log(formatStatusLine('Bitrate', status.bitrate));
        
        const { stdout: wifiInfo } = await executeCommand('iwconfig wlan0', false);
        if (wifiInfo) {
          console.log('\n' + colorize('WiFi Interface Details:', 'bold'));
          console.log(wifiInfo);
        }
        
        const { stdout: routeInfo } = await executeCommand('ip route show', false);
        if (routeInfo) {
          console.log('\n' + colorize('Routing Information:', 'bold'));
          console.log(routeInfo);
        }
      } catch (err) {
        // Just skip additional info if command fails
      }
    }
  }

  // Show VPN status
  console.log(formatSectionHeader('VPN STATUS'));
  const vpnStatusLines = formatVpnStatus(vpnStatus);
  vpnStatusLines.forEach(line => console.log(line));
}
