import { NetworkControl } from './services/network-control.service';
import { generateSignalBars, generateNetworkQR, generateWireGuardQR } from './utils/display.util';
import { executeCommand } from './utils/command.util';
import readline from 'readline';

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

function question(query: string): Promise<string> {
  return new Promise((resolve) => {
    rl.question(query, resolve);
  });
}

async function displayMenu(): Promise<void> {
  console.log('\n=== WiFi Management Tool ===');
  console.log('1. Scan for networks');
  console.log('2. Connect to network');
  console.log('3. Disconnect');
  console.log('4. Start hotspot');
  console.log('5. Stop hotspot');
  console.log('6. Show current status');
  console.log('7. Setup WireGuard VPN');
  console.log('0. Exit');
}

async function main() {
  const networkControl = new NetworkControl();
  let running = true;

  while (running) {
    try {
      await displayMenu();
      const choice = await question('\nEnter your choice (0-7): ');

      switch (choice) {
        case '1': {
          console.log('\nScanning for networks...');
          const networks = await networkControl.scanNetworks();
          console.log('\nAvailable networks:');
          networks.forEach((net) => {
            console.log(`- ${net.ssid} (Signal: ${net.signal}%, Freq: ${net.freq}, Security: ${net.security.join(', ')})`);
          });
          break;
        }

        case '2': {
          console.log('\nScanning for networks...');
          const networks = await networkControl.scanNetworks();
          
          if (networks.length === 0) {
            console.log('No networks found.');
            break;
          }

          console.log('\nAvailable networks:');
          networks.forEach((net, i) => {
            console.log(`${i + 1}. ${net.ssid} (Signal: ${net.signal}%, Security: ${net.security.join(', ')})`);
          });

          const choice = parseInt(await question('\nSelect network (1-' + networks.length + ') or 0 to cancel: '));
          if (choice === 0 || isNaN(choice) || choice > networks.length) {
            console.log('Connection cancelled.');
            break;
          }

          const network = networks[choice - 1];
          const needsPassword = network.security.some(s => s.includes('WPA') || s.includes('WEP'));
          const password = needsPassword ? await question('Enter password: ') : '';
          const hidden = (await question('Is this a hidden network? (y/N): ')).toLowerCase() === 'y';

          console.log(`\nConnecting to "${network.ssid}"...`);
          const result = await networkControl.connect(network.ssid, password);
          console.log(result ? 'Connected successfully' : 'Connection failed');
          break;
        }

        case '3': {
          console.log('\nDisconnecting...');
          const result = await networkControl.disconnect();
          console.log(result ? 'Disconnected successfully' : 'Disconnection failed');
          break;
        }

        case '4': {
          const ssid = await question('Enter hotspot SSID: ');
          const password = await question('Enter hotspot password (min 8 chars): ');

          console.log('\nStarting hotspot...');
          const result = await networkControl.startHotspot(ssid, password);
          if (result) {
            console.log('Hotspot started successfully');
            console.log('\nNetwork Share QR Code:');
            console.log('Scan to connect:');
            await generateNetworkQR(ssid, password);
          } else {
            console.log('Failed to start hotspot');
          }
          break;
        }

        case '5': {
          console.log('\nStopping hotspot...');
          const result = await networkControl.stopHotspot();
          console.log(result ? 'Hotspot stopped successfully' : 'Failed to stop hotspot');
          break;
        }

        case '6': {
          console.log('\n=== WiFi Status ===');
          const status = await networkControl.getStatus();
          const vpnStatus = await networkControl.getWireGuardStatus();
          
          if (!status.connected) {
            console.log('Status: Disconnected');
            console.log('Mode:', status.mode);
          } else {
            console.log('Status: Connected');
            console.log('SSID:', status.ssid);
            console.log('Mode:', status.mode);
            
            if (status.signal) {
              const signalBars = generateSignalBars(status.signal);
              console.log(`Signal Strength: ${signalBars} (${status.signal}%)`);
            }
            
            if (status.freq) console.log('Frequency:', status.freq);
            if (status.bitrate) console.log('Bitrate:', status.bitrate);
            if (status.security?.length) console.log('Security:', status.security.join(', '));
            if (status.ipAddress) console.log('IP Address:', status.ipAddress);
            if (status.gateway) console.log('Gateway:', status.gateway);

            // Only show QR code in hotspot mode
            if (status.mode === 'ap' && status.ssid) {
              console.log('\nNetwork Share QR Code:');
              // Get the hotspot password from the active connection
              const { stdout: connInfo } = await executeCommand(`nmcli connection show "${status.ssid}" | grep 802-11-wireless-security.psk:`);
              const password = connInfo.split(':')[1]?.trim();
              if (password) {
                console.log('Scan to connect:');
                await generateNetworkQR(status.ssid, password);
              }
            }
          }

          if (vpnStatus.active) {
            console.log('\n=== VPN Status ===');
            console.log('Status: Connected');
            if (vpnStatus.endpoint) console.log('Endpoint:', vpnStatus.endpoint);
            if (vpnStatus.transferRx) console.log('Data Received:', vpnStatus.transferRx);
            if (vpnStatus.transferTx) console.log('Data Sent:', vpnStatus.transferTx);
            if (vpnStatus.lastHandshake) console.log('Last Handshake:', vpnStatus.lastHandshake);
          }
          break;
        }

        case '7': {
          console.log('\nSetting up WireGuard VPN...');
          const endpoint = await question('Enter VPN server endpoint (e.g., vpn.example.com:51820): ');
          const allowedIPs = (await question('Enter allowed IPs (comma separated, e.g., 10.0.0.0/24,192.168.0.0/24): ')).split(',');
          const dns = await question('Enter DNS server (optional): ');
          
          const result = await networkControl.setupWireGuardWithQR({
            endpoint,
            allowedIPs,
            dns: dns || undefined
          });

          if (result.success && result.config) {
            console.log('\nVPN setup successful!');
            console.log('\nScan this QR code with your mobile device to import the configuration:');
            await generateWireGuardQR(result.config);
            console.log('\nConfiguration has been saved to /etc/wireguard/wg0.conf');
          } else {
            console.log('Failed to setup VPN');
          }
          break;
        }

        case '0': {
          console.log('\nExiting...');
          running = false;
          break;
        }

        default: {
          console.log('\nInvalid choice. Please try again.');
        }
      }

      if (running) {
        await question('\nPress Enter to continue...');
      }

    } catch (error) {
      console.error('Error:', error);
      await question('\nPress Enter to continue...');
    }
  }

  rl.close();
}

main();
