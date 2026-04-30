#!/bin/bash
# Sparrowx Guard Server Hardening & Defense Script
# This script applies high-performance firewall rules, community threat lists, 
# and kernel hardening to protect the Guard server from DDoS and malicious scans.

if [ "$EUID" -ne 0 ]; then
  echo "Please run as root"
  exit 1
fi

GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
RESET='\033[0m'

# Detect installation directory
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" &> /dev/null && pwd )"
INSTALL_DIR="$SCRIPT_DIR"

echo -e "${BLUE}[1/6] Hardening Kernel (sysctl)...${RESET}"
cat << EOF > /etc/sysctl.d/99-sparrowx-hardening.conf
# Anti-spoofing
net.ipv4.conf.all.rp_filter = 1
net.ipv4.conf.default.rp_filter = 1

# SYN Flood Protection
net.ipv4.tcp_syncookies = 1
net.ipv4.tcp_max_syn_backlog = 2048
net.ipv4.tcp_synack_retries = 2
net.ipv4.tcp_syn_retries = 5

# Ignore ICMP Broadcasts
net.ipv4.icmp_echo_ignore_broadcasts = 1

# IP Forwarding for GRE Tunnels
net.ipv4.ip_forward = 1

# Optimization for high traffic
net.core.netdev_max_backlog = 5000
net.core.rmem_max = 16777216
net.core.wmem_max = 16777216
EOF
sysctl -p /etc/sysctl.d/99-sparrowx-hardening.conf

echo -e "${BLUE}[2/6] Downloading Community Threat Lists...${RESET}"
mkdir -p "$INSTALL_DIR/threat-lists"
curl -s https://rules.emergingthreats.net/fwrules/emerging-Block-IPs.txt | grep -oE '([0-9]{1,3}\.){3}[0-9]{1,3}' > "$INSTALL_DIR/threat-lists/emerging.txt"
curl -s https://www.spamhaus.org/drop/drop.txt | grep -oE '([0-9]{1,3}\.){3}[0-9]{1,3}' > "$INSTALL_DIR/threat-lists/spamhaus.txt"
curl -s https://iplists.firehol.org/files/firehol_level1.netset | grep -oE '([0-9]{1,3}\.){3}[0-9]{1,3}' > "$INSTALL_DIR/threat-lists/firehol.txt"

echo -e "${BLUE}[3/6] Applying Nftables Advanced Ruleset...${RESET}"
cat << 'NFTEOF' > /etc/nftables.conf
#!/usr/sbin/nft -f
flush ruleset

table inet detroit_guard {
  # Sparrowx managed blacklist
  set blacklist {
    type ipv4_addr
    flags dynamic,timeout
    timeout 24h
  }

  # Community Threat Intelligence
  set threat_intel {
    type ipv4_addr
    flags interval
  }

  set syn_meter { type ipv4_addr; flags dynamic,timeout; timeout 10s; }
  set udp_meter { type ipv4_addr; flags dynamic,timeout; timeout 10s; }

  chain input {
    type filter hook input priority 0; policy accept;

    # Drop Blacklisted & Threat Intel immediately
    ip saddr @blacklist drop
    ip saddr @threat_intel drop

    # Drop invalid connections
    ct state invalid drop
    ct state established,related accept
    iif lo accept

    # Allow Essential Ports
    tcp dport { 22, 80, 443, 3000, 3001 } accept
    ip protocol gre accept

    # Auto-ban SYN floods: >100 SYN/s = 24h ban
    tcp flags syn \
      add @syn_meter { ip saddr limit rate over 100/second } \
      add @blacklist { ip saddr timeout 24h } \
      log prefix "[SBS-BAN-SYN] " drop

    # Auto-ban UDP floods: >5000 pps = 24h ban
    meta l4proto udp \
      add @udp_meter { ip saddr limit rate over 5000/second } \
      add @blacklist { ip saddr timeout 24h } \
      log prefix "[SBS-BAN-UDP] " drop
  }

  chain forward {
    type filter hook forward priority 0; policy accept;
    ip saddr @blacklist drop
    ip saddr @threat_intel drop
  }
}
NFTEOF

# Load the threat lists into nftables
systemctl restart nftables
cat "$INSTALL_DIR/threat-lists/"*.txt | sort -u | while read ip; do
  nft add element inet detroit_guard threat_intel "{ $ip }" 2>/dev/null
done

echo -e "${BLUE}[4/6] Setting up Automatic Threat List Sync (Cron)...${RESET}"
cat << CRONEOF > /etc/cron.daily/sparrowx-sync-threats
#!/bin/bash
curl -s https://rules.emergingthreats.net/fwrules/emerging-Block-IPs.txt | grep -oE '([0-9]{1,3}\.){3}[0-9]{1,3}' > "$INSTALL_DIR/threat-lists/emerging.txt"
curl -s https://www.spamhaus.org/drop/drop.txt | grep -oE '([0-9]{1,3}\.){3}[0-9]{1,3}' > "$INSTALL_DIR/threat-lists/spamhaus.txt"
# Flush and reload set
nft flush set inet detroit_guard threat_intel
cat "$INSTALL_DIR/threat-lists/"*.txt | sort -u | while read ip; do
  nft add element inet detroit_guard threat_intel "{ \$ip }" 2>/dev/null
done
CRONEOF
chmod +x /etc/cron.daily/sparrowx-sync-threats

echo -e "${BLUE}[5/6] Verifying FastNetMon Status...${RESET}"
if systemctl is-active --quiet fastnetmon; then
  echo -e "${GREEN}[ok] FastNetMon is running.${RESET}"
else
  echo -e "${YELLOW}[!] FastNetMon is NOT active. Please check /etc/fastnetmon.conf${RESET}"
fi

echo -e "${BLUE}[6/6] Hardening SSH...${RESET}"
sed -i 's/#MaxAuthTries 6/MaxAuthTries 3/' /etc/ssh/sshd_config
systemctl restart ssh

echo -e "${GREEN}${BOLD}============================================${RESET}"
echo -e "${GREEN}${BOLD}  Guard Server Hardening Complete!          ${RESET}"
echo -e "${GREEN}${BOLD}  - Kernel Hardened                         ${RESET}"
echo -e "${GREEN}${BOLD}  - Community Threat Lists Loaded (Auto-Sync)${RESET}"
echo -e "${GREEN}${BOLD}  - SYN/UDP Flood Auto-Ban Active           ${RESET}"
echo -e "${GREEN}${BOLD}  - FastNetMon Ready                        ${RESET}"
echo -e "${GREEN}${BOLD}============================================${RESET}"
