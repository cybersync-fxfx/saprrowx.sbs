#!/bin/bash
# =================================================================
#  SPARROWX — Security Watchdog
#  Monitors the 4-layer defense stack and auto-heals
# =================================================================

SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
source "$SCRIPT_DIR/.env" 2>/dev/null

LOG_FILE="/var/log/sbs/watchdog.log"
mkdir -p /var/log/sbs

# ── Discord Helper ───────────────────────────────────────────────
send_discord() {
  local msg="$1"
  if [ -n "${DISCORD_WEBHOOK_URL:-}" ]; then
    curl -H "Content-Type: application/json" -X POST -d "{\"content\": \"$msg\"}" "$DISCORD_WEBHOOK_URL" >/dev/null 2>&1
  fi
}

# ── Checks ────────────────────────────────────────────────────────
echo "[$(date)] Watchdog running..." >> "$LOG_FILE"

ERRORS=()

# 1. Check Panel
if ! curl -s http://localhost:${PORT:-3001}/api/health > /dev/null; then
  ERRORS+=("Panel API is unreachable (port ${PORT:-3001})")
  pm2 restart all >> "$LOG_FILE" 2>&1
fi

# 2. Check nftables
if ! nft list ruleset | grep -q "sparrowx_shield"; then
  ERRORS+=("nftables SparrowX ruleset is missing")
  nft -f /etc/nftables.conf >> "$LOG_FILE" 2>&1
fi

# 3. Check HAProxy
if ! systemctl is-active --quiet haproxy; then
  ERRORS+=("HAProxy service is down")
  systemctl restart haproxy >> "$LOG_FILE" 2>&1
fi

# 4. Check FastNetMon
if ! systemctl is-active --quiet fastnetmon; then
  ERRORS+=("FastNetMon service is down")
  systemctl restart fastnetmon >> "$LOG_FILE" 2>&1
fi

# 5. Check XDP
IFACE=$(ip route | grep default | awk '{print $5}' | head -1)
if ! ip link show "$IFACE" | grep -q "xdp"; then
  # We don't auto-fix XDP here as it might need compilation, just warn
  ERRORS+=("XDP is not attached to $IFACE")
fi

# ── Reporting ─────────────────────────────────────────────────────
if [ ${#ERRORS[@]} -gt 0 ]; then
  MSG="⚠️ **SparrowX Watchdog Alert**\n"
  for err in "${ERRORS[@]}"; do
    MSG="$MSG - $err\n"
    echo "[!] $err" >> "$LOG_FILE"
  done
  MSG="$MSG\n🛠️ *Watchdog attempted automated recovery.*"
  send_discord "$MSG"
else
  echo "[✓] All systems green" >> "$LOG_FILE"
fi
