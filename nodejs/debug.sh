#!/bin/bash
# Debug script for WiFi Manager
# This script helps diagnose issues with the WiFi Manager

# Terminal colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${GREEN}WiFi Manager Diagnostics${NC}"
echo "-------------------------------"

# Check if running as root
if [ "$EUID" -ne 0 ]; then
  echo -e "${YELLOW}Note: Some commands may not work without root privileges${NC}"
fi

# Function to run and display command output
run_cmd() {
  echo -e "${BLUE}▶ $1${NC}"
  eval "$1"
  echo ""
}

echo -e "${YELLOW}System Information:${NC}"
run_cmd "uname -a"
run_cmd "cat /etc/os-release"

echo -e "${YELLOW}Network Interface Status:${NC}"
run_cmd "ip addr show"
run_cmd "iwconfig"

echo -e "${YELLOW}WiFi Networks:${NC}"
run_cmd "sudo iwlist wlan0 scanning | grep -E 'ESSID|Quality'"

echo -e "${YELLOW}NetworkManager Status:${NC}"
run_cmd "systemctl status NetworkManager --no-pager"
run_cmd "nmcli device status"
run_cmd "nmcli connection show"

echo -e "${YELLOW}WiFi Manager Service Status:${NC}"
run_cmd "systemctl status wifi-manager --no-pager"

echo -e "${YELLOW}WiFi Manager Configuration:${NC}"
run_cmd "ls -la /home/pi/.wifi_configs"
if [ -d "/home/pi/.wifi_configs" ]; then
  run_cmd "find /home/pi/.wifi_configs -type f -name '*.json' -exec echo -e 'File: {}' \; -exec cat {} \; -exec echo \;"
fi

echo -e "${YELLOW}DNS Configuration:${NC}"
run_cmd "cat /etc/resolv.conf"

echo -e "${YELLOW}Routing Table:${NC}"
run_cmd "ip route show"

echo -e "${YELLOW}WireGuard Status:${NC}"
run_cmd "sudo wg show all 2>/dev/null || echo 'WireGuard not available or not configured'"

echo -e "${YELLOW}Recent Logs:${NC}"
run_cmd "journalctl -u NetworkManager -n 20 --no-pager"
run_cmd "journalctl -u wifi-manager -n 20 --no-pager"

echo -e "${GREEN}Diagnostic information collected successfully!${NC}"
echo "You can save this output to a file using: ./debug.sh > diagnostics.log"
