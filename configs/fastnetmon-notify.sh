#!/bin/bash

# =================================================================
#  SPARROWX — FastNetMon Notify Script
#  Handles Automated Banning & Logging
# =================================================================

IP=$1
DIRECTION=$2
PPS=$3
ACTION=$4

LOG_FILE="/var/log/sbs/attacks.log"
NFT_SET="sparrowx_shield.blacklist"

# Ensure log dir exists
mkdir -p /var/log/sbs

if [ "$ACTION" == "ban" ]; then
    echo "$(date '+%Y-%m-%d %H:%M:%S') [FASTNETMON] BAN $IP | $DIRECTION | $PPS pps" >> "$LOG_FILE"
    
    # Add to nftables blacklist
    nft add element inet $NFT_SET { $IP } 2>/dev/null
    
    # Optional: Send Discord webhook
    # if [ -n "$DISCORD_WEBHOOK_URL" ]; then
    #   curl -X POST -H "Content-Type: application/json" -d "{\"content\": \"🚨 **DDoS Attack Detected**\nIP: $IP\nTraffic: $PPS PPS\nAction: BANNED\"}" "$DISCORD_WEBHOOK_URL"
    # fi

elif [ "$ACTION" == "unban" ]; then
    echo "$(date '+%Y-%m-%d %H:%M:%S') [FASTNETMON] UNBAN $IP" >> "$LOG_FILE"
    nft delete element inet $NFT_SET { $IP } 2>/dev/null
fi

exit 0
