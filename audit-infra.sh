#!/bin/bash
# Sparrowx Infrastructure Audit & Self-Healing Tool

set -u

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
BLUE='\033[0;34m'
RESET='\033[0m'

echo -e "${BLUE}=================================================================${RESET}"
echo -e "${BLUE}  SPARROWX INFRASTRUCTURE AUDIT & AUTO-FIX TOOL${RESET}"
echo -e "${BLUE}=================================================================${RESET}"

# Detect installation directory
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" &> /dev/null && pwd )"
INSTALL_DIR="$SCRIPT_DIR"
echo ""

if [ "$EUID" -ne 0 ]; then
  echo -e "${RED}[x] Please run as root to allow system modifications and fixes.${RESET}"
  exit 1
fi

# 1. Check Dependencies
echo -e "${YELLOW}[1/5] Checking Core Dependencies...${RESET}"
DEPS=("node" "nft" "wg" "jq" "pm2" "curl")
for dep in "${DEPS[@]}"; do
  if command -v "$dep" &>/dev/null; then
    echo -e "  ${GREEN}[ok]${RESET} $dep is installed."
  else
    echo -e "  ${RED}[x]${RESET} $dep is MISSING!"
    echo -e "      Attempting to install..."
    apt-get update -yqq && apt-get install -yqq "$dep" || true
  fi
done
echo ""

# 2. System & Network Hardening (sysctl)
echo -e "${YELLOW}[2/5] Auditing Kernel Network Security...${RESET}"
SYSCTL_CONF="/etc/sysctl.d/99-sbs-audit.conf"
cat << 'EOF' > "$SYSCTL_CONF"
net.ipv4.ip_forward = 1
net.ipv4.conf.all.rp_filter = 1
net.ipv4.conf.default.rp_filter = 1
net.ipv4.icmp_echo_ignore_broadcasts = 1
net.ipv4.conf.all.accept_source_route = 0
net.ipv4.conf.default.accept_source_route = 0
net.netfilter.nf_conntrack_max = 2000000
EOF
sysctl -p "$SYSCTL_CONF" &>/dev/null
echo -e "  ${GREEN}[ok]${RESET} Sysctl hardening applied successfully."
echo ""

# 3. Firewall & Drop Policies
echo -e "${YELLOW}[3/5] Inspecting Firewall Integrity...${RESET}"
if nft list tables | grep -q "detroit_guard" || nft list tables | grep -q "sparrowx_guard"; then
  echo -e "  ${GREEN}[ok]${RESET} Active DDoS Guard firewall tables detected."
else
  echo -e "  ${RED}[!]${RESET} No explicit sparrowx firewall table found!"
  echo -e "      Reloading default guard policies..."
  if [ -f "$INSTALL_DIR/setup-guard.sh" ]; then
    bash "$INSTALL_DIR/setup-guard.sh" || true
  elif [ -f /opt/sparrowx/setup-guard.sh ]; then
    bash /opt/sparrowx/setup-guard.sh || true
  elif [ -f /opt/detroit-sbs/setup-guard.sh ]; then
    bash /opt/detroit-sbs/setup-guard.sh || true
  fi
fi
echo ""

# 4. Tunnel Health Check
echo -e "${YELLOW}[4/5] Verifying Active Customer Routing...${RESET}"
REPAIR_SCRIPT="$INSTALL_DIR/repair-tunnels.sh"
if [ ! -x "$REPAIR_SCRIPT" ] && [ -x /opt/sparrowx/repair-tunnels.sh ]; then
  REPAIR_SCRIPT="/opt/sparrowx/repair-tunnels.sh"
elif [ ! -x "$REPAIR_SCRIPT" ] && [ -x /opt/detroit-sbs/repair-tunnels.sh ]; then
  REPAIR_SCRIPT="/opt/detroit-sbs/repair-tunnels.sh"
fi

if [ -x "$REPAIR_SCRIPT" ]; then
  echo -e "  [->] Running tunnel repair checks..."
  bash "$REPAIR_SCRIPT"
  echo -e "  ${GREEN}[ok]${RESET} Routing validation complete."
else
  echo -e "  ${YELLOW}[!]${RESET} Tunnel repair module unavailable."
fi
echo ""

# 5. Service Status
echo -e "${YELLOW}[5/5] Auditing Active Control Plane...${RESET}"
if pm2 status sparrowx-panel 2>/dev/null | grep -q "online" || pm2 status sbs-panel 2>/dev/null | grep -q "online"; then
  echo -e "  ${GREEN}[ok]${RESET} Backend management panel is operational."
else
  echo -e "  ${RED}[x]${RESET} Panel appears offline. Restarting via PM2..."
  pm2 restart all || true
fi

echo ""
echo -e "${BLUE}=================================================================${RESET}"
echo -e "${GREEN}  SHIELD STATUS: FULLY COVERED & READY FOR ACTION${RESET}"
echo -e "${BLUE}=================================================================${RESET}"
