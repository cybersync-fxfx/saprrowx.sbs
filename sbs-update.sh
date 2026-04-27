#!/bin/bash
# ============================================================
#   Sparrowx - Client Updater
#   Run:  sudo bash sbs-update.sh
# ============================================================

set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
CYAN='\033[0;36m'
YELLOW='\033[1;33m'
BOLD='\033[1m'
RESET='\033[0m'

# -- CONFIG ----------------------------------------------------
# Change this to your actual Sparrowx dashboard / CDN URL where the
# latest agent bundle lives.
SPARROWX_UPDATE_URL="https://raw.githubusercontent.com/cybersync-fxfx/sbs.detriot/main/agent/sbs-agent.sh"
INSTALL_DIR="/opt/sbs-agent"
AGENT_SCRIPT="$INSTALL_DIR/sbs-agent.sh"
SERVICE_NAME="sbs-agent"
BACKUP_DIR="$INSTALL_DIR/backups"
VERSION_FILE="$INSTALL_DIR/.version"
# -------------------------------------------------------------

# Root check
if [ "$EUID" -ne 0 ]; then
  echo -e "${RED}[x] Please run as root: sudo bash sbs-update.sh${RESET}"
  exit 1
fi

echo ""
echo -e "${CYAN}${BOLD}============================================${RESET}"
echo -e "${CYAN}${BOLD}    SPARROWX - Agent Updater v1.0        ${RESET}"
echo -e "${CYAN}${BOLD}============================================${RESET}"
echo ""

# Show current version
CURRENT_VERSION="unknown"
if [ -f "$VERSION_FILE" ]; then
  CURRENT_VERSION=$(cat "$VERSION_FILE")
fi
echo -e "${YELLOW}[i] Current installed version: ${BOLD}$CURRENT_VERSION${RESET}"
echo ""

# -- STEP 1: Download latest agent ----------------------------
echo -e "${CYAN}[1/4] Downloading latest Sparrowx agent...${RESET}"
TMP_FILE=$(mktemp /tmp/sbs-agent-XXXXXX.sh)

if ! curl -fsSL "$SPARROWX_UPDATE_URL" -o "$TMP_FILE"; then
  echo -e "${RED}[x] Failed to download update from:${RESET}"
  echo -e "     $SPARROWX_UPDATE_URL"
  echo -e "${YELLOW}[!] Check your internet connection or the update URL.${RESET}"
  rm -f "$TMP_FILE"
  exit 1
fi

# Sanity check - make sure the download isn't an HTML error page
if grep -q "404: Not Found" "$TMP_FILE" 2>/dev/null; then
  echo -e "${RED}[x] Update URL returned 404. Check SPARROWX_UPDATE_URL in this script.${RESET}"
  rm -f "$TMP_FILE"
  exit 1
fi

echo -e "${GREEN}[ok] Download complete.${RESET}"

# -- STEP 2: Backup current agent -----------------------------
echo -e "${CYAN}[2/4] Backing up current agent...${RESET}"
mkdir -p "$BACKUP_DIR"

if [ -f "$AGENT_SCRIPT" ]; then
  BACKUP_PATH="$BACKUP_DIR/sbs-agent.$(date +%Y%m%d_%H%M%S).sh.bak"
  cp "$AGENT_SCRIPT" "$BACKUP_PATH"
  echo -e "${GREEN}[ok] Backup saved -> $BACKUP_PATH${RESET}"
else
  echo -e "${YELLOW}[!] No existing agent found - fresh install.${RESET}"
fi

# -- STEP 3: Install new agent --------------------------------
echo -e "${CYAN}[3/4] Installing new agent...${RESET}"
mkdir -p "$INSTALL_DIR"
cp "$TMP_FILE" "$AGENT_SCRIPT"
chmod +x "$AGENT_SCRIPT"
rm -f "$TMP_FILE"

# Extract and save new version from the script header (# VERSION: x.x.x)
NEW_VERSION=$(grep -m1 '^# VERSION:' "$AGENT_SCRIPT" | awk '{print $3}')
if [ -n "$NEW_VERSION" ]; then
  echo "$NEW_VERSION" > "$VERSION_FILE"
  echo -e "${GREEN}[ok] Installed version: ${BOLD}$NEW_VERSION${RESET}"
else
  echo -e "${YELLOW}[!] Could not detect version tag in agent script.${RESET}"
fi

# -- STEP 4: Restart agent service ----------------------------
echo -e "${CYAN}[4/4] Restarting Sparrowx agent service...${RESET}"

if systemctl list-units --type=service | grep -q "$SERVICE_NAME"; then
  systemctl restart "$SERVICE_NAME"
  sleep 2
  if systemctl is-active --quiet "$SERVICE_NAME"; then
    echo -e "${GREEN}[ok] Service '${SERVICE_NAME}' is running.${RESET}"
  else
    echo -e "${RED}[x] Service '${SERVICE_NAME}' failed to start.${RESET}"
    echo -e "${YELLOW}    Check logs: journalctl -u $SERVICE_NAME -n 50 --no-pager${RESET}"
    exit 1
  fi
else
  echo -e "${YELLOW}[!] Systemd service '${SERVICE_NAME}' not found.${RESET}"
  echo -e "    To register it, run: sudo bash $AGENT_SCRIPT --install"
fi

echo ""
echo -e "${GREEN}${BOLD}============================================${RESET}"
echo -e "${GREEN}${BOLD}  Update complete! ok                        ${RESET}"
echo -e "${GREEN}${BOLD}  Sparrowx Agent is up-to-date and running.      ${RESET}"
echo -e "${GREEN}${BOLD}============================================${RESET}"
echo ""
