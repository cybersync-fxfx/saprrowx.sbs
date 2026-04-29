#!/bin/bash
# Sparrowx Terminal CLI - Guard Server Tool
# Usage:
#   bash sbs-cli.sh              -> show connected agents
#   bash sbs-cli.sh --blocklist  -> show currently blocked IPs
#   bash sbs-cli.sh --ban <ip>   -> ban an IP via nftables
#   bash sbs-cli.sh --unban <ip> -> unban an IP via nftables
#   bash sbs-cli.sh --help       -> show this help

clear

CYAN="\e[1;36m"
GREEN="\e[1;32m"
YELLOW="\e[1;33m"
RED="\e[1;31m"
WHITE="\e[1;37m"
DIM="\e[0;90m"
RESET="\e[0m"

# Auto-detect which nftables table is present
# Supports Sparrowx and legacy SBS nftables tables.
detect_nft_table() {
  if nft list table inet sparrowx_guard &>/dev/null 2>&1; then
    echo "inet sparrowx_guard"
  elif nft list table inet sbs_filter &>/dev/null 2>&1; then
    echo "inet sbs_filter"
  elif nft list table inet detroit_guard &>/dev/null 2>&1; then
    echo "inet detroit_guard"
  else
    echo ""
  fi
}

NFT_SET="blacklist"

echo -e "${CYAN}=================================================${RESET}"
echo -e "${CYAN}          SPARROWX - TERMINAL CLI                ${RESET}"
echo -e "${CYAN}=================================================${RESET}"
echo ""

# -- help ------------------------------------------------------
if [ "$1" = "--help" ] || [ "$1" = "-h" ]; then
  echo -e "${WHITE}Available commands:${RESET}"
  echo ""
  echo -e "  ${GREEN}bash sbs-cli.sh${RESET}                                 - List connected agents"
  echo -e "  ${GREEN}bash sbs-cli.sh --blocklist${RESET}                     - Show all blocked IPs on the firewall"
  echo -e "  ${GREEN}bash sbs-cli.sh --ban <ip>${RESET}                      - Block an IP address"
  echo -e "  ${GREEN}bash sbs-cli.sh --unban <ip>${RESET}                    - Unblock an IP address"
  echo -e "  ${GREEN}bash sbs-cli.sh --expose <agent_id> <port> [to_port]${RESET} - Route public traffic to agent"
  echo -e "  ${GREEN}bash sbs-cli.sh --unexpose <agent_id> <port>${RESET}       - Stop routing public traffic"
  echo -e "  ${GREEN}bash sbs-cli.sh --help${RESET}                          - Show this help"
  echo ""
  exit 0
fi

# -- blocklist -------------------------------------------------
if [ "$1" = "--blocklist" ] || [ "$1" = "-b" ]; then
  echo -e "${WHITE}[lock] Fetching blocked IPs from nftables...${RESET}"
  echo ""

  if ! command -v nft &>/dev/null; then
    echo -e "${RED}[x] nft command not found. Is nftables installed?${RESET}"
    echo -e "${YELLOW}    Try: apt-get install -y nftables && systemctl enable --now nftables${RESET}"
    exit 1
  fi

  NFT_TABLE=$(detect_nft_table)

  if [ -z "$NFT_TABLE" ]; then
    echo -e "${YELLOW}[!] No Sparrowx nftables table found. Creating sparrowx_guard table now...${RESET}"
    nft add table inet sparrowx_guard
    nft add chain inet sparrowx_guard input '{ type filter hook input priority 0; policy accept; }'
    nft add set inet sparrowx_guard blacklist '{ type ipv4_addr; flags timeout; }'
    nft add rule inet sparrowx_guard input ip saddr @blacklist drop
    echo -e "${GREEN}[ok] sparrowx_guard table created. Run setup-guard.sh or the agent installer for full config.${RESET}"
    NFT_TABLE="inet sparrowx_guard"
    echo ""
  fi

  echo -e "${DIM}Using table: $NFT_TABLE${RESET}"
  echo ""

  # Check that the blacklist set actually exists in the detected table
  if ! nft list set $NFT_TABLE $NFT_SET &>/dev/null 2>&1; then
    echo -e "${YELLOW}[!] Blacklist set not found in $NFT_TABLE. Creating it...${RESET}"
    nft add set $NFT_TABLE $NFT_SET '{ type ipv4_addr; flags timeout; }'
    echo -e "${GREEN}[ok] Blacklist set created.${RESET}"
    echo ""
  fi

  RAW=$(nft list set $NFT_TABLE $NFT_SET 2>&1)
  EXIT=$?

  if [ $EXIT -ne 0 ]; then
    echo -e "${RED}[x] Failed to read nftables set:${RESET}"
    echo -e "${DIM}$RAW${RESET}"
    exit 1
  fi

  BLOCKED_IPS=$(echo "$RAW" | grep -oE '\b([0-9]{1,3}\.){3}[0-9]{1,3}\b' | sort -u)

  if [ -z "$BLOCKED_IPS" ]; then
    echo -e "${GREEN}[ok] No IPs are currently blocked.${RESET}"
    echo ""
    echo -e "${DIM}Firewall set output:${RESET}"
    echo -e "${DIM}$RAW${RESET}"
    echo ""
    echo -e "${CYAN}=================================================${RESET}"
    exit 0
  fi

  COUNT=$(echo "$BLOCKED_IPS" | wc -l | tr -d ' ')
  echo -e "${RED}[!] $COUNT blocked IP(s) found:${RESET}"
  echo ""

  printf "${WHITE}%-5s | %-20s${RESET}\n" "#" "IP ADDRESS"
  printf "%-5s | %-20s\n" "-----" "--------------------"

  I=1
  while IFS= read -r IP; do
    printf "${RED}%-5s${RESET} | ${WHITE}%-20s${RESET}\n" "$I" "$IP"
    I=$((I+1))
  done <<< "$BLOCKED_IPS"

  echo ""
  echo -e "${DIM}Source: nft list set $NFT_TABLE $NFT_SET${RESET}"
  echo -e "${CYAN}=================================================${RESET}"
  echo ""
  exit 0
fi

# -- ban -------------------------------------------------------
if [ "$1" = "--ban" ]; then
  IP="$2"

  if [ -z "$IP" ]; then
    echo -e "${RED}[x] Usage: bash sbs-cli.sh --ban <ip>${RESET}"
    exit 1
  fi

  if ! echo "$IP" | grep -qE '^([0-9]{1,3}\.){3}[0-9]{1,3}$'; then
    echo -e "${RED}[x] Invalid IP address: $IP${RESET}"
    exit 1
  fi

  NFT_TABLE=$(detect_nft_table)
  if [ -z "$NFT_TABLE" ]; then
    echo -e "${RED}[x] No Sparrowx nftables table found. Run 'bash sbs-cli.sh --blocklist' first to initialize it.${RESET}"
    exit 1
  fi

  echo -e "${YELLOW}[->] Banning $IP in $NFT_TABLE $NFT_SET ...${RESET}"
  OUTPUT=$(nft add element $NFT_TABLE $NFT_SET "{ $IP }" 2>&1)
  EXIT=$?

  if [ $EXIT -ne 0 ]; then
    echo -e "${RED}[x] Failed to ban $IP:${RESET}"
    echo -e "${DIM}$OUTPUT${RESET}"
    exit 1
  fi

  echo -e "${GREEN}[ok] $IP has been banned on the firewall.${RESET}"
  echo ""
  echo -e "${DIM}Verify with: bash sbs-cli.sh --blocklist${RESET}"
  echo ""
  exit 0
fi

# -- unban -----------------------------------------------------
if [ "$1" = "--unban" ]; then
  IP="$2"

  if [ -z "$IP" ]; then
    echo -e "${RED}[x] Usage: bash sbs-cli.sh --unban <ip>${RESET}"
    exit 1
  fi

  if ! echo "$IP" | grep -qE '^([0-9]{1,3}\.){3}[0-9]{1,3}$'; then
    echo -e "${RED}[x] Invalid IP address: $IP${RESET}"
    exit 1
  fi

  NFT_TABLE=$(detect_nft_table)
  if [ -z "$NFT_TABLE" ]; then
    echo -e "${RED}[x] No Sparrowx nftables table found. Nothing to unban from.${RESET}"
    exit 1
  fi

  echo -e "${YELLOW}[->] Unbanning $IP from $NFT_TABLE $NFT_SET ...${RESET}"
  OUTPUT=$(nft delete element $NFT_TABLE $NFT_SET "{ $IP }" 2>&1)
  EXIT=$?

  if [ $EXIT -ne 0 ]; then
    echo -e "${RED}[x] Failed to unban $IP (may not be in the set):${RESET}"
    echo -e "${DIM}$OUTPUT${RESET}"
    exit 1
  fi

  echo -e "${GREEN}[ok] $IP has been unbanned.${RESET}"
  echo ""
  exit 0
fi

# -- expose -----------------------------------------------------
if [ "$1" = "--expose" ]; then
  AGENT_ID="$2"
  PUBLIC_PORT="$3"
  CLIENT_PORT="${4:-$PUBLIC_PORT}"

  if [ -z "$AGENT_ID" ] || [ -z "$PUBLIC_PORT" ]; then
    echo -e "${RED}[x] Usage: bash sbs-cli.sh --expose <agent_id> <public_port> [client_port]${RESET}"
    exit 1
  fi

  STATE_PATH="/opt/sparrowx/tunnels.json"
  if [ ! -f "$STATE_PATH" ] && [ -f /opt/detroit-sbs/tunnels.json ]; then
    STATE_PATH=/opt/detroit-sbs/tunnels.json
  fi
  
  if [ ! -f "$STATE_PATH" ]; then
    echo -e "${RED}[x] Tunnel state file not found.${RESET}"
    exit 1
  fi

  CLIENT_IP=$(node -e "
  const fs = require('fs');
  const state = JSON.parse(fs.readFileSync('$STATE_PATH', 'utf8'));
  const alloc = state.allocations['$AGENT_ID'];
  if (alloc && alloc.clientTunnelIp) {
    console.log(alloc.clientTunnelIp);
  }
  ")

  if [ -z "$CLIENT_IP" ]; then
    echo -e "${RED}[x] Agent $AGENT_ID not found or has no active tunnel.${RESET}"
    exit 1
  fi

  echo -e "${YELLOW}[->] Exposing port $PUBLIC_PORT to $CLIENT_IP:$CLIENT_PORT...${RESET}"
  
  MANAGER_PATH="/opt/sparrowx/tunnel-manager.sh"
  if [ ! -x "$MANAGER_PATH" ] && [ -x /opt/detroit-sbs/tunnel-manager.sh ]; then
    MANAGER_PATH=/opt/detroit-sbs/tunnel-manager.sh
  fi
  
  bash "$MANAGER_PATH" expose "$PUBLIC_PORT" "$CLIENT_IP" "$CLIENT_PORT"
  
  node -e "
  const fs = require('fs');
  const state = JSON.parse(fs.readFileSync('$STATE_PATH', 'utf8'));
  const alloc = state.allocations['$AGENT_ID'];
  if (alloc) {
    if (!alloc.exposedPorts) alloc.exposedPorts = [];
    alloc.exposedPorts = alloc.exposedPorts.filter(p => p.public !== Number('$PUBLIC_PORT'));
    alloc.exposedPorts.push({ public: Number('$PUBLIC_PORT'), client: Number('$CLIENT_PORT') });
    fs.writeFileSync('$STATE_PATH', JSON.stringify(state, null, 2));
  }
  "

  echo -e "${GREEN}[ok] Port $PUBLIC_PORT exposed to $AGENT_ID ($CLIENT_IP:$CLIENT_PORT).${RESET}"
  exit 0
fi

# -- unexpose ---------------------------------------------------
if [ "$1" = "--unexpose" ]; then
  AGENT_ID="$2"
  PUBLIC_PORT="$3"

  if [ -z "$AGENT_ID" ] || [ -z "$PUBLIC_PORT" ]; then
    echo -e "${RED}[x] Usage: bash sbs-cli.sh --unexpose <agent_id> <public_port>${RESET}"
    exit 1
  fi

  STATE_PATH="/opt/sparrowx/tunnels.json"
  if [ ! -f "$STATE_PATH" ] && [ -f /opt/detroit-sbs/tunnels.json ]; then
    STATE_PATH=/opt/detroit-sbs/tunnels.json
  fi

  echo -e "${YELLOW}[->] Removing port exposure for port $PUBLIC_PORT...${RESET}"
  
  MANAGER_PATH="/opt/sparrowx/tunnel-manager.sh"
  if [ ! -x "$MANAGER_PATH" ] && [ -x /opt/detroit-sbs/tunnel-manager.sh ]; then
    MANAGER_PATH=/opt/detroit-sbs/tunnel-manager.sh
  fi
  
  bash "$MANAGER_PATH" unexpose "$PUBLIC_PORT"
  
  if [ -f "$STATE_PATH" ]; then
    node -e "
    const fs = require('fs');
    const state = JSON.parse(fs.readFileSync('$STATE_PATH', 'utf8'));
    const alloc = state.allocations['$AGENT_ID'];
    if (alloc && alloc.exposedPorts) {
      alloc.exposedPorts = alloc.exposedPorts.filter(p => p.public !== Number('$PUBLIC_PORT'));
      fs.writeFileSync('$STATE_PATH', JSON.stringify(state, null, 2));
    }
    "
  fi

  echo -e "${GREEN}[ok] Port $PUBLIC_PORT unexposed.${RESET}"
  exit 0
fi

# -- default: show connected agents ----------------------------
AGENTS_JSON=$(curl -s http://127.0.0.1:3001/api/internal/agents)

if [ -z "$AGENTS_JSON" ] || [ "$AGENTS_JSON" = "{}" ]; then
  echo -e "${YELLOW}[!] No agents currently connected to this Guard Server.${RESET}"
  echo ""
  echo -e "${DIM}Tip: Run 'bash sbs-cli.sh --help' to see all commands.${RESET}"
  echo ""
  exit 0
fi

AGENT_COUNT=$(echo "$AGENTS_JSON" | node -e "
const data = require('fs').readFileSync(0, 'utf-8');
if(data) {
  try {
    const obj = JSON.parse(data);
    console.log(Object.keys(obj).length);
  } catch(e) { console.log('0'); }
} else { console.log('0'); }
")

echo -e "${GREEN}[+] Found $AGENT_COUNT connected agent(s):${RESET}"
echo ""

printf "${WHITE}%-38s | %-16s | %-15s | %-15s${RESET}\n" "AGENT ID" "IP ADDRESS" "HOSTNAME" "OS"
printf "%-38s | %-16s | %-15s | %-15s\n" "--------------------------------------" "----------------" "---------------" "---------------"

echo "$AGENTS_JSON" | node -e "
const fs = require('fs');
const data = fs.readFileSync(0, 'utf-8');
if (!data) process.exit(0);
try {
  const agents = JSON.parse(data);
  if (agents.error) { console.error('Error:', agents.error); process.exit(1); }
  Object.entries(agents).forEach(([id, a]) => {
    const ip   = (a.ip       || 'N/A');
    const host = (a.hostname || 'N/A').substring(0, 15);
    const os   = (a.os       || 'N/A').substring(0, 15);
    let displayId = id;
    if (displayId.length > 38) displayId = displayId.substring(0, 35) + '...';
    console.log(displayId.padEnd(38) + ' | ' + ip.padEnd(16) + ' | ' + host.padEnd(15) + ' | ' + os.padEnd(15));
  });
} catch(e) { console.error('Failed to parse agent data.'); }
"

echo ""
echo -e "${DIM}Tip: Run 'bash sbs-cli.sh --help' to see all commands.${RESET}"
echo -e "${CYAN}=================================================${RESET}"
echo ""
