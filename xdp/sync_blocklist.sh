#!/bin/bash

# =================================================================
#  SPARROWX — XDP Blocklist Sync
#  Syncs nftables Blacklist to eBPF Map
# =================================================================

# Get all IPs from nftables blacklist
IP_LIST=$(nft list set inet sparrowx_shield blacklist | grep -oE "\b([0-9]{1,3}\.){3}[0-9]{1,3}\b")

# Find the map ID
MAP_ID=$(bpftool map list | grep sparrowx_blacklist | awk '{print $1}' | tr -d ':')

if [ -z "$MAP_ID" ]; then
    echo "[✗] Could not find XDP map 'sparrowx_blacklist'. Is XDP loaded?"
    exit 1
fi

echo "[→] Syncing IPs to XDP map..."

# Clear and reload (simplified)
# Note: XDP maps don't have a 'flush' command like nftables.
# We'll just update all current IPs. 
# For a full sync, we should ideally track removals too.

for ip in $IP_LIST; do
    # Convert IP to hex bytes for bpftool (big endian)
    HEX_IP=$(printf '0x%02x%02x%02x%02x' $(echo $ip | tr '.' ' '))
    
    # bpftool map update id <id> key <key_bytes> value <value_bytes>
    # Key is 4 bytes (IPv4), Value is 8 bytes (__u64 timestamp/placeholder)
    # Note: bpftool expects hex bytes like: hex 01 02 03 04
    HEX_BYTES=$(printf '%02x %02x %02x %02x' $(echo $ip | tr '.' ' '))
    
    bpftool map update id $MAP_ID key hex $HEX_BYTES value hex 00 00 00 00 00 00 00 00 2>/dev/null
    
    if [ $? -eq 0 ]; then
        echo "[✓] Synced $ip"
    else
        echo "[✗] Failed to sync $ip"
    fi
done

echo "[✓] Sync complete."
