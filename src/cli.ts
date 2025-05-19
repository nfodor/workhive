#!/usr/bin/env node
import { NetworkControl } from './services/network-control.service';
import {
  generateSignalBars,
  generateNetworkQR,
  generateWireGuardQR,
  colorize,
  formatSectionHeader,
  formatStatusLine,
  formatVpnStatus,
  getPublicIp
} from './utils/display.util';
import { launchMainTUI } from './tui'; // Import the main TUI launcher

import { displayFormattedStatus } from './utils/status-formatter.util';
import { program } from 'commander';
import { executeCommand } from './utils/command.util';
import readline from 'readline';

// Function to handle interactive mode
async function interactiveMode() {
  const networkControl = new NetworkControl();
  await launchMainTUI(networkControl); // Launch the new TUI
}

const networkControl = new NetworkControl();

program
  .name('wifi-manager')
  .description('WiFi Management CLI')
  .version('1.0.0');

program
  .command('interactive')
  .alias('i')
  .description('Start interactive mode with a menu-based interface')
  .action(async () => {
    await interactiveMode();
  });

program
  .command('scan')
  .description('Scan for available networks')
  .option('-i, --interactive', 'Select network interactively')
  .action(async (options) => {
    console.log('Scanning for networks...');
    const networks = await networkControl.scanNetworks();

    if (networks.length === 0) {
      console.log('No networks found.');
      return;
    }

    console.log('\nAvailable Networks:');
    networks.forEach((net, i) => {
      const signalBars = generateSignalBars(net.signal);
      console.log(`${i + 1}. ${signalBars} "${net.ssid}" (Signal: ${net.signal}%, Security: ${net.security.join(', ')})`);
    });

    if (options.interactive) {
      const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
      });

      rl.question('\nSelect network to connect (1-' + networks.length + ') or 0 to cancel: ', async (answer) => {
        const choice = parseInt(answer);
        if (choice === 0 || isNaN(choice) || choice > networks.length) {
          console.log('Connection cancelled.');
          rl.close();
          return;
        }

        const network = networks[choice - 1];
        const needsPassword = network.security.some(s => s.includes('WPA') || s.includes('WEP'));

        if (needsPassword) {
          rl.question('Enter password: ', async (password) => {
            console.log(`\nConnecting to "${network.ssid}"...`);
            const result = await networkControl.connect(network.ssid, password);
            console.log(result ? 'Connected successfully' : 'Connection failed');
            rl.close();
          });
        } else {
          console.log(`\nConnecting to "${network.ssid}"...`);
          const result = await networkControl.connect(network.ssid);
          console.log(result ? 'Connected successfully' : 'Connection failed');
          rl.close();
        }
      });
    }
  });

program
  .command('connect')
  .description('Connect to a network')
  .argument('<ssid>', 'Network SSID')
  .option('-p, --password <password>', 'Network password')
  .option('--hidden', 'Hidden network')
  .option('-s, --save <n>', 'Save this connection with given name')
  .action(async (ssid, options) => {
    console.log(`Connecting to "${ssid}"...`);
    const result = await networkControl.connect(ssid, options.password);
    console.log(result ? 'Connected successfully' : 'Connection failed');

    if (result && options.save) {
      await networkControl.saveCurrentSetup(options.save);
      console.log(`Configuration saved as "${options.save}"`);
    }
  });

program
  .command('disconnect')
  .description('Disconnect from current network')
  .action(async () => {
    console.log('Disconnecting...');
    const result = await networkControl.disconnect();
    console.log(result ? 'Disconnected successfully' : 'Disconnection failed');
  });

program
  .command('status')
  .description('Show current status')
  .option('-d, --detailed', 'Show detailed status information')
  .action(async (options) => {
    console.log(colorize('Fetching network status...', 'cyan'));
    const status = await networkControl.getStatus();
    const vpnStatus = await networkControl.getWireGuardStatus();

    // Get saved configurations to show most recent
    let savedConfigs: { id: string; config: any }[] = [];
    try {
      savedConfigs = await networkControl.listConfigs();
    } catch (error) {
      // Ignore errors when loading configs
    }

    // Try to find matching saved configuration
    const matchingConfig = status.ssid ?
      savedConfigs.find(c => c.config.ssid === status.ssid && c.config.mode === (status.mode === 'ap' ? 'hotspot' : 'client')) :
      undefined;

    // Use the formatted status display
    await displayFormattedStatus(status, vpnStatus, matchingConfig, options.detailed);

    // Show QR code based on connection mode if we have an active connection
    if (status.connected && status.ssid) {
      if (status.mode === 'ap') {
        console.log('\nHotspot Share QR Code:');
        console.log('Scan this code with a mobile device to connect to your hotspot:');
        try {
          // Try to get the hotspot password
          let password;
          try {
            password = await networkControl.getHotspotPassword(status.ssid);
          } catch (passwordErr) {
            try {
              // Fallback to direct connection file lookup
              const { stdout: connInfo } = await executeCommand(`sudo grep -r "psk=" /etc/NetworkManager/system-connections/ | grep -i "${status.ssid}"`);
              const passwordMatch = connInfo.match(/psk=([^\s]+)/);
              if (passwordMatch && passwordMatch[1]) {
                password = passwordMatch[1];
              }
            } catch (fallbackErr) {
              // Both methods failed
            }
          }

          if (password) {
            await generateNetworkQR(status.ssid, password);

            // Show connected devices count if in hotspot mode
            const devices = await networkControl.getConnectedDevices();
            if (devices.length > 0) {
              console.log(`\nDevices connected to hotspot: ${devices.length}`);
              console.log('Use "wifi-manager devices list" for details');
            } else {
              console.log('\nNo devices currently connected to hotspot');
            }
          } else {
            console.log('Could not retrieve password - QR code will only contain SSID');
            await generateNetworkQR(status.ssid);
          }
        } catch (err) {
          console.log('Error generating QR code - showing SSID only');
          await generateNetworkQR(status.ssid);
        }
      } else {
        // In client mode - show current connection QR code
        console.log('\nWiFi Connection QR Code:');
        console.log('Scan this code to connect to the same network:');
        try {
          // Try multiple methods to get the password for the current client connection
          let password;
          try {
            // Method 1: Try using nmcli with -s (secret) flag
            const { stdout: nmcliInfo } = await executeCommand(`nmcli -s -g 802-11-wireless-security.psk connection show "${status.ssid}"`);
            if (nmcliInfo && nmcliInfo.trim()) {
              password = nmcliInfo.trim();
            }
          } catch (e) {
            // If first method fails, try the second method
            try {
              // Method 2: Try reading from connection file directly
              const { stdout: connInfo } = await executeCommand(`sudo cat "/etc/NetworkManager/system-connections/${status.ssid}.nmconnection" | grep psk=`);
              const passwordMatch = connInfo.match(/psk=(.+)/);
              if (passwordMatch && passwordMatch[1]) {
                password = passwordMatch[1];
              }
            } catch (innerErr) {
              // Both methods failed, continue without password
            }
          }

          // Generate QR code with or without password
          if (password) {
            console.log("Network password found - QR code includes credentials");
            await generateNetworkQR(status.ssid, password);
          } else {
            console.log("Network password not available - QR code includes SSID only");
            await generateNetworkQR(status.ssid);
          }
        } catch (err) {
          console.log("Failed to generate QR code with credentials - showing SSID only");
          await generateNetworkQR(status.ssid);
        }
      }
    }
  });

// Create a single config command with subcommands
const configCommand = program
  .command('config')
  .description('Manage network configurations');

configCommand
  .command('save')
  .description('Save current network configuration')
  .argument('<n>', 'Configuration name')
  .action(async (name) => {
    try {
      await networkControl.saveCurrentSetup(name);
      console.log('Configuration saved successfully');
    } catch (error) {
      console.error('Failed to save configuration:', error);
    }
  });

configCommand
  .command('list')
  .description('List saved configurations')
  .action(async () => {
    try {
      console.log('Loading saved configurations...');
      const configs = await networkControl.listConfigs();
      console.log('\nSaved Configurations:');

      if (configs.length === 0) {
        console.log('No saved configurations found.');
        return;
      }

      configs.forEach(({ id, config }, index) => {
        console.log(`${index + 1}. ${id} (${config.mode}): "${config.ssid}"`);
        if (config.lastUsed) {
          console.log(`   Last used: ${new Date(config.lastUsed).toLocaleString()}`);
        }
        if (config.vpnEnabled) {
          console.log('   VPN: Enabled');
        }
        console.log('');
      });
    } catch (error) {
      console.error('Failed to list configurations:', error);
    }
  });

configCommand
  .command('activate')
  .description('Activate saved configuration')
  .argument('<n>', 'Configuration name')
  .action(async (name) => {
    try {
      const result = await networkControl.activateConfig(name);
      console.log(result ? 'Configuration activated successfully' : 'Failed to activate configuration');
    } catch (error) {
      console.error('Failed to activate configuration:', error);
    }
  });

configCommand
  .command('deduplicate')
  .description('Remove duplicate configurations')
  .action(async () => {
    try {
      await networkControl.deduplicateConfigs();
      console.log('Configurations deduplicated successfully');
    } catch (error) {
      console.error('Failed to deduplicate configurations:', error);
    }
  });

configCommand
  .command('export')
  .description('Export network configurations to a file')
  .option('-f, --filename <filename>', 'Custom filename for the export')
  .action(async (options) => {
    try {
      console.log('Exporting network configurations...');
      console.log('Sensitive data like passwords will be encrypted for security.');
      const filePath = await networkControl.exportNetworkConfigs(options.filename);

      if (filePath) {
        console.log(`Configurations successfully exported to: ${filePath}`);
      } else {
        console.error('Failed to export configurations');
      }
    } catch (error) {
      console.error('Failed to export configurations:', error);
    }
  });

configCommand
  .command('import')
  .description('Import network configurations from a file')
  .argument('<filepath>', 'Path to the exported configuration file')
  .action(async (filePath) => {
    try {
      console.log(`Importing network configurations from: ${filePath}`);
      console.log('Encrypted passwords will be decrypted during import.');
      const result = await networkControl.importNetworkConfigs(filePath);

      if (result.success) {
        console.log(`Successfully imported ${result.imported} configuration(s)`);
      } else {
        console.error('Failed to import configurations');
      }

      if (result.errors && result.errors.length > 0) {
        console.log('\nErrors encountered:');
        result.errors.forEach(error => console.log(`- ${error}`));
      }
    } catch (error) {
      console.error('Failed to import configurations:', error);
    }
  });

program
  .command('device')
  .description('Manage device authorization')
  .option('-a, --allow <mac>', 'Allow MAC address')
  .option('-r, --remove <mac>', 'Remove MAC address')
  .action(async (options) => {
    try {
      const { stdout } = await executeCommand('cat /etc/NetworkManager/dnsmasq.d/dhcp-options.conf');
      const currentMacs = stdout.split('\n')
        .filter(line => line.startsWith('dhcp-host='))
        .map(line => line.split('=')[1]);

      let macs = [...currentMacs];

      if (options.allow) {
        macs.push(options.allow);
      }
      if (options.remove) {
        macs = macs.filter(mac => mac !== options.remove);
      }

      await networkControl.updateDeviceAuth(macs);
      console.log('Device authorization updated successfully');
    } catch (error) {
      console.error('Failed to update device authorization:', error);
    }
  });

program
  .command('dns')
  .description('Configure DNS servers')
  .argument('<servers>', 'Comma-separated list of DNS servers')
  .action(async (servers) => {
    try {
      await networkControl.updateDnsConfig(servers.split(','));
      console.log('DNS configuration updated successfully');
    } catch (error) {
      console.error('Failed to update DNS configuration:', error);
    }
  });

program
  .command('debug')
  .description('Run network diagnostics')
  .option('-d, --deep', 'Run deep diagnostics')
  .action(async (options) => {
    try {
      const diagnostics = await networkControl.runDiagnostics(options.deep);
      console.log('\n=== Network Diagnostics ===');
      console.log('\nNetwork Status:');
      console.log(diagnostics.networkStatus);
      console.log('\nDNS Configuration:');
      console.log(diagnostics.dnsStatus);
      console.log('\nDHCP Status:');
      console.log(diagnostics.dhcpStatus);

      if (options.deep && diagnostics.systemLogs) {
        console.log('\nSystem Logs:');
        console.log(diagnostics.systemLogs.join('\n'));
      }

      if (diagnostics.vpnStatus.active) {
        console.log('\nVPN Status:');
        console.log('Endpoint:', diagnostics.vpnStatus.endpoint);
        console.log('Data Received:', diagnostics.vpnStatus.transferRx);
        console.log('Data Sent:', diagnostics.vpnStatus.transferTx);
        console.log('Last Handshake:', diagnostics.vpnStatus.lastHandshake);
      }
    } catch (error) {
      console.error('Failed to run diagnostics:', error);
    }
  });

program
  .command('hotspot')
  .description('Start a WiFi hotspot')
  .argument('<ssid>', 'Hotspot SSID')
  .argument('<password>', 'Hotspot password')
  .option('-s, --save <n>', 'Save this hotspot configuration')
  .action(async (ssid, password, options) => {
    console.log(`Starting hotspot with SSID "${ssid}"...`);
    const result = await networkControl.startHotspot(ssid, password);

    if (result) {
      console.log('Hotspot started successfully');

      // Show IP address for the hotspot interface
      try {
        const { stdout: ipInfo } = await executeCommand('ip addr show wlan0');
        const ipMatch = ipInfo.match(/inet\s+(\d+\.\d+\.\d+\.\d+)/);
        if (ipMatch && ipMatch[1]) {
          console.log(`\nHotspot IP address: ${ipMatch[1]}`);
        }
      } catch (err) {
        // Skip if command fails
      }

      console.log('\nHotspot Share QR Code:');
      console.log('Scan this code with a mobile device to connect to your hotspot:');
      console.log('');  // Add a blank line
      await generateNetworkQR(ssid, password);

      console.log('\nUse "wifi-manager devices list" to see connected devices');

      if (options.save) {
        await networkControl.saveCurrentSetup(options.save);
        console.log(`Hotspot configuration saved as "${options.save}"`);
      }
    } else {
      console.log('Failed to start hotspot');
    }
  });

const vpnCommand = program
  .command('vpn')
  .description('Manage WireGuard VPN connection');

vpnCommand
  .command('start')
  .description('Start VPN connection')
  .option('-c, --config <file>', 'WireGuard config file path')
  .option('-e, --endpoint <endpoint>', 'VPN server endpoint (e.g., vpn.example.com:51820)')
  .option('-a, --allowed-ips <ips>', 'Allowed IPs (comma separated)')
  .option('-d, --dns <server>', 'DNS server to use')
  .action(async (options) => {
    try {
      if (options.config) {
        console.log(`Reading VPN configuration from ${options.config}...`);
        const { stdout } = await executeCommand(`cat ${options.config}`);
        const config = JSON.parse(stdout);
        const result = await networkControl.setupWireGuardWithQR(config);

        if (result.success && result.config) {
          console.log('VPN started successfully');
          console.log('\nVPN Configuration QR Code:');
          await generateWireGuardQR(result.config);
        } else {
          console.log('Failed to start VPN');
        }
      } else if (options.endpoint && options.allowedIps) {
        console.log('Setting up WireGuard VPN with provided parameters...');
        const allowedIPs = options.allowedIps.split(',');

        const result = await networkControl.setupWireGuardWithQR({
          endpoint: options.endpoint,
          allowedIPs: allowedIPs,
          dns: options.dns
        });

        if (result.success && result.config) {
          console.log('VPN started successfully');
          console.log('\nVPN Configuration QR Code:');
          await generateWireGuardQR(result.config);
        } else {
          console.log('Failed to start VPN');
        }
      } else {
        console.error('Error: Either config file or endpoint/allowed-ips are required');
      }
    } catch (error) {
      console.error('Failed to start VPN:', error);
    }
  });

vpnCommand
  .command('stop')
  .description('Stop VPN connection')
  .action(async () => {
    console.log('Stopping VPN connection...');
    const result = await networkControl.stopWireGuard();
    console.log(result ? 'VPN stopped successfully' : 'Failed to stop VPN');
  });

vpnCommand
  .command('status')
  .description('Show VPN connection status')
  .option('-d, --detailed', 'Show detailed status information')
  .action(async (options) => {
    console.log('Checking VPN status...');
    const status = await networkControl.getWireGuardStatus();

    // Use the formatVpnStatus from our utilities for better display
    console.log(formatSectionHeader('VPN STATUS'));
    const vpnStatusLines = formatVpnStatus(status);
    vpnStatusLines.forEach(line => console.log(line));

    if (status.active && options.detailed) {
      // Show routing information for VPN
      try {
        const { stdout: routeInfo } = await executeCommand('ip route show | grep wg0');
        console.log('\n' + colorize('VPN Routing:', 'bold'));
        console.log(routeInfo);

        const { stdout: wgShow } = await executeCommand('sudo wg show wg0');
        console.log('\n' + colorize('WireGuard Details:', 'bold'));
        console.log(wgShow);
      } catch (err) {
        // Just skip if command fails
      }
    }
  });

vpnCommand
  .command('export')
  .description('Export WireGuard VPN configuration to a file')
  .option('-f, --filename <filename>', 'Custom filename for the export')
  .action(async (options) => {
    try {
      console.log('Exporting WireGuard configuration...');
      console.log('The private key will be encrypted for security.');
      const filePath = await networkControl.exportWireGuardConfig(options.filename);

      if (filePath) {
        console.log(`WireGuard configuration successfully exported to: ${filePath}`);
      } else {
        console.error('Failed to export WireGuard configuration. Is the VPN configured?');
      }
    } catch (error) {
      console.error('Failed to export WireGuard configuration:', error);
    }
  });

vpnCommand
  .command('import')
  .description('Import WireGuard VPN configuration from a file')
  .argument('<filepath>', 'Path to the exported configuration file')
  .action(async (filePath) => {
    try {
      console.log(`Importing WireGuard configuration from: ${filePath}`);
      console.log('The encrypted private key will be decrypted during import.');
      const result = await networkControl.importWireGuardConfig(filePath);

      if (result.success) {
        console.log('WireGuard configuration successfully imported');
        console.log('Use "wifi-manager vpn start" to activate the imported configuration');
      } else {
        console.error('Failed to import WireGuard configuration');

        if (result.errors && result.errors.length > 0) {
          console.log('\nErrors encountered:');
          result.errors.forEach(error => console.log(`- ${error}`));
        }
      }
    } catch (error) {
      console.error('Failed to import WireGuard configuration:', error);
    }
  });

program
  .command('boot-setup')
  .description('Set the network configuration to use at boot time')
  .argument('<id>', 'Configuration ID to use at boot')
  .action(async (id) => {
    try {
      // Check if the configuration exists
      const savedConfigs = await networkControl.listConfigs();
      const configExists = savedConfigs.some((config: { id: string }) => config.id === id);

      if (!configExists) {
        console.log(`Configuration "${id}" not found. Available configurations:`);
        savedConfigs.forEach((config: { id: string; config: any }) => {
          console.log(`- ${config.id} ("${config.config.ssid}", ${config.config.mode})`);
        });
        return;
      }

      // Set as default configuration
      await networkControl.setDefaultConfig(id);
      console.log(`Configuration "${id}" will be used at boot time`);
    } catch (error) {
      console.error('Failed to set boot configuration:', error);
    }
  });

// If no command is provided, start interactive mode
if (process.argv.length <= 2) {
  interactiveMode().catch(console.error);
} else {
  program.parse();
}