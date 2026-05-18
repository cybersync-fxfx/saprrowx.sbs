#!/bin/bash
# =================================================================
#  SPARROWX — Universal Auto-Setup Installer (PRO VERSION)
#  Works on: Ubuntu 20.04+ / Debian 11+
#
#  Usage: sudo bash sparrow-setup.sh
# =================================================================
set -u
set -o pipefail

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[0;33m'
CYAN='\033[0;36m'; BOLD='\033[1m'; DIM='\033[2m'; RESET='\033[0m'

SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
LOG_FILE="$SCRIPT_DIR/setup.log"
declare -a WARNINGS=()

# ── Helpers ───────────────────────────────────────────────────────
log()  { echo -e "$1" | tee -a "$LOG_FILE"; }
ok()   { log "${GREEN}[✓] $1${RESET}"; }
info() { log "${CYAN}[→] $1${RESET}"; }
warn() { WARNINGS+=("$1"); log "${YELLOW}[!] $1${RESET}"; }
err()  { log "${RED}[✗] $1${RESET}"; }
ask()  { echo -ne "${BOLD}$1${RESET} "; read -r "$2"; }
askd() { echo -ne "${BOLD}$1${RESET} ${DIM}[${3}]${RESET} "; read -r "$2"; eval "$2=\${$2:-$3}"; }

apt_install_required() {
  local label="$1"
  shift

  if DEBIAN_FRONTEND=noninteractive apt-get install -y -qq "$@" >> "$LOG_FILE" 2>&1; then
    ok "$label installed"
    return 0
  fi

  err "$label install failed. Last package-manager output:"
  tail -n 30 "$LOG_FILE" | sed 's/^/    /'
  exit 1
}

apt_install_if_available() {
  local label="$1"
  shift
  local package

  for package in "$@"; do
    if ! apt-cache show "$package" >/dev/null 2>&1; then
      return 2
    fi
  done

  if DEBIAN_FRONTEND=noninteractive apt-get install -y -qq "$@" >> "$LOG_FILE" 2>&1; then
    ok "$label installed"
    return 0
  fi

  return 1
}

link_linux_tools_bpftool() {
  local bpftool_path
  bpftool_path="$(find /usr/lib/linux-tools -type f -name bpftool 2>/dev/null | sort -V | tail -n 1 || true)"

  if [ -n "$bpftool_path" ]; then
    ln -sf "$bpftool_path" /usr/local/sbin/bpftool
    hash -r
  fi
}

install_bpftool() {
  if command -v bpftool >/dev/null 2>&1; then
    ok "bpftool available"
    return 0
  fi

  if apt_install_if_available "bpftool" bpftool; then
    return 0
  fi

  if apt_install_if_available "kernel bpftool tools" "linux-tools-$(uname -r)" linux-tools-common; then
    link_linux_tools_bpftool
  fi

  if ! command -v bpftool >/dev/null 2>&1 && apt_install_if_available "generic kernel bpftool tools" linux-tools-generic linux-tools-common; then
    link_linux_tools_bpftool
  fi

  if command -v bpftool >/dev/null 2>&1; then
    ok "bpftool available"
    return 0
  fi

  warn "bpftool is not available from the enabled apt repositories; XDP blacklist sync will be skipped until bpftool is installed."
  return 1
}

systemd_unit_exists() {
  systemctl cat "$1" >/dev/null 2>&1
}

ensure_installer_permissions() {
  local script
  local executable_scripts=(
    "$SCRIPT_DIR/sparrow.sh"
    "$SCRIPT_DIR/sbs-admin.sh"
    "$SCRIPT_DIR/sbs-cli.sh"
    "$SCRIPT_DIR/sbs-disk-manager.sh"
    "$SCRIPT_DIR/sbs-inspector.sh"
    "$SCRIPT_DIR/sbs-update.sh"
    "$SCRIPT_DIR/sbs-watchdog.sh"
    "$SCRIPT_DIR/setup-guard.sh"
    "$SCRIPT_DIR/harden-guard.sh"
    "$SCRIPT_DIR/audit-infra.sh"
    "$SCRIPT_DIR/tunnel-manager.sh"
    "$SCRIPT_DIR/repair-tunnels.sh"
    "$SCRIPT_DIR/restore-tunnels.sh"
    "$SCRIPT_DIR/sparrow-apply-config.sh"
    "$SCRIPT_DIR/sparrow-attack-test.sh"
    "$SCRIPT_DIR/sparrow-healthfix.sh"
    "$SCRIPT_DIR/sparrow-setup.sh"
    "$SCRIPT_DIR/xdp/load_xdp.sh"
    "$SCRIPT_DIR/xdp/sync_blocklist.sh"
    "$SCRIPT_DIR/configs/fastnetmon-notify.sh"
  )

  mkdir -p /usr/local/bin /usr/local/sbin /var/log/sbs
  chmod 0755 /usr/local/bin /usr/local/sbin /var/log/sbs

  for script in "${executable_scripts[@]}"; do
    if [ -f "$script" ]; then
      chmod 0755 "$script"
    fi
  done

  find "$SCRIPT_DIR" -maxdepth 2 -type d -exec chmod 0755 {} \; 2>/dev/null || true
  ok "Command permissions normalized"
}

banner() {
  clear
  echo -e "${CYAN}${BOLD}"
  echo "  ╔══════════════════════════════════════════════════════╗"
  echo "  ║     SPARROWX — Universal Defense Stack Installer     ║"
  echo "  ║     Status: Automated / Multi-Layer / Self-Healing   ║"
  echo "  ╚══════════════════════════════════════════════════════╝"
  echo -e "${RESET}"
}

step() {
  echo ""
  echo -e "${CYAN}${BOLD}━━━ $1 ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}"
}

# ── Root check ────────────────────────────────────────────────────
if [ "$EUID" -ne 0 ]; then
  echo -e "${RED}Please run as root: sudo bash sparrow-setup.sh${RESET}"
  exit 1
fi

banner

# ── OS Detection ──────────────────────────────────────────────────
step "Detecting System"
OS_ID=$(grep '^ID=' /etc/os-release | cut -d= -f2 | tr -d '"')
OS_VER=$(grep '^VERSION_ID=' /etc/os-release | cut -d= -f2 | tr -d '"')
KERNEL=$(uname -r)
ARCH=$(uname -m)
IFACE=$(ip -4 route show default 2>/dev/null | awk '{print $5}' | head -1)
if [ -z "$IFACE" ]; then
  IFACE=$(ip -6 route show default 2>/dev/null | awk '{print $5}' | head -1)
fi
SERVER_IP=$(curl -s ifconfig.me 2>/dev/null || hostname -I | awk '{print $1}')
RAM_GB=$(awk '/MemTotal/ {printf "%.0f", $2/1024/1024}' /proc/meminfo)
CPU_CORES=$(nproc)
KERNEL_MAJOR=$(echo "$KERNEL" | cut -d. -f1)
KERNEL_MINOR=$(echo "$KERNEL" | cut -d. -f2)

ok "OS: $OS_ID $OS_VER"
ok "Kernel: $KERNEL"
if [ -z "$IFACE" ]; then
  err "Could not detect the default network interface"
  exit 1
fi
ok "Interface: $IFACE | IP: $SERVER_IP"
ok "Resources: ${CPU_CORES} cores / ${RAM_GB}GB RAM"

# XDP support check (kernel >= 5.6)
XDP_SUPPORTED=false
if [ "$KERNEL_MAJOR" -gt 5 ] || { [ "$KERNEL_MAJOR" -eq 5 ] && [ "$KERNEL_MINOR" -ge 6 ]; }; then
  XDP_SUPPORTED=true
  ok "XDP/eBPF: Supported"
else
  warn "XDP/eBPF: NOT supported (kernel $KERNEL below 5.6)"
fi

# ── Gather Config ─────────────────────────────────────────────────
step "Configuration Questions"
echo -e "${DIM}Press Enter to accept the default value shown in [brackets]${RESET}"
echo ""

askd "Panel domain (e.g. panel.sparrowx.net):"    DOMAIN         "localhost"
askd "Panel port:"                                 PANEL_PORT     "3001"
askd "Discord webhook URL (for alerts):"           DISCORD_URL    ""
askd "Admin email:"                                ADMIN_EMAIL    "admin@localhost"

echo ""
info "Starting automated deployment..."
sleep 1

ensure_installer_permissions

# ── System Update & Base Packages ────────────────────────────────
step "Installing Dependencies"
if ! apt-get update -qq >> "$LOG_FILE" 2>&1; then
  err "apt update failed. Last package-manager output:"
  tail -n 30 "$LOG_FILE" | sed 's/^/    /'
  exit 1
fi

apt_install_required "Required system packages" \
  ca-certificates curl wget git unzip jq net-tools iproute2 \
  nftables wireguard haproxy \
  build-essential clang llvm libelf-dev libbpf-dev

if ! apt_install_if_available "Matching kernel headers" "linux-headers-$(uname -r)"; then
  warn "Matching headers for the running kernel ($(uname -r)) are unavailable. If XDP compilation fails, reboot into the latest installed kernel and rerun setup."
fi

install_bpftool || true

# Node.js
if ! command -v node &>/dev/null; then
  if ! curl -fsSL https://deb.nodesource.com/setup_20.x | bash - >> "$LOG_FILE" 2>&1; then
    err "NodeSource repository setup failed"
    exit 1
  fi
  apt_install_required "Node.js" nodejs
fi
if ! command -v node &>/dev/null; then
  err "Node.js command is still unavailable after installation"
  exit 1
fi
ok "Node.js $(node -v)"

# PM2
if ! command -v pm2 &>/dev/null; then
  if ! npm install -g pm2 --silent >> "$LOG_FILE" 2>&1; then
    err "PM2 install failed"
    exit 1
  fi
fi
ok "PM2 installed"

# ── Local Supabase Database Setup ─────────────────────────────────
step "Local Supabase Database Setup"
if ! command -v docker &>/dev/null; then
  info "Installing Docker..."
  if ! curl -fsSL https://get.docker.com | sh >> "$LOG_FILE" 2>&1; then
    err "Docker install failed"
    exit 1
  fi
  if ! systemctl enable --now docker >> "$LOG_FILE" 2>&1; then
    err "Docker service failed to start"
    exit 1
  fi
fi

if [ ! -d "/opt/supabase" ]; then
  info "Cloning Supabase locally..."
  rm -rf /opt/supabase-source
  git clone --depth 1 https://github.com/supabase/supabase /opt/supabase-source >> "$LOG_FILE" 2>&1 || { err "Supabase clone failed"; exit 1; }
  mkdir -p /opt/supabase
  cp -rf /opt/supabase-source/docker/* /opt/supabase/
  cp /opt/supabase-source/docker/.env.example /opt/supabase/.env
  
  cd /opt/supabase
  # Update ports to bind to localhost
  sed -i 's/KONG_HTTP_PORT=8000/KONG_HTTP_PORT=127.0.0.1:8000/g' .env
  sed -i 's/KONG_HTTPS_PORT=8443/KONG_HTTPS_PORT=127.0.0.1:8443/g' .env
  sed -i 's/POSTGRES_PORT=5432/POSTGRES_PORT=127.0.0.1:5432/g' .env
  sed -i 's/POOLER_PROXY_PORT_TRANSACTION=6543/POOLER_PROXY_PORT_TRANSACTION=127.0.0.1:6543/g' .env
  
  info "Configuring secrets..."
  DB_PASS=$(openssl rand -hex 16)
  JWT_SECRET=$(openssl rand -hex 32)
  sed -i "s/POSTGRES_PASSWORD=your-super-secret-and-long-postgres-password/POSTGRES_PASSWORD=$DB_PASS/g" .env
  sed -i "s/JWT_SECRET=your-super-secret-jwt-token-with-at-least-32-characters-long/JWT_SECRET=$JWT_SECRET/g" .env
  
  if [ -f "./utils/generate-keys.sh" ]; then
    bash ./utils/generate-keys.sh >> "$LOG_FILE" 2>&1 || true
  fi
  
  info "Starting local Supabase (this will take a few minutes)..."
  docker compose pull >> "$LOG_FILE" 2>&1 || { err "Supabase Docker image pull failed"; exit 1; }
  docker compose up -d >> "$LOG_FILE" 2>&1 || { err "Supabase Docker startup failed"; exit 1; }
  
  info "Waiting for database to initialize..."
  sleep 45
  
  info "Applying SparrowX database schema..."
  docker compose exec -T db psql -U postgres -d postgres < "$SCRIPT_DIR/supabase_setup.sql" >> "$LOG_FILE" 2>&1 || { err "Core database schema apply failed"; exit 1; }
  docker compose exec -T db psql -U postgres -d postgres < "$SCRIPT_DIR/supabase_threat_radar.sql" >> "$LOG_FILE" 2>&1 || { err "Threat radar schema apply failed"; exit 1; }
  ok "Local Supabase setup completed successfully"
else
  ok "Local Supabase is already installed in /opt/supabase"
fi

cd /opt/supabase
SUPABASE_URL="http://127.0.0.1:8000"
SUPABASE_ANON=$(grep -E "^ANON_KEY=" .env | cut -d '=' -f2 | tr -d '"\r' | tail -n 1)
SUPABASE_SVC=$(grep -E "^SERVICE_ROLE_KEY=" .env | cut -d '=' -f2 | tr -d '"\r' | tail -n 1)
cd "$SCRIPT_DIR"

if [ -z "$SUPABASE_ANON" ] || [ -z "$SUPABASE_SVC" ]; then
  warn "Failed to extract Supabase keys, check /opt/supabase/.env!"
fi

# ── Write .env ────────────────────────────────────────────────────
step "Configuring Environment"
cat > "$SCRIPT_DIR/.env" <<EOF
# Auto-generated by sparrow-setup.sh on $(date)
SUPABASE_URL=${SUPABASE_URL}
SUPABASE_ANON_KEY=${SUPABASE_ANON}
SUPABASE_SERVICE_KEY=${SUPABASE_SVC}
SPARROWX_DOMAIN=${DOMAIN}
PORT=${PANEL_PORT}
ADMIN_EMAIL=${ADMIN_EMAIL}
DISCORD_WEBHOOK_URL=${DISCORD_URL}
NODE_ENV=production
EOF
ok ".env file written"

# ── Layer 2: nftables ─────────────────────────────────────────────
step "Layer 2: Setting Up nftables"
if [ -f "$SCRIPT_DIR/configs/nftables-sparrowx.conf" ]; then
  sed "s/IFACE_PLACEHOLDER/$IFACE/g" "$SCRIPT_DIR/configs/nftables-sparrowx.conf" > /etc/nftables.conf.sparrowx
  # Non-destructive include
  if ! grep -q "nftables.conf.sparrowx" /etc/nftables.conf; then
     echo "include \"/etc/nftables.conf.sparrowx\"" >> /etc/nftables.conf
  fi
  nft -f /etc/nftables.conf.sparrowx 2>>"$LOG_FILE" && ok "Rules applied" || warn "Rules failed"
else
  warn "nftables config source missing"
fi

# ── sysctl: Hardening ─────────────────────────────────────────────
step "Layer 2: Kernel Hardening"
if [ -f "$SCRIPT_DIR/configs/sysctl-sparrowx.conf" ]; then
  cp "$SCRIPT_DIR/configs/sysctl-sparrowx.conf" /etc/sysctl.d/99-sparrowx.conf
  sysctl -p /etc/sysctl.d/99-sparrowx.conf >> "$LOG_FILE" 2>&1 && ok "Kernel hardened"
fi

# ── Layer 3: HAProxy ─────────────────────────────────────────────
step "Layer 3: HAProxy WAF"
mkdir -p /etc/haproxy/certs
if [ -f "$SCRIPT_DIR/configs/haproxy.cfg" ]; then
  sed "s/PANEL_PORT_PLACEHOLDER/$PANEL_PORT/g" "$SCRIPT_DIR/configs/haproxy.cfg" > /etc/haproxy/haproxy.cfg
  if ! command -v haproxy >/dev/null 2>&1 || ! systemd_unit_exists haproxy.service; then
    warn "HAProxy package or service is missing; skipping HAProxy startup."
  elif ! haproxy -c -f /etc/haproxy/haproxy.cfg >> "$LOG_FILE" 2>&1; then
    warn "HAProxy config validation failed; check $LOG_FILE."
  elif systemctl enable --now haproxy >> "$LOG_FILE" 2>&1; then
    ok "HAProxy running"
  else
    warn "HAProxy failed to start; check $LOG_FILE."
  fi
else
  warn "HAProxy config source missing"
fi

# ── Layer 4: FastNetMon ──────────────────────────────────────────
step "Layer 4: FastNetMon Detection"
if ! command -v fastnetmon &>/dev/null; then
  if wget -q https://install.fastnetmon.com/installer -O /tmp/fnm_install.sh; then
    bash /tmp/fnm_install.sh --install-only >> "$LOG_FILE" 2>&1 || warn "FastNetMon installer failed; check $LOG_FILE."
  else
    warn "FastNetMon installer download failed."
  fi
fi

if [ -f "$SCRIPT_DIR/configs/fastnetmon.conf" ]; then
  if ! command -v fastnetmon >/dev/null 2>&1 && ! systemd_unit_exists fastnetmon.service; then
    warn "FastNetMon package or service is missing; skipping FastNetMon startup."
  else
    sed "s/IFACE_PLACEHOLDER/$IFACE/g" "$SCRIPT_DIR/configs/fastnetmon.conf" > /etc/fastnetmon.conf
    install -m 0755 "$SCRIPT_DIR/configs/fastnetmon-notify.sh" /usr/local/bin/fastnetmon-notify.sh
    if systemctl enable --now fastnetmon >> "$LOG_FILE" 2>&1; then
      ok "FastNetMon active"
    else
      warn "FastNetMon failed to start; check $LOG_FILE."
    fi
  fi
else
  warn "FastNetMon config source missing"
fi

# ── Layer 1: XDP/eBPF ────────────────────────────────────────────
if [ "$XDP_SUPPORTED" = true ]; then
  step "Layer 1: XDP Packet Filter"
  if ! command -v clang >/dev/null 2>&1; then
    warn "clang is unavailable; skipping XDP compilation."
  elif [ ! -d "$SCRIPT_DIR/xdp" ]; then
    warn "XDP source directory missing"
  else
    cd "$SCRIPT_DIR/xdp"
    rm -f sparrowx_xdp.o
    # Compile with BTF support (-g)
    if clang -O2 -g -target bpf \
      -D__TARGET_ARCH_$(uname -m | sed 's/x86_64/x86/') \
      -I/usr/include/$(uname -m)-linux-gnu \
      -c sparrowx_xdp.c -o sparrowx_xdp.o >> "$LOG_FILE" 2>&1; then
      bash load_xdp.sh >> "$LOG_FILE" 2>&1 && ok "XDP attached to $IFACE" || warn "XDP load failed; check $LOG_FILE."
    else
      warn "XDP compilation failed; check $LOG_FILE."
    fi
    cd "$SCRIPT_DIR"
  fi
fi

# ── Finalize Panel ────────────────────────────────────────────────
step "Finalizing Panel"
if ! npm install --silent >> "$LOG_FILE" 2>&1; then
  err "Panel dependency install failed"
  exit 1
fi
pm2 delete sparrowx-panel 2>/dev/null || true
if ! pm2 start ecosystem.config.js >> "$LOG_FILE" 2>&1; then
  err "PM2 failed to start SparrowX"
  exit 1
fi
pm2 save >> "$LOG_FILE" 2>&1 || warn "PM2 save failed; SparrowX is running but may not restart automatically after reboot."
ok "SparrowX services started"

# CLI link
ensure_installer_permissions
ln -sfn "$SCRIPT_DIR/sparrow.sh" /usr/local/bin/sparrow
if [ -x /usr/local/bin/sparrow ]; then
  ok "Sparrow CLI installed"
else
  warn "Sparrow CLI link was created but is not executable."
fi

# Watchdog
CRON_WATCHDOG="*/5 * * * * root bash $SCRIPT_DIR/sbs-watchdog.sh >> /var/log/sbs/watchdog.log 2>&1"
echo "$CRON_WATCHDOG" > /etc/cron.d/sparrowx-watchdog
ok "Watchdog cron job scheduled"

# ── Results ───────────────────────────────────────────────────────
step "Setup Complete!"
if [ "${#WARNINGS[@]}" -eq 0 ]; then
  echo -e "  ${GREEN}All layers have been configured and applied.${RESET}"
else
  echo -e "  ${YELLOW}Setup completed with ${#WARNINGS[@]} warning(s):${RESET}"
  for warning in "${WARNINGS[@]}"; do
    echo -e "  ${YELLOW}- ${warning}${RESET}"
  done
fi
echo -e "  Run ${BOLD}sparrow${RESET} to manage your server."
echo ""
