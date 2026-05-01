#!/usr/bin/env bash
# SparrowX HealthFix
# Checks the panel, UI build, live HTTPS, real telemetry path, and all 4 defense layers.
# Run on the guard server from /opt/sbs:
#   bash sparrow-healthfix.sh
# Check only, no fixes:
#   FIX=0 bash sparrow-healthfix.sh

set -u

APP_DIR="${APP_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" && pwd)}"
cd "$APP_DIR" || exit 1

FIX="${FIX:-1}"
RUN_ID="$(date +%Y%m%d-%H%M%S)"
LOG_FILE="${LOG_FILE:-/var/log/sbs/healthfix.log}"
BACKUP_DIR="${BACKUP_DIR:-/root/sparrowx-healthfix-backups/$RUN_ID}"

mkdir -p /var/log/sbs "$BACKUP_DIR"

PORT="${PORT:-}"
if [ -z "$PORT" ] && [ -f .env ]; then
  PORT="$(grep -E '^PORT=' .env 2>/dev/null | tail -1 | cut -d= -f2-)"
fi
PORT="${PORT:-3001}"

DOMAIN="${DOMAIN:-${SPARROWX_DOMAIN:-}}"
if [ -z "$DOMAIN" ] && [ -f .env ]; then
  DOMAIN="$(grep -E '^(SPARROWX_DOMAIN|DOMAIN)=' .env 2>/dev/null | tail -1 | cut -d= -f2-)"
fi
DOMAIN="${DOMAIN:-sparrowx.sbs}"

IFACE="${IFACE:-$(ip route get 1.1.1.1 2>/dev/null | awk '{for(i=1;i<=NF;i++) if($i=="dev"){print $(i+1); exit}}')}"
IFACE="${IFACE:-eth0}"

OK=0
WARN=0
FAIL=0
FIXED=0

green='\033[0;32m'
yellow='\033[0;33m'
red='\033[0;31m'
blue='\033[0;34m'
reset='\033[0m'

log() { printf '%s %s\n' "$(date '+%F %T')" "$*" >> "$LOG_FILE"; }
section() { printf '\n%s===== %s =====%s\n' "$blue" "$1" "$reset"; log "===== $1 ====="; }
ok() { OK=$((OK + 1)); printf '%b[OK]%b %s\n' "$green" "$reset" "$1"; log "[OK] $1"; }
warn() { WARN=$((WARN + 1)); printf '%b[WARN]%b %s\n' "$yellow" "$reset" "$1"; log "[WARN] $1"; }
fail() { FAIL=$((FAIL + 1)); printf '%b[FAIL]%b %s\n' "$red" "$reset" "$1"; log "[FAIL] $1"; }
fixed() { FIXED=$((FIXED + 1)); printf '%b[FIXED]%b %s\n' "$green" "$reset" "$1"; log "[FIXED] $1"; }

run_fix() {
  if [ "$FIX" != "1" ]; then
    log "[SKIP] Fix disabled: $*"
    return 1
  fi
  log "[RUN] $*"
  bash -lc "$*" >> "$LOG_FILE" 2>&1
}

backup_file() {
  local src="$1"
  local name
  name="$(echo "$src" | sed 's#^/##; s#/#_#g')"
  if [ -e "$src" ]; then
    cp -a "$src" "$BACKUP_DIR/$name" 2>/dev/null || true
  fi
}

panel_health() {
  curl -fsS --max-time 5 "http://127.0.0.1:${PORT}/api/health" >/dev/null 2>&1
}

live_health() {
  curl -kfsS --max-time 8 "https://${DOMAIN}/api/health" >/dev/null 2>&1
}

service_active() {
  systemctl is-active --quiet "$1" 2>/dev/null
}

pm2_online() {
  command -v pm2 >/dev/null 2>&1 && pm2 jlist 2>/dev/null | node -e "
    let raw=''; process.stdin.on('data', c => raw += c);
    process.stdin.on('end', () => {
      try {
        const apps = JSON.parse(raw || '[]');
        const app = apps.find(a => a.name === 'sparrowx-panel');
        process.exit(app && app.pm2_env && app.pm2_env.status === 'online' ? 0 : 1);
      } catch { process.exit(1); }
    });
  "
}

restart_panel() {
  if ! command -v pm2 >/dev/null 2>&1; then
    fail "PM2 is not installed"
    return 1
  fi

  if pm2 describe sparrowx-panel >/dev/null 2>&1; then
    run_fix "cd '$APP_DIR' && pm2 restart sparrowx-panel --update-env"
  elif [ -f ecosystem.config.js ]; then
    run_fix "cd '$APP_DIR' && pm2 start ecosystem.config.js --only sparrowx-panel"
  else
    run_fix "cd '$APP_DIR' && pm2 start server.js --name sparrowx-panel --update-env"
  fi

  sleep 4
  if panel_health; then
    fixed "Panel recovered"
    return 0
  fi
  fail "Panel still unhealthy after restart"
  return 1
}

build_frontend() {
  if [ ! -d frontend ]; then
    fail "frontend directory is missing"
    return 1
  fi

  if [ ! -d frontend/node_modules ]; then
    run_fix "cd '$APP_DIR/frontend' && npm ci --legacy-peer-deps"
  fi

  if run_fix "cd '$APP_DIR' && npm run build"; then
    fixed "Frontend rebuilt"
    return 0
  fi
  fail "Frontend build failed"
  return 1
}

write_haproxy_config() {
  local pem="/etc/haproxy/certs/${DOMAIN}.pem"

  mkdir -p /etc/haproxy/certs
  if [ ! -f "$pem" ]; then
    if [ -f "/etc/letsencrypt/live/${DOMAIN}/fullchain.pem" ] && [ -f "/etc/letsencrypt/live/${DOMAIN}/privkey.pem" ]; then
      cat "/etc/letsencrypt/live/${DOMAIN}/fullchain.pem" "/etc/letsencrypt/live/${DOMAIN}/privkey.pem" > "$pem"
      chmod 600 "$pem"
    else
      warn "SSL cert for ${DOMAIN} is missing; keeping current proxy"
      return 1
    fi
  fi

  backup_file /etc/haproxy/haproxy.cfg
  cat > /etc/haproxy/haproxy.cfg <<EOF
global
    log /dev/log local0
    log /dev/log local1 notice
    chroot /var/lib/haproxy
    stats socket /run/haproxy/admin.sock mode 660 level admin expose-fd listeners
    stats timeout 30s
    user haproxy
    group haproxy
    daemon
    maxconn 50000
    ssl-default-bind-options no-sslv3 no-tlsv10 no-tlsv11 no-tls-tickets

defaults
    log global
    mode http
    option httplog
    option dontlognull
    option forwardfor
    timeout connect 5s
    timeout client 60s
    timeout server 60s
    timeout http-request 10s

frontend sparrowx_http
    bind *:80
    http-request redirect scheme https code 301

frontend sparrowx_https
    bind *:443 ssl crt ${pem} alpn h2,http/1.1
    http-request set-header X-Forwarded-Proto https
    http-request set-header X-Forwarded-Host %[req.hdr(Host)]
    acl bad_bot hdr_sub(user-agent) -i sqlmap nikto masscan zgrab
    acl bad_path path_sub -i ../ /etc/passwd wp-admin .env
    http-request deny if bad_bot
    http-request deny if bad_path
    default_backend sparrowx_panel

backend sparrowx_panel
    option httpchk GET /api/health
    http-check expect status 200
    server panel_local 127.0.0.1:${PORT} check inter 2000 fall 3 rise 2
EOF

  haproxy -c -f /etc/haproxy/haproxy.cfg >/dev/null 2>&1
}

recover_proxy() {
  if ! command -v haproxy >/dev/null 2>&1; then
    run_fix "apt update && apt install -y haproxy"
  fi

  if write_haproxy_config; then
    run_fix "systemctl stop nginx 2>/dev/null || true"
    if run_fix "systemctl enable --now haproxy && systemctl restart haproxy"; then
      sleep 3
      if live_health; then
        fixed "HAProxy and HTTPS recovered"
        return 0
      fi
    fi
  fi

  warn "HAProxy recovery failed; starting nginx fallback if available"
  run_fix "systemctl stop haproxy 2>/dev/null || true; systemctl start nginx 2>/dev/null || true"
  live_health && fixed "Nginx fallback is serving live HTTPS" && return 0
  fail "Live HTTPS is still unhealthy"
  return 1
}

check_panel_and_ui() {
  section "1. Dashboard backend and UI"

  if command -v node >/dev/null 2>&1 && node -c server.js >/dev/null 2>&1; then
    ok "server.js syntax is valid"
  else
    fail "server.js syntax check failed"
  fi

  if pm2_online; then
    ok "PM2 panel process is online"
  else
    warn "PM2 panel process is not online"
    restart_panel || true
  fi

  if panel_health; then
    ok "Local API health is good"
  else
    warn "Local API health failed"
    restart_panel || true
  fi

  local dist_ok=1
  if [ ! -f frontend/dist/index.html ]; then
    dist_ok=0
  else
    while IFS= read -r asset; do
      [ -z "$asset" ] && continue
      if [ ! -f "frontend/dist/$asset" ]; then
        dist_ok=0
      fi
    done < <(grep -o 'assets/[^"]*' frontend/dist/index.html 2>/dev/null | sed 's/[?#].*$//' | sort -u)
  fi

  if [ "$dist_ok" -eq 1 ]; then
    ok "Dashboard build assets are present"
  else
    warn "Dashboard build assets are missing or broken"
    build_frontend || true
  fi

  if curl -kfsS --max-time 8 "https://${DOMAIN}/" >/dev/null 2>&1; then
    ok "Dashboard page loads over HTTPS"
  else
    warn "Dashboard page does not load over HTTPS"
  fi
}

check_proxy() {
  section "2. HAProxy / SSL"

  if service_active haproxy; then
    ok "HAProxy service is active"
  else
    warn "HAProxy service is inactive"
    recover_proxy || true
  fi

  if live_health; then
    ok "Live HTTPS API is healthy"
  else
    warn "Live HTTPS API failed"
    recover_proxy || true
  fi
}

check_real_data_path() {
  section "3. Real data path"

  local runtime_age
  runtime_age="$(node -e "
    const fs = require('fs');
    const p = 'storage/runtime-state.json';
    if (!fs.existsSync(p)) process.exit(2);
    const d = JSON.parse(fs.readFileSync(p, 'utf8'));
    const t = Number(d.lastUpdateMs || d.stats?.lastUpdateMs || d.savedAt || 0);
    if (!t) process.exit(3);
    console.log(Math.round((Date.now() - t) / 1000));
  " 2>/dev/null || echo "")"

  if [ -n "$runtime_age" ] && [ "$runtime_age" -le 180 ]; then
    ok "Dashboard runtime state is fresh (${runtime_age}s old)"
  else
    warn "Dashboard runtime state is stale or missing"
    restart_panel || true
  fi

  if command -v wg >/dev/null 2>&1 && wg show interfaces 2>/dev/null | grep -q .; then
    ok "WireGuard interface exists"
    local latest now age
    latest="$(wg show all latest-handshakes 2>/dev/null | awk '{if($3>m)m=$3} END{print m+0}')"
    now="$(date +%s)"
    if [ "${latest:-0}" -gt 0 ]; then
      age=$((now - latest))
      if [ "$age" -le 180 ]; then
        ok "WireGuard handshake is fresh (${age}s old)"
      else
        warn "WireGuard handshake is old (${age}s)"
        run_fix "cd '$APP_DIR' && (sparrow tunnel repair || bash repair-tunnels.sh || bash restore-tunnels.sh)" || true
      fi
    else
      warn "WireGuard has no handshake yet"
      run_fix "cd '$APP_DIR' && (sparrow tunnel repair || bash repair-tunnels.sh || bash restore-tunnels.sh)" || true
    fi
  else
    warn "WireGuard interface missing"
    run_fix "cd '$APP_DIR' && (sparrow tunnel restore || bash restore-tunnels.sh || bash repair-tunnels.sh)" || true
  fi

  if find intel -maxdepth 2 -type f \( -name '*.json' -o -name '*.jsonl' \) 2>/dev/null | grep -q .; then
    ok "Radar/intel files exist"
  else
    warn "Radar/intel files are empty; this can mean no traffic or sleeping scanner"
  fi

  if [ -f intel/brain/last-report.json ]; then
    local report_age
    report_age="$(node -e "const fs=require('fs'); const s=fs.statSync('intel/brain/last-report.json'); console.log(Math.round((Date.now()-s.mtimeMs)/1000));" 2>/dev/null || echo 999999)"
    if [ "$report_age" -le 86400 ]; then
      ok "Brain analysis report is recent"
    else
      warn "Brain analysis report is old"
      run_fix "cd '$APP_DIR' && node sparrow-brain.js --apply" && fixed "Brain analysis refreshed" || true
    fi
  else
    warn "Brain analysis report missing"
    run_fix "cd '$APP_DIR' && node sparrow-brain.js --apply" && fixed "Brain analysis created" || true
  fi
}

check_firewall_layers() {
  section "4. Firewall and kernel layers"

  if [ "$(cat /proc/sys/net/ipv4/ip_forward 2>/dev/null || echo 0)" = "1" ]; then
    ok "IP forwarding is active"
  else
    warn "IP forwarding is off"
    run_fix "sysctl -w net.ipv4.ip_forward=1"
  fi

  if [ -f configs/sysctl-sparrowx.conf ]; then
    run_fix "cp '$APP_DIR/configs/sysctl-sparrowx.conf' /etc/sysctl.d/99-sparrowx.conf && sysctl -p /etc/sysctl.d/99-sparrowx.conf >/dev/null"
  fi

  if nft list ruleset 2>/dev/null | grep -q 'table inet sparrowx_shield'; then
    ok "sparrowx_shield nftables table is active"
  else
    warn "sparrowx_shield nftables table missing"
    backup_file /etc/nftables.conf
    run_fix "systemctl restart nftables 2>/dev/null || nft -f /etc/nftables.conf" || true
    nft list ruleset 2>/dev/null | grep -q 'table inet sparrowx_shield' && fixed "nftables recovered" || fail "nftables still missing sparrowx_shield"
  fi

  if nft list ruleset 2>/dev/null | grep -q '10\.200\.0\.2.*masquerade'; then
    ok "Tunnel NAT is preserved"
  else
    warn "Tunnel NAT was not found; client traffic may not route"
  fi
}

check_fastnetmon() {
  section "5. FastNetMon"

  if ! command -v fastnetmon >/dev/null 2>&1; then
    warn "FastNetMon is not installed"
    run_fix "apt update && apt install -y fastnetmon" || true
  fi

  if [ -f configs/fastnetmon-notify.sh ]; then
    run_fix "cp '$APP_DIR/configs/fastnetmon-notify.sh' /usr/local/bin/fastnetmon-notify.sh && chmod +x /usr/local/bin/fastnetmon-notify.sh"
  fi
  run_fix "mkdir -p /var/log/sbs /var/log/fastnetmon_attacks"

  if [ -f /etc/fastnetmon.conf ]; then
    backup_file /etc/fastnetmon.conf
    run_fix "sed -i 's/^daemon *=.*/daemon = off/' /etc/fastnetmon.conf"
    grep -q '^interfaces' /etc/fastnetmon.conf || run_fix "printf '\ninterfaces = ${IFACE}\n' >> /etc/fastnetmon.conf"
    grep -q '^enable_ban *= *on' /etc/fastnetmon.conf || run_fix "cat >> /etc/fastnetmon.conf <<'EOF'

# SparrowX mitigation enablement
enable_ban = on
ban_for_pps = on
ban_for_bandwidth = on
ban_for_flows = on
notify_script_enabled = on
notify_script_path = /usr/local/bin/fastnetmon-notify.sh
EOF"
  fi

  if [ "$FIX" = "1" ]; then
    mkdir -p /etc/systemd/system/fastnetmon.service.d
    cat > /etc/systemd/system/fastnetmon.service.d/override.conf <<'EOF'
[Service]
Type=simple
PIDFile=
ExecStart=
ExecStart=/usr/sbin/fastnetmon --configuration_file=/etc/fastnetmon.conf
Restart=on-failure
RestartSec=5
TimeoutStartSec=30
EOF

    run_fix "systemctl daemon-reload"
  fi
  if service_active fastnetmon; then
    ok "FastNetMon is active"
  else
    warn "FastNetMon is inactive"
    run_fix "systemctl reset-failed fastnetmon 2>/dev/null || true; systemctl restart fastnetmon" || true
    sleep 4
    service_active fastnetmon && fixed "FastNetMon recovered" || fail "FastNetMon failed to start"
  fi

  if grep -q '^enable_ban *= *on' /etc/fastnetmon.conf 2>/dev/null; then
    ok "FastNetMon ban script is enabled"
  else
    warn "FastNetMon ban script is not enabled"
  fi
}

check_xdp() {
  section "6. XDP / eBPF"

  if ip -details link show dev "$IFACE" 2>/dev/null | grep -q 'prog/xdp'; then
    ok "XDP is attached to ${IFACE}"
  else
    warn "XDP is not attached to ${IFACE}"
    if [ -f xdp/load_xdp.sh ]; then
      run_fix "cd '$APP_DIR' && bash xdp/load_xdp.sh" || true
      ip -details link show dev "$IFACE" 2>/dev/null | grep -q 'prog/xdp' && fixed "XDP attached" || fail "XDP attach failed"
    else
      fail "xdp/load_xdp.sh is missing"
    fi
  fi

  if [ -f xdp/sync_blocklist-live.sh ]; then
    run_fix "cd '$APP_DIR' && bash xdp/sync_blocklist-live.sh" && ok "XDP map sync ran" || warn "XDP map sync failed"
  elif [ -f xdp/sync_blocklist.sh ]; then
    run_fix "cd '$APP_DIR' && bash xdp/sync_blocklist.sh" && ok "XDP map sync ran" || warn "XDP map sync failed"
  else
    warn "XDP sync script is missing"
  fi
}

final_report() {
  section "7. Final live proof"

  panel_health && ok "Local API final check OK" || fail "Local API final check failed"
  live_health && ok "Live HTTPS final check OK" || fail "Live HTTPS final check failed"

  if command -v pm2 >/dev/null 2>&1; then
    run_fix "pm2 save" >/dev/null 2>&1 || true
  fi

  printf '\n===== SUMMARY =====\n'
  printf 'OK=%s WARN=%s FIXED=%s FAIL=%s\n' "$OK" "$WARN" "$FIXED" "$FAIL"
  printf 'Log: %s\n' "$LOG_FILE"
  printf 'Backup: %s\n' "$BACKUP_DIR"
  printf '\nRollback commands:\n'
  printf 'systemctl stop haproxy && systemctl start nginx\n'
  printf 'ip link set dev %s xdp off\n' "$IFACE"
  printf 'systemctl stop fastnetmon\n'
  printf 'cp %s/etc_haproxy_haproxy.cfg /etc/haproxy/haproxy.cfg 2>/dev/null || true\n' "$BACKUP_DIR"

  if [ "$FAIL" -gt 0 ]; then
    exit 1
  fi
}

if [ "$(id -u)" -ne 0 ]; then
  fail "Run as root on the guard server"
  exit 1
fi

printf '===== SparrowX HealthFix %s =====\n' "$(date)"
printf 'APP_DIR=%s DOMAIN=%s PORT=%s IFACE=%s FIX=%s\n' "$APP_DIR" "$DOMAIN" "$PORT" "$IFACE" "$FIX"
log "HealthFix start APP_DIR=$APP_DIR DOMAIN=$DOMAIN PORT=$PORT IFACE=$IFACE FIX=$FIX"

backup_file .env
backup_file /etc/haproxy/haproxy.cfg
backup_file /etc/nginx
backup_file /etc/fastnetmon.conf
backup_file /etc/nftables.conf
backup_file /etc/wireguard

check_panel_and_ui
check_proxy
check_real_data_path
check_firewall_layers
check_fastnetmon
check_xdp
final_report
