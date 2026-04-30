#!/bin/bash
# Sparrowx Guard Server Setup Script

if [ "$EUID" -ne 0 ]; then
  echo "Please run as root"
  exit 1
fi

# Detect installation directory
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" &> /dev/null && pwd )"
INSTALL_DIR="$SCRIPT_DIR"

echo "[1/5] Enabling IP Forwarding and WireGuard dependencies..."
apt-get update -qq && apt-get install -y wireguard wireguard-tools procps < /dev/null

# Kernel tweaks for high-performance networking
cat << 'SYSCTL_EOF' > /etc/sysctl.d/99-sparrowx.conf
net.ipv4.ip_forward = 1
net.ipv6.conf.all.forwarding = 1
net.ipv4.conf.all.rp_filter = 0
net.ipv4.conf.default.rp_filter = 0
net.netfilter.nf_conntrack_max = 2000000
net.netfilter.nf_conntrack_tcp_timeout_established = 7440
SYSCTL_EOF
sysctl -p /etc/sysctl.d/99-sparrowx.conf || true

modprobe wireguard || true
modprobe nf_conntrack || true

echo "[2/5] Setting up Tunnel Manager..."
mkdir -p "$INSTALL_DIR"
# Only copy if source exists and is different from destination
if [ "$SCRIPT_DIR" != "$INSTALL_DIR" ]; then
  cp tunnel-manager.sh "$INSTALL_DIR/" 2>/dev/null || true
  cp restore-tunnels.sh "$INSTALL_DIR/" 2>/dev/null || true
fi
chmod +x "$INSTALL_DIR/tunnel-manager.sh" 2>/dev/null || true
chmod +x "$INSTALL_DIR/restore-tunnels.sh" 2>/dev/null || true

echo "[3/5] Configuring sudoers for Node.js..."
if ! grep -q "$INSTALL_DIR/tunnel-manager.sh" /etc/sudoers; then
  echo "root ALL=(ALL) NOPASSWD: $INSTALL_DIR/tunnel-manager.sh" >> /etc/sudoers
fi

echo "[4/5] Configuring nftables with auto-ban..."
mkdir -p /var/log/sbs
touch /var/log/sbs/attacks.log

cat << 'NFTEOF' > /etc/nftables.conf
#!/usr/sbin/nft -f
flush ruleset

table inet detroit_guard {

  # Persistent blacklist - 24h ban, visible in dashboard and CLI
  set blacklist {
    type ipv4_addr
    flags dynamic,timeout
    timeout 24h
  }

  # SYN flood meter - tracks per-IP SYN rate
  set syn_meter {
    type ipv4_addr
    flags dynamic,timeout
    timeout 10s
  }

  # UDP flood meter - tracks per-IP UDP rate
  set udp_meter {
    type ipv4_addr
    flags dynamic,timeout
    timeout 10s
  }

  chain input {
    type filter hook input priority 0; policy accept;

    # Drop already-banned IPs immediately
    ip saddr @blacklist drop

    # Drop invalid connections
    ct state invalid drop

    # Allow established/related and loopback
    ct state established,related accept
    iif lo accept

    # Allow allowed ports
    tcp dport { 22, 80, 443, 3000 } accept

    # Allow WireGuard for tunnels
    udp dport 51820-51900 accept

    # Auto-ban SYN floods: >100 SYN/s from same IP = 24h ban
    tcp flags syn \
      add @syn_meter { ip saddr limit rate over 100/second } \
      add @blacklist { ip saddr timeout 24h } \
      log prefix "[SBS-BAN-SYN] " \
      drop

    # Allow normal SYN traffic under the threshold
    tcp flags syn accept

    # Auto-ban UDP floods: >5000 pps from same IP = 24h ban
    meta l4proto udp \
      add @udp_meter { ip saddr limit rate over 5000/second } \
      add @blacklist { ip saddr timeout 24h } \
      log prefix "[SBS-BAN-UDP] " \
      drop

    # Allow normal UDP traffic under the threshold
    meta l4proto udp accept

    # ICMP rate limit (no auto-ban, just throttle)
    ip protocol icmp limit rate 10/second accept
    ip protocol icmp drop
  }

  chain forward {
    type filter hook forward priority 0; policy accept;
    
    # Drop already-banned IPs immediately
    ip saddr @blacklist drop

    # Track SYN floods aimed at Agents (Forwarded traffic)
    tcp flags syn \
      add @syn_meter { ip saddr limit rate over 100/second } \
      add @blacklist { ip saddr timeout 24h } \
      log prefix "[SBS-BAN-SYN-FWD] " \
      drop

    # Track UDP floods aimed at Agents (Forwarded traffic)
    meta l4proto udp \
      add @udp_meter { ip saddr limit rate over 5000/second } \
      add @blacklist { ip saddr timeout 24h } \
      log prefix "[SBS-BAN-UDP-FWD] " \
      drop

    ct state established,related accept
  }
}
NFTEOF

systemctl enable nftables
systemctl restart nftables
echo "[ok] nftables loaded with auto-ban rules."

echo "[5/5] Setting up attack log writer (sparrowx-ban-logger)..."

cat << LOGGEREOF > "$INSTALL_DIR/ban-logger.sh"
#!/bin/bash
# Watches kernel logs for Sparrowx auto-ban events and writes them to
# /var/log/sbs/attacks.log so the Sparrowx dashboard can display them.
touch /var/log/sbs/attacks.log

journalctl -kf --no-hostname 2>/dev/null | grep --line-buffered '\[SBS-BAN-' | while IFS= read -r line; do
  SRC=\$(echo "\$line" | grep -oP 'SRC=\K[\d.]+')
  PROTO=\$(echo "\$line" | grep -oP '\[SBS-BAN-\K[A-Z]+(?=\])')
  SCOPE=\$(echo "\$line" | grep -q 'FWD' && echo "FORWARDED" || echo "LOCAL")
  TS=\$(date '+%Y-%m-%d %H:%M:%S')
  if [ -n "\$SRC" ]; then
    echo "[\$TS] AUTO-BAN \${PROTO:-UNKNOWN} flood from \${SRC} (\${SCOPE}) - blacklisted for 24h" >> /var/log/sbs/attacks.log
  fi
done
LOGGEREOF

chmod +x "$INSTALL_DIR/ban-logger.sh"

cat << SVCEOF > /etc/systemd/system/sparrowx-ban-logger.service
[Unit]
Description=Sparrowx Auto-Ban Event Logger
After=network.target nftables.service

[Service]
Type=simple
ExecStart=$INSTALL_DIR/ban-logger.sh
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
SVCEOF

systemctl daemon-reload
systemctl enable sparrowx-ban-logger
systemctl restart sparrowx-ban-logger
systemctl disable --now sbs-ban-logger 2>/dev/null || true

cat << RESTORESVCEOF > /etc/systemd/system/sparrowx-tunnel-restore.service
[Unit]
Description=Sparrowx Tunnel Restore
After=network-online.target
Wants=network-online.target

[Service]
Type=oneshot
ExecStart=$INSTALL_DIR/restore-tunnels.sh
RemainAfterExit=yes

[Install]
WantedBy=multi-user.target
RESTORESVCEOF

systemctl daemon-reload
systemctl enable sparrowx-tunnel-restore
systemctl restart sparrowx-tunnel-restore || true
systemctl disable --now sbs-tunnel-restore 2>/dev/null || true

echo ""
echo "=============================================="
echo "  Sparrowx Guard Setup Complete!"
echo "=============================================="
echo ""
echo "  Auto-ban is now ACTIVE:"
echo "  SYN flood > 100/s   -> IP banned for 24h"
echo "  UDP flood > 5000/s  -> IP banned for 24h"
echo "  All bans logged to /var/log/sbs/attacks.log"
echo "  Dashboard security feed will show events live"
echo ""
echo "  Check active bans anytime:"
echo "  bash /opt/sbs/sbs-cli.sh --blocklist"
echo ""
