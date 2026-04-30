#!/bin/bash

# =================================================================
#  SPARROWX — Config Applier (PRO)
#  Replaces placeholders and applies all 4 layers
# =================================================================

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[0;33m'; RESET='\033[0m'

IFACE=$(ip route | grep default | awk '{print $5}' | head -1)
PORT=$(grep '^PORT=' .env | cut -d= -f2 || echo 3001)

echo -e "${YELLOW}[→] Targeted Interface: $IFACE${RESET}"
echo -e "${YELLOW}[→] Targeted Port: $PORT${RESET}"

# 1. nftables
if [ -f "configs/nftables-sparrowx.conf" ]; then
    echo -e "${GREEN}[→] Applying nftables Layer 2...${RESET}"
    sed "s/IFACE_PLACEHOLDER/$IFACE/g" configs/nftables-sparrowx.conf > /etc/nftables.conf.sparrowx
    nft -f /etc/nftables.conf.sparrowx && echo -e "${GREEN}[✓] nftables updated${RESET}" || echo -e "${RED}[✗] nftables failed${RESET}"
fi

# 2. HAProxy
if [ -f "configs/haproxy.cfg" ]; then
    echo -e "${GREEN}[→] Applying HAProxy Layer 3...${RESET}"
    mkdir -p /etc/haproxy/certs
    sed "s/PANEL_PORT_PLACEHOLDER/$PORT/g" configs/haproxy.cfg > /etc/haproxy/haproxy.cfg
    haproxy -c -f /etc/haproxy/haproxy.cfg >/dev/null 2>&1
    if [ $? -eq 0 ]; then
        systemctl restart haproxy && echo -e "${GREEN}[✓] HAProxy updated${RESET}" || echo -e "${RED}[✗] HAProxy failed to restart${RESET}"
    else
        echo -e "${RED}[✗] HAProxy config validation failed${RESET}"
    fi
fi

# 3. FastNetMon
if [ -f "configs/fastnetmon.conf" ]; then
    echo -e "${GREEN}[→] Applying FastNetMon Layer 4...${RESET}"
    sed "s/IFACE_PLACEHOLDER/$IFACE/g" configs/fastnetmon.conf > /etc/fastnetmon.conf
    # Ensure capture method is correct for modern Ubuntu
    sed -i 's/method = af_packet/method = pcap/g' /etc/fastnetmon.conf # Try pcap if af_packet fails
    systemctl restart fastnetmon && echo -e "${GREEN}[✓] FastNetMon updated${RESET}" || echo -e "${RED}[✗] FastNetMon failed${RESET}"
fi

# 4. sysctl
if [ -f "configs/sysctl-sparrowx.conf" ]; then
    echo -e "${GREEN}[→] Applying Kernel Hardening...${RESET}"
    cp configs/sysctl-sparrowx.conf /etc/sysctl.d/99-sparrowx.conf
    sysctl -p /etc/sysctl.d/99-sparrowx.conf >/dev/null && echo -e "${GREEN}[✓] sysctl updated${RESET}"
fi

# 5. XDP Sync
if [ -f "xdp/sync_blocklist.sh" ]; then
    echo -e "${GREEN}[→] Syncing XDP Blocklist...${RESET}"
    bash xdp/sync_blocklist.sh
fi
