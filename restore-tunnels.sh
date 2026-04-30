#!/bin/bash
set -euo pipefail

# Detect installation directory
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" &> /dev/null && pwd )"
INSTALL_DIR="$SCRIPT_DIR"

STATE_PATH="${SPARROWX_TUNNEL_STATE_PATH:-${SBS_TUNNEL_STATE_PATH:-$INSTALL_DIR/tunnels.json}}"
if [ ! -f "$STATE_PATH" ] && [ -f /opt/sparrowx/tunnels.json ]; then
  STATE_PATH=/opt/sparrowx/tunnels.json
elif [ ! -f "$STATE_PATH" ] && [ -f /opt/detroit-sbs/tunnels.json ]; then
  STATE_PATH=/opt/detroit-sbs/tunnels.json
fi

MANAGER_PATH="${SPARROWX_TUNNEL_MANAGER:-${SBS_TUNNEL_MANAGER:-$INSTALL_DIR/tunnel-manager.sh}}"
if [ ! -x "$MANAGER_PATH" ] && [ -x /opt/sparrowx/tunnel-manager.sh ]; then
  MANAGER_PATH=/opt/sparrowx/tunnel-manager.sh
elif [ ! -x "$MANAGER_PATH" ] && [ -x /opt/detroit-sbs/tunnel-manager.sh ]; then
  MANAGER_PATH=/opt/detroit-sbs/tunnel-manager.sh
fi

if [ ! -f "$STATE_PATH" ]; then
  echo "[restore-tunnels] No tunnel state file found at $STATE_PATH"
  exit 0
fi

if [ ! -x "$MANAGER_PATH" ]; then
  echo "[restore-tunnels] Tunnel manager missing or not executable: $MANAGER_PATH" >&2
  exit 1
fi

# Extract and run restoration for each allocation
node - "$STATE_PATH" <<'NODE' | while IFS=$'\t' read -r agentId clientPublicIp guardPublicIp guardTunnelIp clientTunnelIp listenPort tunnelName guardPriv clientPub; do
const fs = require('fs');
const statePath = process.argv[2];
const raw = JSON.parse(fs.readFileSync(statePath, 'utf8'));
const allocations = raw.allocations || {};
for (const [agentId, cfg] of Object.entries(allocations)) {
  if (!cfg || !cfg.clientPublicIp || !cfg.guardPublicIp || !cfg.guardTunnelIp || !cfg.clientTunnelIp) continue;
  const tunnelName = cfg.tunnelName || `spx_${String(agentId).substring(0, 8)}`;
  process.stdout.write(
    `${agentId}\t${cfg.clientPublicIp}\t${cfg.guardPublicIp}\t${cfg.guardTunnelIp}\t${cfg.clientTunnelIp}\t${cfg.listenPort || 51820}\t${tunnelName}\t${cfg.guardPrivateKey || ''}\t${cfg.clientPublicKey || ''}\n`
  );
}
NODE
  if [ -z "${agentId:-}" ]; then
    continue
  fi
  echo "[restore-tunnels] Restoring WireGuard tunnel for ${agentId} (${clientPublicIp})"
  
  export SPARROWX_GUARD_PRIVATE_KEY="$guardPriv"
  export SPARROWX_CLIENT_PUBLIC_KEY="$clientPub"
  export SBS_GUARD_PRIVATE_KEY="$guardPriv"
  export SBS_CLIENT_PUBLIC_KEY="$clientPub"
  
  if [ -z "$guardPriv" ] || [ -z "$clientPub" ]; then
    echo "[restore-tunnels] Skip ${agentId}: WireGuard keys missing in state file."
    continue
  fi

  bash "$MANAGER_PATH" add "$agentId" "$clientPublicIp" "$guardPublicIp" "$guardTunnelIp" "$clientTunnelIp" "$listenPort" "$tunnelName"
done

# Restore Port Forwards
node - "$STATE_PATH" <<'NODE' | while IFS=$'\t' read -r clientTunnelIp publicPort clientPort; do
const fs = require('fs');
const statePath = process.argv[2];
const raw = JSON.parse(fs.readFileSync(statePath, 'utf8'));
const allocations = raw.allocations || {};
for (const [agentId, cfg] of Object.entries(allocations)) {
  if (!cfg || !cfg.clientTunnelIp || !cfg.exposedPorts) continue;
  for (const port of cfg.exposedPorts) {
    process.stdout.write(`${cfg.clientTunnelIp}\t${port.public}\t${port.client || port.public}\n`);
  }
}
NODE
  if [ -z "${clientTunnelIp:-}" ]; then
    continue
  fi
  echo "[restore-tunnels] Restoring Port Forward ${publicPort} -> ${clientTunnelIp}:${clientPort}"
  bash "$MANAGER_PATH" expose "$publicPort" "$clientTunnelIp" "$clientPort"
done

