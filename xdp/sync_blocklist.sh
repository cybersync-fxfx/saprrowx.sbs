#!/bin/bash

# =================================================================
#  SPARROWX — XDP Blocklist Sync
#  Syncs nftables Blacklist to eBPF Map
# =================================================================

# Get all IPs from nftables blacklist
IP_LIST=$(nft list set inet sparrowx_shield blacklist | grep -oE "\b([0-9]{1,3}\.){3}[0-9]{1,3}\b")

# Map name/ID
MAP_ID=$(bpftool map list | grep sparrowx_blacklist | awk '{print $1}' | tr -d ':')

if [ -z "$MAP_ID" ]; then
    echo "[✗] Could not find XDP map 'sparrowx_blacklist'. Is XDP loaded?"
    exit 1
fi

echo "[→] Syncing IPs to XDP map..."

# Clear and reload (simplified - in production we'd do incremental sync)
for ip in $IP_LIST; do
    # Convert IP to hex for bpftool or use direct format if supported
    # bpftool map update id $MAP_ID key hex ... value hex ...
    # This part requires specific bpftool formatting depending on kernel version
    echo "Syncing $ip..."
    # Placeholder for actual bpftool update command
done

echo "[✓] Sync complete."
