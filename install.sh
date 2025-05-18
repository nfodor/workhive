#!/bin/bash

# WorkHive Installation Script

# Exit immediately if a command exits with a non-zero status.
set -e

# Function to check if a command exists
command_exists() {
  command -v "$1" >/dev/null 2>&1
}

# Function to install packages if they are not already installed
install_package() {
  if ! dpkg -s "$1" >/dev/null 2>&1; then
    echo "Installing $1..."
    sudo apt-get update
    sudo apt-get install -y "$1"
  else
    echo "$1 is already installed."
  fi
}

# Check for root privileges
if [ "$EUID" -ne 0 ]; then
  echo "Please run as root or with sudo."
  exit 1
fi

# --- Package Installation ---
echo "\n--- Checking and Installing System Dependencies ---"

# Essential build tools
install_package "build-essential"

# Node.js and npm
if ! command_exists node || ! command_exists npm; then
  echo "Node.js or npm not found. Installing Node.js (which includes npm)..."
  # Add NodeSource repository for Node.js 18.x (or your preferred version)
  curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
  sudo apt-get install -y nodejs
else
  echo "Node.js and npm are already installed."
  echo "Node version: $(node -v)"
  echo "npm version: $(npm -v)"
fi

# NetworkManager
install_package "network-manager"

# dnsmasq (for hotspot functionality)
install_package "dnsmasq"

# WireGuard
install_package "wireguard"
install_package "wireguard-tools"

# iptables (for firewall rules, usually pre-installed)
if ! command_exists iptables; then
  install_package "iptables"
else
  echo "iptables is already installed."
fi

# Other utilities that might be used by the application or its scripts
install_package "nmap"      # For network scanning and diagnostics
install_package "tcpdump"   # For network diagnostics
install_package "curl"      # For HTTP requests (e.g., setip.io)

echo "\n--- System Dependencies Check Complete ---"

# --- Application Setup ---
echo "\n--- Setting up WorkHive Application ---"

# Navigate to the script's directory
APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$APP_DIR"

echo "Working directory: $APP_DIR"

# Install npm dependencies (including devDependencies for the build process)
echo "\\nInstalling npm dependencies (including devDependencies for build)..."
npm install

# Build the application (compile TypeScript to JavaScript)
echo "\\nBuilding the application..."
# The build script in package.json (npx tsc && chmod +x dist/cli.js) will be executed
npm run build

# Optional: Prune devDependencies after build if a smaller deployment is needed
# echo "\\nPruning development dependencies..."
# npm prune --production

# Ensure boot and cli scripts are executable
if [ -f "dist/boot.js" ]; then
  chmod +x "dist/boot.js"
  echo "Made boot.js executable."
else
  echo "Warning: dist/boot.js not found after build."
fi

if [ -f "dist/cli.js" ]; then
  chmod +x "dist/cli.js"
  echo "Made cli.js executable."
else
  echo "Error: dist/cli.js not found after build. Build might have failed."
  exit 1
fi

# --- Systemd Service Setup ---
echo "\n--- Setting up Systemd Service for WorkHive ---"

SERVICE_FILE_NAME="workhive.service" # Updated service name
SERVICE_FILE_PATH="/etc/systemd/system/$SERVICE_FILE_NAME"

# Create or update the systemd service file
# Note: The wifi-manager.service file in the repo should be renamed to workhive.service
# or this script should refer to the correct source file name.
# Assuming the correct service file is named 'workhive.service' in the repo.

if [ -f "wifi-manager.service" ]; then
    echo "Copying wifi-manager.service to $SERVICE_FILE_PATH..."
    cp "wifi-manager.service" "$SERVICE_FILE_PATH"
elif [ -f "$SERVICE_FILE_NAME" ]; then
    echo "Copying $SERVICE_FILE_NAME to $SERVICE_FILE_PATH..."
    cp "$SERVICE_FILE_NAME" "$SERVICE_FILE_PATH"
else
    echo "Error: Service file (workhive.service or wifi-manager.service) not found in $APP_DIR."
    echo "Please ensure the service definition file is present."
    # As a fallback, create a basic one if it's truly missing, but this is not ideal.
    # It's better to have the correct one in the repository.
    echo "Creating a fallback service file at $SERVICE_FILE_PATH..."
    cat <<EOF > "$SERVICE_FILE_PATH"
[Unit]
Description=WorkHive WiFi Manager
After=network.target

[Service]
Type=simple
User=root
WorkingDirectory=$APP_DIR
ExecStart=$APP_DIR/dist/boot.js
Restart=on-failure
Environment=NODE_ENV=production
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
EOF
fi

# Reload systemd, enable and start the service
echo "\nReloading systemd daemon..."
systemctl daemon-reload

echo "Enabling WorkHive service to start on boot..."
systemctl enable "$SERVICE_FILE_NAME"

echo "Starting WorkHive service..."
systemctl start "$SERVICE_FILE_NAME"

echo "WorkHive service status:"
systemctl status "$SERVICE_FILE_NAME" --no-pager || true # Don't exit if status fails for some reason

# --- CLI Symlink Setup ---
echo "\n--- Setting up CLI command 'workhive' ---"

CLI_SYMLINK_PATH="/usr/local/bin/workhive"

if [ -L "$CLI_SYMLINK_PATH" ] && [ -e "$CLI_SYMLINK_PATH" ]; then
  echo "Symlink $CLI_SYMLINK_PATH already exists. Removing it to create a new one."
  rm -f "$CLI_SYMLINK_PATH"
fi

ln -s "$APP_DIR/dist/cli.js" "$CLI_SYMLINK_PATH"
echo "Symlink for 'workhive' command created at $CLI_SYMLINK_PATH."

# --- Final Instructions ---
echo "\n--- WorkHive Installation Complete! ---"
echo "The WorkHive service has been started and enabled on boot."
echo "You can manage WorkHive using the 'workhive' command."
echo "Example: workhive status"
echo "To see logs: sudo journalctl -u $SERVICE_FILE_NAME -f"

exit 0
