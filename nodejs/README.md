# WiFi Manager

A comprehensive network management solution for Raspberry Pi and other Linux systems. This tool provides a TypeScript/JavaScript implementation of various network management features with both CLI and interactive modes.

## Features

- 📱 **QR Code Generation**: Share network credentials easily via QR codes
- 📊 **Signal Strength Visualization**: Visual signal strength indicators
- 🔒 **WireGuard VPN Support**: Full VPN management built-in
- 💾 **Configuration Management**: Save and restore network profiles
- 🔐 **Device Authorization**: Control which devices can connect
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

## Usage

### Interactive Mode

Simply run the command without arguments:

```bash
wifi-manager
```

This will start an interactive menu where you can:
- Scan for networks
- Connect to networks
- Manage network configurations
- Set up and control VPN connections
- View system status
- And more...

### Command-Line Interface

```bash
# Get help
wifi-manager --help

# Scan for networks
wifi-manager scan

# Scan with interactive selection
wifi-manager scan -i

# Connect to a network
wifi-manager connect "MyNetwork" -p "MyPassword"

# Show current status
wifi-manager status

# Show detailed status
wifi-manager status --detailed

# Start a hotspot
wifi-manager hotspot "MyHotspot" "MyPassword"

# Manage configurations
wifi-manager config list
wifi-manager config save myconfig
wifi-manager config activate myconfig
wifi-manager config export -f myexport.json
wifi-manager config import myexport.json

# WireGuard VPN management
wifi-manager vpn status
wifi-manager vpn start -c config.json
wifi-manager vpn stop
wifi-manager vpn export -f myvpn.json
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
