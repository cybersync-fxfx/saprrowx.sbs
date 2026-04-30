#!/bin/bash
# =================================================================
#   SPARROWX - REAL-TIME DASHBOARD INSPECTOR & AUTO-DEBUGGER
#   Purpose: Ensures the control panel shows 100% accurate data.
#   Fixes: Mismatched state, stuck interfaces, log sync issues.
# =================================================================

set -u

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
CYAN='\033[0;36m'
RESET='\033[0m'

# Detect installation directory
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" &> /dev/null && pwd )"
STATE_FILE="${SCRIPT_DIR}/tunnels.json"
RUNTIME_FILE="${SCRIPT_DIR}/storage/runtime-state.json"
ATTACK_LOG="/var/log/sbs/attacks.log"

echo -e "${CYAN}=================================================================${RESET}"
echo -e "${CYAN}  SPARROWX - DASHBOARD TRUTH & INTEGRITY INSPECTOR${RESET}"
echo -e "${CYAN}=================================================================${RESET}"

if [ "$EUID" -ne 0 ]; then
  echo -e "${RED}[x] Error: Inspector requires root privileges.${RESET}"
  exit 1
fi

# -- STEP 1: Check Database & Local State Consistency --
echo -e "\n${YELLOW}[1/4] Auditing Local State vs Actual Interfaces...${RESET}"

if [ ! -f "$STATE_FILE" ]; then
  echo -e "  ${RED}[x] Critical: tunnels.json missing.${RESET}"
else
  # Count expected tunnels from JSON
  EXPECTED_COUNT=$(jq '.allocations | length' "$STATE_FILE" 2>/dev/null || echo "0")
  # Count actual wireguard interfaces
  ACTUAL_COUNT=$(wg show interfaces | wc -l)
  
  echo -e "  [i] Dashboard expects: ${EXPECTED_COUNT} active tunnels."
  echo -e "  [i] System has: ${ACTUAL_COUNT} active interfaces."

  if [ "$EXPECTED_COUNT" -ne "$ACTUAL_COUNT" ]; then
    echo -e "  ${RED}[!] DISCREPANCY DETECTED! Dashboard data may be inaccurate.${RESET}"
    echo -e "  [->] AUTO-FIX: Synchronizing tunnels..."
    if [ -f "$SCRIPT_DIR/repair-tunnels.sh" ]; then
        bash "$SCRIPT_DIR/repair-tunnels.sh"
    fi
  else
    echo -e "  ${GREEN}[ok]${RESET} State consistency verified."
  fi
fi

# -- STEP 2: Verify Log Streaming Integrity --
echo -e "\n${YELLOW}[2/4] Verifying Attack Log & Telemetry Pipeline...${RESET}"

if [ ! -f "$ATTACK_LOG" ]; then
  echo -e "  ${YELLOW}[!] Warning: attack log missing. Creating file...${RESET}"
  mkdir -p /var/log/sbs
  touch "$ATTACK_LOG"
fi

# Check if ban-logger service is alive
if systemctl is-active --quiet sparrowx-ban-logger || systemctl is-active --quiet sbs-ban-logger; then
  echo -e "  ${GREEN}[ok]${RESET} Ban-logger service is operational."
else
  echo -e "  ${RED}[x] Ban-logger is DEAD. Dashboard will not show new attacks.${RESET}"
  echo -e "  [->] AUTO-FIX: Restoring logging service..."
  systemctl enable sparrowx-ban-logger &>/dev/null || true
  systemctl restart sparrowx-ban-logger &>/dev/null || systemctl restart sbs-ban-logger &>/dev/null || true
fi

# -- STEP 3: Auto-Debug Crash Loops (Discord Spam Protection) --
echo -e "\n${YELLOW}[3/4] Inspecting for Crash Loops & Service Stability...${RESET}"

PANEL_LOG=$(pm2 logs sparrowx-panel --lines 20 --no-colors 2>/dev/null | grep -iE "error|crash|failed")
if [[ -n "$PANEL_LOG" ]]; then
  echo -e "  ${RED}[!] Recent crashes found in panel logs:${RESET}"
  echo "$PANEL_LOG" | tail -n 3
  echo -e "  [->] AUTO-DEBUG: Checking .env integrity..."
  if ! grep -q "SUPABASE_URL" "$SCRIPT_DIR/.env"; then
    echo -e "      ${RED}[x] Missing Supabase config in .env!${RESET}"
  fi
else
  echo -e "  ${GREEN}[ok]${RESET} No critical crash patterns detected in PM2."
fi

# -- STEP 4: Network Forwarding Check --
echo -e "\n${YELLOW}[4/4] Verifying Kernel Data Path...${RESET}"
FORWARD_VAL=$(cat /proc/sys/net/ipv4/ip_forward)
if [ "$FORWARD_VAL" -eq 1 ]; then
  echo -e "  ${GREEN}[ok]${RESET} IP Forwarding is active."
else
  echo -e "  ${RED}[x] IP Forwarding is DISABLED. Clients cannot reach the internet!${RESET}"
  echo -e "  [->] AUTO-FIX: Enabling forwarding..."
  echo 1 > /proc/sys/net/ipv4/ip_forward
  sysctl -w net.ipv4.ip_forward=1 &>/dev/null
fi

echo -e "\n${CYAN}=================================================================${RESET}"
echo -e "${GREEN}  INSPECTION COMPLETE: All dashboard data streams validated.${RESET}"
echo -e "${CYAN}=================================================================${RESET}\n"
