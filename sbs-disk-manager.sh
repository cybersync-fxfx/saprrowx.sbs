#!/bin/bash
# =================================================================
#   SPARROWX - LOG DISK MANAGER
#   Organises logs by month, reports disk usage, and clears
#   old month archives on demand.
#
#   Usage:
#     sudo bash sbs-disk-manager.sh              # Show status
#     sudo bash sbs-disk-manager.sh rotate       # Archive current logs by month
#     sudo bash sbs-disk-manager.sh clear 2025-03 # Delete a specific month
#     sudo bash sbs-disk-manager.sh clear-all    # Clear all archived months
#     sudo bash sbs-disk-manager.sh auto         # Full auto: rotate + clear months older than 3
# =================================================================

set -u

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
CYAN='\033[0;36m'
BOLD='\033[1m'
RESET='\033[0m'

SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" &> /dev/null && pwd )"

# Log directories to manage
LOG_DIRS=(
  "/var/log/sbs"
  "$SCRIPT_DIR/storage"
  "$SCRIPT_DIR/intel/logs"
)

# Archive root - monthly folders will live here
ARCHIVE_ROOT="/var/log/sbs/archive"
KEEP_MONTHS=3  # How many months to keep when using 'auto' mode

# ── Helpers ──────────────────────────────────────────────────────
get_month_tag() {
  # Returns YYYY-MM for a given file based on its mtime
  local file="$1"
  stat -c '%y' "$file" 2>/dev/null | awk '{print substr($1,1,7)}'
}

human_size() {
  du -sh "$1" 2>/dev/null | awk '{print $1}'
}

print_header() {
  echo -e "\n${CYAN}${BOLD}=================================================================${RESET}"
  echo -e "${CYAN}${BOLD}  SPARROWX - DISK MANAGER & LOG ROTATOR${RESET}"
  echo -e "${CYAN}${BOLD}=================================================================${RESET}\n"
}

# ── COMMAND: status ──────────────────────────────────────────────
cmd_status() {
  print_header
  echo -e "${YELLOW}[DISK USAGE]${RESET}"
  echo ""
  
  for dir in "${LOG_DIRS[@]}"; do
    if [ -d "$dir" ]; then
      SIZE=$(human_size "$dir")
      COUNT=$(find "$dir" -type f | wc -l)
      echo -e "  ${BOLD}${dir}${RESET}"
      echo -e "    Size: ${GREEN}${SIZE}${RESET} | Files: ${COUNT}"
    fi
  done

  echo ""
  echo -e "${YELLOW}[ATTACK LOG]${RESET}"
  if [ -f /var/log/sbs/attacks.log ]; then
    SIZE=$(human_size /var/log/sbs/attacks.log)
    LINES=$(wc -l < /var/log/sbs/attacks.log)
    LAST=$(tail -n 1 /var/log/sbs/attacks.log 2>/dev/null | cut -c1-80)
    echo -e "  Size: ${GREEN}${SIZE}${RESET} | Lines: ${LINES}"
    echo -e "  Last entry: ${LAST}"
  else
    echo -e "  ${YELLOW}No attack log found at /var/log/sbs/attacks.log${RESET}"
  fi

  echo ""
  echo -e "${YELLOW}[ARCHIVES BY MONTH]${RESET}"
  if [ -d "$ARCHIVE_ROOT" ] && [ "$(ls -A "$ARCHIVE_ROOT" 2>/dev/null)" ]; then
    for month_dir in "$ARCHIVE_ROOT"/*/; do
      MONTH=$(basename "$month_dir")
      SIZE=$(human_size "$month_dir")
      COUNT=$(find "$month_dir" -type f | wc -l)
      echo -e "  ${BOLD}${MONTH}${RESET}: ${GREEN}${SIZE}${RESET} (${COUNT} files)"
    done
  else
    echo -e "  No archives yet. Run 'rotate' to create them."
  fi

  echo ""
  echo -e "${YELLOW}[SYSTEM DISK]${RESET}"
  df -h / | tail -n 1 | awk '{printf "  Root: Used %s of %s (%s used)\n", $3, $2, $5}'
  df -h /var | tail -n 1 2>/dev/null | awk '{printf "  /var: Used %s of %s (%s used)\n", $3, $2, $5}'
  echo ""
}

# ── COMMAND: rotate ──────────────────────────────────────────────
cmd_rotate() {
  echo -e "\n${CYAN}[->] Rotating and archiving logs by month...${RESET}"
  mkdir -p "$ARCHIVE_ROOT"

  TOTAL_MOVED=0

  # Rotate .log and .jsonl files in managed directories
  for dir in "${LOG_DIRS[@]}"; do
    if [ ! -d "$dir" ]; then continue; fi

    find "$dir" -maxdepth 1 -type f \( -name "*.log" -o -name "*.jsonl" \) | while read -r file; do
      MONTH=$(get_month_tag "$file")
      CURRENT_MONTH=$(date +%Y-%m)
      
      # Skip current month's live files
      if [ "$MONTH" = "$CURRENT_MONTH" ]; then continue; fi
      
      if [ -z "$MONTH" ]; then continue; fi

      DEST_DIR="$ARCHIVE_ROOT/$MONTH"
      mkdir -p "$DEST_DIR"
      
      # Compress and move
      gzip -c "$file" > "$DEST_DIR/$(basename "$file").gz" && rm -f "$file"
      echo -e "  ${GREEN}[archived]${RESET} $(basename "$file") -> $DEST_DIR/"
      TOTAL_MOVED=$((TOTAL_MOVED + 1))
    done
  done

  # Rotate the main attacks.log into monthly file, keeping current entries
  if [ -f /var/log/sbs/attacks.log ]; then
    CURRENT_MONTH=$(date +%Y-%m)
    MONTH_ARCHIVE="$ARCHIVE_ROOT/$CURRENT_MONTH"
    mkdir -p "$MONTH_ARCHIVE"
    
    ROTATE_TRIGGER_MB=50  # Rotate attacks.log when it exceeds 50MB
    SIZE_KB=$(du -k /var/log/sbs/attacks.log | awk '{print $1}')
    if [ "$SIZE_KB" -gt $((ROTATE_TRIGGER_MB * 1024)) ]; then
      STAMP=$(date +%Y%m%d_%H%M%S)
      gzip -c /var/log/sbs/attacks.log > "$MONTH_ARCHIVE/attacks_${STAMP}.log.gz"
      > /var/log/sbs/attacks.log  # Truncate, don't delete
      echo -e "  ${GREEN}[rotated]${RESET} attacks.log (${SIZE_KB}KB) -> $MONTH_ARCHIVE/"
    fi
  fi

  echo -e "\n${GREEN}[ok] Rotation complete.${RESET}"
  echo -e "     Run '$(basename "$0") status' to see current disk usage.\n"
}

# ── COMMAND: clear <YYYY-MM> ─────────────────────────────────────
cmd_clear() {
  local MONTH="$1"
  if [ -z "$MONTH" ]; then
    echo -e "${RED}[x] Usage: $(basename "$0") clear YYYY-MM${RESET}"
    exit 1
  fi

  local TARGET="$ARCHIVE_ROOT/$MONTH"
  if [ ! -d "$TARGET" ]; then
    echo -e "${YELLOW}[!] No archive found for month: $MONTH${RESET}"
    exit 0
  fi

  local SIZE=$(human_size "$TARGET")
  echo -e "\n${YELLOW}[!] About to delete archive: ${BOLD}$MONTH${RESET}${YELLOW} (${SIZE})${RESET}"
  read -p "    Are you sure? Type YES to confirm: " CONFIRM
  
  if [ "$CONFIRM" = "YES" ]; then
    rm -rf "$TARGET"
    echo -e "${GREEN}[ok] Archive $MONTH deleted.${RESET}\n"
  else
    echo -e "${YELLOW}[!] Cancelled.${RESET}\n"
  fi
}

# ── COMMAND: clear-all ───────────────────────────────────────────
cmd_clear_all() {
  if [ ! -d "$ARCHIVE_ROOT" ]; then
    echo -e "${YELLOW}[!] No archive directory found.${RESET}"
    exit 0
  fi

  local SIZE=$(human_size "$ARCHIVE_ROOT")
  echo -e "\n${RED}[!] About to delete ALL log archives (${SIZE}).${RESET}"
  read -p "    Type YES to confirm: " CONFIRM

  if [ "$CONFIRM" = "YES" ]; then
    rm -rf "$ARCHIVE_ROOT"
    echo -e "${GREEN}[ok] All archives deleted.${RESET}\n"
  else
    echo -e "${YELLOW}[!] Cancelled.${RESET}\n"
  fi
}

# ── COMMAND: auto ────────────────────────────────────────────────
cmd_auto() {
  echo -e "\n${CYAN}[auto] Running full automatic disk management...${RESET}"
  
  # Step 1: Rotate old logs
  cmd_rotate_silent

  # Step 2: Delete archives older than KEEP_MONTHS
  if [ -d "$ARCHIVE_ROOT" ]; then
    CUTOFF=$(date -d "-${KEEP_MONTHS} months" +%Y-%m 2>/dev/null || \
             date -v-${KEEP_MONTHS}m +%Y-%m 2>/dev/null)  # macOS fallback
    
    for month_dir in "$ARCHIVE_ROOT"/*/; do
      MONTH=$(basename "$month_dir")
      if [[ "$MONTH" < "$CUTOFF" ]]; then
        SIZE=$(human_size "$month_dir")
        rm -rf "$month_dir"
        echo -e "  ${GREEN}[cleared]${RESET} $MONTH (${SIZE}) - older than ${KEEP_MONTHS} months"
      fi
    done
  fi

  echo -e "\n${GREEN}[ok] Auto disk management complete.${RESET}"
  
  # Show disk usage summary
  DISK_PCT=$(df / | tail -n 1 | awk '{print $5}' | tr -d '%')
  if [ "$DISK_PCT" -gt 80 ]; then
    echo -e "${RED}[!] Warning: Root disk is ${DISK_PCT}% full! Consider clearing more archives.${RESET}\n"
  else
    echo -e "${GREEN}[ok] Disk usage: ${DISK_PCT}%${RESET}\n"
  fi
}

cmd_rotate_silent() {
  mkdir -p "$ARCHIVE_ROOT"
  for dir in "${LOG_DIRS[@]}"; do
    if [ ! -d "$dir" ]; then continue; fi
    find "$dir" -maxdepth 1 -type f \( -name "*.log" -o -name "*.jsonl" \) | while read -r file; do
      MONTH=$(get_month_tag "$file")
      CURRENT_MONTH=$(date +%Y-%m)
      if [ "$MONTH" = "$CURRENT_MONTH" ] || [ -z "$MONTH" ]; then continue; fi
      DEST_DIR="$ARCHIVE_ROOT/$MONTH"
      mkdir -p "$DEST_DIR"
      gzip -c "$file" > "$DEST_DIR/$(basename "$file").gz" && rm -f "$file"
      echo -e "  ${GREEN}[archived]${RESET} $(basename "$file") -> $DEST_DIR/"
    done
  done
}

# ── Install as monthly cron ───────────────────────────────────────
cmd_install_cron() {
  local CRON_LINE="0 3 1 * * root bash $SCRIPT_DIR/sbs-disk-manager.sh auto >> /var/log/sbs/disk-manager.log 2>&1"
  local CRON_FILE="/etc/cron.d/sparrowx-disk-manager"
  echo "$CRON_LINE" > "$CRON_FILE"
  chmod 644 "$CRON_FILE"
  echo -e "${GREEN}[ok] Cron installed: runs on the 1st of every month at 3am.${RESET}"
  echo -e "     File: $CRON_FILE"
}

# ── Entrypoint ───────────────────────────────────────────────────
if [ "$EUID" -ne 0 ]; then
  echo -e "${RED}[x] Please run as root: sudo bash sbs-disk-manager.sh${RESET}"
  exit 1
fi

COMMAND="${1:-status}"

case "$COMMAND" in
  status)       cmd_status ;;
  rotate)       cmd_rotate ;;
  clear)        cmd_clear "${2:-}" ;;
  clear-all)    cmd_clear_all ;;
  auto)         cmd_auto ;;
  install-cron) cmd_install_cron ;;
  *)
    echo -e "${YELLOW}Commands: status | rotate | clear YYYY-MM | clear-all | auto | install-cron${RESET}"
    exit 1
    ;;
esac
