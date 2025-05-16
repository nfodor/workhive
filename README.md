# WorkHive - Free Professional Travel Router for Raspberry Pi

A comprehensive solution for transforming your Raspberry Pi 4B and newer into a powerful, portable travel router. When connected to an iPhone or Android phone, this turns your Raspberry Pi into an advanced networking hub with powerful capabilities. This tool provides a TypeScript/JavaScript implementation designed for travelers, remote workers, and tech enthusiasts who need a reliable, secure networking solution on the go.

> **⚠️ WARNING: Some features are still under development.** This project is actively being developed and some features mentioned in this documentation might not be fully implemented. Please refer to the test results and development updates for more information on feature status.

## The Traveler's Network Dilemma

Do you travel frequently and wish your devices could connect to WiFi as seamlessly on the road as they do at your home office? We understand the frustration. When traveling with multiple devices, you lose the simplicity of your home network setup, forcing you to reconnect each device to unfamiliar networks, often with questionable security.

WorkHive solves this by bringing the comfort and security of your home office network wherever you go. This isn't just a travel router—it's your entire home network ecosystem made portable. Connect once to WorkHive, and all your devices instantly recognize their familiar environment, maintaining your configurations, shared resources, and security settings intact.

Even better, WorkHive enhances your home network when you're not traveling, serving as a security upgrade to your existing setup that you can simply unplug and take when you're on the move.

## Project Goal

The primary goal of this project is to create a portable, low-power travel router using a Raspberry Pi that offers:

- **Mobile Hotspot**: Turn your Pi into a WiFi access point with advanced access control
- **Low Power Consumption**: Optimized for operation with standard USB power supplies (no need for 5V/5A supply on Pi5)
- **Public IP Address**: Automated integration with setip.io for obtaining a public IP
- **Encrypted Traffic**: WireGuard VPN tunneling for all network traffic
- **Dual Mode Operation**: Function as either a router or a client device

## Features

- 🔌 **Low Power Operation**: Works with standard USB power sources, including car chargers and power banks
- 🌐 **Public IP via setip.io**: Automated connection and configuration with setip.io service
- 🔄 **Multi-Mode Support**: Function as a hotspot, client, or both (with additional WiFi adapter)
- 🔒 **WireGuard Integration**: All traffic from local network encrypted and routed through WireGuard tunnel
- 📱 **QR Code Generation**: Share network credentials easily via QR codes
- 📊 **Signal Strength Visualization**: Visual signal strength indicators
- 💾 **Configuration Management**: Save and restore network profiles
- 🔐 **Device Authorization**: Fine-grained control over which devices can connect
- 🚀 **Systemd Service**: Automatic startup on boot
- 🖥️ **Interactive CLI**: Feature-rich command-line interface

## Installation

### Automatic Installation

```bash
sudo ./install.sh
```

### Manual Installation

1. Install dependencies:
   ```bash
   npm install
   ```

2. Build the application:
   ```bash
   npm run build
   ```

3. Create a global symlink (optional):
   ```bash
   sudo npm link
   ```

4. Set up systemd service (optional):
   ```bash
   sudo cp wifi-manager.service /etc/systemd/system/
   sudo systemctl daemon-reload
   sudo systemctl enable wifi-manager.service
   sudo systemctl start wifi-manager.service
   ```

## Testing

You can run comprehensive tests using the included test script:

```bash
# Run all tests and see detailed results
./test.sh

# View previous test results
cat test-results/test-results-*.log
```

The test script verifies all major features, including:
- Network scanning
- Connection management
- Configuration export/import
- VPN functionality with setip.io integration
- Device access control
- Network diagnostics

Test results are saved to the `test-results` directory with timestamped filenames.

## Usage

### Interactive Mode

Simply run the command without arguments:

```bash
wifi-manager
```

This will start an interactive menu where you can:
- Scan for networks
- Connect to networks
- Create or manage a WiFi hotspot
- Set up and control WireGuard VPN connections with setip.io
- View system status
- Manage device access control
- And more...

### Command-Line Interface

```bash
# Get help
wifi-manager --help

# Scan for networks (client mode)
wifi-manager scan

# Scan with interactive selection and connect
wifi-manager scan -i

# Connect to a network (client mode)
wifi-manager connect "MyNetwork" -p "MyPassword"

# Show current status
wifi-manager status

# Show detailed status including power consumption
wifi-manager status --detailed

# Start a hotspot (access point mode)
wifi-manager hotspot "MyHotspot" "MyPassword"

# Manage network configurations
wifi-manager config list
wifi-manager config save myconfig
wifi-manager config activate myconfig
wifi-manager config export -f myexport.json
wifi-manager config import myexport.json

# WireGuard VPN management with setip.io integration
wifi-manager vpn status
wifi-manager vpn start --setip  # Use setip.io for public IP
wifi-manager vpn start -c config.json  # Use custom config
wifi-manager vpn stop
wifi-manager vpn export -f myvpn.json
wifi-manager vpn import myvpn.json

# Network diagnostics
wifi-manager debug
wifi-manager debug --deep

# View and manage connected devices (when in hotspot mode)
wifi-manager devices list
wifi-manager devices authorize "Device Name" 192.168.4.10
wifi-manager devices revoke "Device Name"
```

## Dual Mode Operation

The WiFi Manager supports multiple operational modes:

- **Hotspot Mode**: Create a WiFi access point for multiple devices to connect
- **Client Mode**: Connect to existing WiFi networks when using the Pi as a desktop/portable machine
- **Dual Mode**: With a second WiFi controller, operate as both client and hotspot simultaneously

> **Note**: Dual mode operation with a second WiFi controller has not been thoroughly tested under various power conditions.

## WireGuard VPN Integration with setip.io

All traffic from your local WiFi network is encrypted and tunneled through WireGuard VPN:

- Automatic connection to setip.io for obtaining a public IP address
- All network traffic exits through the setip.io public IP address
- Incoming connections can be routed through the same IP address
- Full encryption provides security when using public WiFi hotspots

WireGuard configuration is fully integrated with the WiFi management system for a seamless experience.

## Security Features

- 🔐 **Password Encryption**: All exported passwords and private keys are encrypted
- 🛡️ **Access Control**: Manage which devices can connect to your hotspot
- 🔍 **Connection Monitoring**: Monitor connected devices and their activity
- 📊 **Diagnostics**: Comprehensive network diagnostics tools

## Advanced Features

### Export/Import Configurations

You can export your network and VPN configurations to a file for backup or transfer to another device:

```bash
# Export configurations
wifi-manager config export -f my_networks.json
wifi-manager vpn export -f my_vpn.json

# Import configurations
wifi-manager config import my_networks.json
wifi-manager vpn import my_vpn.json
```

### QR Code Sharing

Easily share network credentials using QR codes:

```bash
# Show QR code for current network
wifi-manager status

# Show QR code when starting a hotspot
wifi-manager hotspot "MyHotspot" "MyPassword"

# Show WireGuard VPN QR code
wifi-manager vpn status
```

## License

ISC License

## Contributing

Contributions are welcome! Please open an issue or submit a pull request for any improvements or bug fixes.
wifi-manager vpn import myvpn.json
```

## Network Configuration Management

Save, export, and import network configurations:

```bash
# Save current configuration
wifi-manager config save home

# List saved configurations
wifi-manager config list

# Activate a saved configuration
wifi-manager config activate work

# Remove duplicate configurations
wifi-manager config deduplicate

# Export all configurations to a file
wifi-manager config export -f backup.json

# Import configurations from a file
wifi-manager config import backup.json
```

## WireGuard VPN

Set up, export, and import VPN connections:

```bash
# Start VPN from config file
wifi-manager vpn start -c vpn-config.json

# Start VPN with direct parameters
wifi-manager vpn start -e vpn.example.com:51820 -a "10.0.0.0/24,192.168.0.0/24" -d 1.1.1.1

# Check VPN status
wifi-manager vpn status

# Stop VPN
wifi-manager vpn stop

# Export current VPN configuration to a file
wifi-manager vpn export -f myvpn.json

# Import VPN configuration from a file
wifi-manager vpn import myvpn.json
```

## Device Management

Control which devices can connect to your network:

```bash
# List allowed devices
wifi-manager device --list

# Allow a device
wifi-manager device --allow "00:11:22:33:44:55"

# Remove a device
wifi-manager device --remove "00:11:22:33:44:55"
```

## Diagnostics

Debug network issues:

```bash
# Basic diagnostics
wifi-manager debug

# Deep diagnostics with system logs
wifi-manager debug --deep
```

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## License

This project is licensed under the ISC License.
