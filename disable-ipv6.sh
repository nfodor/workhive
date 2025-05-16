#!/bin/bash

# More comprehensive sysctl configuration
sudo tee /etc/sysctl.d/40-disable-ipv6.conf > /dev/null <<EOF
net.ipv6.conf.all.disable_ipv6 = 1
net.ipv6.conf.default.disable_ipv6 = 1
net.ipv6.conf.lo.disable_ipv6 = 1
net.ipv6.conf.eth0.disable_ipv6 = 1
net.ipv6.conf.eth1.disable_ipv6 = 1
net.ipv6.conf.wlan0.disable_ipv6 = 1
EOF

# Apply sysctl settings immediately
sudo sysctl --system

# More complete NetworkManager configuration
sudo tee /etc/NetworkManager/conf.d/disable-ipv6.conf > /dev/null <<EOF
[connection]
ipv6.method=disabled
ipv6.ip6-privacy=0

[ipv6]
method=disabled
ip6-privacy=disabled

[keyfile]
unmanaged-devices=*,except:type:wifi,except:type:wwan,except:type:ethernet
EOF

# Disable IPv6 module loading
sudo tee /etc/modprobe.d/disable-ipv6.conf > /dev/null <<EOF
options ipv6 disable=1
alias net-pf-10 off
alias ipv6 off
EOF

# Restart NetworkManager
sudo systemctl restart NetworkManager

# Force reload sysctl settings
sudo sysctl -p /etc/sysctl.d/40-disable-ipv6.conf

# Bring interfaces down and up to ensure changes take effect
for iface in $(ip -o link show | awk -F': ' '{print $2}'); do
    if [ "$iface" != "lo" ]; then
        sudo ip link set "$iface" down
        sudo ip link set "$iface" up
    fi
done

echo "IPv6 has been disabled system-wide. Please reboot for all changes to take effect."
echo "After reboot, verify with: 'ip -6 addr' and 'ping6 -c 1 ipv6.google.com'"
