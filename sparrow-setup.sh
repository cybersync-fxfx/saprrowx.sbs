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
HTTP_BIND_LINE="bind *:80"
HTTPS_BIND_LINE="# HTTPS disabled until a valid certificate is installed"
ALLOWED_TCP_PORTS="22, 80, 443, 3001"
AUTO_MODE=false
DOMAIN=""
PANEL_PORT="3001"
DISCORD_URL=""
ADMIN_EMAIL=""
SERVER_IPV4=""
SERVER_IPV6=""
DNS_RECORDS=""
DNS_MATCHES_SERVER=false

# ── Helpers ───────────────────────────────────────────────────────
log()  { echo -e "$1" | tee -a "$LOG_FILE"; }
ok()   { log "${GREEN}[✓] $1${RESET}"; }
info() { log "${CYAN}[→] $1${RESET}"; }
warn() { WARNINGS+=("$1"); log "${YELLOW}[!] $1${RESET}"; }
err()  { log "${RED}[✗] $1${RESET}"; }
ask()  { echo -ne "${BOLD}$1${RESET} "; read -r "$2"; }
askd() {
  local answer
  echo -ne "${BOLD}$1${RESET} ${DIM}[${3}]${RESET} "
  read -r answer
  printf -v "$2" '%s' "${answer:-$3}"
}

usage() {
  cat <<EOF
Usage: sudo bash sparrow-setup.sh [options]

Options:
  --auto, -y              Run with detected/default values and no prompts
  --domain DOMAIN         Panel domain, for example sparrowx.sbs
  --port PORT             Panel port, default 3001
  --discord-webhook URL   Discord alert webhook
  --admin-email EMAIL     Admin email for local config and Let's Encrypt
  --help, -h              Show this help
EOF
}

parse_args() {
  while [ "$#" -gt 0 ]; do
    case "$1" in
      --auto|-y|--yes)
        AUTO_MODE=true
        shift
        ;;
      --domain)
        if [ "$#" -lt 2 ]; then err "--domain requires a value"; exit 1; fi
        DOMAIN="${2:-}"
        shift 2
        ;;
      --port)
        if [ "$#" -lt 2 ]; then err "--port requires a value"; exit 1; fi
        PANEL_PORT="${2:-3001}"
        shift 2
        ;;
      --discord-webhook|--discord)
        if [ "$#" -lt 2 ]; then err "$1 requires a value"; exit 1; fi
        DISCORD_URL="${2:-}"
        shift 2
        ;;
      --admin-email|--email)
        if [ "$#" -lt 2 ]; then err "$1 requires a value"; exit 1; fi
        ADMIN_EMAIL="${2:-}"
        shift 2
        ;;
      --help|-h)
        usage
        exit 0
        ;;
      *)
        err "Unknown option: $1"
        usage
        exit 1
        ;;
    esac
  done

  if [ ! -t 0 ]; then
    AUTO_MODE=true
  fi
}

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

trim_value() {
  local value="$1"
  value="${value#"${value%%[![:space:]]*}"}"
  value="${value%"${value##*[![:space:]]}"}"
  printf '%s' "$value"
}

is_real_domain() {
  [ -n "$1" ] && [ "$1" != "localhost" ] && [[ ! "$1" =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]] && [[ "$1" == *.* ]]
}

first_nonempty_curl() {
  local url
  local value

  for url in "$@"; do
    value="$(curl -fsS --max-time 4 "$url" 2>/dev/null | tr -d '\r\n' || true)"
    if [ -n "$value" ]; then
      printf '%s' "$value"
      return 0
    fi
  done

  return 1
}

detect_public_ipv4() {
  local value
  value="$(first_nonempty_curl \
    "https://api.ipify.org" \
    "https://ipv4.icanhazip.com" \
    "https://ifconfig.me/ip" || true)"

  if [[ "$value" =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
    printf '%s' "$value"
    return 0
  fi

  hostname -I 2>/dev/null | tr ' ' '\n' | grep -E '^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$' | head -1
}

detect_public_ipv6() {
  local value
  value="$(first_nonempty_curl \
    "https://api64.ipify.org" \
    "https://ipv6.icanhazip.com" || true)"

  if [[ "$value" == *:* ]]; then
    printf '%s' "$value"
    return 0
  fi

  hostname -I 2>/dev/null | tr ' ' '\n' | grep ':' | head -1
}

detect_default_interface() {
  local iface
  iface="$(ip -4 route show default 2>/dev/null | awk '{print $5}' | head -1)"
  if [ -z "$iface" ]; then
    iface="$(ip -6 route show default 2>/dev/null | awk '{print $5}' | head -1)"
  fi
  printf '%s' "$iface"
}

detect_domain_default() {
  local candidate

  if [ -n "${SPARROWX_DOMAIN:-}" ]; then
    printf '%s' "$SPARROWX_DOMAIN"
    return 0
  fi

  candidate="$(hostname -f 2>/dev/null || true)"
  if is_real_domain "$candidate"; then
    printf '%s' "$candidate"
    return 0
  fi

  printf 'localhost'
}

resolve_domain_records() {
  local domain="$1"

  if ! is_real_domain "$domain"; then
    return 0
  fi

  getent ahosts "$domain" 2>/dev/null | awk '!seen[$1]++ {print $1}' | paste -sd, -
}

domain_points_to_server() {
  local records="$1"
  local record
  local -a record_list

  IFS=',' read -ra record_list <<< "$records"
  for record in "${record_list[@]}"; do
    record="$(trim_value "$record")"
    if { [ -n "$SERVER_IPV4" ] && [ "$record" = "$SERVER_IPV4" ]; } || { [ -n "$SERVER_IPV6" ] && [ "$record" = "$SERVER_IPV6" ]; }; then
      return 0
    fi
  done

  return 1
}

normalize_runtime_config() {
  DOMAIN="$(trim_value "$DOMAIN")"
  PANEL_PORT="$(trim_value "$PANEL_PORT")"
  DISCORD_URL="$(trim_value "$DISCORD_URL")"
  ADMIN_EMAIL="$(trim_value "$ADMIN_EMAIL")"

  [ -z "$DOMAIN" ] && DOMAIN="$(detect_domain_default)"
  [ -z "$PANEL_PORT" ] && PANEL_PORT="3001"
  [ -z "$ADMIN_EMAIL" ] && ADMIN_EMAIL="admin@localhost"

  if ! [[ "$PANEL_PORT" =~ ^[0-9]+$ ]] || [ "$PANEL_PORT" -lt 1 ] || [ "$PANEL_PORT" -gt 65535 ]; then
    warn "Invalid panel port '$PANEL_PORT'; falling back to 3001."
    PANEL_PORT="3001"
  fi

  case "$PANEL_PORT" in
    22|80|443) ALLOWED_TCP_PORTS="22, 80, 443" ;;
    *) ALLOWED_TCP_PORTS="22, 80, 443, $PANEL_PORT" ;;
  esac

  DNS_RECORDS="$(resolve_domain_records "$DOMAIN")"
  if [ -n "$DNS_RECORDS" ] && domain_points_to_server "$DNS_RECORDS"; then
    DNS_MATCHES_SERVER=true
  else
    DNS_MATCHES_SERVER=false
  fi
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

configure_haproxy_tls() {
  local cert_dir="/etc/letsencrypt/live/$DOMAIN"
  local pem_path="/etc/haproxy/certs/sparrowx.pem"
  local renewal_hook="/etc/letsencrypt/renewal-hooks/deploy/sparrowx-haproxy.sh"
  local certbot_email_args=()

  if ! is_real_domain "$DOMAIN"; then
    info "HTTPS certificate skipped for local or IP-only panel domain."
    return 0
  fi

  if [ "$DNS_MATCHES_SERVER" != true ]; then
    warn "Skipping HTTPS certificate because $DOMAIN does not resolve to this VPS yet. Update A/AAAA records, then rerun setup."
    return 1
  fi

  if ! command -v certbot >/dev/null 2>&1; then
    if ! apt_install_if_available "Certbot" certbot; then
      warn "Certbot is unavailable; HTTPS will stay disabled until a certificate is installed."
      return 1
    fi
  fi

  mkdir -p /etc/haproxy/certs /etc/letsencrypt/renewal-hooks/deploy

  if [ ! -f "$cert_dir/fullchain.pem" ] || [ ! -f "$cert_dir/privkey.pem" ]; then
    info "Requesting Let's Encrypt certificate for $DOMAIN..."
    systemctl stop haproxy >/dev/null 2>&1 || true

    if [[ "$ADMIN_EMAIL" == *@* ]] && [ "$ADMIN_EMAIL" != "admin@localhost" ]; then
      certbot_email_args=(--email "$ADMIN_EMAIL")
    else
      certbot_email_args=(--register-unsafely-without-email)
    fi

    if ! certbot certonly --standalone \
      --non-interactive --agree-tos \
      "${certbot_email_args[@]}" \
      -d "$DOMAIN" >> "$LOG_FILE" 2>&1; then
      warn "Let's Encrypt certificate request failed; HTTP will still be available on port 80. Check DNS and port 80 reachability."
      return 1
    fi
  fi

  if [ -f "$cert_dir/fullchain.pem" ] && [ -f "$cert_dir/privkey.pem" ]; then
    cat "$cert_dir/fullchain.pem" "$cert_dir/privkey.pem" > "$pem_path"
    chmod 0600 "$pem_path"
    cat > "$renewal_hook" <<EOF
#!/bin/bash
cat "$cert_dir/fullchain.pem" "$cert_dir/privkey.pem" > "$pem_path"
chmod 0600 "$pem_path"
systemctl reload haproxy >/dev/null 2>&1 || true
EOF
    chmod 0755 "$renewal_hook"
    if [ -n "$SERVER_IPV6" ]; then
      HTTPS_BIND_LINE="bind :::443 v4v6 ssl crt $pem_path alpn h2,http/1.1"
    else
      HTTPS_BIND_LINE="bind *:443 ssl crt $pem_path alpn h2,http/1.1"
    fi
    ok "HTTPS certificate ready for $DOMAIN"
    return 0
  fi

  warn "HTTPS certificate files were not found after Certbot finished."
  return 1
}

run_deployment_health_checks() {
  local dns_records

  step "Deployment Health Check"

  if curl -fsS --max-time 5 "http://127.0.0.1:${PANEL_PORT}/api/health" >/dev/null 2>&1; then
    ok "Panel health OK on 127.0.0.1:${PANEL_PORT}"
  else
    warn "Panel health check failed on 127.0.0.1:${PANEL_PORT}; inspect pm2 logs sparrowx-panel."
  fi

  if curl -fsS --max-time 5 "http://127.0.0.1/api/health" >/dev/null 2>&1; then
    ok "HAProxy HTTP health OK on port 80"
  else
    warn "HAProxy HTTP health check failed on port 80."
  fi

  if is_real_domain "$DOMAIN"; then
    dns_records="$(resolve_domain_records "$DOMAIN")"
    if [ -n "$dns_records" ]; then
      info "DNS for $DOMAIN resolves to: $dns_records"
    else
      warn "DNS lookup failed for $DOMAIN."
    fi

    if curl -fsS --max-time 8 "http://${DOMAIN}/api/health" >/dev/null 2>&1; then
      ok "Public HTTP health OK: http://${DOMAIN}/api/health"
    else
      warn "Public HTTP health check failed for $DOMAIN. Check DNS, cloud firewall, and provider firewall rules."
    fi

    if [ "$HTTPS_BIND_LINE" != "# HTTPS disabled until a valid certificate is installed" ]; then
      if curl -kfsS --max-time 8 "https://${DOMAIN}/api/health" >/dev/null 2>&1; then
        ok "Public HTTPS health OK: https://${DOMAIN}/api/health"
      else
        warn "Public HTTPS health check failed for $DOMAIN. Check HAProxy logs and port 443 firewall rules."
      fi
    else
      warn "HTTPS is not enabled; use http://${DOMAIN} until certificate setup succeeds."
    fi
  fi
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

parse_args "$@"

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
IFACE="$(detect_default_interface)"
SERVER_IPV4="$(detect_public_ipv4 || true)"
SERVER_IPV6="$(detect_public_ipv6 || true)"
SERVER_IP="${SERVER_IPV4:-$SERVER_IPV6}"
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
ok "Interface: $IFACE"
if [ -n "$SERVER_IPV4" ]; then ok "Public IPv4: $SERVER_IPV4"; else info "No public IPv4 detected"; fi
if [ -n "$SERVER_IPV6" ]; then ok "Public IPv6: $SERVER_IPV6"; else info "No public IPv6 detected"; fi
if [ -n "$SERVER_IPV6" ]; then
  HTTP_BIND_LINE="bind :::80 v4v6"
fi
ok "Resources: ${CPU_CORES} cores / ${RAM_GB}GB RAM"

# XDP support check (kernel >= 5.6)
XDP_SUPPORTED=false
if [ "$KERNEL_MAJOR" -gt 5 ] || { [ "$KERNEL_MAJOR" -eq 5 ] && [ "$KERNEL_MINOR" -ge 6 ]; }; then
  XDP_SUPPORTED=true
  ok "XDP/eBPF: Supported"
  if [ -z "$SERVER_IPV4" ] && [ -n "$SERVER_IPV6" ]; then
    warn "XDP program currently filters IPv4 traffic; IPv6 traffic remains protected by nftables and HAProxy."
  fi
else
  warn "XDP/eBPF: NOT supported (kernel $KERNEL below 5.6)"
fi

# ── Gather Config ─────────────────────────────────────────────────
step "Configuration Questions"
if [ "$AUTO_MODE" = true ]; then
  [ -z "$DOMAIN" ] && DOMAIN="$(detect_domain_default)"
  info "Auto mode enabled; using detected/default configuration."
else
  echo -e "${DIM}Press Enter to accept the default value shown in [brackets]${RESET}"
  echo ""
  askd "Panel domain (e.g. panel.sparrowx.net):"    DOMAIN         "${DOMAIN:-$(detect_domain_default)}"
  askd "Panel port:"                                 PANEL_PORT     "${PANEL_PORT:-3001}"
  askd "Discord webhook URL (for alerts):"           DISCORD_URL    "${DISCORD_URL:-}"
  askd "Admin email:"                                ADMIN_EMAIL    "${ADMIN_EMAIL:-admin@localhost}"
fi

normalize_runtime_config
ok "Panel domain: $DOMAIN"
ok "Panel port: $PANEL_PORT"
ok "Admin email: $ADMIN_EMAIL"
if is_real_domain "$DOMAIN"; then
  if [ -n "$DNS_RECORDS" ]; then
    info "DNS records detected for $DOMAIN: $DNS_RECORDS"
  else
    info "No DNS records detected for $DOMAIN yet."
  fi

  if [ "$DNS_MATCHES_SERVER" = true ]; then
    ok "Domain DNS points to this VPS"
  else
    info "Domain DNS will be rechecked after dependencies are installed."
  fi
fi

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

# Re-detect after curl/iproute dependencies are guaranteed to exist.
SERVER_IPV4="$(detect_public_ipv4 || true)"
SERVER_IPV6="$(detect_public_ipv6 || true)"
if [ -n "$SERVER_IPV6" ]; then
  HTTP_BIND_LINE="bind :::80 v4v6"
else
  HTTP_BIND_LINE="bind *:80"
fi
normalize_runtime_config
info "Confirmed network profile: IPv4=${SERVER_IPV4:-none}, IPv6=${SERVER_IPV6:-none}, DNS=${DNS_RECORDS:-none}"

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
SPARROWX_INTERFACE=${IFACE}
SPARROWX_PUBLIC_IPV4=${SERVER_IPV4}
SPARROWX_PUBLIC_IPV6=${SERVER_IPV6}
SPARROWX_DNS_RECORDS=${DNS_RECORDS}
PORT=${PANEL_PORT}
ADMIN_EMAIL=${ADMIN_EMAIL}
DISCORD_WEBHOOK_URL=${DISCORD_URL}
NODE_ENV=production
EOF
ok ".env file written"

install -d -m 0755 /etc/sparrowx
cat > /etc/sparrowx/install-profile.env <<EOF
# Auto-generated by sparrow-setup.sh on $(date)
SPARROWX_INSTALL_DIR="${SCRIPT_DIR}"
SPARROWX_OS="${OS_ID}"
SPARROWX_OS_VERSION="${OS_VER}"
SPARROWX_KERNEL="${KERNEL}"
SPARROWX_ARCH="${ARCH}"
SPARROWX_INTERFACE="${IFACE}"
SPARROWX_PUBLIC_IPV4="${SERVER_IPV4}"
SPARROWX_PUBLIC_IPV6="${SERVER_IPV6}"
SPARROWX_DOMAIN="${DOMAIN}"
SPARROWX_PANEL_PORT="${PANEL_PORT}"
SPARROWX_DNS_RECORDS="${DNS_RECORDS}"
SPARROWX_DNS_MATCHES_SERVER="${DNS_MATCHES_SERVER}"
SPARROWX_HTTP_BIND="${HTTP_BIND_LINE}"
SPARROWX_HTTPS_BIND="${HTTPS_BIND_LINE}"
SPARROWX_ALLOWED_TCP_PORTS="${ALLOWED_TCP_PORTS}"
EOF
chmod 0644 /etc/sparrowx/install-profile.env
ok "Install profile written to /etc/sparrowx/install-profile.env"

# ── Layer 2: nftables ─────────────────────────────────────────────
step "Layer 2: Setting Up nftables"
if [ -f "$SCRIPT_DIR/configs/nftables-sparrowx.conf" ]; then
  sed -e "s/IFACE_PLACEHOLDER/$IFACE/g" \
      -e "s/ALLOWED_TCP_PORTS_PLACEHOLDER/$ALLOWED_TCP_PORTS/g" \
      "$SCRIPT_DIR/configs/nftables-sparrowx.conf" > /etc/nftables.conf.sparrowx
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
  configure_haproxy_tls || true
  sed -e "s/PANEL_PORT_PLACEHOLDER/$PANEL_PORT/g" \
      -e "s|HTTP_BIND_PLACEHOLDER|$HTTP_BIND_LINE|g" \
      -e "s|HTTPS_BIND_PLACEHOLDER|$HTTPS_BIND_LINE|g" \
      "$SCRIPT_DIR/configs/haproxy.cfg" > /etc/haproxy/haproxy.cfg
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

run_deployment_health_checks

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
