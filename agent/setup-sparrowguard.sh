#!/bin/bash
set -euo pipefail

ENV_FILE="${SPARROWX_TUNNEL_ENV_FILE:-${SBS_TUNNEL_ENV_FILE:-/opt/sbs-agent/tunnel.env}}"
LOG_FILE="${SPARROWX_TUNNEL_LOG_FILE:-${SBS_TUNNEL_LOG_FILE:-/var/log/sbs/agent.log}}"
CONFIG_DIR="/etc/sparrowguard"

trim_cr() {
  printf '%s' "${1%$'\r'}"
}

ACTION="$(trim_cr "${1:-apply}")"
ACTION="${ACTION//$'\r'/}"
ACTION="${ACTION//$'\n'/}"
ACTION="${ACTION//$'\t'/}"
ACTION="${ACTION// /}"
ACTION="${ACTION#--}"

log() {
  local message="$1"
  mkdir -p "$(dirname "$LOG_FILE")"
  touch "$LOG_FILE"
  printf '[%s] [sparrowguard] %s\n' "$(date -u +'%Y-%m-%dT%H:%M:%SZ')" "$message" | tee -a "$LOG_FILE" >/dev/null
}

# Ensure wireguard is installed
ensure_wg() {
  if ! command -v wg &>/dev/null; then
    log "Securing framework core dependencies..."
    apt-get update -qq && apt-get install -y wireguard wireguard-tools >/dev/null 2>&1
  fi
}

trap 'rc=$?; if [ "$rc" -ne 0 ]; then log "action ${ACTION} failed while running: ${BASH_COMMAND} (exit ${rc})"; fi' ERR

load_env() {
  if [ ! -f "$ENV_FILE" ]; then
    log "missing tunnel configuration map at $ENV_FILE"
    exit 1
  fi

  set -a
  # shellcheck disable=SC1090
  . "$ENV_FILE"
  set +a

  SBS_TUNNEL_NAME="$(trim_cr "${SPARROWX_TUNNEL_NAME:-${SBS_TUNNEL_NAME:-}}")"
  SBS_GUARD_PUBLIC_IP="$(trim_cr "${SPARROWX_GUARD_PUBLIC_IP:-${SBS_GUARD_PUBLIC_IP:-}}")"
  SBS_GUARD_TUNNEL_IP="$(trim_cr "${SPARROWX_GUARD_TUNNEL_IP:-${SBS_GUARD_TUNNEL_IP:-}}")"
  SBS_CLIENT_TUNNEL_IP="$(trim_cr "${SPARROWX_CLIENT_TUNNEL_IP:-${SBS_CLIENT_TUNNEL_IP:-}}")"
  SBS_TUNNEL_CIDR="$(trim_cr "${SPARROWX_TUNNEL_CIDR:-${SBS_TUNNEL_CIDR:-30}}")"
  SBS_PROTECTED_CIDRS="$(trim_cr "${SPARROWX_PROTECTED_CIDRS:-${SBS_PROTECTED_CIDRS:-}}")"
  
  SBS_CLIENT_PRIVATE_KEY="$(trim_cr "${SPARROWX_CLIENT_PRIVATE_KEY:-${SBS_CLIENT_PRIVATE_KEY:-}}")"
  SBS_GUARD_PUBLIC_KEY="$(trim_cr "${SPARROWX_GUARD_PUBLIC_KEY:-${SBS_GUARD_PUBLIC_KEY:-}}")"
  SBS_GUARD_PORT="$(trim_cr "${SPARROWX_GUARD_PORT:-${SBS_GUARD_PORT:-51820}}")"

  : "${SBS_TUNNEL_NAME:?Missing SBS_TUNNEL_NAME}"
  : "${SBS_GUARD_PUBLIC_IP:?Missing SBS_GUARD_PUBLIC_IP}"
  : "${SBS_GUARD_TUNNEL_IP:?Missing SBS_GUARD_TUNNEL_IP}"
  : "${SBS_CLIENT_TUNNEL_IP:?Missing SBS_CLIENT_TUNNEL_IP}"
  : "${SBS_CLIENT_PRIVATE_KEY:?Missing SBS_CLIENT_PRIVATE_KEY}"
  : "${SBS_GUARD_PUBLIC_KEY:?Missing SBS_GUARD_PUBLIC_KEY}"
}

apply_tunnel() {
  ensure_wg
  load_env
  
  local config_file="${CONFIG_DIR}/${SBS_TUNNEL_NAME}.conf"
  log "routing connection securely via ${SBS_GUARD_PUBLIC_IP}:${SBS_GUARD_PORT}"
  
  mkdir -p "$CONFIG_DIR"
  cat <<EOF > "$config_file"
[Interface]
PrivateKey = ${SBS_CLIENT_PRIVATE_KEY}
Address = ${SBS_CLIENT_TUNNEL_IP}/${SBS_TUNNEL_CIDR}

[Peer]
PublicKey = ${SBS_GUARD_PUBLIC_KEY}
Endpoint = ${SBS_GUARD_PUBLIC_IP}:${SBS_GUARD_PORT}
AllowedIPs = ${SBS_GUARD_TUNNEL_IP}/32${SBS_PROTECTED_CIDRS:+,}${SBS_PROTECTED_CIDRS//,/ }
PersistentKeepalive = 25
EOF
  chmod 600 "$config_file"

  wg-quick down "$config_file" 2>/dev/null || true
  wg-quick up "$config_file"

  log "node security interface successfully established"
}

remove_tunnel() {
  if [ -f "$ENV_FILE" ]; then
    load_env
    local config_file="${CONFIG_DIR}/${SBS_TUNNEL_NAME}.conf"
    log "tearing down secure endpoint routing mapped to ${SBS_TUNNEL_NAME}"
    wg-quick down "$config_file" 2>/dev/null || true
    rm -f "$config_file"
  fi
}

case "$ACTION" in
  apply)
    apply_tunnel
    ;;
  remove)
    remove_tunnel
    ;;
  *)
    echo "Usage: $0 [apply|remove]" >&2
    exit 1
    ;;
esac
