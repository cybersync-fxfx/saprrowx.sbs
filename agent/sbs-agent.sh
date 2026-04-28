#!/bin/bash
# VERSION: 1.0.5
# Sparrowx Agent Bootstrap / Self-Contained Installer
# This file is the authoritative versioned agent.
# Clients update automatically from the Sparrowx panel.

set -e

# -- Detect mode -----------------------------------------------
# If called with --install, performs a first-time install.
# Otherwise it just replaces the agent binary and restarts the service.

INSTALL_DIR="/opt/sbs-agent"
SERVICE_NAME="sbs-agent"
AGENT_BIN="$INSTALL_DIR/agent.js"
ENV_FILE="$INSTALL_DIR/.env"

RED='\033[0;31m'
GREEN='\033[0;32m'
CYAN='\033[0;36m'
YELLOW='\033[1;33m'
BOLD='\033[1m'
RESET='\033[0m'

if [ "$EUID" -ne 0 ]; then
  echo -e "${RED}[x] Please run as root.${RESET}"
  exit 1
fi

echo -e "${CYAN}${BOLD}[Sparrowx] Agent version $(grep '^# VERSION:' "$0" | awk '{print $3}')${RESET}"

# -- Write latest agent.js -------------------------------------
mkdir -p "$INSTALL_DIR"
mkdir -p /var/log/sbs
touch /var/log/sbs/attacks.log /var/log/sbs/agent.log

cat > "$AGENT_BIN" << 'AGENT_EOF'
const fs   = require('fs');
const os   = require('os');
const http = require('http');
const https = require('https');
const { exec, execSync } = require('child_process');

// -- Helpers ---------------------------------------------------
function getCpuUsage() {
  const cpus = os.cpus();
  let user=0,nice=0,sys=0,idle=0,irq=0;
  for (let c of cpus) {
    user+=c.times.user; nice+=c.times.nice;
    sys+=c.times.sys;   idle+=c.times.idle; irq+=c.times.irq;
  }
  return { total:user+nice+sys+idle+irq, active:user+nice+sys+irq };
}

let lastCpu = getCpuUsage();

const config = {
  server:  process.env.SPARROWX_SERVER || process.env.SBS_SERVER,
  agentId: process.env.SPARROWX_AGENT_ID || process.env.SBS_AGENT_ID,
  apiKey:  process.env.SPARROWX_API_KEY || process.env.SBS_API_KEY,
  enableTunnel: (process.env.SPARROWX_ENABLE_TUNNEL || process.env.SBS_ENABLE_TUNNEL) === '1'
};

const AGENT_BUNDLE_VERSION = '2026-04-27-sparrowx-1';
const TUNNEL_RETRY_MS = 60000;
const SELF_UPDATE_INTERVAL_MS = 5 * 60 * 1000;
let tunnelRegisterInFlight = false;
let tunnelRegistered = false;
let lastTunnelRegisterAt = 0;
let selfUpdateInFlight = false;

function log(msg) {
  const line = '[' + new Date().toISOString() + '] ' + msg;
  try { fs.appendFileSync('/var/log/sbs/agent.log', line + '\n'); } catch(e){}
  console.log(line);
}

function getOsName() {
  try {
    const raw = fs.readFileSync('/etc/os-release', 'utf8');
    const pretty = raw.match(/^PRETTY_NAME="?([^"\n]+)"?/m);
    const id = raw.match(/^ID="?([^"\n]+)"?/m);
    return (pretty && pretty[1]) || (id && id[1]) || os.type();
  } catch(e) {
    return os.type();
  }
}

function request(path, method, data, cb, hops=0) {
  const url = new URL(path, config.server);
  const mod = url.protocol==='https:' ? https : http;
  const headers = { 'Content-Type':'application/json','User-Agent':'sparrowx-agent/1.0.5' };
  if (config.agentId) headers['X-Sparrowx-Agent-Id'] = config.agentId;
  if (config.apiKey) headers['X-Sparrowx-Api-Key'] = config.apiKey;
  const req = mod.request(url, {
    method,
    headers
  }, res => {
    let body='';
    res.on('data', d => body+=d);
    res.on('end', () => {
      if (res.statusCode>=300&&res.statusCode<400&&res.headers.location&&hops<3) {
        const redir = new URL(res.headers.location, url);
        config.server = redir.origin;
        return request(redir.pathname+redir.search, method, data, cb, hops+1);
      }
      cb && cb(res.statusCode<200||res.statusCode>=300 ? new Error('HTTP '+res.statusCode) : null, body);
    });
  });
  req.on('error', e => cb && cb(e));
  if (data) req.write(JSON.stringify(data));
  req.end();
}

function applySelfUpdate(scriptBody, latestBuild) {
  if (selfUpdateInFlight) return;
  selfUpdateInFlight = true;
  try {
    fs.writeFileSync('/opt/sbs-agent/.sbs-agent-update.sh', scriptBody, { mode: 0o700 });
    log('[update] applying agent build ' + latestBuild);
    exec('nohup bash /opt/sbs-agent/.sbs-agent-update.sh --self-update >> /var/log/sbs/agent-update.log 2>&1 &', {
      shell:'/bin/bash'
    }, ()=>{});
  } catch(e) {
    selfUpdateInFlight = false;
    log('[update] failed to stage update: ' + e.message);
  }
}

function checkSelfUpdate() {
  if (selfUpdateInFlight || !config.agentId || !config.apiKey || !config.server) return;
  request('/api/agent/update-info', 'POST', {
    agentId: config.agentId,
    apiKey: config.apiKey,
    build: AGENT_BUNDLE_VERSION
  }, (err,res)=>{
    if(err||!res) return;
    let info=null;
    try { info=JSON.parse(res); } catch(e) { return; }
    if(!info||!info.updateRequired||!info.latestBuild) return;
    log('[update] server has newer agent build ' + info.latestBuild + ' (local ' + AGENT_BUNDLE_VERSION + ')');
    request('/api/agent/self-update-script', 'POST', {
      agentId: config.agentId,
      apiKey: config.apiKey
    }, (scriptErr, scriptBody)=>{
      if(scriptErr||!scriptBody) {
        log('[update] failed to download update script: ' + (scriptErr ? scriptErr.message : 'empty response'));
        return;
      }
      applySelfUpdate(scriptBody, info.latestBuild);
    });
  });
}

function registerTunnel(reason = 'register') {
  if (!config.enableTunnel || tunnelRegisterInFlight || tunnelRegistered) return;

  const now = Date.now();
  if (now - lastTunnelRegisterAt < TUNNEL_RETRY_MS) return;

  tunnelRegisterInFlight = true;
  lastTunnelRegisterAt = now;
  log('[tunnel] registering with guard (' + reason + ')');

  request('/api/agent/tunnel/create', 'POST', {
    agentId: config.agentId,
    apiKey: config.apiKey
  }, (err) => {
    tunnelRegisterInFlight = false;
    if (err) {
      log('[tunnel] ' + err.message);
      return;
    }
    tunnelRegistered = true;
    log('[tunnel] registered with guard');
  });
}

// -- Register --------------------------------------------------
function register() {
  request('/api/agent/register','POST',{
    agentId:  config.agentId,
    apiKey:   config.apiKey,
    hostname: fs.readFileSync('/proc/sys/kernel/hostname','utf-8').trim(),
    ip:       'auto',
    os:       getOsName(),
    arch:     process.arch
  }, err => { 
    if(err) {
      log('[register] '+err.message); 
    } else {
      log('[register] connected');
      if (config.enableTunnel) {
        log('[tunnel] waiting for registration to settle...');
        setTimeout(() => registerTunnel('initial register'), 2000);
      }
    }
  });
}

// -- Network bytes ---------------------------------------------
let lastNet = { rx:0, tx:0, rxPackets:0, txPackets:0, ts:Date.now() };
let cachedPrimaryIface = '';

function parseProcNetDev() {
  try {
    return fs.readFileSync('/proc/net/dev','utf8')
      .split('\n')
      .slice(2)
      .map((line)=>{
        const parts=line.trim().split(/[:\s]+/).filter(Boolean);
        if(parts.length<17) return null;
        const rx=Number(parts[1])||0;
        const rxPackets=Number(parts[2])||0;
        const tx=Number(parts[9])||0;
        const txPackets=Number(parts[10])||0;
        return {
          iface:parts[0],
          rx,
          rxPackets,
          tx,
          txPackets,
          totalBytes:rx+tx,
          totalPackets:rxPackets+txPackets
        };
      })
      .filter(item=>item&&item.iface!=='lo');
  } catch(e) {
    return [];
  }
}

function getPrimaryInterface() {
  if (cachedPrimaryIface) return cachedPrimaryIface;
  try {
    const routes=fs.readFileSync('/proc/net/route','utf8')
      .split('\n')
      .slice(1)
      .map(line=>line.trim().split(/\s+/))
      .filter(parts=>parts.length>2);
    const defaultRoute=routes.find(parts=>parts[1]==='00000000');
    if(defaultRoute&&defaultRoute[0]) cachedPrimaryIface=defaultRoute[0];
  } catch(e) {
    cachedPrimaryIface = '';
  }
  if(!cachedPrimaryIface) {
    const counters=parseProcNetDev();
    const preferred=counters.find(item=>/^e(n|th|ns|np|no|p|m)/.test(item.iface))||counters[0];
    cachedPrimaryIface=preferred?preferred.iface:'';
  }
  return cachedPrimaryIface;
}

function readNetBytes(cb) {
  const counters=parseProcNetDev();
  const primary=getPrimaryInterface();
  const display=
    counters.find(item=>item.iface===primary)||
    counters.slice().sort((a,b)=>(b.totalBytes-a.totalBytes)||(b.totalPackets-a.totalPackets))[0];

  if(!display) return cb(null,{rx:0,tx:0,rxPackets:0,txPackets:0,iface:'unknown'});

  const totals=counters.reduce((acc,item)=>{
    acc.rx+=item.rx;
    acc.rxPackets+=item.rxPackets;
    acc.tx+=item.tx;
    acc.txPackets+=item.txPackets;
    return acc;
  }, { rx:0, tx:0, rxPackets:0, txPackets:0 });

  cachedPrimaryIface=display.iface;
  cb(null,{
    iface:display.iface,
    ...totals
  });
}

function parseEndpoint(value) {
  const raw = String(value || '').replace(/,.*/, '').trim();
  if (!raw || raw === '*:*' || raw === '0.0.0.0:*' || raw === '[::]:*') return null;
  let host = raw;
  let port = '';
  if (raw[0] === '[') {
    const end = raw.lastIndexOf(']:');
    if (end === -1) return null;
    host = raw.slice(1, end);
    port = raw.slice(end + 2);
  } else {
    const idx = raw.lastIndexOf(':');
    if (idx === -1) return null;
    host = raw.slice(0, idx);
    port = raw.slice(idx + 1);
  }
  host = host.replace(/%.*$/, '');
  if (!host || host === '*' || host === '::' || host === '0.0.0.0') return null;
  const portNumber = Number(port);
  return { ip: host, port: Number.isFinite(portNumber) ? portNumber : null };
}

function isServicePort(port) {
  return [20,21,22,25,53,80,110,143,443,465,587,993,995,3000,3001,51820].includes(Number(port));
}

function classifyDirection(local, remote) {
  if (!local || !remote) return 'listen';
  if (isServicePort(local.port) && !isServicePort(remote.port)) return 'incoming';
  if (!isServicePort(local.port) && isServicePort(remote.port)) return 'outgoing';
  if (Number(local.port) < 1024 && Number(remote.port) >= 1024) return 'incoming';
  if (Number(remote.port) < 1024 && Number(local.port) >= 1024) return 'outgoing';
  return 'incoming';
}

function classifyTrafficSeverity(event) {
  const riskyPorts = [23,135,139,445,1433,3306,3389,5432,5900,6379,9200,11211];
  if (/SYN-RECV/i.test(event.state) || (event.direction === 'incoming' && riskyPorts.includes(Number(event.localPort)))) {
    return { severity:'danger', reason:'suspicious inbound service probe' };
  }
  if (event.sizeBytes >= 65536 || /CLOSE-WAIT|LAST-ACK/i.test(event.state)) {
    return { severity:'warning', reason:'large queued packet data' };
  }
  if (event.direction === 'incoming' && !isServicePort(event.localPort)) {
    return { severity:'warning', reason:'inbound non-standard port' };
  }
  return { severity:'success', reason:'normal flow' };
}

function interfaceSeverity(direction, mbps, packets) {
  if (mbps >= 50 || packets >= 5000) return { severity:'danger', reason:direction+' flood-rate traffic' };
  if (mbps >= 10 || packets >= 1000) return { severity:'warning', reason:direction+' elevated traffic' };
  if (packets > 0) return { severity:'success', reason:direction+' normal traffic' };
  return { severity:'success', reason:direction+' idle' };
}

function buildInterfaceTrafficEvents(netNow, rxDiff, txDiff, rxPacketDiff, txPacketDiff, inMbps, outMbps, avgPacketBytes) {
  const now = new Date().toISOString();
  const iface = netNow.iface || 'unknown';
  const incoming = {
    timestamp:now,
    direction:'incoming',
    protocol:'IFACE',
    sourceLabel:'network',
    destinationLabel:iface,
    localIp:iface,
    localPort:null,
    remoteIp:'network',
    remotePort:null,
    state:rxPacketDiff>0?'RX':'IDLE',
    recvQ:0,
    sendQ:0,
    packets:rxPacketDiff,
    sizeBytes:rxDiff,
    avgPacketBytes,
    rateMbps:inMbps,
    iface,
    ...interfaceSeverity('incoming', inMbps, rxPacketDiff)
  };
  const outgoing = {
    timestamp:now,
    direction:'outgoing',
    protocol:'IFACE',
    sourceLabel:iface,
    destinationLabel:'network',
    localIp:iface,
    localPort:null,
    remoteIp:'network',
    remotePort:null,
    state:txPacketDiff>0?'TX':'IDLE',
    recvQ:0,
    sendQ:0,
    packets:txPacketDiff,
    sizeBytes:txDiff,
    avgPacketBytes,
    rateMbps:outMbps,
    iface,
    ...interfaceSeverity('outgoing', outMbps, txPacketDiff)
  };
  return [incoming, outgoing];
}

function collectTrafficEvents(iface) {
  try {
    const output = execSync('ss -Htuna 2>/dev/null | head -n 80', {
      encoding:'utf8',
      timeout:1200,
      stdio:['ignore','pipe','ignore']
    });
    const now = new Date().toISOString();
    return output.split('\n').map(l=>l.trim()).filter(Boolean).map(line=>{
      const parts=line.split(/\s+/);
      if(parts.length<6) return null;
      const protocol=String(parts[0]||'').toUpperCase();
      if(protocol!=='TCP'&&protocol!=='UDP') return null;
      const state=parts[1]||'-';
      const recvQ=parseInt(parts[2])||0;
      const sendQ=parseInt(parts[3])||0;
      const local=parseEndpoint(parts[4]);
      const remote=parseEndpoint(parts[5]);
      if(!local||!remote) return null;
      const direction=classifyDirection(local,remote);
      const base={
        timestamp:now,
        direction,
        protocol,
        localIp:local.ip,
        localPort:local.port,
        remoteIp:remote.ip,
        remotePort:remote.port,
        state,
        recvQ,
        sendQ,
        packets:null,
        sizeBytes:recvQ+sendQ,
        avgPacketBytes:0,
        rateMbps:0,
        iface:iface||'unknown'
      };
      return { ...base, ...classifyTrafficSeverity(base) };
    }).filter(Boolean).slice(0,30);
  } catch(e) {
    return [];
  }
}

// -- Stats -----------------------------------------------------
const TELEMETRY_AGENT_BUILD = 'netdev-v2';

function sendStats() {
  readNetBytes((_,netNow)=>{
    const elapsed=(Date.now()-lastNet.ts)/1000||1;
    const rxDiff=Math.max(0,netNow.rx-lastNet.rx);
    const txDiff=Math.max(0,netNow.tx-lastNet.tx);
    const rxPacketDiff=Math.max(0,(netNow.rxPackets||0)-(lastNet.rxPackets||0));
    const txPacketDiff=Math.max(0,(netNow.txPackets||0)-(lastNet.txPackets||0));
    const packetDiff=rxPacketDiff+txPacketDiff;
    const inMbps=parseFloat(((rxDiff*8)/elapsed/1e6).toFixed(3));
    const outMbps=parseFloat(((txDiff*8)/elapsed/1e6).toFixed(3));
    const pps=parseFloat((packetDiff/elapsed).toFixed(1));
    const avgPacketBytes=packetDiff>0?Math.round((rxDiff+txDiff)/packetDiff):0;
    lastNet={rx:netNow.rx,tx:netNow.tx,rxPackets:netNow.rxPackets||0,txPackets:netNow.txPackets||0,ts:Date.now()};
    const trafficEvents=[
      ...buildInterfaceTrafficEvents(netNow,rxDiff,txDiff,rxPacketDiff,txPacketDiff,inMbps,outMbps,avgPacketBytes),
      ...collectTrafficEvents(netNow.iface),
    ];

    exec(
      "ss -ant | wc -l; " +
      "ss -ant | grep ESTAB | wc -l; " +
      "ss -ant | grep SYN-RECV | wc -l; " +
      "NFT_TABLE=$(nft list table inet detroit_guard >/dev/null 2>&1 && echo 'inet detroit_guard' || echo 'inet sbs_filter'); " +
      "nft list set $NFT_TABLE blacklist 2>/dev/null | grep -oE '([0-9]{1,3}\\.){3}[0-9]{1,3}' | wc -l; " +
      "free | grep Mem | awk '{print $3/$2 * 100}'; " +
      "cat /proc/uptime | awk '{print $1}'; " +
      "ss -anu | wc -l; " +
      "grep -E 'Accepted|Failed|Invalid|Disconnected' /var/log/auth.log 2>/dev/null | tail -n 20 || " +
      "grep -E 'Accepted|Failed|Invalid|Disconnected' /var/log/secure 2>/dev/null | tail -n 20 || echo ''; " +
      "echo '---ATTACKS---'; " +
      "tail -n 10 /var/log/sbs/attacks.log 2>/dev/null || echo ''",
      (err, stdout) => {
        if(err||!stdout) return;
        const lines=stdout.split('\n');
        const curCpu=getCpuUsage();
        const td=curCpu.total-lastCpu.total;
        const ad=curCpu.active-lastCpu.active;
        const cpuPct=td===0?0:(ad/td)*100;
        lastCpu=curCpu;

        const sep=lines.findIndex(l=>l.includes('---ATTACKS---'));
        const sshLines=lines.slice(7,sep>=0?sep:lines.length);
        const atkLines=sep>=0?lines.slice(sep+1):[];

        const logOutput=[
          ...sshLines.filter(l=>l.trim()).map(l=>'[SSH] '+l.trim()),
          ...atkLines.filter(l=>l.trim()).map(l=>'[FW]  '+l.trim()),
        ].join('\n');

        const defaultTunnelName = 'spx_' + String(config.agentId || '').substring(0, 8);
        const legacyTunnelName = 'sbs_' + String(config.agentId || '').substring(0, 8);
        let tunnelName = defaultTunnelName;
        try {
          const tunnelEnv = fs.readFileSync('/opt/sbs-agent/tunnel.env', 'utf8');
          const match = tunnelEnv.match(/^(?:SPARROWX_TUNNEL_NAME|SBS_TUNNEL_NAME)=(.+)$/m);
          if (match && match[1]) tunnelName = match[1].trim();
        } catch (_) {
          if (!fs.existsSync('/sys/class/net/' + defaultTunnelName) && fs.existsSync('/sys/class/net/' + legacyTunnelName)) {
            tunnelName = legacyTunnelName;
          }
        }
        const tunnelPresent = fs.existsSync('/sys/class/net/' + tunnelName);
        if (tunnelPresent) tunnelRegistered = true;

        if (config.enableTunnel && !tunnelPresent && (Date.now() - (global.lastTunnelRetry || 0)) > TUNNEL_RETRY_MS) {
          log('[tunnel] interface missing, attempting auto-recovery...');
          global.lastTunnelRetry = Date.now();
          tunnelRegistered = false;
          registerTunnel('missing interface');
        }

        request('/api/agent/stats','POST',{
          agentId:     config.agentId,
          apiKey:      config.apiKey,
          connections: parseInt(lines[0])||0,
          established: parseInt(lines[1])||0,
          synRate:     parseInt(lines[2])||0,
          bannedIPs:   parseInt(lines[3])||0,
          cpuPercent:  parseFloat(cpuPct.toFixed(1))||0,
          memPercent:  parseFloat(lines[4])||0,
          inMbps, outMbps, pps,
          avgPacketBytes,
          packetDiff,
          rxPacketDiff,
          txPacketDiff,
          rxPackets:netNow.rxPackets||0,
          txPackets:netNow.txPackets||0,
          rxBytes:netNow.rx||0,
          txBytes:netNow.tx||0,
          telemetrySource:'/proc/net/dev',
          telemetryAgentBuild:TELEMETRY_AGENT_BUILD,
          agentBuild:AGENT_BUNDLE_VERSION,
          uptime:      parseFloat(lines[5])||0,
          udpConns:    parseInt(lines[6])||0,
          log:         logOutput,
          iface:       netNow.iface,
          trafficEvents,
          tunnelName,
          tunnelPresent,
        });
      }
    );
  });
}

// -- Command poll ----------------------------------------------
function pollCommands() {
  request('/api/agent/commands','GET',null,(err,res)=>{
    if(err||!res) return;
    try {
      const cmds=JSON.parse(res);
      cmds.forEach(cmd=>{
        log('[command] running ' + (cmd.kind || 'shell') + ' (' + cmd.id + ')');
        exec(cmd.cmd,{timeout:45000, maxBuffer: 1024*1024, shell: '/bin/bash'},(error,stdout,stderr)=>{
          const output = (stdout || '') + (stderr || '') + (error && error.killed ? '\n[command] timed out' : '');
          log('[command] ' + cmd.id + ' ' + (error ? 'failed' : 'completed') + ' with exit ' + (error ? (error.code || 1) : 0));
          request('/api/agent/command-result','POST',{
            agentId:  config.agentId,
            apiKey:   config.apiKey,
            cmdId:    cmd.id,
            kind:     cmd.kind || null,
            output,
            exitCode: error ? (typeof error.code === 'number' ? error.code : 1) : 0
          });
        });
      });
    } catch(e){}
  });
}

// -- Boot ------------------------------------------------------
register();
checkSelfUpdate();
setInterval(register,     15000);
setInterval(sendStats,     1000);
setInterval(pollCommands,  1000);
setInterval(checkSelfUpdate, SELF_UPDATE_INTERVAL_MS);
AGENT_EOF

chmod 600 "$AGENT_BIN"

echo -e "${GREEN}[ok] agent.js updated.${RESET}"

# -- First-time install mode -----------------------------------
if [ "$1" = "--install" ]; then
  echo -e "${CYAN}[Sparrowx] First-time install mode...${RESET}"

  # Prompt for required values
  read -rp "Sparrowx Server URL (e.g. https://your-server.com): " SPARROWX_SERVER
  read -rp "Agent ID: " SPARROWX_AGENT_ID
  read -rp "API Key: " SPARROWX_API_KEY

  cat > "$ENV_FILE" << EOF
SPARROWX_SERVER=$SPARROWX_SERVER
SPARROWX_AGENT_ID=$SPARROWX_AGENT_ID
SPARROWX_API_KEY=$SPARROWX_API_KEY
SPARROWX_ENABLE_TUNNEL=1
SBS_SERVER=$SPARROWX_SERVER
SBS_AGENT_ID=$SPARROWX_AGENT_ID
SBS_API_KEY=$SPARROWX_API_KEY
SBS_ENABLE_TUNNEL=1
EOF
  chmod 600 "$ENV_FILE"
  echo -e "${GREEN}[ok] .env written to $ENV_FILE${RESET}"

  # Install dependencies
  echo -e "${CYAN}[Sparrowx] Installing dependencies and preparing system...${RESET}"
  apt-get update -qq
  apt-get install -y ca-certificates curl gnupg kmod nftables iproute2 net-tools jq wireguard wireguard-tools procps < /dev/null

  # Kernel tweaks
  modprobe wireguard || true
  modprobe nf_conntrack || true

  cat << 'SYSCTL_EOF' > /etc/sysctl.d/99-sbs.conf
net.ipv4.ip_forward = 1
net.ipv6.conf.all.forwarding = 1
net.ipv4.conf.all.rp_filter = 1
net.ipv4.conf.default.rp_filter = 1
net.netfilter.nf_conntrack_max = 2000000
net.netfilter.nf_conntrack_tcp_timeout_established = 7440
SYSCTL_EOF
  sysctl -p /etc/sysctl.d/99-sbs.conf || true

  # Install node if missing
  if ! command -v node &>/dev/null; then
    echo -e "${CYAN}[Sparrowx] Installing Node.js 20.x...${RESET}"
    curl -fsSL https://deb.nodesource.com/setup_20.x | bash - &>/dev/null
    apt-get install -y nodejs &>/dev/null
    echo -e "${GREEN}[ok] Node.js installed.${RESET}"
  fi

  # Write systemd unit
  cat > /etc/systemd/system/sbs-agent.service << EOF
[Unit]
Description=Sparrowx Agent
After=network.target

[Service]
Type=simple
User=root
EnvironmentFile=$ENV_FILE
WorkingDirectory=$INSTALL_DIR
ExecStart=/usr/bin/node $AGENT_BIN
Restart=always
RestartSec=5
StandardOutput=append:/var/log/sbs/agent.log
StandardError=append:/var/log/sbs/agent.log

[Install]
WantedBy=multi-user.target
EOF

  systemctl daemon-reload
  systemctl enable sbs-agent
  echo -e "${GREEN}[ok] Systemd service registered.${RESET}"
fi

# -- Always: restart service -----------------------------------
if systemctl list-unit-files "$SERVICE_NAME.service" >/dev/null 2>&1 || [ -f "/etc/systemd/system/$SERVICE_NAME.service" ]; then
  systemctl daemon-reload
  systemctl enable "$SERVICE_NAME" >/dev/null 2>&1 || true
  systemctl restart "$SERVICE_NAME"
  sleep 2
  if systemctl is-active --quiet "$SERVICE_NAME"; then
    echo -e "${GREEN}[ok] $SERVICE_NAME is running.${RESET}"
  else
    echo -e "${RED}[x] $SERVICE_NAME failed to start. Check: journalctl -u $SERVICE_NAME -n 30 --no-pager${RESET}"
    exit 1
  fi
else
  echo -e "${YELLOW}[!] Service not registered. Run: sudo bash $0 --install${RESET}"
fi

echo -e "${GREEN}${BOLD}[Sparrowx] Agent ready. ok${RESET}"
