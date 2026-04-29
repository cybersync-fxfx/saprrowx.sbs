#!/bin/bash
set -euo pipefail

STATE_PATH="${SPARROWX_TUNNEL_STATE_PATH:-${SBS_TUNNEL_STATE_PATH:-/opt/sparrowx/tunnels.json}}"
if [ ! -f "$STATE_PATH" ] && [ -f /opt/detroit-sbs/tunnels.json ]; then
  STATE_PATH=/opt/detroit-sbs/tunnels.json
fi

MANAGER_PATH="${SPARROWX_TUNNEL_MANAGER:-${SBS_TUNNEL_MANAGER:-/opt/sparrowx/tunnel-manager.sh}}"
if [ ! -x "$MANAGER_PATH" ] && [ -x /opt/detroit-sbs/tunnel-manager.sh ]; then
  MANAGER_PATH=/opt/detroit-sbs/tunnel-manager.sh
fi

if [ ! -f "$STATE_PATH" ]; then
  exit 0
fi

# 1. Check and Repair Tunnel Interfaces
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
  
  if ! ip link show dev "$tunnelName" >/dev/null 2>&1; then
    echo "[repair-tunnels] Interface $tunnelName is DOWN. Repairing..."
    export SPARROWX_GUARD_PRIVATE_KEY="$guardPriv"
    export SPARROWX_CLIENT_PUBLIC_KEY="$clientPub"
    export SBS_GUARD_PRIVATE_KEY="$guardPriv"
    export SBS_CLIENT_PUBLIC_KEY="$clientPub"
    bash "$MANAGER_PATH" add "$agentId" "$clientPublicIp" "$guardPublicIp" "$guardTunnelIp" "$clientTunnelIp" "$listenPort" "$tunnelName"
  fi
done

# 2. Check and Repair Port Forwards
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
  
  if ! nft list chain ip detroit_nat port_forwards 2>/dev/null | grep -q "tcp dport ${publicPort} dnat to ${clientTunnelIp}:${clientPort}"; then
    echo "[repair-tunnels] Port Forward ${publicPort} -> ${clientTunnelIp}:${clientPort} is missing. Repairing..."
    bash "$MANAGER_PATH" expose "$publicPort" "$clientTunnelIp" "$clientPort"
  fi
done
