#!/bin/bash
# WiFi Manager Installation Script
# This script installs and configures the WiFi Manager service

# Terminal colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${GREEN}WiFi Manager Installation${NC}"
echo "-------------------------------"

# Check if running as root
if [ "$EUID" -ne 0 ]; then
  echo -e "${RED}Please run as root (sudo ./install.sh)${NC}"
  exit 1
fi

# Current directory
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" &> /dev/null && pwd )"

echo -e "${YELLOW}Installing dependencies...${NC}"
cd "$SCRIPT_DIR"
npm install

echo -e "${YELLOW}Building the application...${NC}"
npm run build

echo -e "${YELLOW}Setting up global command...${NC}"
npm link

echo -e "${YELLOW}Creating configuration directory...${NC}"
mkdir -p /home/pi/.wifi_configs
chown pi:pi /home/pi/.wifi_configs

echo -e "${YELLOW}Setting up systemd service...${NC}"
cp wifi-manager.service /etc/systemd/system/
systemctl daemon-reload
systemctl enable wifi-manager.service
systemctl start wifi-manager.service

echo -e "${YELLOW}Setting up executable permissions...${NC}"
chmod +x "$SCRIPT_DIR/dist/cli.js"

echo -e "${GREEN}Installation complete!${NC}"
echo ""
echo "Usage:"
echo "  wifi-manager          - Interactive menu (no arguments)"
echo "  wifi-manager --help   - Show all available commands"
echo "  wifi-manager scan     - Scan for available networks"
echo "  wifi-manager scan -i  - Scan and connect interactively"
echo "  wifi-manager status   - Show current network status"
echo ""
echo "The WiFi Manager service has been installed and started."
echo "The service will automatically start on boot."
