#!/bin/bash
# =================================================================
#   SPARROW — Unified Control Tool for SparrowX Infrastructure
#
#   Usage:
#     sparrow                  → Interactive menu
#     sparrow audit            → Audit & auto-fix infra
#     sparrow harden           → Harden guard server
#     sparrow inspect          → Inspect dashboard data integrity
#     sparrow disk             → Disk & log manager
#     sparrow disk rotate      → Rotate logs by month
#     sparrow disk clear YYYY-MM → Clear a month's archive
#     sparrow disk auto        → Auto rotate + clear old months
#     sparrow tunnel repair    → Repair broken tunnels
#     sparrow tunnel restore   → Restore tunnels after reboot
#     sparrow admin            → Admin panel (users/keys)
#     sparrow update           → Update the panel & agent
#     sparrow cli              → Agent & firewall CLI
#     sparrow brain            → Chat with Sparrow Brain (NLP AI)
#     sparrow brain analyze    → Run brain learning cycle
#     sparrow setup            → Initial guard setup
#     sparrow help             → Show this help
# =================================================================

SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" &> /dev/null && pwd )"

# ── Colors ────────────────────────────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[0;33m'
CYAN='\033[0;36m'; BOLD='\033[1m'; DIM='\033[2m'; RESET='\033[0m'

# ── Banner ────────────────────────────────────────────────────────
banner() {
  clear
  echo -e "${CYAN}${BOLD}"
  echo "  ███████╗██████╗  █████╗ ██████╗ ██████╗  ██████╗ ██╗    ██╗"
  echo "  ██╔════╝██╔══██╗██╔══██╗██╔══██╗██╔══██╗██╔═══██╗██║    ██║"
  echo "  ███████╗██████╔╝███████║██████╔╝██████╔╝██║   ██║██║ █╗ ██║"
  echo "  ╚════██║██╔═══╝ ██╔══██║██╔══██╗██╔══██╗██║   ██║██║███╗██║"
  echo "  ███████║██║     ██║  ██║██║  ██║██║  ██║╚██████╔╝╚███╔███╔╝"
  echo "  ╚══════╝╚═╝     ╚═╝  ╚═╝╚═╝  ╚═╝╚═╝  ╚═╝ ╚═════╝  ╚══╝╚══╝"
  echo -e "${RESET}"
  echo -e "  ${DIM}Autonomous Infrastructure Guard — Unified Control Tool${RESET}"
  echo -e "  ${DIM}$(date '+%A, %B %d %Y  %H:%M:%S')${RESET}"
  echo ""
}

# ── Helper: run a sub-script ─────────────────────────────────────
run_script() {
  local script="$SCRIPT_DIR/$1"
  shift
  if [ ! -f "$script" ]; then
    echo -e "${RED}[x] Script not found: $script${RESET}"
    return 1
  fi
  bash "$script" "$@"
}

# ── Helper: check root ───────────────────────────────────────────
need_root() {
  if [ "$EUID" -ne 0 ]; then
    echo -e "${RED}[x] This command requires root. Run: sudo sparrow $*${RESET}"
    exit 1
  fi
}

# ── Menu display ──────────────────────────────────────────────────
show_menu() {
  echo -e "${CYAN}${BOLD}  ── SECURITY ─────────────────────────────────────${RESET}"
  echo -e "  ${GREEN}[1]${RESET} ${BOLD}Audit & Auto-Fix${RESET}         ${DIM}Full infra health check${RESET}"
  echo -e "  ${GREEN}[2]${RESET} ${BOLD}Harden Guard${RESET}             ${DIM}Apply security hardening${RESET}"
  echo -e "  ${GREEN}[3]${RESET} ${BOLD}Inspect Dashboard${RESET}        ${DIM}Verify dashboard data accuracy${RESET}"
  echo ""
  echo -e "${CYAN}${BOLD}  ── TUNNELS ───────────────────────────────────────${RESET}"
  echo -e "  ${GREEN}[4]${RESET} ${BOLD}Repair Tunnels${RESET}           ${DIM}Fix broken WireGuard tunnels${RESET}"
  echo -e "  ${GREEN}[5]${RESET} ${BOLD}Restore Tunnels${RESET}          ${DIM}Restore tunnels after reboot${RESET}"
  echo ""
  echo -e "${CYAN}${BOLD}  ── SYSTEM ────────────────────────────────────────${RESET}"
  echo -e "  ${GREEN}[6]${RESET} ${BOLD}Disk Manager${RESET}             ${DIM}Log rotation & storage cleanup${RESET}"
  echo -e "  ${GREEN}[7]${RESET} ${BOLD}Update Panel & Agent${RESET}     ${DIM}Pull latest code and restart${RESET}"
  echo -e "  ${GREEN}[8]${RESET} ${BOLD}Admin Panel${RESET}              ${DIM}Manage users, keys, agents${RESET}"
  echo -e "  ${GREEN}[9]${RESET} ${BOLD}Agent CLI${RESET}                ${DIM}Firewall & connected agent tools${RESET}"
  echo ""
  echo -e "${CYAN}${BOLD}  ── INTELLIGENCE ──────────────────────────────────${RESET}"
  echo -e "  ${GREEN}[10]${RESET} ${BOLD}Sparrow Brain (Chat)${RESET}    ${DIM}Talk to local NLP threat AI${RESET}"
  echo -e "  ${GREEN}[11]${RESET} ${BOLD}Brain Analyze${RESET}           ${DIM}Run AI learning cycle on logs${RESET}"
  echo ""
  echo -e "${CYAN}${BOLD}  ── SETUP ─────────────────────────────────────────${RESET}"
  echo -e "  ${GREEN}[12]${RESET} ${BOLD}Initial Guard Setup${RESET}     ${DIM}Bootstrap a fresh guard server${RESET}"
  echo ""
  echo -e "  ${RED}[0]${RESET} Exit"
  echo ""
  echo -ne "  ${BOLD}Choose an option:${RESET} "
}

# ── Dispatch sub-commands ─────────────────────────────────────────
do_command() {
  local cmd="$1"
  shift
  case "$cmd" in

    audit)
      need_root audit
      run_script audit-infra.sh "$@"
      ;;

    harden)
      need_root harden
      run_script harden-guard.sh "$@"
      ;;

    inspect)
      need_root inspect
      run_script sbs-inspector.sh "$@"
      ;;

    tunnel)
      need_root tunnel
      local sub="${1:-}"; shift 2>/dev/null || true
      case "$sub" in
        repair)  run_script repair-tunnels.sh ;;
        restore) run_script restore-tunnels.sh ;;
        *)
          echo -e "${YELLOW}Usage: sparrow tunnel repair | restore${RESET}"
          ;;
      esac
      ;;

    disk)
      need_root disk
      local sub="${1:-status}"; shift 2>/dev/null || true
      run_script sbs-disk-manager.sh "$sub" "$@"
      ;;

    update)
      run_script sbs-update.sh "$@"
      ;;

    admin)
      run_script sbs-admin.sh "$@"
      ;;

    cli)
      run_script sbs-cli.sh "$@"
      ;;

    brain)
      local sub="${1:-chat}"; shift 2>/dev/null || true
      case "$sub" in
        analyze|learn|train)
          echo -e "${CYAN}[Brain] Running learning cycle...${RESET}"
          node "$SCRIPT_DIR/sparrow-brain.js" --apply
          ;;
        chat|*)
          node "$SCRIPT_DIR/sparrow-brain-chat.js"
          ;;
      esac
      ;;

    setup)
      need_root setup
      run_script setup-guard.sh "$@"
      ;;

    help|--help|-h)
      echo -e "${CYAN}${BOLD}  Sparrow — Unified Control Tool${RESET}"
      echo ""
      echo -e "  ${BOLD}sparrow${RESET}                   Interactive menu"
      echo -e "  ${BOLD}sparrow audit${RESET}             Audit & auto-fix infrastructure"
      echo -e "  ${BOLD}sparrow harden${RESET}            Apply security hardening"
      echo -e "  ${BOLD}sparrow inspect${RESET}           Inspect dashboard data integrity"
      echo -e "  ${BOLD}sparrow tunnel repair${RESET}     Repair broken tunnels"
      echo -e "  ${BOLD}sparrow tunnel restore${RESET}    Restore tunnels after reboot"
      echo -e "  ${BOLD}sparrow disk${RESET}              Disk manager (status)"
      echo -e "  ${BOLD}sparrow disk rotate${RESET}       Archive old logs by month"
      echo -e "  ${BOLD}sparrow disk auto${RESET}         Auto rotate + clear old months"
      echo -e "  ${BOLD}sparrow disk clear YYYY-MM${RESET}  Delete a month's archive"
      echo -e "  ${BOLD}sparrow update${RESET}            Update panel & agent"
      echo -e "  ${BOLD}sparrow admin${RESET}             Admin panel"
      echo -e "  ${BOLD}sparrow cli${RESET}               Agent & firewall CLI"
      echo -e "  ${BOLD}sparrow brain${RESET}             Chat with Sparrow Brain AI"
      echo -e "  ${BOLD}sparrow brain analyze${RESET}     Run AI learning cycle"
      echo -e "  ${BOLD}sparrow setup${RESET}             Initial guard setup"
      echo ""
      ;;

    *)
      echo -e "${RED}[x] Unknown command: $cmd${RESET}"
      echo -e "    Run ${BOLD}sparrow help${RESET} to see all commands."
      exit 1
      ;;
  esac
}

# ── Interactive menu loop ─────────────────────────────────────────
interactive_menu() {
  while true; do
    banner
    show_menu
    read -r choice

    echo ""
    case "$choice" in
      1)  need_root audit;    run_script audit-infra.sh   ;;
      2)  need_root harden;   run_script harden-guard.sh  ;;
      3)  need_root inspect;  run_script sbs-inspector.sh ;;
      4)  need_root tunnel;   run_script repair-tunnels.sh  ;;
      5)  need_root tunnel;   run_script restore-tunnels.sh ;;
      6)
        echo -e "${CYAN}Disk Manager — enter sub-command (status/rotate/auto/clear YYYY-MM):${RESET} "
        read -r diskcmd
        need_root disk
        run_script sbs-disk-manager.sh ${diskcmd:-status}
        ;;
      7)  run_script sbs-update.sh ;;
      8)  run_script sbs-admin.sh  ;;
      9)  run_script sbs-cli.sh    ;;
      10) node "$SCRIPT_DIR/sparrow-brain-chat.js" ;;
      11)
        echo -e "${CYAN}[Brain] Running learning cycle...${RESET}"
        node "$SCRIPT_DIR/sparrow-brain.js" --apply
        ;;
      12) need_root setup; run_script setup-guard.sh ;;
      0|exit|quit|q)
        echo -e "${GREEN}  Goodbye. Stay protected.${RESET}\n"
        exit 0
        ;;
      *)
        echo -e "${YELLOW}  Invalid option. Press Enter to try again.${RESET}"
        ;;
    esac

    echo ""
    echo -ne "${DIM}  Press Enter to return to menu...${RESET}"
    read -r
  done
}

# ── Entry point ───────────────────────────────────────────────────
if [ $# -eq 0 ]; then
  interactive_menu
else
  do_command "$@"
fi
