#!/bin/bash
set -euo pipefail

# Sparrowx Guard Tunnel Manager (WireGuard + nftables)
ACTION="${1:-}"
AGENT_ID="${2:-}"
CLIENT_IP="${3:-}"
GUARD_IP="${4:-${GUARD_PUBLIC_IP:-}}"
GUARD_INTERNAL_IP="${5:-}"
CLIENT_INTERNAL_IP="${6:-}"
LISTEN_PORT="${7:-51820}"
REQUESTED_TUNNEL_NAME="${8:-}"

TUNNEL_NAME="${REQUESTED_TUNNEL_NAME:-${SPARROWX_TUNNEL_NAME:-${SBS_TUNNEL_NAME:-spx_${AGENT_ID:0:8}}}}"
CONFIG_DIR="/etc/wireguard"
CONFIG_FILE="${CONFIG_DIR}/${TUNNEL_NAME}.conf"

# -- Helpers ---------------------------------------------------
log() {
  echo "[tunnel-manager] $1" >&2
}

ensure_nft_table() {
  # Ensure the detroit_guard table and required chains exist
  nft list table inet detroit_guard >/dev/null 2>&1 || nft add table inet detroit_guard
  nft list chain inet detroit_guard forward >/dev/null 2>&1 || nft add chain inet detroit_guard forward '{ type filter hook forward priority 0; policy accept; }'

  # Ensure NAT table exists (using ip family for nat is common)
  nft list table ip detroit_nat >/dev/null 2>&1 || nft add table ip detroit_nat
  nft list chain ip detroit_nat postrouting >/dev/null 2>&1 || nft add chain ip detroit_nat postrouting '{ type nat hook postrouting priority 100; policy accept; }'
  nft list set ip detroit_nat postrouting_masq >/dev/null 2>&1 || nft add set ip detroit_nat postrouting_masq '{ type ipv4_addr; }'

  if ! nft -a list chain ip detroit_nat postrouting 2>/dev/null | grep -q 'ip saddr @postrouting_masq masquerade'; then
    nft add rule ip detroit_nat postrouting ip saddr @postrouting_masq masquerade
  fi
}

# Ensure wireguard is installed
if ! command -v wg &>/dev/null; then
  log "WireGuard not found. Installing..."
  apt-get update -qq && apt-get install -y wireguard wireguard-tools >/dev/null
fi

case $ACTION in
  add)
    if [ -z "$AGENT_ID" ] || [ -z "$CLIENT_IP" ] || [ -z "$GUARD_INTERNAL_IP" ] || [ -z "$CLIENT_INTERNAL_IP" ]; then
      echo "Usage: $0 add <agent_id> <client_public_ip> <guard_public_ip> <guard_tunnel_ip> <client_tunnel_ip> [listen_port] [tunnel_name]" >&2
      exit 1
    fi

    # Retrieve keys from env
    GUARD_PRIVATE_KEY="${SPARROWX_GUARD_PRIVATE_KEY:-${SBS_GUARD_PRIVATE_KEY:-}}"
    CLIENT_PUBLIC_KEY="${SPARROWX_CLIENT_PUBLIC_KEY:-${SBS_CLIENT_PUBLIC_KEY:-}}"

    if [ -z "$GUARD_PRIVATE_KEY" ] || [ -z "$CLIENT_PUBLIC_KEY" ]; then
      log "Error: WireGuard keys (SPARROWX_GUARD_PRIVATE_KEY/SPARROWX_CLIENT_PUBLIC_KEY or legacy SBS_* aliases) missing from environment."
      exit 1
    fi

    log "Configuring WireGuard tunnel ${TUNNEL_NAME} for agent ${AGENT_ID}..."
    
    # 1. Enable IP Forwarding
    sysctl -w net.ipv4.ip_forward=1 > /dev/null

    # 2. Create WG Config
    mkdir -p "$CONFIG_DIR"
    chmod 700 "$CONFIG_DIR"

    # We do NOT specify an Endpoint here because the guard is the server.
    # The client will initiate the connection and punch through NAT.
    cat <<EOF > "$CONFIG_FILE"
[Interface]
PrivateKey = ${GUARD_PRIVATE_KEY}
ListenPort = ${LISTEN_PORT}
Address = ${GUARD_INTERNAL_IP}/30

[Peer]
PublicKey = ${CLIENT_PUBLIC_KEY}
AllowedIPs = ${CLIENT_INTERNAL_IP}/32
PersistentKeepalive = 25
EOF
    chmod 600 "$CONFIG_FILE"

    # 3. Bring interface up
    wg-quick down "$TUNNEL_NAME" 2>/dev/null || true
    if ! wg-quick up "$TUNNEL_NAME"; then
      log "Failed to bring up ${TUNNEL_NAME}. Check dmesg/journalctl."
      exit 1
    fi

    # 4. NAT/Forwarding rules (using nftables)
    ensure_nft_table

    # Track client tunnel IPs in one stable NAT set.
    nft add element ip detroit_nat postrouting_masq "{ ${CLIENT_INTERNAL_IP} }" 2>/dev/null || true

    log "Tunnel ${TUNNEL_NAME} is UP (${GUARD_INTERNAL_IP} <-> ${CLIENT_INTERNAL_IP})"
    echo "{ \"status\": \"ok\", \"tunnel\": \"${TUNNEL_NAME}\", \"client_ip\": \"${CLIENT_IP}\" }"
    ;;

  remove)
    log "Removing tunnel ${TUNNEL_NAME}..."
    wg-quick down "$TUNNEL_NAME" 2>/dev/null || true
    rm -f "$CONFIG_FILE"

    if [ -n "$CLIENT_INTERNAL_IP" ]; then
      ensure_nft_table
      nft delete element ip detroit_nat postrouting_masq "{ ${CLIENT_INTERNAL_IP} }" 2>/dev/null || true
    fi

    echo "{ \"status\": \"ok\", \"tunnel\": \"removed\" }"
    ;;

  list)
    wg show
    ;;

  *)
    echo "Usage: $0 <add|remove|list> ..." >&2
    exit 1
    ;;
esac
