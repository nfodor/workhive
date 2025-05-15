#!/bin/bash
#set -x 
# Enable strict mode and verbose error handling at the top of the script
set -euo pipefail
IFS=$'\n\t'

# Trap errors and print detailed information
trap 'echo "[ERROR] Command failed at line $LINENO: $BASH_COMMAND" >&2' ERR

# Check for required commands at startup
for cmd in nmcli iwconfig ethtool ip ping grep awk qrencode; do
  if ! command -v "$cmd" >/dev/null 2>&1; then
    if [ "$cmd" == "qrencode" ]; then
      echo "[WARNING] Command '$cmd' not found. QR code generation will be skipped. Install with 'sudo apt install qrencode'." >&2
    else
      echo "[FATAL] Required command '$cmd' not found. Please install it before running this script." >&2
      exit 1
    fi
  fi
done

HOTSPOT_NAME="WORK-HIVE_HOTSPOT"
HOTSPOT_IP="192.168.100.1/24"
WG_INTERFACE="wg0"
VPN_DNS="1.1.1.1"
WG_PUBLIC_IP="157.230.208.238"  # Replace with actual WireGuard server public IP
DNSMASQ_CONF="/etc/NetworkManager/dnsmasq.d/custom-dns.conf"
DHCP_CONF="/etc/NetworkManager/dnsmasq.d/dhcp-options.conf"
CONFIG_DIR="$HOME/.wifi_configs"

# Derived Hotspot IP configurations
HOTSPOT_GATEWAY_IP=$(echo "$HOTSPOT_IP" | cut -d'/' -f1)
_HOTSPOT_CIDR_SUFFIX=$(echo "$HOTSPOT_IP" | cut -d'/' -f2)
_HOTSPOT_SUBNET_PREFIX=$(echo "$HOTSPOT_GATEWAY_IP" | cut -d'.' -f1-3)
HOTSPOT_SUBNET="${_HOTSPOT_SUBNET_PREFIX}.0/${_HOTSPOT_CIDR_SUFFIX}"

print_help() {
  cat <<EOF
Usage:
  $0 --setup --interface <interface> --mode <mode> [--ssid <ssid>] [--password <password>] [--config_name <config_name>] [--wg_interface <wg_interface>] [--captive_mode <on|off|captive>]
      - Starts hotspot or connects as client
      - --interface: network interface to use (e.g., wlan0)
      - --mode: hotspot | client
      - --ssid: (optional) Wi-Fi network name (SSID) to use or connect to
      - --password: (optional) Wi-Fi password
      - --config_name: (optional) custom name for this configuration
      - --wg_interface: (optional) WireGuard interface to use (e.g., wg0)
      - --captive_mode: (optional) captive portal mode: on, off, or captive
      
      Examples:
        # Hotspot mode (SSID: hotspotone, Password: HotspotAccess123!)
        $0 --setup --interface wlan0 --mode hotspot --ssid hotspotone --password 'HotspotAccess123!'

        # Client mode (connect to Wi-Fi)
        $0 --setup --interface wlan0 --mode client --ssid mywifi --password mywifipass

        # Hotspot with WireGuard and captive mode enabled
        $0 --setup --interface wlan0 --mode hotspot --ssid hotspotone --password 'HotspotAccess123!' --wg_interface wg0 --captive_mode on

        # Client with custom config name
        $0 --setup --interface wlan0 --mode client --ssid mywifi --password mywifipass --config_name workwifi

  $0 --device <action> [params]
      - Manage device internet access
      - actions:
        * list: Show all authorized devices
        * authorize <device-name> <ip-address>: Grant internet access to a device
        * revoke <device-name>: Remove internet access from a device

  $0 --edit <config-keyword>
      - Opens config file in editor for manual update
      - allowed_devices: edit device authorization list

  $0 --list
      - List saved configurations

  $0 --select
      - Show menu to select and activate a saved configuration

  $0 --activate <config_id>
      - Activate a saved configuration by ID

  $0 --deduplicate-profiles
      - Interactively remove duplicate Wi-Fi network profiles (based on SSID)

  $0 --deduplicate-saved
      - Interactively remove duplicate saved Wi-Fi configurations (based on SSID and mode)

  $0 --debug [deep]
      - Run diagnostic checks for forwarding, NAT, and connections
      - Use "deep" to include tcpdump and verbose output

  $0 status
      - Show current connection status, hotspot details (SSID, Password, QR code), including WireGuard connectivity

  $0 --help
      - Show this help menu
EOF
}

run_debug_diagnostics() {
  local mode=$1
  echo "===================="
  echo "🔥 Hotspot Debug Info"
  echo "===================="

  echo -e "\n📶 Active Interfaces:"
  ip addr show wlan0
  ip addr show $WG_INTERFACE

  echo -e "\n📡 Routing Table:"
  ip route

  echo -e "\n🔁 IP Forwarding Status:"
  sysctl net.ipv4.ip_forward

  echo -e "\n🛡️  NAT Table (iptables -t nat):"
  sudo iptables -t nat -L -n -v --line-numbers

  echo -e "\n🚦 FORWARD Chain (iptables):"
  sudo iptables -L FORWARD -n -v --line-numbers

  echo -e "\n🔍 Current TCP Connections to :443 (conntrack):"
  sudo conntrack -L | grep dport=443 || echo "(no active connections on port 443)"

  if [[ "$mode" == "deep" ]]; then
    echo -e "\n🐾 Capturing packets on wlan0 for port 443 (Press Ctrl+C to stop):"
    sudo tcpdump -i wlan0 port 443 -nn -vvv
  else
    echo -e "\n💡 Suggestion: Run with '--debug deep' for live packet capture (tcpdump)"
  fi

  echo "===================="
}

apply_dns_bypass_for_clients() {
  if [ -f "$DHCP_CONF" ]; then
    echo "Setting up DNS bypass for authorized devices..."

    sudo iptables -C FORWARD -i wlan0 -p udp --dport 53 -j DROP 2>/dev/null \
      || sudo iptables -A FORWARD -i wlan0 -p udp --dport 53 -j DROP
    sudo iptables -C FORWARD -i wlan0 -p tcp --dport 53 -j DROP 2>/dev/null \
      || sudo iptables -A FORWARD -i wlan0 -p tcp --dport 53 -j DROP

    while IFS= read -r line; do
      if [[ $line =~ dhcp-host=([^,]+),([0-9.]+) ]]; then
        local device="${BASH_REMATCH[1]}"
        local ip="${BASH_REMATCH[2]}"
        echo "Bypassing captive DNS for device '$device' ($ip)"
        sudo iptables -I FORWARD -s "$ip" -p udp --dport 53 -j ACCEPT
        sudo iptables -I FORWARD -s "$ip" -p tcp --dport 53 -j ACCEPT
      fi
    done < "$DHCP_CONF"
  else
    echo "No device configuration found. All clients will use captive DNS."
  fi
}

enable_ip_forwarding() {
  echo "Enabling IP forwarding..."
  sudo sysctl -w net.ipv4.ip_forward=1
}

setup_wireguard_routing() {
  local target_wg_interface=$1
  echo "Setting up NAT and DNS routing for $target_wg_interface..."

  # Validate that target_wg_interface is set
  if [ -z "$target_wg_interface" ]; then
    echo "Error: No WireGuard interface provided to setup_wireguard_routing function."
    return 1
  fi

  # Validate that wlan0 is available
  if ! ip link show wlan0 &>/dev/null; then
    echo "Error: wlan0 interface is not available. Cannot proceed with NAT and DNS routing."
    return 1
  fi

  # Enable NAT for the hotspot subnet to the WireGuard interface
  sudo iptables -t nat -C POSTROUTING -s "$HOTSPOT_SUBNET" -o "$target_wg_interface" -j MASQUERADE 2>/dev/null \
    || sudo iptables -t nat -A POSTROUTING -s "$HOTSPOT_SUBNET" -o "$target_wg_interface" -j MASQUERADE

  # Allow forwarding from the hotspot interface to the WireGuard interface
  sudo iptables -C FORWARD -i wlan0 -o "$target_wg_interface" -j ACCEPT 2>/dev/null \
    || sudo iptables -A FORWARD -i wlan0 -o "$target_wg_interface" -j ACCEPT

  # Allow forwarding from the WireGuard interface to the hotspot interface for established connections
  sudo iptables -C FORWARD -i "$target_wg_interface" -o wlan0 -m state --state ESTABLISHED,RELATED -j ACCEPT 2>/dev/null \
    || sudo iptables -A FORWARD -i "$target_wg_interface" -o wlan0 -m state --state ESTABLISHED,RELATED -j ACCEPT

  # Allow DNS traffic from the hotspot interface to the WireGuard interface
  sudo iptables -C FORWARD -i wlan0 -o "$target_wg_interface" -p udp --dport 53 -j ACCEPT 2>/dev/null \
    || sudo iptables -A FORWARD -i wlan0 -o "$target_wg_interface" -p udp --dport 53 -j ACCEPT
  sudo iptables -C FORWARD -i wlan0 -o "$target_wg_interface" -p tcp --dport 53 -j ACCEPT 2>/dev/null \
    || sudo iptables -A FORWARD -i wlan0 -o "$target_wg_interface" -p tcp --dport 53 -j ACCEPT

  echo "NAT and DNS routing setup completed for $target_wg_interface."
}

write_dns_config() {
  echo "Configuring captive portal DNS settings..."

  # Always use captive mode by default, redirecting to port 8080
  sudo tee "$DNSMASQ_CONF" > /dev/null <<EOF
# Redirect all DNS queries to the hotspot IP on port 8080
address=/#/$HOTSPOT_GATEWAY_IP#8080

# Allow these domains to resolve normally for better compatibility
server=/googleapi.com/8.8.8.8
server=/cloudfront.net/8.8.8.8
server=/apple.com/8.8.8.8
server=/stripe.com/8.8.8.8

# Special handling for Apple's captive portal detection
address=/captive.apple.com/$HOTSPOT_GATEWAY_IP#8080
EOF

  # Configure specific domains to always resolve to the hotspot IP
  # This is done in dnsmasq-shared.d to ensure it works for all clients
  sudo mkdir -p /etc/NetworkManager/dnsmasq-shared.d
  sudo tee /etc/NetworkManager/dnsmasq-shared.d/local-domains.conf > /dev/null <<EOF
# Force specific domains to resolve to the hotspot IP
address=/setip.io/$HOTSPOT_GATEWAY_IP
# address=/numfree.org/$HOTSPOT_GATEWAY_IP
EOF

  # Apply DNS bypass for authorized devices
  apply_dns_bypass_for_clients

  echo "Restarting NetworkManager to apply DNS changes..."
  sudo systemctl restart NetworkManager
}

create_config_id() {
  local custom_name=$1
  local mode=$2
  local ssid=$3

  # If custom name is provided, use it
  if [ -n "$custom_name" ]; then
    # Replace spaces with underscores and remove special characters
    echo "${custom_name// /_}" | tr -cd 'a-zA-Z0-9_-'
    return
  fi

  # Otherwise, create a name based on SSID and mode
  local base_name="${ssid// /_}_${mode}"
  # Remove special characters
  echo "$base_name" | tr -cd 'a-zA-Z0-9_-'
}

get_unique_config_id() {
  local base_id=$1
  local config_id="$base_id"
  local counter=1

  # Check if file with this ID already exists
  while [ -f "${CONFIG_DIR}/${config_id}.conf" ]; do
    config_id="${base_id}_${counter}"
    counter=$((counter+1))
  done

  echo "$config_id"
}

show_current_setup() {
  # Find the most recently used config file (by access time)
  if [ ! -d "$CONFIG_DIR" ]; then
    echo "No saved configurations found."
    return 1
  fi

  local latest_file
  latest_file=$(ls -1t "$CONFIG_DIR"/*.conf 2>/dev/null | head -n 1)
  if [ -z "$latest_file" ]; then
    echo "No configuration has been activated yet."
    return 1
  fi

  echo "Current active setup (most recently used):"
  echo "-----------------------------------------"
  cat "$latest_file"
  echo "-----------------------------------------"

  # Extract mode and interface
  local mode=$(grep -m 1 -oP 'MODE="\K[^"]+' "$latest_file" | tr -d '\n')
  local interface=$(grep -m 1 -oP 'INTERFACE="\K[^"]+' "$latest_file" | tr -d '\n')

  echo ""
  echo "📡 Connection Details:"
  echo "-----------------------------------------"

  if [ "$mode" == "hotspot" ]; then
    echo "🔥 Hotspot Mode Active on Interface: $interface"
    echo ""

    # Display hotspot signal strength and quality
    echo "📶 Hotspot Signal Quality:"
    iwconfig "$interface" | grep -E 'Signal level|Link Quality' || echo "No signal data available for $interface."

    # Display internet connection details
    echo ""
    echo "🌐 Internet Connection (Upstream):"
    local upstream_interface=$(ip route | grep default | awk '{print $5}')
    if [ -n "$upstream_interface" ]; then
      echo "Upstream Interface: $upstream_interface"
      iwconfig "$upstream_interface" | grep -E 'Signal level|Link Quality' || echo "No signal data available for $upstream_interface."
    else
      echo "No upstream internet connection detected."
    fi

    # Test internet connectivity
    echo ""
    echo "🌍 Internet Connectivity Test:"
    if ping -c 1 8.8.8.8 &>/dev/null; then
      echo "Internet is reachable (ping to 8.8.8.8 succeeded)."
    else
      echo "Internet is NOT reachable (ping to 8.8.8.8 failed)."
    fi
  elif [ "$mode" == "client" ]; then
    echo "🌐 Client Mode Active on Interface: $interface"
    echo ""

    # Display client signal strength and quality
    echo "📶 Wi-Fi Signal Quality:"
    iwconfig "$interface" | grep -E 'Signal level|Link Quality' || echo "No signal data available for $interface."

    # Test internet connectivity
    echo ""
    echo "🌍 Internet Connectivity Test:"
    if ping -c 1 8.8.8.8 &>/dev/null; then
      echo "Internet is reachable (ping to 8.8.8.8 succeeded)."
    else
      echo "Internet is NOT reachable (ping to 8.8.8.8 failed)."
    fi
  else
    echo "Unknown mode: $mode"
  fi

  echo "-----------------------------------------"
}

config_exists() {
  local ssid="$1"
  local mode="$2"
  local password="$3"
  if [ ! -d "$CONFIG_DIR" ]; then
    return 1
  fi
  for file in "$CONFIG_DIR"/*.conf; do
    [ -e "$file" ] || continue
    local f_ssid=$(grep -m 1 -oP 'SSID="\K[^"]+' "$file" | tr -d '\n')
    local f_mode=$(grep -m 1 -oP 'MODE="\K[^"]+' "$file" | tr -d '\n')
    local f_password=$(grep -m 1 -oP 'PASSWORD="\K[^"]+' "$file" | tr -d '\n')
    if [[ "$f_ssid" == "$ssid" && "$f_mode" == "$mode" && "$f_password" == "$password" ]]; then
      return 0
    fi
  done
  return 1
}

save_config() {
  local interface=$1
  local mode=$2
  local ssid=$3
  local password=$4
  local captive=${5:-"off"}
  local custom_name=${6:-""}

  # Create a base config ID from name or SSID+mode
  local base_id=$(create_config_id "$custom_name" "$mode" "$ssid")

  # Get unique ID (append number if needed)
  local config_id=$(get_unique_config_id "$base_id")
  local config_file="${CONFIG_DIR}/${config_id}.conf"
  local created_date=$(date "+%Y-%m-%d %H:%M:%S")

  # Create config directory if it doesn't exist
  mkdir -p "$CONFIG_DIR"

  # Save configuration with proper quoting to handle spaces
  cat > "$config_file" <<EOF
INTERFACE="$interface"
MODE="$mode"
SSID="$ssid"
PASSWORD="$password"
CAPTIVE_MODE="$captive"
CREATED_DATE="$created_date"
CONFIG_ID="$config_id"
EOF

  echo "Configuration saved as: $config_id"
  return 0
}

list_configs() {
  # Check if config directory exists
  if [ ! -d "$CONFIG_DIR" ]; then
    echo "No saved configurations found."
    return 1
  fi

  # Create a sorted array of config files
  mapfile -t config_files < <(find "$CONFIG_DIR" -name "*.conf" | sort)

  # Remove non-existent files from the list (in case of race conditions)
  config_files=( "${config_files[@]}" )
  local i=1
  local any_found=0

  for config_file in "${config_files[@]}"; do
    if [ ! -f "$config_file" ]; then
      continue
    fi
    local config_id=$(basename "$config_file" .conf)
    local ssid=$(grep -m 1 -oP 'SSID="\K[^"]+' "$config_file" | tr -d '\n')
    local mode=$(grep -m 1 -oP 'MODE="\K[^"]+' "$config_file" | tr -d '\n')
    local created_date=$(grep -m 1 -oP 'CREATED_DATE="\K[^"]+' "$config_file" | tr -d '\n')

    echo "$i) $config_id - $ssid (${mode}) - Created: $created_date"
    i=$((i+1))
    any_found=1
  done

  if [ "$any_found" -eq 0 ]; then
    echo "No saved configurations found."
    return 1
  fi

  return 0
}

select_config() {
  # List all configs
  if ! list_configs; then
    return 1
  fi

  # Get config count and files
  mapfile -t config_files < <(find "$CONFIG_DIR" -name "*.conf" | sort)
  local config_count=${#config_files[@]}

  # Ask for selection
  echo ""
  echo "Enter number to activate (or q to quit): "
  read selection

  # Check if user wants to quit
  if [[ "$selection" == "q" || "$selection" == "Q" ]]; then
    echo "Operation cancelled."
    return 1
  fi

  # Validate selection
  if ! [[ "$selection" =~ ^[0-9]+$ ]] || [ "$selection" -lt 1 ] || [ "$selection" -gt "$config_count" ]; then
    echo "Invalid selection. Please try again."
    return 1
  fi

  # Get selected config file (adjust for 0-based array indexing)
  local selected_index=$((selection-1))
  local config_file="${config_files[$selected_index]}"

  # Extract the variables safely using grep instead of sourcing
  # Trim any whitespace or newlines
  local interface=$(grep -m 1 -oP 'INTERFACE="\K[^"]+' "$config_file" | tr -d '\n')
  local mode=$(grep -m 1 -oP 'MODE="\K[^"]+' "$config_file" | tr -d '\n')
  local ssid=$(grep -m 1 -oP 'SSID="\K[^"]+' "$config_file" | tr -d '\n')
  local password=$(grep -m 1 -oP 'PASSWORD="\K[^"]+' "$config_file" | tr -d '\n')
  local captive_mode=$(grep -m 1 -oP 'CAPTIVE_MODE="\K[^"]+' "$config_file" | tr -d '\n')

  # Normalize captive_mode to be either "on", "off", or "captive"
  if [[ "$captive_mode" != "off" && "$captive_mode" != "on" && "$captive_mode" != "captive" ]]; then
    echo "Warning: Invalid captive mode '$captive_mode', defaulting to 'off'"
    captive_mode="off"
  fi

  # Debug output
  echo "Debug: MODE=$mode, CAPTIVE_MODE=$captive_mode"

  # Activate config
  echo "Activating configuration for $ssid ($mode)"
  handle_setup "$interface" "$mode" "$ssid" "$password" "$captive_mode"

  return 0
}

ensure_hairpin_nat() {
  echo "Ensuring hairpin NAT is in place for hotspot clients accessing $WG_PUBLIC_IP..."
   sudo iptables -t mangle -A FORWARD -p tcp --tcp-flags SYN,RST SYN -j TCPMSS --clamp-mss-to-pmtu  2>/dev/null \
    || sudo iptables -t nat -C PREROUTING -i wlan0 -d $WG_PUBLIC_IP -p tcp --dport 443 -j DNAT --to-destination "${HOTSPOT_GATEWAY_IP}:443" 2>/dev/null \
    || sudo iptables -t nat -A PREROUTING -i wlan0 -d $WG_PUBLIC_IP -p tcp --dport 443 -j DNAT --to-destination "${HOTSPOT_GATEWAY_IP}:443"
# Add a rule for HTTP (port 80)
sudo iptables -t nat -C PREROUTING --i wlan0 -d $WG_PUBLIC_IP -p tcp --dport 80 -j DNAT --to-destination "${HOTSPOT_GATEWAY_IP}:80" 2>/dev/null \
  || sudo iptables -t nat -A PREROUTING -i wlan0 -d $WG_PUBLIC_IP -p tcp --dport 80 -j DNAT --to-destination "${HOTSPOT_GATEWAY_IP}:80"

sudo iptables -t nat -C POSTROUTING -s "$HOTSPOT_SUBNET" -d "$HOTSPOT_GATEWAY_IP" -p tcp --dport 80 -j MASQUERADE 2>/dev/null \
  || sudo iptables -t nat -A POSTROUTING -s "$HOTSPOT_SUBNET" -d "$HOTSPOT_GATEWAY_IP" -p tcp --dport 80 -j MASQUERADE
  sudo iptables -t nat -C POSTROUTING -s "$HOTSPOT_SUBNET" -d "$HOTSPOT_GATEWAY_IP" -p tcp --dport 443 -j MASQUERADE 2>/dev/null \
    || sudo iptables -t nat -A POSTROUTING -s "$HOTSPOT_SUBNET" -d "$HOTSPOT_GATEWAY_IP" -p tcp --dport 443 -j MASQUERADE
}

handle_devices() {
  local action=$1

  case "$action" in
    list)
      echo "Currently authorized devices (with internet access):"
      if [ -f "$DHCP_CONF" ]; then
        while IFS= read -r line; do
          if [[ $line =~ dhcp-host=([^,]+),([0-9.]+) ]]; then
            local device="${BASH_REMATCH[1]}"
            local ip="${BASH_REMATCH[2]}"
            echo "- $device ($ip)"
          else
            echo "- $line (malformed entry)"
          fi
        done < "$DHCP_CONF"
      else
        echo "No devices authorized"
      fi
      ;;
    authorize)
      local device_name=$2
      local ip=$3

      if [[ -z "$device_name" || -z "$ip" ]]; then
        echo "Usage: $0 --device authorize <device-name> <ip-address>"
        echo "Example: $0 --device authorize \"John's iPhone\" 192.168.4.10"
        return 1
      fi

  # Create or append to the file with proper formatting
  mkdir -p "$(dirname "$DHCP_CONF")"
  # Ensure commas are properly placed
  echo "dhcp-host=$device_name,$ip,infinite" | sudo tee -a "$DHCP_CONF" > /dev/null
  echo "Device $device_name authorized with IP $ip"
      echo "Authorized device '$device_name' with IP $ip"
      echo "This device will now have full internet access through the hotspot"

      # Apply changes
      sudo systemctl restart NetworkManager
      apply_dns_bypass_for_clients
      ;;
    revoke)
      local device_name=$2

      if [[ -z "$device_name" ]]; then
        echo "Usage: $0 --device revoke <device-name>"
        echo "Example: $0 --device revoke \"John's iPhone\""
        return 1
      fi

      sudo sed -i "/dhcp-host=$device_name,/d" "$DHCP_CONF"
      echo "Revoked authorization for device '$device_name'"
      echo "This device will now be redirected to the captive portal"

      # Apply changes
      sudo systemctl restart NetworkManager
      apply_dns_bypass_for_clients
      ;;
    *)
      echo "Unknown device action: $action"
      echo "Try: list, authorize, revoke"
      return 1
      ;;
  esac
}

activate_config() {
  local config_id=$1
  local config_file="${CONFIG_DIR}/${config_id}.conf"

  # Check if config file exists
  if [ ! -f "$config_file" ]; then
    echo "Configuration not found: $config_id"
    # Try to list available configs
    list_configs
    return 1
  fi

  # Extract the variables safely using grep instead of sourcing
  # Trim any whitespace or newlines
  local interface=$(grep -m 1 -oP 'INTERFACE="\K[^"]+' "$config_file" | tr -d '\n')
  local mode=$(grep -m 1 -oP 'MODE="\K[^"]+' "$config_file" | tr -d '\n')
  local ssid=$(grep -m 1 -oP 'SSID="\K[^"]+' "$config_file" | tr -d '\n')
  local password=$(grep -m 1 -oP 'PASSWORD="\K[^"]+' "$config_file" | tr -d '\n')
  local captive_mode=$(grep -m 1 -oP 'CAPTIVE_MODE="\K[^"]+' "$config_file" | tr -d '\n')

  # Normalize captive_mode to be either "on", "off", or "captive"
  if [[ "$captive_mode" != "off" && "$captive_mode" != "on" && "$captive_mode" != "captive" ]]; then
    echo "Warning: Invalid captive mode '$captive_mode', defaulting to 'off'"
    captive_mode="off"
  fi

  # Debug output
  echo "Debug: MODE=$mode, CAPTIVE_MODE=$captive_mode"

  # Activate config
  echo "Activating configuration: $config_id"
  handle_setup "$interface" "$mode" "$ssid" "$password" "$captive_mode"

  return 0
}

show_status() {
  echo "📊 Current Network Status:"

  # Display mode information (robust glob handling)
  shopt -s nullglob
  local conf_files=("$CONFIG_DIR"/*.conf)
  local current_mode=""
  local current_ssid=""
  local current_password=""

  if [ ${#conf_files[@]} -gt 0 ]; then
    local latest_file
    latest_file=$(ls -1t "$CONFIG_DIR"/*.conf 2>/dev/null | head -n 1)
    if [ -n "$latest_file" ];then
      current_mode=$(grep -m 1 -oP 'MODE="\K[^"]+' "$latest_file" | tr -d '\n')
      current_ssid=$(grep -m 1 -oP 'SSID="\K[^"]+' "$latest_file" | tr -d '\n')
      current_password=$(grep -m 1 -oP 'PASSWORD="\K[^"]+' "$latest_file" | tr -d '\n')
      echo "🛠️  Current Mode: $current_mode"
      if [ "$current_mode" == "hotspot" ]; then
        echo "🔥 Hotspot SSID: $current_ssid"
        echo "🔑 Hotspot Password: $current_password"
        if command -v qrencode >/dev/null 2>&1; then
          echo "📱 Scan QR Code to Connect:"
          qrencode -t ANSIUTF8 "WIFI:T:WPA;S:$current_ssid;P:$current_password;;"
        else
          echo "(QR code generation skipped: 'qrencode' not found. Install with 'sudo apt install qrencode')"
        fi
      fi
    else
      echo "⚠️  No active configuration found."
    fi
  else
    echo "⚠️  No saved configurations found."
  fi
  shopt -u nullglob

  # Show all IP addresses per interface
  echo -e "\n🌐 IP Addresses per Interface:"
  local interfaces_found_for_ip=0
  # Using ls /sys/class/net and filtering for common relevant interfaces
  for interface in $(ls /sys/class/net/); do
    # Skip loopback unless it's the only interface (edge case, mostly for debugging)
    if [[ "$interface" == "lo" && $(ls /sys/class/net/ | wc -l) -gt 1 ]]; then
      continue
    fi
    # Heuristic: check for a MAC address file, or if it's a bridge, or common patterns
    if [ -f "/sys/class/net/$interface/address" ] || [ -d "/sys/class/net/$interface/bridge" ] || \
       [[ "$interface" == "$WG_INTERFACE" && -n "$WG_INTERFACE" ]] || \
       [[ "$interface" == "wlan"* ]] || [[ "$interface" == "eth"* ]] || \
       [[ "$interface" == "en"* ]] || [[ "$interface" == "wl"* ]]; then
      
      ips=$(ip -4 addr show "$interface" 2>/dev/null | awk '/inet / {print $2}' || echo "N/A")
      echo "🔹 $interface: ${ips:-No IPv4 address assigned}"
      interfaces_found_for_ip=$((interfaces_found_for_ip + 1))
    fi
  done
   if [ "$interfaces_found_for_ip" -eq 0 ]; then
    echo "No relevant network interfaces found to display IPs."
  fi

  # Show WireGuard interface IP if present and distinct from the loop above
  if [ -n "$WG_INTERFACE" ] && ip link show "$WG_INTERFACE" &>/dev/null; then
    # Check if WG_INTERFACE was already listed by the loop above to avoid duplicate IP display
    if ! (ls /sys/class/net/ | grep -q "^${WG_INTERFACE}$" && \
          ( [ -f "/sys/class/net/$WG_INTERFACE/address" ] || [ -d "/sys/class/net/$WG_INTERFACE/bridge" ] || \
            [[ "$WG_INTERFACE" == "wlan"* ]] || [[ "$WG_INTERFACE" == "eth"* ]] || \
            [[ "$WG_INTERFACE" == "en"* ]] || [[ "$WG_INTERFACE" == "wl"* ]] ) ); then
      wg_ips=$(ip -4 addr show "$WG_INTERFACE" | awk '/inet / {print $2}')
      echo "🔹 $WG_INTERFACE (WireGuard): ${wg_ips:-No IPv4 address assigned}"
    fi
  fi
  
  echo # Newline
  echo -n "🌍 External Public IP: "
  if command -v curl >/dev/null 2>&1; then
    curl -s --max-time 5 https://api.ipify.org || curl -s --max-time 5 https://icanhazip.com || echo "(could not retrieve or timed out)"
  elif command -v wget >/dev/null 2>&1; then
    wget -qO- --timeout=5 https://api.ipify.org || wget -qO- --timeout=5 https://icanhazip.com || echo "(could not retrieve or timed out)"
  else
    echo "(curl and wget not found)"
  fi
  echo # Newline after IP

  # Test internet connectivity
  if ping -c 1 -W 2 8.8.8.8 &>/dev/null; then
    echo "✅ Internet is reachable (ping to 8.8.8.8 succeeded)."
  else
    echo "❌ Internet is NOT reachable (ping to 8.8.8.8 failed)."
  fi

  # Interface Details (Speed, RX/TX)
  echo -e "\n📡 Interface Details:"
  found_any=0
  for interface in $(ls /sys/class/net | grep -v '^lo$'); do
    if [ ! -d "/sys/class/net/$interface" ]; then
      continue
    fi
    found_any=1
    speed="N/A"
    if [ -f "/sys/class/net/$interface/speed" ]; then
      speed_val=$(cat "/sys/class/net/$interface/speed" 2>/dev/null)
      if [[ "$speed_val" =~ ^[0-9]+$ ]] && [ "$speed_val" -gt 0 ]; then
        speed="$speed_val Mbps"
      fi
    fi
    if [[ "$speed" == "N/A" ]] && command -v ethtool >/dev/null 2>&1; then
      speed_val=$(ethtool "$interface" 2>/dev/null | grep -oP 'Speed: \K[0-9]+(?=Mb/s)')
      if [[ "$speed_val" =~ ^[0-9]+$ ]]; then
        speed="$speed_val Mbps"
      fi
    fi
    rx_bytes=$(cat "/sys/class/net/$interface/statistics/rx_bytes" 2>/dev/null || echo "0")
    tx_bytes=$(cat "/sys/class/net/$interface/statistics/tx_bytes" 2>/dev/null || echo "0")
    ips=$(ip -4 addr show "$interface" 2>/dev/null | awk '/inet / {print $2}' | paste -sd, -)
    [ -z "$ips" ] && ips="No IPv4"
    echo "DEBUG: $interface speed=$speed rx=$rx_bytes tx=$tx_bytes ips=$ips"
    echo "🔹 Interface: $interface ($ips)"
    echo "   Speed: $speed"
    echo "   RX: $((rx_bytes / 1024)) KB"
    echo "   TX: $((tx_bytes / 1024)) KB"
  done
  if [ "$found_any" -eq 0 ]; then
    echo "No network interfaces found to display details for."
  fi

  # Device Authorization (Whitelist) Status:
  echo "" 
  echo "🔒 Device Authorization (Whitelist) Status:"
  if [ -f "$DHCP_CONF" ]; then
    allowed_count=$(grep -c '^dhcp-host=' "$DHCP_CONF" || true)
    if [ "$allowed_count" -gt 0 ]; then
      echo "Whitelist is ENABLED. Allowed devices:"
      grep '^dhcp-host=' "$DHCP_CONF" | while IFS=, read -r _ device_name_auth ip_addr_auth _; do # Unique var names
        echo "  - Device: $device_name_auth, IP: $ip_addr_auth"
      done
    else
      echo "Whitelist is ENABLED but no devices are currently authorized."
    fi
  else
    echo "Whitelist is DISABLED. All devices may be allowed (unless restricted elsewhere)."
  fi
  # List currently connected Wi-Fi clients (hotspot mode)
  echo ""
  echo "📶 Connected Wi-Fi Clients (wlan0):"
  if [ -d "/sys/class/net/wlan0" ] && iw dev wlan0 info 2>/dev/null | grep -q "type AP"; then
    if iw dev wlan0 station dump 2>/dev/null | grep -q 'Station'; then
      iw dev wlan0 station dump | awk '
        /^Station/ {mac=$2}
        /rx bytes:/ {rx=$3}
        /tx bytes:/ {tx=$3; print "  - MAC: " mac ", RX: " rx " bytes, TX: " tx " bytes"}
      '
    else
      echo "No clients currently connected to wlan0 hotspot."
    fi
  else
    echo "wlan0 is not active or not in hotspot mode."
  fi
  # Check if WireGuard is active
  if [ -n "$WG_INTERFACE" ] && ip link show "$WG_INTERFACE" &>/dev/null; then
    echo ""
    echo "🔒 WireGuard interface '$WG_INTERFACE' detected. Verifying WireGuard connection..."
    if ping -c 1 -W 2 -I "$WG_INTERFACE" 8.8.8.8 &>/dev/null; then 
      echo "✅ Internet is reachable through WireGuard ($WG_INTERFACE)."
    else
      echo "❌ Internet is NOT reachable through WireGuard ($WG_INTERFACE)."
    fi
  else
    echo ""
    echo "🔓 No active WireGuard interface detected or WG_INTERFACE variable not set."
  fi
}

handle_setup() {
  local L_INTERFACE=$1
  local L_MODE=$2
  local L_SSID=${3:-"Capuchino Home"}
  local L_PASSWORD=${4:-"HotspotAccess123!"}
  local L_CAPTIVE_MODE=${5:-"off"}
  local L_CONFIG_NAME=${6:-""}
  local L_WG_INTERFACE=${7:-""}  # WireGuard interface (optional)

  # Debug output
  echo "Debug in handle_setup: MODE='$L_MODE', CAPTIVE_MODE='$L_CAPTIVE_MODE', WG_INTERFACE='$L_WG_INTERFACE'"

  # Validate password length for hotspot mode
  if [ "$L_MODE" == "hotspot" ] && [ ${#L_PASSWORD} -lt 8 ]; then
    echo "Error: Password for hotspot mode must be at least 8 characters long." >&2
    return 1
  fi

  # --- WireGuard state management: Ensure old/default WG interface is handled ---
  # If no specific WireGuard interface is requested for this setup (L_WG_INTERFACE is empty),
  # and the default global WireGuard interface (WG_INTERFACE, e.g., "wg0") is currently active, bring it down.
  if [ -z "$L_WG_INTERFACE" ]; then
    if sudo wg show "$WG_INTERFACE" &>/dev/null; then # Check if default WG is active
      echo "No WireGuard interface specified for current setup. Attempting to bring down default interface $WG_INTERFACE..."
      if sudo wg-quick down "$WG_INTERFACE"; then
        echo "Default WireGuard interface $WG_INTERFACE brought down successfully."
      else
        # This might fail if not managed by wg-quick or already down, which is not necessarily an error here.
        echo "Note: Failed to bring down default WireGuard interface $WG_INTERFACE (it might not have been up or not managed by wg-quick)."
      fi
    fi
  # Else, if a specific WireGuard interface IS requested (L_WG_INTERFACE is not empty),
  # and it's DIFFERENT from the default global WG_INTERFACE,
  # and the default global WG_INTERFACE is active, bring down the default one first.
  # This prepares for activating the new L_WG_INTERFACE later.
  elif [ "$L_WG_INTERFACE" != "$WG_INTERFACE" ]; then
    if sudo wg show "$WG_INTERFACE" &>/dev/null; then # Check if default WG is active
      echo "A different WireGuard interface ($L_WG_INTERFACE) is requested. Attempting to bring down default interface $WG_INTERFACE first..."
      if sudo wg-quick down "$WG_INTERFACE"; then
        echo "Default WireGuard interface $WG_INTERFACE brought down successfully."
      else
        echo "Note: Failed to bring down default WireGuard interface $WG_INTERFACE (it might not have been up or not managed by wg-quick)."
      fi
    fi
  fi
  # --- End WireGuard state management ---

  if [ "$L_MODE" == "hotspot" ]; then
    echo "Starting hotspot on $L_INTERFACE..."

    # Disconnect the interface from any current Wi-Fi network
    nmcli dev disconnect "$L_INTERFACE" 2>/dev/null || echo "Interface $L_INTERFACE was not connected or already disconnected."

    # Delete any existing connection with this name (no error if missing)
    nmcli con delete "$HOTSPOT_NAME" 2>/dev/null

    # Add a new Wi-Fi hotspot connection on the specified interface
    nmcli con add type wifi ifname "$L_INTERFACE" mode ap con-name "$HOTSPOT_NAME" ssid "$L_SSID" autoconnect yes

    # Use the 2.4GHz band (better for compatibility with older devices)
    nmcli con modify "$HOTSPOT_NAME" wifi.band b
    nmcli con modify "$HOTSPOT_NAME" wifi.channel 1

    # Set WPA2 security
    nmcli con modify "$HOTSPOT_NAME" wifi-sec.key-mgmt wpa-psk
    nmcli con modify "$HOTSPOT_NAME" wifi-sec.psk "$L_PASSWORD"

    # Set static IP and enable internet sharing (NAT + DHCP)
    nmcli con modify "$HOTSPOT_NAME" ipv4.method shared
    nmcli con modify "$HOTSPOT_NAME" ipv4.addresses "$HOTSPOT_IP"
    nmcli con modify "$HOTSPOT_NAME" ipv4.ignore-auto-dns yes

    # Disable IPv6 (simplifies captive DNS and routing logic)
    nmcli con modify "$HOTSPOT_NAME" ipv6.method disabled

    # Disable Wi-Fi power saving for the hotspot connection
    echo "Disabling Wi-Fi power saving for hotspot $HOTSPOT_NAME..."
    nmcli con modify "$HOTSPOT_NAME" wifi.powersave 2

    nmcli con up "$HOTSPOT_NAME"
    enable_ip_forwarding
    
    if [ -n "$L_WG_INTERFACE" ]; then
      setup_wireguard_routing "$L_WG_INTERFACE"
    else
      echo "No WireGuard interface specified, skipping WireGuard-specific routing."
    fi

    # Configure DNS with captive portal by default
    write_dns_config

    # --- REVISED SAVE/TOUCH LOGIC FOR HOTSPOT ---
    if [ ! -d "$CONFIG_DIR" ]; then
      mkdir -p "$CONFIG_DIR" # Ensure dir exists
    fi

    local existing_match_file=""
    # Temporarily set nullglob to handle empty CONFIG_DIR or no .conf files gracefully
    local shopt_nullglob_was_set=0
    if ! shopt -q nullglob; then shopt -s nullglob; shopt_nullglob_was_set=1; fi

    for file in "$CONFIG_DIR"/*.conf; do
      # Extract all relevant fields from the file for comparison
      # Assuming grep will exit with error if pattern not found, and set -e/-o pipefail will handle it.
      # If a field is missing, its variable will be empty.
      local f_interface=$(grep -m 1 -oP 'INTERFACE="\K[^"]+' "$file" 2>/dev/null | tr -d '\n')
      local f_mode=$(grep -m 1 -oP 'MODE="\K[^"]+' "$file" 2>/dev/null | tr -d '\n')
      local f_ssid=$(grep -m 1 -oP 'SSID="\K[^"]+' "$file" 2>/dev/null | tr -d '\n')
      local f_password=$(grep -m 1 -oP 'PASSWORD="\K[^"]+' "$file" 2>/dev/null | tr -d '\n')
      local f_captive_mode=$(grep -m 1 -oP 'CAPTIVE_MODE="\K[^"]+' "$file" 2>/dev/null | tr -d '\n')
      # Note: L_WG_INTERFACE is not currently part of the saved config fields, so not matched here.

      # Compare with the current setup parameters
      if [[ "$f_interface" == "$L_INTERFACE" && \
            "$f_mode" == "$L_MODE" && \
            "$f_ssid" == "$L_SSID" && \
            "$f_password" == "$L_PASSWORD" && \
            "$f_captive_mode" == "$L_CAPTIVE_MODE" ]]; then
        existing_match_file="$file"
        break
      fi
    done
    # Restore nullglob if it was changed
    if [ "$shopt_nullglob_was_set" -eq 1 ]; then shopt -u nullglob; fi

    if [ -n "$existing_match_file" ]; then
      # An identical configuration file already exists.
      echo "Identical configuration file found: $(basename "$existing_match_file" .conf)"
      # Touch it to update its modification timestamp, making it the "latest".
      if touch "$existing_match_file"; then
        echo "Updated timestamp for $(basename "$existing_match_file" .conf) to reflect current activation."
      else
        echo "Warning: Failed to update timestamp for $(basename "$existing_match_file" .conf)." >&2
      fi
    else
      # No exact match found, so save a new configuration.
      local effective_config_name="$L_CONFIG_NAME" # Use user-provided name if available
      if [ -z "$effective_config_name" ]; then
        # Generate a base name (e.g., SSID_mode)
        # Pass empty custom_name to create_config_id so it generates from mode and SSID
        local base_id=$(create_config_id "" "$L_MODE" "$L_SSID") 
        # Ensure the generated name is unique by appending a number if needed
        effective_config_name=$(get_unique_config_id "$base_id") 
        echo "No config name provided for new setup, generated unique name: $effective_config_name"
      else
        # User provided a name. save_config will use this name as the filename base.
        # If a file with this name.conf already exists, save_config will overwrite it.
        echo "Using provided config name: $effective_config_name"
      fi
      
      # Save the new/updated configuration.
      # The 'effective_config_name' is passed as the 'custom_name' (6th argument) to save_config.
      save_config "$L_INTERFACE" "$L_MODE" "$L_SSID" "$L_PASSWORD" "$L_CAPTIVE_MODE" "$effective_config_name"
    fi
    # --- END REVISED SAVE/TOUCH LOGIC ---

  elif [ "$L_MODE" == "client" ]; then
    echo "Connecting as client..."
    nmcli con down "$HOTSPOT_NAME" 2>/dev/null

    # Check if the configuration already exists
    if config_exists "$L_SSID" "$L_MODE" "$L_PASSWORD"; then
      echo "Configuration for SSID='$L_SSID', MODE='$L_MODE' already exists. Not saving duplicate."
    else
      # Attempt to connect
      if nmcli dev wifi connect "$L_SSID" password "$L_PASSWORD" ifname "$L_INTERFACE"; then
        echo "Successfully connected to $L_SSID"

        # Disable power saving for the client connection
        sleep 2
        ACTIVE_CON_UUID=$(nmcli -g GENERAL.CONNECTION dev show "$L_INTERFACE" | head -n 1)

        if [ -n "$ACTIVE_CON_UUID" ]; then
          ACTIVE_CON_NAME=$(nmcli -g CONNECTION.ID c show "$ACTIVE_CON_UUID" | head -n 1)
          echo "Disabling Wi-Fi power saving for connection '$ACTIVE_CON_NAME' (UUID: $ACTIVE_CON_UUID) on interface $L_INTERFACE..."
          nmcli con modify "$ACTIVE_CON_UUID" wifi.powersave 2
        fi

        # Save successful configuration
        save_config "$L_INTERFACE" "$L_MODE" "$L_SSID" "$L_PASSWORD" "$L_CAPTIVE_MODE" "$L_CONFIG_NAME"
      else
        echo "Failed to connect to $L_SSID"
        return 1
      fi
    fi
  else
    echo "Unknown mode: $L_MODE"
    exit 1
  fi

  # Verify internet connectivity
  echo ""
  echo "🌍 Verifying Internet Connectivity:"
  if ping -c 1 8.8.8.8 &>/dev/null; then
    echo "Internet is reachable (ping to 8.8.8.8 succeeded)."
  else
    echo "Internet is NOT reachable (ping to 8.8.8.8 failed)."
    return 1
  fi

  # Activate WireGuard if L_WG_INTERFACE is provided
  if [ -n "$L_WG_INTERFACE" ]; then
    echo "Activating WireGuard interface: $L_WG_INTERFACE"
    if sudo wg-quick up "$L_WG_INTERFACE"; then
      echo "WireGuard interface '$L_WG_INTERFACE' activated successfully."

      # Re-verify internet connectivity after WireGuard is set up
      show_status
    else
      echo "Failed to activate WireGuard interface '$L_WG_INTERFACE'."
      return 1
    fi
  fi
}

sync_bypass_with_dhcp() {
  # This function is now handled by apply_dns_bypass_for_clients
  # which reads directly from the DHCP config file
  echo "Updating DNS bypass rules from DHCP configuration..."
  apply_dns_bypass_for_clients
}

handle_edit() {
  KEY=$1
  case "$KEY" in
    allowed_devices)
      echo "Editing MAC → IP reservations..."
      sudo nano "/etc/NetworkManager/dnsmasq.d/dhcp-options.conf"
      echo "Restarting NetworkManager to apply changes..."
      sudo systemctl restart NetworkManager
      # Update bypass list after editing
      sync_bypass_with_dhcp
      ;;
    *)
      echo "Unknown config key: $KEY"
      echo "Try: allowed_devices"
      exit 1
      ;;
  esac
}

remove_duplicate_profiles() {
  echo "Scanning for duplicate Wi-Fi network profiles..."
  declare -A ssids_profiles # Key: SSID, Value: list of "UUID|Name|ActiveStatus"
  local old_ifs="$IFS"
  IFS=$'\n'

  # Get NAME, UUID, TYPE, ACTIVE status for all connections
  # We will fetch SSID separately for Wi-Fi connections
  while IFS=: read -r name uuid type active_status; do
    if [[ "$type" == "802-11-wireless" ]]; then
      # Attempt to get SSID for this specific Wi-Fi connection
      # nmcli property names are typically lowercase.
      local ssid=""
      # Try standard '802-11-wireless.ssid' first
      ssid=$(nmcli -g 802-11-wireless.ssid c show "$uuid" 2>/dev/null)
      
      # Fallback to 'wifi.ssid' if the first attempt fails or returns empty
      if [[ -z "$ssid" ]]; then
        ssid=$(nmcli -g wifi.ssid c show "$uuid" 2>/dev/null)
      fi

      if [[ -n "$ssid" ]]; then # Only process if SSID was successfully retrieved
        # Store as "UUID|Name|ActiveStatus"
        ssids_profiles["$ssid"]+="$uuid|$name|$active_status\n"
      else
        echo "Warning: Could not retrieve SSID for Wi-Fi connection: $name (UUID: $uuid)" >&2
      fi
    fi
  done < <(nmcli -t -f NAME,UUID,TYPE,ACTIVE c)
  IFS="$old_ifs"

  local found_duplicates=0
  for ssid_key in "${!ssids_profiles[@]}"; do
    local profile_list_str="${ssids_profiles[$ssid_key]}"
    # Use grep . to remove empty lines that might result from the concatenation
    mapfile -t profiles_for_ssid < <(echo -e "$profile_list_str" | grep .)

    if [ "${#profiles_for_ssid[@]}" -gt 1 ]; then
      found_duplicates=1
      echo -e "\nFound ${#profiles_for_ssid[@]} profiles for SSID: \"$ssid_key\""
      
      local active_profile_indices=()
      local profile_details_to_display=()

      for i in "${!profiles_for_ssid[@]}"; do
        IFS='|' read -r uuid name active <<< "${profiles_for_ssid[$i]}"
        local display_name="$name"
        local active_marker=""
        if [[ "$active" == "yes" ]]; then
          active_marker=" (ACTIVE)"
          active_profile_indices+=("$i")
        fi
        profile_details_to_display+=("  $((i+1))) Name: '$display_name' (UUID: $uuid)$active_marker")
      done

      for detail in "${profile_details_to_display[@]}"; do
        echo "$detail"
      done

      echo "Options for SSID \"$ssid_key\":"
      echo "  k) Keep specific profiles (select by number to keep, others deleted)"
      if [ "${#active_profile_indices[@]}" -gt 0 ]; then
        echo "  a) Keep ACTIVE profile(s) only, delete others"
      fi
      echo "  d) Delete ALL profiles for this SSID (use with caution!)"
      echo "  s) Skip this SSID"
      read -p "Choose an action (k/a/d/s): " choice

      case "$choice" in
        k)
          read -p "Enter numbers of profiles to KEEP, separated by spaces: " keep_selection
          declare -A to_keep_indices
          for num_str in $keep_selection; do
            if [[ "$num_str" =~ ^[0-9]+$ ]]; then
              local idx=$((num_str - 1))
              if [ "$idx" -ge 0 ] && [ "$idx" -lt "${#profiles_for_ssid[@]}"]; then
                to_keep_indices["$idx"]=1
              else
                echo "Invalid number: $num_str for SSID \"$ssid_key\""
              fi
            else
              echo "Invalid input: $num_str"
            fi
          done

          if [ ${#to_keep_indices[@]} -eq 0 ]; then
            echo "No valid profiles selected to keep. Skipping deletion for SSID \"$ssid_key\"."
            continue
          fi

          for i in "${!profiles_for_ssid[@]}"; do
            IFS='|' read -r uuid name active <<< "${profiles_for_ssid[$i]}"
            if [[ -z "${to_keep_indices[$i]}" ]]; then
              echo "Deleting profile: Name: '$name', UUID: $uuid"
              sudo nmcli c delete "$uuid" || echo "Error: Failed to delete profile $uuid"
            else
              echo "Keeping profile: Name: '$name', UUID: $uuid"
            fi
          done
          ;;
        a)
          if [ "${#active_profile_indices[@]}" -gt 0 ]; then
            for i in "${!profiles_for_ssid[@]}"; do
              IFS='|' read -r uuid name active <<< "${profiles_for_ssid[$i]}"
              local is_one_to_keep=0
              for active_idx in "${active_profile_indices[@]}"; do
                if [ "$i" -eq "$active_idx" ]; then
                  is_one_to_keep=1
                  break
                fi
              done

              if [ "$is_one_to_keep" -eq 1 ]; then
                echo "Keeping active profile: Name: '$name', UUID: $uuid"
              else
                echo "Deleting profile: Name: '$name', UUID: $uuid"
                sudo nmcli c delete "$uuid" || echo "Error: Failed to delete profile $uuid"
              fi
            done
          else
            echo "No active profile to keep for SSID \"$ssid_key\". No action taken."
          fi
          ;;
        d)
          read -p "ARE YOU SURE you want to delete ALL ${#profiles_for_ssid[@]} profiles for SSID \"$ssid_key\"? (yes/NO): " confirm_delete_all
          if [[ "$confirm_delete_all" == "yes" ]]; then
            for i in "${!profiles_for_ssid[@]}"; do
              IFS='|' read -r uuid name active <<< "${profiles_for_ssid[$i]}"
              echo "Deleting profile: Name: '$name', UUID: $uuid"
              sudo nmcli c delete "$uuid" || echo "Error: Failed to delete profile $uuid"
            done
          else
            echo "Deletion of all profiles for SSID \"$ssid_key\" cancelled."
          fi
          ;;
        s|*)
          echo "Skipping SSID \"$ssid_key\"."
          ;;
      esac
    fi
  done

  if [ "$found_duplicates" -eq 0 ]; then
    echo "No duplicate Wi-Fi profiles found (based on SSID)."
  fi
  echo "Profile deduplication finished."
}

deduplicate_saved_configs() {
  echo "Scanning for duplicate saved Wi-Fi configurations..."
  if [ ! -d "$CONFIG_DIR" ]; then
    echo "No saved configurations found."
    return
  fi

  declare -A ssid_mode_to_files
  mapfile -t config_files < <(find "$CONFIG_DIR" -name "*.conf" | sort)

  for config_file in "${config_files[@]}"; do
    ssid=$(grep -m 1 -oP 'SSID="\K[^"]+' "$config_file" | tr -d '\n')
    mode=$(grep -m 1 -oP 'MODE="\K[^"]+' "$config_file" | tr -d '\n')
    key="${ssid}__${mode}"
    ssid_mode_to_files["$key"]+="$config_file "
  done

  local found=0
  for key in "${!ssid_mode_to_files[@]}"; do
    files=(${ssid_mode_to_files[$key]})
    if [ "${#files[@]}" -gt 1 ]; then
      found=1
      echo ""
      echo "Duplicate configs for SSID/MODE: ${key/__/ }"
      for i in "${!files[@]}"; do
        echo "  $((i+1))) ${files[$i]}"
      done
      echo "Options:"
      echo "  k) Keep specific configs (select by number to keep, others deleted)"
      echo "  d) Delete ALL configs for this SSID/MODE"
      echo "  s) Skip"
      read -p "Choose an action (k/d/s): " choice
      case "$choice" in
        k)
          read -p "Enter numbers to KEEP (space-separated): " keep
          declare -A keep_map
          for n in $keep; do
            idx=$((n-1))
            if [ "$idx" -ge 0 ] && [ "$idx" -lt "${#files[@]}"]; then
              keep_map["$idx"]=1
            fi
          done
          for i in "${!files[@]}"; do
            if [ -z "${keep_map[$i]}" ]; then
              if rm -f "${files[$i]}"; then
                echo "Deleted: ${files[$i]}"
              else
                echo "Failed to delete: ${files[$i]}"
              fi
            fi
          done
          ;;
        d)
          for f in "${files[@]}"; do
            if rm -f "$f"; then
              echo "Deleted: $f"
            else
              echo "Failed to delete: $f"
            fi
          done
          ;;
        *)
          echo "Skipping."
          ;;
      esac
    fi
  done

  if [ "$found" -eq 0 ]; then
    echo "No duplicate saved configurations found."
  fi
  echo "Saved configuration deduplication finished."
}

# MAIN
case "$1" in
  --current)
    show_current_setup
    ;;
  --device)
    shift
    handle_devices "$@"
    ;;
  --help)
    print_help
    ;;
  --setup)
    shift # remove --setup

    # Initialize variables to store parsed values
    L_INTERFACE=""
    L_MODE=""
    L_SSID="" 
    L_PASSWORD=""
    L_CAPTIVE_MODE=""
    L_CONFIG_NAME=""
    L_WG_INTERFACE=""

    # Parse named arguments
    while [[ $# -gt 0 ]]; do
      case "$1" in
        --interface)
          L_INTERFACE="$2"
          shift 2
          ;;
        --mode)
          L_MODE="$2"
          shift 2
          ;;
        --ssid)
          L_SSID="$2"
          shift 2
          ;;
        --password)
          L_PASSWORD="$2"
          shift 2
          ;;
        --config_name)
          L_CONFIG_NAME="$2"
          shift 2
          ;;
        --wg_interface)
          L_WG_INTERFACE="$2"
          shift 2
          ;;
        --captive_mode)
          L_CAPTIVE_MODE="$2"
          shift 2
          ;;
        *)
          echo "Error: Unknown parameter for --setup: $1" >&2
          print_help
          exit 1
          ;;
      esac
    done

    # Validate required parameters (interface and mode)
    if [ -z "$L_INTERFACE" ]; then
      echo "Error: --interface is required for --setup." >&2
      print_help
      exit 1
    fi
    if [ -z "$L_MODE" ]; then
      echo "Error: --mode is required for --setup." >&2
      print_help
      exit 1
    fi

    # Call handle_setup with the parsed values in the correct positional order
    # handle_setup will apply its own defaults for optional parameters if they are passed as empty strings
    handle_setup "$L_INTERFACE" "$L_MODE" "$L_SSID" "$L_PASSWORD" "$L_CAPTIVE_MODE" "$L_CONFIG_NAME" "$L_WG_INTERFACE"
    ensure_hairpin_nat
    ;;
  --edit)
    shift
    handle_edit "$@"
    ;;
  --list)
    list_configs
    ;;
  --select)
    select_config
    ;;
  --activate)
    shift
    activate_config "$@"
    ;;
  --deduplicate-profiles)
    remove_duplicate_profiles
    ;;
  --deduplicate-saved)
    deduplicate_saved_configs
    ;;
  --debug)
    shift
    run_debug_diagnostics "$1"
    ;;
  --test|-t)
    show_status
    ;;
  status)
    show_status
    ;;
  *)
    if [ $# -eq 0 ]; then
      select_config
    else
      echo "Invalid option: $1"
      print_help
      exit 1
    fi
    ;;
esac
