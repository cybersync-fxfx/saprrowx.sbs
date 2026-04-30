#!/bin/bash

# =================================================================
#  SPARROWX — Config Applier
#  Replaces placeholders and applies configs to the system
# =================================================================

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[0;33m'; RESET='\033[0m'

IFACE=$(ip route | grep default | awk '{print $5}' | head -1)
PORT=$(grep '^PORT=' .env | cut -d= -f2 || echo 3001)

echo -e "${YELLOW}[→] Detected Interface: $IFACE${RESET}"
echo -e "${YELLOW}[→] Detected Port: $PORT${RESET}"

# 1. nftables
if [ -f "configs/nftables-sparrowx.conf" ]; then
    echo -e "${GREEN}[→] Applying nftables...${RESET}"
    sed "s/IFACE_PLACEHOLDER/$IFACE/g" configs/nftables-sparrowx.conf > /etc/nftables.conf.sparrowx
    nft -f /etc/nftables.conf.sparrowx && echo -e "${GREEN}[✓] nftables applied${RESET}" || echo -e "${RED}[✗] nftables failed${RESET}"
fi

# 2. HAProxy
if [ -f "configs/haproxy.cfg" ]; then
    echo -e "${GREEN}[→] Applying HAProxy...${RESET}"
    sed "s/PANEL_PORT_PLACEHOLDER/$PORT/g" configs/haproxy.cfg > /etc/haproxy/haproxy.cfg
    haproxy -c -f /etc/haproxy/haproxy.cfg && systemctl restart haproxy && echo -e "${GREEN}[✓] HAProxy applied${RESET}" || echo -e "${RED}[✗] HAProxy failed${RESET}"
fi

# 3. FastNetMon
if [ -f "configs/fastnetmon.conf" ]; then
    echo -e "${GREEN}[→] Applying FastNetMon...${RESET}"
    sed "s/IFACE_PLACEHOLDER/$IFACE/g" configs/fastnetmon.conf > /etc/fastnetmon.conf
    systemctl restart fastnetmon && echo -e "${GREEN}[✓] FastNetMon applied${RESET}" || echo -e "${RED}[✗] FastNetMon failed (Is it installed?)${RESET}"
fi

# 4. sysctl
if [ -f "configs/sysctl-sparrowx.conf" ]; then
    echo -e "${GREEN}[→] Applying sysctl...${RESET}"
    cp configs/sysctl-sparrowx.conf /etc/sysctl.d/99-sparrowx.conf
    sysctl -p /etc/sysctl.d/99-sparrowx.conf && echo -e "${GREEN}[✓] sysctl applied${RESET}"
fi
