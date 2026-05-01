#!/bin/bash
# =================================================================
#   SPARROWX MASTER INSPECTOR & AUTO-REMEDIATION SUITE
#   Purpose: Holistic system health check for control panel & guard.
#   Fixes: UI build issues, API failures, service crashes, AI readiness.
# =================================================================

set -u

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
CYAN='\033[0;36m'
MAGENTA='\033[0;35m'
RESET='\033[0m'

# Detect installation directory
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" &> /dev/null && pwd )"
STATE_FILE="${SCRIPT_DIR}/tunnels.json"
RUNTIME_FILE="${SCRIPT_DIR}/storage/runtime-state.json"
ATTACK_LOG="/var/log/sbs/attacks.log"
FRONTEND_DIST="${SCRIPT_DIR}/frontend/dist"
BRAIN_REPORT="${SCRIPT_DIR}/intel/brain/last-report.json"

echo -e "${CYAN}=================================================================${RESET}"
echo -e "${CYAN}  SPARROWX MASTER INFRASTRUCTURE INSPECTOR (v2.1)${RESET}"
echo -e "${CYAN}=================================================================${RESET}"

if [ "$EUID" -ne 0 ]; then
  echo -e "${RED}[x] Error: Master Inspector requires root privileges.${RESET}"
  exit 1
fi

# -- STEP 1: Backend Code Integrity --
echo -e "\n${YELLOW}[1/8] Auditing Application Logic & Syntax...${RESET}"
if ! node -c "$SCRIPT_DIR/server.js" &>/dev/null; then
  echo -e "  ${RED}[x] Critical: server.js has SYNTAX ERRORS!${RESET}"
  echo -e "  [->] ALERT: Manual intervention required. Syntax check failed."
else
  echo -e "  ${GREEN}[ok]${RESET} server.js logic is syntactically valid."
fi

# -- STEP 2: Environment & Secrets Audit --
echo -e "\n${YELLOW}[2/8] Verifying Environment Configuration...${RESET}"
if [ ! -f "$SCRIPT_DIR/.env" ]; then
  echo -e "  ${RED}[x] Error: .env file is MISSING.${RESET}"
else
  CRITICAL_KEYS=("SUPABASE_URL" "SUPABASE_SERVICE_ROLE_KEY" "JWT_SECRET")
  for KEY in "${CRITICAL_KEYS[@]}"; do
    if ! grep -q "$KEY" "$SCRIPT_DIR/.env"; then
      echo -e "  ${RED}[x] Missing critical key: $KEY${RESET}"
    else
      echo -e "  ${GREEN}[ok]${RESET} Key found: $KEY"
    fi
  done
fi

# -- STEP 3: UI Build & Asset Integrity --
echo -e "\n${YELLOW}[3/8] Inspecting User Interface Assets...${RESET}"
if [ ! -d "$FRONTEND_DIST" ] || [ ! -f "$FRONTEND_DIST/index.html" ]; then
  echo -e "  ${RED}[!] UI build is INCOMPLETE or MISSING.${RESET}"
  echo -e "  [->] AUTO-FIX: Attempting to rebuild frontend assets..."
  if [ -d "$SCRIPT_DIR/frontend" ]; then
    cd "$SCRIPT_DIR/frontend" && npm install && npm run build
    cd "$SCRIPT_DIR"
    if [ -f "$FRONTEND_DIST/index.html" ]; then
      echo -e "  ${GREEN}[ok]${RESET} UI successfully rebuilt."
    else
      echo -e "  ${RED}[x] UI rebuild FAILED.${RESET}"
    fi
  else
    echo -e "  ${RED}[x] Frontend source directory missing!${RESET}"
  fi
else
  echo -e "  ${GREEN}[ok]${RESET} Frontend assets are present and ready."
fi

# -- STEP 4: Service Orchestration (PM2) --
echo -e "\n${YELLOW}[4/8] Verifying Service Status (PM2)...${RESET}"
SERVICES=("sparrowx-panel" "sparrowx-radar")
for SVC in "${SERVICES[@]}"; do
  if pm2 describe "$SVC" &>/dev/null; then
    STATUS=$(pm2 jlist | jq -r ".[] | select(.name==\"$SVC\") | .pm2_env.status")
    if [ "$STATUS" == "online" ]; then
      echo -e "  ${GREEN}[ok]${RESET} Service $SVC is ONLINE."
    else
      echo -e "  ${RED}[!] Service $SVC is $STATUS.${RESET}"
      echo -e "  [->] AUTO-FIX: Restarting $SVC..."
      pm2 restart "$SVC"
    fi
  else
    echo -e "  ${YELLOW}[?] Service $SVC is NOT MANAGED by PM2.${RESET}"
  fi
done

# -- STEP 5: Database & Local State Consistency --
echo -e "\n${YELLOW}[5/8] Auditing Tunnels & Logic State...${RESET}"
if [ ! -f "$STATE_FILE" ]; then
  echo -e "  ${RED}[x] Critical: tunnels.json missing.${RESET}"
else
  EXPECTED_COUNT=$(jq '.allocations | length' "$STATE_FILE" 2>/dev/null || echo "0")
  ACTUAL_COUNT=$(wg show interfaces | wc -l)
  if [ "$EXPECTED_COUNT" -ne "$ACTUAL_COUNT" ]; then
    echo -e "  ${RED}[!] DISCREPANCY! Attempting repair...${RESET}"
    if [ -f "$SCRIPT_DIR/repair-tunnels.sh" ]; then
        bash "$SCRIPT_DIR/repair-tunnels.sh"
    fi
  else
    echo -e "  ${GREEN}[ok]${RESET} State consistency verified ($ACTUAL_COUNT tunnels)."
  fi
fi

# -- STEP 6: Filesystem & Permissions --
echo -e "\n${YELLOW}[6/8] Verifying Storage & Log Permissions...${RESET}"
DIRS=("storage" "intel" "intel/logs" "storage/logs" "intel/brain")
for DIR in "${DIRS[@]}"; do
  FULL_PATH="$SCRIPT_DIR/$DIR"
  if [ ! -d "$FULL_PATH" ]; then
    mkdir -p "$FULL_PATH"
  fi
  if [ -w "$FULL_PATH" ]; then
    echo -e "  ${GREEN}[ok]${RESET} $DIR is writable."
  else
    chmod -R 755 "$FULL_PATH"
  fi
done

# -- STEP 7: Network & Firewall State --
echo -e "\n${YELLOW}[7/8] Verifying Kernel Data Path...${RESET}"
FORWARD_VAL=$(cat /proc/sys/net/ipv4/ip_forward)
if [ "$FORWARD_VAL" -eq 1 ]; then
  echo -e "  ${GREEN}[ok]${RESET} IP Forwarding is active."
else
  echo -e "  ${RED}[x] IP Forwarding is DISABLED.${RESET}"
  echo 1 > /proc/sys/net/ipv4/ip_forward
  sysctl -w net.ipv4.ip_forward=1 &>/dev/null
fi

# Check if NFTables is active
if systemctl is-active --quiet nftables; then
  echo -e "  ${GREEN}[ok]${RESET} nftables.service is active."
else
  echo -e "  ${RED}[!] nftables.service is INACTIVE. Starting now...${RESET}"
  systemctl start nftables
fi

# -- STEP 8: AI & Intelligence Audit (Sparrow Brain) --
echo -e "\n${YELLOW}[8/8] Auditing AI Intelligence & UI Readiness...${RESET}"
if [ ! -f "$BRAIN_REPORT" ]; then
    echo -e "  ${RED}[!] UI Alert: Brain report missing. Dashboard is 'Waiting'.${RESET}"
    echo -e "  [->] AUTO-FIX: Triggering Sparrow Brain intelligence cycle..."
    node "$SCRIPT_DIR/sparrow-brain.js" --apply &>/dev/null
    echo -e "  ${GREEN}[ok]${RESET} Intelligence applied. UI data populated."
else
    echo -e "  ${GREEN}[ok]${RESET} Sparrow Brain report is current."
fi

echo -e "\n${CYAN}=================================================================${RESET}"
echo -e "${GREEN}  MASTER INSPECTION COMPLETE: System is stabilized.${RESET}"
echo -e "${CYAN}=================================================================${RESET}\n"
