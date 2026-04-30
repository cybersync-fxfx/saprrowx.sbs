#!/bin/bash
# SparrowX Security Stress Test & Audit Tool
# ⚠️ WARNING: Run this only on servers YOU own for testing your defense layers.

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

clear
echo -e "${CYAN}====================================================${NC}"
echo -e "${CYAN}      SparrowX Infrastructure Stress Test           ${NC}"
echo -e "${CYAN}====================================================${NC}"
echo -e "This script will simulate various attack patterns to"
echo -e "verify your 4-layer defense stack."
echo ""

# Check for hping3
if ! command -v hping3 &> /dev/null; then
    echo -e "${YELLOW}[!] hping3 not found. Installing...${NC}"
    sudo apt-get update -qq && sudo apt-get install -y hping3 -qq
fi

read -p "Enter Target IP (Your Guard/VPS IP): " TARGET
if [[ -z "$TARGET" ]]; then
    echo -e "${RED}[error] Target IP required.${NC}"
    exit 1
fi

echo -e "\n${YELLOW}Select Attack Strategy:${NC}"
echo "1) TCP SYN Flood (Test Layer 1 XDP/L2 Nftables)"
echo "2) UDP Flood (Test Layer 4 FastNetMon)"
echo "3) HTTP Request Flood (Test Layer 3 HAProxy)"
echo "4) Port Scan / Fanout (Test Radar Intelligence)"
echo "5) ICMP Flood (Ping of Death Simulation)"
echo "6) Stop All Tests"
read -p "Choice [1-6]: " CHOICE

case $CHOICE in
    1)
        echo -e "${GREEN}[→] Starting SYN Flood on $TARGET:80...${NC}"
        sudo hping3 -S -p 80 --flood --rand-source "$TARGET"
        ;;
    2)
        echo -e "${GREEN}[→] Starting UDP Flood on $TARGET...${NC}"
        sudo hping3 --udp -p 53 --flood --rand-source "$TARGET"
        ;;
    3)
        echo -e "${GREEN}[→] Starting HTTP Flood on http://$TARGET/...${NC}"
        if ! command -v ab &> /dev/null; then
            sudo apt-get install -y apache2-utils -qq
        fi
        ab -n 100000 -c 100 "http://$TARGET/"
        ;;
    4)
        echo -e "${GREEN}[→] Starting Port Scan (Radar Fanout Test)...${NC}"
        sudo nmap -sS -p 1-1000 -T4 "$TARGET"
        ;;
    5)
        echo -e "${GREEN}[→] Starting ICMP Flood on $TARGET...${NC}"
        sudo hping3 -1 --flood --rand-source "$TARGET"
        ;;
    6)
        sudo pkill hping3
        sudo pkill ab
        echo -e "${GREEN}[✓] All stress tests stopped.${NC}"
        ;;
    *)
        echo -e "${RED}[error] Invalid choice.${NC}"
        ;;
esac
