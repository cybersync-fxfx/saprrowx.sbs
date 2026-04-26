const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// Auto-install dependencies if not present
if (!fs.existsSync(path.join(__dirname, 'node_modules'))) {
  console.log('\x1b[33m[!] Dependencies not found. Installing automatically...\x1b[0m');
  try {
    execSync('npm install', { stdio: 'inherit' });
    console.log('\x1b[32m[✓] Dependencies installed successfully.\x1b[0m\n');
  } catch (err) {
    console.error('\x1b[31m[x] Failed to install dependencies. Please run npm install manually.\x1b[0m');
    process.exit(1);
  }
}

// Check for .env file
if (!fs.existsSync(path.join(__dirname, '.env'))) {
  console.log('\x1b[33m[!] .env file not found. Creating a template...\x1b[0m');
  const envTemplate = `PORT=3001
SUPABASE_URL=your_supabase_url
SUPABASE_ANON_KEY=your_supabase_anon_key
SUPABASE_SERVICE_KEY=your_supabase_service_key
`;
  fs.writeFileSync(path.join(__dirname, '.env'), envTemplate);
  console.log('\x1b[31m[x] .env template created. Please fill in your Supabase credentials in the .env file and restart the server.\x1b[0m');
  process.exit(1);
}

require('dotenv').config();
const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const crypto = require('crypto');
const { createClient } = require('@supabase/supabase-js');
const {
  DEFAULT_POOL_CIDR,
  getTunnelConfig,
  getOrAllocateTunnelConfig,
  releaseTunnelConfig,
  getTunnelStatePath,
  tunnelNameForAgent,
} = require('./tunnel-config');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const PORT = process.env.PORT || 3001;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY; // Needed for admin operations
const ADMIN_FEATURES_ENABLED = Boolean(SUPABASE_SERVICE_KEY);

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  console.error("\x1b[31m[x] Error: Missing SUPABASE_URL or SUPABASE_ANON_KEY in .env\x1b[0m");
  process.exit(1);
}

// Global Supabase Client (Anon privileges)
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
// Admin Client (Bypasses RLS, keep server-side only.)
const supabaseAdmin = ADMIN_FEATURES_ENABLED
  ? createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
    })
  : supabase;

app.disable('x-powered-by');
app.use(express.json({ limit: '200kb' }));
app.use(express.urlencoded({ extended: false, limit: '50kb' }));
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');
  next();
});
app.use(express.static(path.join(__dirname, 'frontend', 'dist')));

let db = { agents: {} }; // agents store runtime state
let commandQueue = {}; // { agentId: [{ id, cmd }] }
let commandLedger = {}; // { cmdId: { agentId, kind, status, output, ... } }
let radar = null;
const STORAGE_ROOT = path.join(__dirname, 'storage');
const RUNTIME_STATE_PATH = path.join(STORAGE_ROOT, 'runtime-state.json');
const RUNTIME_SNAPSHOT_INTERVAL_MS = 15000;

fs.mkdirSync(STORAGE_ROOT, { recursive: true });

const safeId = (value, fallback = 'unknown-client') => {
  const normalized = String(value || '').trim().replace(/[^a-zA-Z0-9._-]/g, '_');
  return normalized || fallback;
};

const getClientDir = (clientId) => {
  const dir = path.join(STORAGE_ROOT, safeId(clientId));
  fs.mkdirSync(dir, { recursive: true });
  return dir;
};

const getDailyLogKey = (date = new Date()) => {
  const shifted = new Date(date.getTime());
  // Day boundary starts at 1:00 AM local time.
  if (shifted.getHours() < 1) {
    shifted.setDate(shifted.getDate() - 1);
  }
  const y = shifted.getFullYear();
  const m = String(shifted.getMonth() + 1).padStart(2, '0');
  const d = String(shifted.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
};

const appendClientLog = (clientId, entry) => {
  try {
    const clientDir = getClientDir(clientId);
    const logsDir = path.join(clientDir, 'logs');
    fs.mkdirSync(logsDir, { recursive: true });
    const filePath = path.join(logsDir, `${getDailyLogKey()}.jsonl`);
    fs.appendFileSync(filePath, `${JSON.stringify(entry)}\n`);
  } catch (err) {
    console.error('[storage] failed to append client log:', err.message);
  }
};

const writeClientLatestSnapshot = (clientId, payload) => {
  try {
    const clientDir = getClientDir(clientId);
    fs.writeFileSync(
      path.join(clientDir, 'latest.json'),
      JSON.stringify({ updatedAt: new Date().toISOString(), ...payload }, null, 2)
    );
  } catch (err) {
    console.error('[storage] failed to write client latest snapshot:', err.message);
  }
};

const buildRuntimeSnapshot = () => ({
  updatedAt: new Date().toISOString(),
  profileTunnelStatus: db.profileTunnelStatus || {},
  lastStats: db.lastStats || {},
  commandLedger: Object.values(commandLedger)
    .sort((a, b) => Date.parse(b.completedAt || b.dispatchedAt || b.createdAt || 0) - Date.parse(a.completedAt || a.dispatchedAt || a.createdAt || 0))
    .slice(0, 500),
});

const persistRuntimeSnapshot = () => {
  try {
    fs.writeFileSync(RUNTIME_STATE_PATH, JSON.stringify(buildRuntimeSnapshot(), null, 2));
  } catch (err) {
    console.error('[storage] failed to persist runtime snapshot:', err.message);
  }
};

const restoreRuntimeSnapshot = () => {
  try {
    if (!fs.existsSync(RUNTIME_STATE_PATH)) return;
    const raw = fs.readFileSync(RUNTIME_STATE_PATH, 'utf8');
    if (!raw.trim()) return;
    const parsed = JSON.parse(raw);
    db.profileTunnelStatus = parsed.profileTunnelStatus || {};
    db.lastStats = parsed.lastStats || {};
    const restoredLedger = Array.isArray(parsed.commandLedger) ? parsed.commandLedger : [];
    commandLedger = {};
    restoredLedger.forEach((entry) => {
      if (entry && entry.id) commandLedger[entry.id] = entry;
    });
  } catch (err) {
    console.error('[storage] failed to restore runtime snapshot:', err.message);
  }
};

const scheduleDailyLogReset = () => {
  const now = new Date();
  const next = new Date(now);
  next.setHours(1, 0, 0, 0);
  if (next <= now) next.setDate(next.getDate() + 1);
  const delay = Math.max(1000, next.getTime() - now.getTime());

  setTimeout(() => {
    const timestamp = new Date().toISOString();
    const clientIds = new Set([
      ...Object.keys(db.agents || {}),
      ...Object.values(db.lastStats || {}).map((entry) => entry?.stats?.agentId).filter(Boolean),
      ...Object.values(db.lastStats || {}).map((entry) => entry?.agent?.agentId).filter(Boolean),
    ]);

    clientIds.forEach((clientId) => {
      appendClientLog(clientId, {
        type: 'daily_reset',
        message: 'Daily log reset boundary reached (1:00 AM local time).',
        at: timestamp,
      });
    });

    db.dailyResetAt = timestamp;
    persistRuntimeSnapshot();
    scheduleDailyLogReset();
  }, delay);
};

restoreRuntimeSnapshot();
setInterval(persistRuntimeSnapshot, RUNTIME_SNAPSHOT_INTERVAL_MS);
scheduleDailyLogReset();

const ipv4Pattern = /^(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}$/;
const CLIENT_TUNNEL_SCRIPT_SOURCE = fs
  .readFileSync(path.join(__dirname, 'agent', 'setup-tunnel-client.sh'), 'utf8')
  .replace(/\r\n/g, '\n');

const CLIENT_TUNNEL_SERVICE_UNIT = `[Unit]
Description=SBS Client WireGuard Tunnel
After=network-online.target
Wants=network-online.target

[Service]
Type=oneshot
RemainAfterExit=yes
EnvironmentFile=/opt/sbs-agent/tunnel.env
ExecStart=/opt/sbs-agent/setup-tunnel-client.sh apply
ExecStop=/opt/sbs-agent/setup-tunnel-client.sh remove
StandardOutput=append:/var/log/sbs/agent.log
StandardError=append:/var/log/sbs/agent.log

[Install]
WantedBy=multi-user.target
`.replace(/\r\n/g, '\n');

const normalizeIp = (value) => {
  if (!value) return '';
  const candidate = Array.isArray(value) ? value[0] : String(value).split(',')[0].trim();
  return candidate.replace(/^::ffff:/, '');
};

const trimCommandOutput = (value, max = 4000) => {
  const text = String(value || '').trim();
  if (!text) return '';
  if (text.length <= max) return text;
  return `${text.slice(0, max)}\n...[truncated]`;
};

const queueAgentCommand = (agentId, cmd, meta = {}) => {
  if (!commandQueue[agentId]) commandQueue[agentId] = [];
  const entry = {
    id: crypto.randomUUID(),
    cmd,
    kind: meta.kind || 'shell',
    summary: meta.summary || null,
    createdAt: new Date().toISOString(),
  };
  commandQueue[agentId].push(entry);
  commandLedger[entry.id] = {
    id: entry.id,
    agentId,
    kind: entry.kind,
    summary: entry.summary,
    status: 'queued',
    createdAt: entry.createdAt,
    output: '',
    exitCode: null,
  };
  return entry;
};

const markCommandDispatched = (cmdId) => {
  if (!commandLedger[cmdId]) return;
  commandLedger[cmdId] = {
    ...commandLedger[cmdId],
    status: 'sent',
    dispatchedAt: new Date().toISOString(),
  };
};

const recordCommandResult = (cmdId, result = {}) => {
  const previous = commandLedger[cmdId] || {};
  commandLedger[cmdId] = {
    ...previous,
    ...result,
    output: trimCommandOutput(result.output ?? previous.output ?? ''),
    completedAt: new Date().toISOString(),
    status: result.exitCode === 0 ? 'succeeded' : 'failed',
  };
  return commandLedger[cmdId];
};

const getLatestAgentCommand = (agentId, kindPrefix = null) => {
  const matches = Object.values(commandLedger)
    .filter((entry) => entry.agentId === agentId)
    .filter((entry) => !kindPrefix || String(entry.kind || '').startsWith(kindPrefix))
    .sort((a, b) => {
      const aTs = Date.parse(a.completedAt || a.dispatchedAt || a.createdAt || 0);
      const bTs = Date.parse(b.completedAt || b.dispatchedAt || b.createdAt || 0);
      return bTs - aTs;
    });
  return matches[0] || null;
};

const upsertAgentState = (agentId, partial) => {
  db.agents[agentId] = {
    ...db.agents[agentId],
    ...partial,
    lastSeen: Date.now()
  };
  return db.agents[agentId];
};

const buildAgentConnectedMessage = (agent) => ({
  type: 'agent_connected',
  hostname: agent.hostname || '-',
  ip: agent.ip || '-',
  os: agent.os || 'Ubuntu',
  agentStatus: 'CONNECTED'
});

const assertValidIpv4 = (ip) => {
  if (!ipv4Pattern.test(String(ip || '').trim())) {
    throw new Error(`Invalid IPv4 address: ${ip}`);
  }
  return String(ip).trim();
};

const resolveGuardPublicIp = (req) => {
  const configured = normalizeIp(process.env.GUARD_PUBLIC_IP || '');
  if (ipv4Pattern.test(configured)) return configured;

  const host = String(req?.headers?.host || '').split(':')[0].trim();
  if (ipv4Pattern.test(host)) return host;

  try {
    return assertValidIpv4(execSync('curl -4 -fsS https://api.ipify.org').toString().trim());
  } catch (err) {
    throw new Error('Unable to determine guard public IP. Set GUARD_PUBLIC_IP in the server environment.');
  }
};

const generateWgKeys = () => {
  try {
    const { privateKey, publicKey } = crypto.generateKeyPairSync('x25519', {
      publicKeyEncoding: { type: 'spki', format: 'der' },
      privateKeyEncoding: { type: 'pkcs8', format: 'der' },
    });

    // WireGuard expects raw 32-byte keys encoded in Base64.
    // The DER encoding includes headers; we need to extract the raw 32 bytes.
    // Private key DER (PKCS#8) for X25519 is 48 bytes; raw key starts at offset 16.
    // Public key DER (SPKI) for X25519 is 44 bytes; raw key starts at offset 12.
    const privRaw = privateKey.slice(16);
    const pubRaw = publicKey.slice(12);

    return {
      priv: privRaw.toString('base64'),
      pub: pubRaw.toString('base64'),
    };
  } catch (err) {
    console.error('[tunnel] Crypto key generation failed:', err.message);
    // Absolute fallback (not recommended but avoids crash)
    const dummy = crypto.randomBytes(32).toString('base64');
    return { priv: dummy, pub: dummy };
  }
};

const buildClientTunnelBootstrapCommand = (tunnelConfig) => {
  const protectedCidrs = String(process.env.SBS_PROTECTED_CIDRS || '').trim();

  return `
mkdir -p /opt/sbs-agent /var/log/sbs
touch /var/log/sbs/agent.log
cat <<'TUNNEL_SCRIPT_EOF' > /opt/sbs-agent/setup-tunnel-client.sh
${CLIENT_TUNNEL_SCRIPT_SOURCE}
TUNNEL_SCRIPT_EOF
chmod +x /opt/sbs-agent/setup-tunnel-client.sh
cat <<'TUNNEL_ENV_EOF' > /opt/sbs-agent/tunnel.env
SBS_TUNNEL_NAME=${tunnelConfig.tunnelName}
SBS_GUARD_PUBLIC_IP=${tunnelConfig.guardPublicIp}
SBS_GUARD_TUNNEL_IP=${tunnelConfig.guardTunnelIp}
SBS_CLIENT_TUNNEL_IP=${tunnelConfig.clientTunnelIp}
SBS_TUNNEL_CIDR=${tunnelConfig.tunnelCidr || 30}
SBS_PROTECTED_CIDRS=${protectedCidrs}
SBS_CLIENT_PRIVATE_KEY=${tunnelConfig.clientPrivateKey}
SBS_GUARD_PUBLIC_KEY=${tunnelConfig.guardPublicKey}
SBS_GUARD_PORT=${tunnelConfig.listenPort || 51820}
TUNNEL_ENV_EOF
cat <<'TUNNEL_UNIT_EOF' > /etc/systemd/system/sbs-tunnel.service
${CLIENT_TUNNEL_SERVICE_UNIT}
TUNNEL_UNIT_EOF
sed -i 's/\r$//' /opt/sbs-agent/setup-tunnel-client.sh /opt/sbs-agent/tunnel.env /etc/systemd/system/sbs-tunnel.service
systemctl daemon-reload
systemctl enable sbs-tunnel.service
systemctl reset-failed sbs-tunnel.service || true
if ! systemctl restart sbs-tunnel.service; then
  systemctl status sbs-tunnel.service --no-pager >> /var/log/sbs/agent.log 2>&1 || true
  journalctl -u sbs-tunnel.service -n 30 --no-pager >> /var/log/sbs/agent.log 2>&1 || true
  exit 1
fi
`.trim();
};

const buildClientTunnelRemovalCommand = () => `
if systemctl list-unit-files sbs-tunnel.service >/dev/null 2>&1; then
  systemctl disable --now sbs-tunnel.service || systemctl stop sbs-tunnel.service || true
fi
if [ -f /opt/sbs-agent/setup-tunnel-client.sh ]; then
  /opt/sbs-agent/setup-tunnel-client.sh remove || true
fi
rm -f /opt/sbs-agent/tunnel.env
rm -f /etc/systemd/system/sbs-tunnel.service
systemctl daemon-reload || true
systemctl reset-failed sbs-tunnel.service || true
`.trim();

function detectGuardFirewallTable() {
  const { execFileSync } = require('child_process');
  const candidates = [
    { family: 'inet', table: 'detroit_guard' },
    { family: 'inet', table: 'sbs_filter' },
  ];

  for (const candidate of candidates) {
    try {
      execFileSync('nft', ['list', 'table', candidate.family, candidate.table], {
        stdio: ['ignore', 'ignore', 'ignore'],
      });
      return candidate;
    } catch (_) {
      // keep checking
    }
  }

  return { family: 'inet', table: 'detroit_guard' };
}

function execNft(args) {
  const { execFileSync } = require('child_process');
  try {
    return execFileSync('nft', args, { encoding: 'utf8' });
  } catch (err) {
    const stderr = err.stderr ? String(err.stderr).trim() : '';
    const stdout = err.stdout ? String(err.stdout).trim() : '';
    throw new Error(stderr || stdout || err.message);
  }
}

function appendAttackLog(message) {
  try {
    fs.mkdirSync('/var/log/sbs', { recursive: true });
    fs.appendFileSync(
      '/var/log/sbs/attacks.log',
      `[${new Date().toISOString()}] ${message}\n`
    );
  } catch (_) {
    // Non-fatal: guard logging should never break request handling.
  }
}

function ensureGuardBlacklistSet() {
  const target = detectGuardFirewallTable();

  try {
    execNft(['list', 'table', target.family, target.table]);
  } catch (_) {
    execNft(['add', 'table', target.family, target.table]);
  }

  try {
    execNft(['list', 'chain', target.family, target.table, 'input']);
  } catch (_) {
    execNft(['add', 'chain', target.family, target.table, 'input', '{', 'type', 'filter', 'hook', 'input', 'priority', '0;', 'policy', 'accept;', '}']);
  }

  try {
    execNft(['list', 'set', target.family, target.table, 'blacklist']);
  } catch (_) {
    execNft(['add', 'set', target.family, target.table, 'blacklist', '{', 'type', 'ipv4_addr;', 'flags', 'dynamic,timeout;', 'timeout', '24h;', '}']);
  }

  try {
    execNft(['list', 'chain', target.family, target.table, 'input']);
    const inputRules = execNft(['list', 'chain', target.family, target.table, 'input']);
    if (!inputRules.includes('ip saddr @blacklist drop')) {
      execNft(['insert', 'rule', target.family, target.table, 'input', 'ip', 'saddr', '@blacklist', 'drop']);
    }
  } catch (err) {
    throw new Error(`Unable to ensure guard blacklist rule: ${err.message}`);
  }

  return target;
}

function listGuardBlockedIps() {
  const target = ensureGuardBlacklistSet();
  const output = execNft(['list', 'set', target.family, target.table, 'blacklist']);
  const ips = [...new Set(output.match(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g) || [])];
  return { ...target, ips, output };
}

function addGuardBlockedIp(ip) {
  const safeIp = assertValidIpv4(ip);
  const target = ensureGuardBlacklistSet();
  try {
    execNft(['add', 'element', target.family, target.table, 'blacklist', `{ ${safeIp} }`]);
  } catch (err) {
    if (!/File exists/i.test(err.message)) throw err;
  }
  return listGuardBlockedIps();
}

function removeGuardBlockedIp(ip) {
  const safeIp = assertValidIpv4(ip);
  const target = ensureGuardBlacklistSet();
  try {
    execNft(['delete', 'element', target.family, target.table, 'blacklist', `{ ${safeIp} }`]);
  } catch (err) {
    if (!/No such file or directory|Could not process rule/i.test(err.message)) throw err;
  }
  return listGuardBlockedIps();
}

async function syncTunnelProfileStatus(agentId, nextStatus, clientIp = null) {
  if (!ADMIN_FEATURES_ENABLED) return;
  if (!db.profileTunnelStatus) db.profileTunnelStatus = {};
  if (db.profileTunnelStatus[agentId] === nextStatus) return;

  db.profileTunnelStatus[agentId] = nextStatus;
  const payload = { tunnel_status: nextStatus };
  if (clientIp) payload.client_ip = clientIp;
  await supabaseAdmin.from('user_profiles').update(payload).eq('agent_id', agentId);
}

// Middleware
const authMiddleware = async (req, res, next) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'No token provided' });
  
  try {
    const { data: { user }, error } = await supabase.auth.getUser(token);
    if (error || !user) throw new Error('Invalid token');
    
    // Create an authenticated client to fetch user_profiles (respects RLS)
    const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: `Bearer ${token}` } }
    });
    
    const { data: profile } = await userClient.from('user_profiles').select('*').eq('id', user.id).single();
    if (!profile) throw new Error('Profile not found');
    
    if (profile.status === 'pending') {
      return res.status(403).json({ error: 'Account pending approval from administrator.', isPending: true });
    }
    if (profile.status === 'rejected') {
      return res.status(403).json({ error: 'Account rejected.' });
    }
    
    req.user = { ...user, ...profile };
    next();
  } catch (err) {
    res.status(401).json({ error: err.message });
  }
};

const adminMiddleware = (req, res, next) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
  next();
};

const privilegedSupabaseMiddleware = (req, res, next) => {
  if (!ADMIN_FEATURES_ENABLED) {
    return res.status(503).json({
      error: 'Admin features require SUPABASE_SERVICE_KEY or SUPABASE_SERVICE_ROLE_KEY in the server environment.'
    });
  }
  next();
};

async function verifyAgentCredentials(agentId, apiKey) {
  if (!ADMIN_FEATURES_ENABLED) {
    const err = new Error('Agent authentication requires SUPABASE_SERVICE_KEY or SUPABASE_SERVICE_ROLE_KEY in the server environment.');
    err.statusCode = 503;
    throw err;
  }

  const { data, error } = await supabaseAdmin
    .from('user_profiles')
    .select('id')
    .eq('agent_id', agentId)
    .eq('api_key', apiKey)
    .limit(1);

  if (error) throw error;
  return data?.[0]?.id || null;
}

const agentAuthMiddleware = async (req, res, next) => {
  try {
    const body = (req && req.body && typeof req.body === 'object') ? req.body : {};
    const query = (req && req.query && typeof req.query === 'object') ? req.query : {};
    const agentId = body.agentId || query.agentId;
    const apiKey = body.apiKey || query.apiKey;

    if (!agentId || !apiKey) {
      return res.status(401).json({ error: 'Missing agent credentials' });
    }

    const userId = await verifyAgentCredentials(agentId, apiKey);

    if (!userId) {
      return res.status(401).json({ error: 'Invalid agent credentials' });
    }

    req.user = { id: userId, agentId };
    next();
  } catch (err) {
    if (err.statusCode) {
      return res.status(err.statusCode).json({ error: err.message });
    }
    console.error('[agent-auth] middleware failed:', err);
    return res.status(400).json({ error: 'Malformed agent request' });
  }
};

// Routes
app.post('/api/auth/register', async (req, res) => {
  const { username, email, password } = req.body;
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: { username }
    }
  });
  
  if (error) return res.status(400).json({ error: error.message });
  res.json({ success: true });
});

app.post('/api/auth/login', async (req, res) => {
  const { username, password } = req.body; // In Supabase, we log in with email.
  // The frontend currently passes "username" which could be an email or username.
  // Supabase signInWithPassword expects an email. We will assume 'username' field contains the email for now.
  const email = username; 
  
  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password
  });
  
  if (error) return res.status(401).json({ error: error.message });
  
  const token = data.session.access_token;
  // Fetch profile to return
  const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${token}` } }
  });
  const { data: profile } = await userClient.from('user_profiles').select('*').eq('id', data.user.id).single();
  
  if (profile?.status === 'pending') {
    return res.status(403).json({ error: 'Account pending approval from administrator.' });
  }
  if (profile?.status === 'rejected') {
    return res.status(403).json({ error: 'Account rejected.' });
  }
  
  res.json({ 
    token, 
    user: { 
      username: profile?.username || data.user.email, 
      apiKey: profile?.api_key, 
      agentId: profile?.agent_id,
      role: profile?.role
    } 
  });
});

app.get('/api/me', authMiddleware, (req, res) => {
  const agentStatus = db.agents[req.user.agent_id] ? 'CONNECTED' : 'NO AGENT';
  res.json({
    id: req.user.id,
    username: req.user.username,
    email: req.user.email,
    apiKey: req.user.api_key,
    agentId: req.user.agent_id,
    role: req.user.role,
    agentStatus
  });
});

app.post('/api/me/regenerate-key', authMiddleware, privilegedSupabaseMiddleware, async (req, res) => {
  const newKey = 'sbs_' + crypto.randomBytes(16).toString('hex');
  const { error } = await supabaseAdmin
    .from('user_profiles')
    .update({ api_key: newKey })
    .eq('id', req.user.id);

  if (error) return res.status(500).json({ error: error.message });
  res.json({ apiKey: newKey });
});

app.get('/api/admin/users', authMiddleware, adminMiddleware, privilegedSupabaseMiddleware, async (req, res) => {
  const { data, error } = await supabaseAdmin.from('user_profiles').select('*');
  if (error) return res.status(500).json({ error: error.message });
  res.json(data || []);
});

app.post('/api/admin/approve', authMiddleware, adminMiddleware, privilegedSupabaseMiddleware, async (req, res) => {
  const { id } = req.body;
  const { error } = await supabaseAdmin.from('user_profiles').update({ status: 'approved' }).eq('id', id);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ success: true });
});

app.post('/api/admin/reject', authMiddleware, adminMiddleware, privilegedSupabaseMiddleware, async (req, res) => {
  const { id } = req.body;
  const { error } = await supabaseAdmin.from('user_profiles').update({ status: 'rejected' }).eq('id', id);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ success: true });
});

app.get('/api/guard/blocklist', authMiddleware, adminMiddleware, (req, res) => {
  try {
    const result = listGuardBlockedIps();
    res.json({
      ips: result.ips,
      table: `${result.family} ${result.table}`,
    });
  } catch (err) {
    res.status(500).json({ error: err.message || 'Failed to read guard blocklist.' });
  }
});

app.post('/api/guard/blocklist', authMiddleware, adminMiddleware, (req, res) => {
  try {
    const ip = assertValidIpv4(req.body?.ip);
    const result = addGuardBlockedIp(ip);
    appendAttackLog(`[manual-ban] ${ip} blocked from dashboard by ${req.user.username || req.user.email || req.user.id}`);
    broadcastGlobalBan(ip);
    res.json({
      success: true,
      ips: result.ips,
      table: `${result.family} ${result.table}`,
    });
  } catch (err) {
    res.status(400).json({ error: err.message || 'Failed to ban IP on guard firewall.' });
  }
});

app.delete('/api/guard/blocklist/:ip', authMiddleware, adminMiddleware, (req, res) => {
  try {
    const ip = assertValidIpv4(req.params.ip);
    const result = removeGuardBlockedIp(ip);
    appendAttackLog(`[manual-unban] ${ip} removed from dashboard by ${req.user.username || req.user.email || req.user.id}`);
    broadcastGlobalUnban(ip);
    res.json({
      success: true,
      ips: result.ips,
      table: `${result.family} ${result.table}`,
    });
  } catch (err) {
    res.status(400).json({ error: err.message || 'Failed to unban IP on guard firewall.' });
  }
});

// Agent Installer Download
app.get('/api/agent/download', authMiddleware, (req, res) => {
  const requestedOs = String(req.query.os || 'ubuntu').toLowerCase();
  const osType = ['ubuntu', 'debian'].includes(requestedOs) ? requestedOs : 'ubuntu';
  const fallbackServerUrl = req.protocol + '://' + req.get('host');
  const requestedServerUrl = String(req.query.serverUrl || fallbackServerUrl).trim();
  let serverUrl = fallbackServerUrl;
  try {
    const parsed = new URL(requestedServerUrl);
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
      serverUrl = parsed.origin;
    }
  } catch (_) {
    serverUrl = fallbackServerUrl;
  }
  
  let osCheckScript = `OS_VERSION=$(grep -oP '(?<=^VERSION_ID=").*(?=")' /etc/os-release)
if [[ "$osType" == "ubuntu" ]]; then
  if [[ "$OS_VERSION" != "20.04" && "$OS_VERSION" != "22.04" && "$OS_VERSION" != "24.04" ]]; then
    echo "Unsupported Ubuntu version."
    exit 1
  fi
elif [[ "$osType" == "debian" ]]; then
  if [[ "$OS_VERSION" != "11" && "$OS_VERSION" != "12" && "$OS_VERSION" != "13" ]]; then
    echo "Unsupported Debian version."
    exit 1
  fi
fi`;

  const script = `#!/bin/bash
# SBS Agent Installer
if [ "$EUID" -ne 0 ]; then
  echo "Please run as root"
  exit 1
fi

osType="${osType}"
${osCheckScript}

echo "Installing dependencies and preparing system..."
apt-get update -qq
apt-get install -y ca-certificates curl gnupg kmod nftables iproute2 net-tools jq wireguard wireguard-tools procps < /dev/null

# Kernel tweaks for networking and tunneling
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

if ! command -v node &> /dev/null; then
  echo "Installing Node.js 20.x..."
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt-get install -y nodejs < /dev/null
fi

mkdir -p /opt/sbs-agent
cat << 'AGENT_JS_EOF' > /opt/sbs-agent/agent.js
const fs = require('fs');
const { exec, execSync } = require('child_process');
const http = require('http');
const https = require('https');
const os = require('os');

function getCpuUsage() {
  const cpus = os.cpus();
  let user = 0, nice = 0, sys = 0, idle = 0, irq = 0;
  for (let cpu in cpus) {
    user += cpus[cpu].times.user;
    nice += cpus[cpu].times.nice;
    sys += cpus[cpu].times.sys;
    idle += cpus[cpu].times.idle;
    irq += cpus[cpu].times.irq;
  }
  return { total: user + nice + sys + idle + irq, active: user + nice + sys + irq };
}

let lastCpu = getCpuUsage();

const config = {
  server: process.env.SBS_SERVER,
  agentId: process.env.SBS_AGENT_ID,
  apiKey: process.env.SBS_API_KEY,
  enableTunnel: process.env.SBS_ENABLE_TUNNEL === '1'
};

const TUNNEL_RETRY_MS = 60000;
let tunnelRegisterInFlight = false;
let tunnelRegistered = false;
let lastTunnelRegisterAt = 0;

function log(message) {
  const line = '[' + new Date().toISOString() + '] ' + message;
  try {
    fs.appendFileSync('/var/log/sbs/agent.log', line + '\\n');
  } catch (e) {}
  console.log(line);
}

function makeRequest(path, method, data, callback, redirectCount = 0) {
  const url = new URL(path, config.server);
  const reqModule = url.protocol === 'https:' ? https : http;
  const options = {
    method,
    headers: {
      'Content-Type': 'application/json',
      'User-Agent': 'sbs-agent/1.0'
    }
  };
  const req = reqModule.request(url, options, (res) => {
    let body = '';
    res.on('data', chunk => body += chunk);
    res.on('end', () => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && redirectCount < 3) {
        const redirectedUrl = new URL(res.headers.location, url);
        config.server = redirectedUrl.origin;
        return makeRequest(redirectedUrl.pathname + redirectedUrl.search, method, data, callback, redirectCount + 1);
      }
      if (res.statusCode < 200 || res.statusCode >= 300) {
        const error = new Error('HTTP ' + res.statusCode + ' for ' + path + ': ' + body);
        error.statusCode = res.statusCode;
        return callback && callback(error, body);
      }
      callback && callback(null, body);
    });
  });
  req.on('error', (e) => callback && callback(e));
  if (data) req.write(JSON.stringify(data));
  req.end();
}

function registerTunnel(reason = 'register') {
  if (!config.enableTunnel || tunnelRegisterInFlight || tunnelRegistered) return;

  const now = Date.now();
  if (now - lastTunnelRegisterAt < TUNNEL_RETRY_MS) return;

  tunnelRegisterInFlight = true;
  lastTunnelRegisterAt = now;
  log('[tunnel] registering with guard (' + reason + ')');

  makeRequest('/api/agent/tunnel/create', 'POST', {
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

function register() {
  makeRequest('/api/agent/register', 'POST', {
    agentId: config.agentId,
    apiKey: config.apiKey,
    hostname: fs.readFileSync('/proc/sys/kernel/hostname', 'utf-8').trim(),
    ip: 'auto',
    os: '${osType === 'debian' ? 'Debian' : 'Ubuntu'}',
    arch: process.arch
  }, (err) => {
    if (err) {
      log('[register] ' + err.message);
      return;
    }
    log('[register] connected to panel');
    if (config.enableTunnel) {
      log('[tunnel] waiting for registration to settle...');
      setTimeout(() => registerTunnel('initial register'), 2000);
    }
  });
}

// Read /proc/net/dev and return {rx, tx} bytes for the primary interface
let cachedPrimaryIface = '';

function getPrimaryInterface() {
  if (cachedPrimaryIface) return cachedPrimaryIface;
  try {
    cachedPrimaryIface = execSync("ip -o -4 route show to default 2>/dev/null | awk '{print $5; exit}'", {
      encoding: 'utf8',
      timeout: 800,
      stdio: ['ignore', 'pipe', 'ignore']
    }).trim();
  } catch (_) {
    cachedPrimaryIface = '';
  }
  return cachedPrimaryIface;
}

function readNetBytes(cb) {
  const { exec } = require('child_process');
  const iface = String(getPrimaryInterface() || '').replace(/[^A-Za-z0-9_.:-]/g, '');
  const cmd = "awk 'NR>2 {name=$1; gsub(\":\",\"\",name); if(name!=\"lo\"){print name,$2,$3,$10,$11}}' /proc/net/dev";

  exec(cmd, (err, out) => {
    if ((!out || !out.trim()) && iface) {
      cachedPrimaryIface = '';
      return readNetBytes(cb);
    }
    if (err || !out.trim()) return cb(null, { rx: 0, tx: 0, iface: 'unknown' });
    const rows = out
      .trim()
      .split('\n')
      .map((line) => line.trim().split(/\s+/))
      .filter((parts) => parts.length >= 5);

    if (rows.length === 0) return cb(null, { rx: 0, tx: 0, iface: 'unknown' });

    const preferredRow = iface
      ? rows.find((parts) => String(parts[0]) === iface)
      : null;
    const displayIface = preferredRow ? String(preferredRow[0]) : String(rows[0][0]);

    const totals = rows.reduce((acc, parts) => {
      acc.rx += parseInt(parts[1], 10) || 0;
      acc.rxPackets += parseInt(parts[2], 10) || 0;
      acc.tx += parseInt(parts[3], 10) || 0;
      acc.txPackets += parseInt(parts[4], 10) || 0;
      return acc;
    }, { rx: 0, tx: 0, rxPackets: 0, txPackets: 0 });

    cb(null, {
      iface: displayIface || 'unknown',
      rx: totals.rx,
      rxPackets: totals.rxPackets,
      tx: totals.tx,
      txPackets: totals.txPackets
    });
  });
}

let lastNetSample = { rx: 0, tx: 0, rxPackets: 0, txPackets: 0, ts: Date.now() };

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
  return {
    ip: host,
    port: Number.isFinite(portNumber) ? portNumber : null
  };
}

function isServicePort(port) {
  return [20, 21, 22, 25, 53, 80, 110, 143, 443, 465, 587, 993, 995, 3000, 3001, 51820].includes(Number(port));
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
  const riskyPorts = [23, 135, 139, 445, 1433, 3306, 3389, 5432, 5900, 6379, 9200, 11211];
  if (/SYN-RECV/i.test(event.state) || (event.direction === 'incoming' && riskyPorts.includes(Number(event.localPort)))) {
    return { severity: 'danger', reason: 'suspicious inbound service probe' };
  }
  if (event.sizeBytes >= 65536 || /CLOSE-WAIT|LAST-ACK/i.test(event.state)) {
    return { severity: 'warning', reason: 'large queued packet data' };
  }
  if (event.direction === 'incoming' && !isServicePort(event.localPort)) {
    return { severity: 'warning', reason: 'inbound non-standard port' };
  }
  return { severity: 'success', reason: 'normal flow' };
}

function interfaceSeverity(direction, mbps, packets) {
  if (mbps >= 50 || packets >= 5000) {
    return { severity: 'danger', reason: direction + ' flood-rate traffic' };
  }
  if (mbps >= 10 || packets >= 1000) {
    return { severity: 'warning', reason: direction + ' elevated traffic' };
  }
  if (packets > 0) {
    return { severity: 'success', reason: direction + ' normal traffic' };
  }
  return { severity: 'success', reason: direction + ' idle' };
}

function buildInterfaceTrafficEvents(netNow, rxDiff, txDiff, rxPacketDiff, txPacketDiff, inMbps, outMbps, avgPacketBytes) {
  const now = new Date().toISOString();
  const iface = netNow.iface || 'unknown';
  const incoming = {
    timestamp: now,
    direction: 'incoming',
    protocol: 'IFACE',
    sourceLabel: 'network',
    destinationLabel: iface,
    localIp: iface,
    localPort: null,
    remoteIp: 'network',
    remotePort: null,
    state: rxPacketDiff > 0 ? 'RX' : 'IDLE',
    recvQ: 0,
    sendQ: 0,
    packets: rxPacketDiff,
    sizeBytes: rxDiff,
    avgPacketBytes,
    rateMbps: inMbps,
    iface,
    ...interfaceSeverity('incoming', inMbps, rxPacketDiff)
  };
  const outgoing = {
    timestamp: now,
    direction: 'outgoing',
    protocol: 'IFACE',
    sourceLabel: iface,
    destinationLabel: 'network',
    localIp: iface,
    localPort: null,
    remoteIp: 'network',
    remotePort: null,
    state: txPacketDiff > 0 ? 'TX' : 'IDLE',
    recvQ: 0,
    sendQ: 0,
    packets: txPacketDiff,
    sizeBytes: txDiff,
    avgPacketBytes,
    rateMbps: outMbps,
    iface,
    ...interfaceSeverity('outgoing', outMbps, txPacketDiff)
  };
  return [incoming, outgoing];
}

function collectTrafficEvents(iface) {
  try {
    const output = execSync('ss -Htuna 2>/dev/null | head -n 80', {
      encoding: 'utf8',
      timeout: 1200,
      stdio: ['ignore', 'pipe', 'ignore']
    });
    const now = new Date().toISOString();
    return output
      .split('\\n')
      .map(line => line.trim())
      .filter(Boolean)
      .map((line) => {
        const parts = line.split(/\s+/);
        if (parts.length < 6) return null;
        const protocol = String(parts[0] || '').toUpperCase();
        if (protocol !== 'TCP' && protocol !== 'UDP') return null;
        const state = parts[1] || '-';
        const recvQ = parseInt(parts[2]) || 0;
        const sendQ = parseInt(parts[3]) || 0;
        const local = parseEndpoint(parts[4]);
        const remote = parseEndpoint(parts[5]);
        if (!local || !remote) return null;
        const direction = classifyDirection(local, remote);
        const base = {
          timestamp: now,
          direction,
          protocol,
          localIp: local.ip,
          localPort: local.port,
          remoteIp: remote.ip,
          remotePort: remote.port,
          state,
          recvQ,
          sendQ,
          packets: null,
          sizeBytes: recvQ + sendQ,
          avgPacketBytes: 0,
          rateMbps: 0,
          iface: iface || 'unknown'
        };
        return { ...base, ...classifyTrafficSeverity(base) };
      })
      .filter(Boolean)
      .slice(0, 30);
  } catch (_) {
    return [];
  }
}

function sendStats() {
  // Step 1: snapshot network bytes NOW before running the bash block
  readNetBytes((_, netNow) => {
    const elapsed = (Date.now() - lastNetSample.ts) / 1000 || 1;
    const rxDiff  = Math.max(0, netNow.rx - lastNetSample.rx);
    const txDiff  = Math.max(0, netNow.tx - lastNetSample.tx);
    const rxPacketDiff = Math.max(0, (netNow.rxPackets || 0) - (lastNetSample.rxPackets || 0));
    const txPacketDiff = Math.max(0, (netNow.txPackets || 0) - (lastNetSample.txPackets || 0));
    const packetDiff = rxPacketDiff + txPacketDiff;
    const inMbps  = parseFloat(((rxDiff * 8) / elapsed / 1_000_000).toFixed(3));
    const outMbps = parseFloat(((txDiff * 8) / elapsed / 1_000_000).toFixed(3));
    const pps = parseFloat((packetDiff / elapsed).toFixed(1));
    const avgPacketBytes = packetDiff > 0 ? Math.round((rxDiff + txDiff) / packetDiff) : 0;
    lastNetSample = { rx: netNow.rx, tx: netNow.tx, rxPackets: netNow.rxPackets || 0, txPackets: netNow.txPackets || 0, ts: Date.now() };
    const trafficEvents = [
      ...buildInterfaceTrafficEvents(netNow, rxDiff, txDiff, rxPacketDiff, txPacketDiff, inMbps, outMbps, avgPacketBytes),
      ...collectTrafficEvents(netNow.iface),
    ];

    // Step 2: collect system stats + SSH log + attack log
    exec(
      "ss -ant | wc -l; " +
      "ss -ant | grep ESTAB | wc -l; " +
      "ss -ant | grep SYN-RECV | wc -l; " +
      "NFT_TABLE=$(nft list table inet detroit_guard >/dev/null 2>&1 && echo 'inet detroit_guard' || echo 'inet sbs_filter'); " +
      "nft list set $NFT_TABLE blacklist 2>/dev/null | grep -oE '([0-9]{1,3}\\.){3}[0-9]{1,3}' | wc -l; " +
      "free | grep Mem | awk '{print $3/$2 * 100}'; " +
      "cat /proc/uptime | awk '{print $1}'; " +
      "ss -anu | wc -l; " +
      // SSH events — accepted / failed / invalid from auth.log
      "grep -E 'Accepted|Failed|Invalid|Disconnected' /var/log/auth.log 2>/dev/null | tail -n 20 || " +
      "grep -E 'Accepted|Failed|Invalid|Disconnected' /var/log/secure 2>/dev/null | tail -n 20 || echo ''; " +
      // Attack log
      "echo '---ATTACKS---'; " +
      "tail -n 10 /var/log/sbs/attacks.log 2>/dev/null || echo ''",
      (err, stdout) => {
        if (err || !stdout) return;
        const raw   = stdout;
        const lines = raw.split('\\n');

        const currentCpu = getCpuUsage();
        const totalDiff  = currentCpu.total - lastCpu.total;
        const activeDiff = currentCpu.active - lastCpu.active;
        const cpuPercent = totalDiff === 0 ? 0 : (activeDiff / totalDiff) * 100;
        lastCpu = currentCpu;

        // Split log sections
        const attackSep   = lines.findIndex(l => l.includes('---ATTACKS---'));
        const sshLines    = lines.slice(7, attackSep >= 0 ? attackSep : lines.length);
        const attackLines = attackSep >= 0 ? lines.slice(attackSep + 1) : [];

        const logOutput = [
          ...sshLines.filter(l => l.trim()).map(l => '[SSH] ' + l.trim()),
          ...attackLines.filter(l => l.trim()).map(l => '[FW]  ' + l.trim()),
        ].join('\\n');
        
        const tunnelName = 'sbs_' + String(config.agentId || '').substring(0, 8);
        const tunnelPresent = fs.existsSync('/sys/class/net/' + tunnelName);
        if (tunnelPresent) tunnelRegistered = true;

        if (config.enableTunnel && !tunnelPresent && (Date.now() - (global.lastTunnelRetry || 0)) > TUNNEL_RETRY_MS) {
          log('[tunnel] interface missing, attempting auto-recovery...');
          global.lastTunnelRetry = Date.now();
          tunnelRegistered = false;
          registerTunnel('missing interface');
        }

        makeRequest('/api/agent/stats', 'POST', {
          agentId:    config.agentId,
          apiKey:     config.apiKey,
          connections: parseInt(lines[0]) || 0,
          established: parseInt(lines[1]) || 0,
          synRate:     parseInt(lines[2]) || 0,
          bannedIPs:   parseInt(lines[3]) || 0,
          cpuPercent:  parseFloat(cpuPercent.toFixed(1)) || 0,
          memPercent:  parseFloat(lines[4]) || 0,
          inMbps,
          outMbps,
          pps,
          avgPacketBytes,
          uptime: parseFloat(lines[5]) || 0,
          udpConns: parseInt(lines[6]) || 0,
          log:   logOutput,
          iface: netNow.iface,
          trafficEvents,
          tunnelName,
          tunnelPresent,
        });
      }
    );
  });
}

function pollCommands() {
  makeRequest('/api/agent/commands?agentId=' + config.agentId + '&apiKey=' + config.apiKey, 'GET', null, (err, res) => {
    if (err || !res) return;
    try {
      const cmds = JSON.parse(res);
      cmds.forEach(cmd => {
        log('[command] running ' + (cmd.kind || 'shell') + ' (' + cmd.id + ')');
        exec(cmd.cmd, { timeout: 45000, maxBuffer: 1024 * 1024, shell: '/bin/bash' }, (error, stdout, stderr) => {
          const output = (stdout || '') + (stderr || '') + (error && error.killed ? '\\n[command] timed out' : '');
          log('[command] ' + cmd.id + ' ' + (error ? 'failed' : 'completed') + ' with exit ' + (error ? (error.code || 1) : 0));
          makeRequest('/api/agent/command-result', 'POST', {
            agentId: config.agentId,
            apiKey: config.apiKey,
            cmdId: cmd.id,
            kind: cmd.kind || null,
            output,
            exitCode: error ? (typeof error.code === 'number' ? error.code : 1) : 0
          });
        });
      });
    } catch(e) {}
  });
}

register();
setInterval(register, 15000);
setInterval(sendStats, 1000);
setInterval(pollCommands, 1000);
AGENT_JS_EOF

cat << ENV_EOF > /opt/sbs-agent/.env
SBS_SERVER=${serverUrl}
SBS_AGENT_ID=${req.user.agent_id}
SBS_API_KEY=${req.user.api_key}
SBS_ENABLE_TUNNEL=1
ENV_EOF

cat << 'TUNNEL_SH_EOF' > /opt/sbs-agent/setup-tunnel-client.sh
${CLIENT_TUNNEL_SCRIPT_SOURCE}
TUNNEL_SH_EOF
chmod +x /opt/sbs-agent/setup-tunnel-client.sh

mkdir -p /var/log/sbs
touch /var/log/sbs/attacks.log
touch /var/log/sbs/agent.log

cat << 'NFT_EOF' > /etc/nftables.conf
#!/usr/sbin/nft -f
flush ruleset

table inet detroit_guard {
  set blacklist {
    type ipv4_addr
    flags timeout
  }

  chain input {
    type filter hook input priority 0; policy accept;
    ct state invalid drop
    ct state established,related accept
    iif lo accept
    ip saddr @blacklist drop
    
    tcp flags syn limit rate 1000/second accept
    tcp flags syn drop
    
    meta l4proto udp limit rate 10000/second accept
    meta l4proto udp drop
    
    ip protocol icmp limit rate 10/second accept
    ip protocol icmp drop
  }
}
NFT_EOF
systemctl enable nftables
systemctl restart nftables

cat << 'AGENT_SVC_EOF' > /etc/systemd/system/sbs-agent.service
[Unit]
Description=SBS Agent
After=network.target

[Service]
Type=simple
User=root
EnvironmentFile=/opt/sbs-agent/.env
WorkingDirectory=/opt/sbs-agent
ExecStart=/usr/bin/node /opt/sbs-agent/agent.js
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
AGENT_SVC_EOF

cat << 'TUNNEL_SVC_EOF' > /etc/systemd/system/sbs-tunnel.service
${CLIENT_TUNNEL_SERVICE_UNIT}
TUNNEL_SVC_EOF

sed -i 's/\r$//' /opt/sbs-agent/agent.js /opt/sbs-agent/.env /opt/sbs-agent/setup-tunnel-client.sh /etc/nftables.conf /etc/systemd/system/sbs-agent.service /etc/systemd/system/sbs-tunnel.service

systemctl daemon-reload
systemctl enable sbs-agent
systemctl restart sbs-agent
if [ -f /opt/sbs-agent/tunnel.env ]; then
  systemctl enable sbs-tunnel 2>/dev/null || true
  systemctl restart sbs-tunnel 2>/dev/null || true
else
  systemctl disable sbs-tunnel 2>/dev/null || true
fi

echo "=============================================="
echo "  SBS Agent installation complete! ✓"
echo "  Agent ID: ${req.user.agent_id}"
echo "=============================================="
`;
  res.setHeader('Content-Type', 'text/x-shellscript');
  res.setHeader('Content-Disposition', `attachment; filename="sbs-agent-${req.user.agent_id}.sh"`);
  res.send(script);
});

// Agent endpoints
app.post('/api/agent/register', agentAuthMiddleware, (req, res) => {
  const { agentId } = req.user;
  const requestIp = normalizeIp(req.headers['x-forwarded-for'] || req.socket.remoteAddress);
  const agent = upsertAgentState(agentId, {
    userId: req.user.id,
    hostname: req.body.hostname,
    ip: requestIp,
    os: req.body.os,
    arch: req.body.arch
  });
  console.log(`[agent] Registered ${agentId} from ${agent.ip} (${agent.hostname || 'unknown-host'})`);
  broadcastToUser(req.user.id, buildAgentConnectedMessage(agent));
  res.json({ success: true });
});

app.post('/api/agent/stats', agentAuthMiddleware, (req, res) => {
  const { agentId } = req.user;
  const requestIp = normalizeIp(req.headers['x-forwarded-for'] || req.socket.remoteAddress);
  const stats = req.body;
  const tunnelName = stats?.tunnelName || getTunnelInterfaceName(agentId);
  const tunnelPresent = Boolean(stats?.tunnelPresent);
  const agent = upsertAgentState(agentId, {
    userId: req.user.id,
    ip: requestIp,
    stats,
    tunnelName,
    tunnelPresent
  });

  const guardState = readGuardTunnelState(agentId);
  const hasExpectedTunnel = Boolean(getTunnelConfig(agentId));
  const nextTunnelStatus = guardState.exists && tunnelPresent
    ? 'active'
    : (guardState.exists || tunnelPresent || hasExpectedTunnel ? 'degraded' : 'inactive');

  syncTunnelProfileStatus(agentId, nextTunnelStatus, requestIp).catch((err) => {
    console.error(`[tunnel] failed to sync profile status for ${agentId}:`, err.message);
  });

  // Wake up Radar if it's enabled to ensure real-time protection for new connections
  if (radar && radar.config.enabled) {
    radar.scan({ manual: false }).catch(() => {});
  }

  // Cache the latest stats per user so the frontend can fetch them on page load
  if (!db.lastStats) db.lastStats = {};
  db.lastStats[req.user.id] = {
    stats,
    agent: { agentId, hostname: agent.hostname || '-', ip: agent.ip || '-', os: agent.os || 'Ubuntu' },
    savedAt: Date.now(),
  };

  appendClientLog(agentId, {
    type: 'stats_update',
    at: new Date().toISOString(),
    userId: req.user.id,
    stats: {
      connections: stats?.connections ?? 0,
      established: stats?.established ?? 0,
      synRate: stats?.synRate ?? 0,
      bannedIPs: stats?.bannedIPs ?? 0,
      cpuPercent: stats?.cpuPercent ?? 0,
      memPercent: stats?.memPercent ?? 0,
      inMbps: stats?.inMbps ?? 0,
      outMbps: stats?.outMbps ?? 0,
      pps: stats?.pps ?? 0,
      uptime: stats?.uptime ?? 0,
      iface: stats?.iface || '-',
    },
  });
  writeClientLatestSnapshot(agentId, {
    userId: req.user.id,
    agent: { hostname: agent.hostname || '-', ip: agent.ip || '-', os: agent.os || 'Ubuntu' },
    stats,
  });
  persistRuntimeSnapshot();

  broadcastToUser(req.user.id, {
    type: 'stats_update',
    stats,
    log: stats.log,
    agentStatus: 'CONNECTED',
    agent: {
      hostname: agent.hostname || '-',
      ip: agent.ip || '-',
      os: agent.os || 'Ubuntu'
    }
  });
  res.json({ success: true });
});

// Frontend can call this on page load to get the last known stats immediately
app.get('/api/agent/last-stats', authMiddleware, (req, res) => {
  const cached = db.lastStats?.[req.user.id];
  if (!cached) return res.json({ available: false });
  // Only return if agent sent stats within the last 30 seconds
  if (Date.now() - cached.savedAt > 30000) return res.json({ available: false });
  res.json({ available: true, ...cached });
});

app.get('/api/agent/commands', agentAuthMiddleware, (req, res) => {
  const { agentId } = req.user;
  const cmds = commandQueue[agentId] || [];
  commandQueue[agentId] = [];
  cmds.forEach((cmd) => markCommandDispatched(cmd.id));
  res.json(cmds);
});

app.post('/api/agent/command-result', agentAuthMiddleware, (req, res) => {
  const { cmdId, output, exitCode, kind } = req.body;
  const result = recordCommandResult(cmdId, { output, exitCode, kind });
  appendClientLog(req.user.agentId, {
    type: 'command_result',
    at: new Date().toISOString(),
    cmdId,
    kind: result.kind || kind || null,
    status: result.status,
    exitCode: result.exitCode,
    summary: result.summary || null,
    output: trimCommandOutput(output, 2000),
  });
  persistRuntimeSnapshot();
  broadcastToUser(req.user.id, { type: 'command_result', cmdId, output, exitCode, kind: result.kind, status: result.status });
  res.json({ success: true });
});

app.post('/api/command', authMiddleware, (req, res) => {
  const { cmd } = req.body;
  const { agent_id, id: userId } = req.user;

  // Primary: exact agent_id match from user profile
  let targetAgentId = (agent_id && db.agents[agent_id]) ? agent_id : null;

  // Fallback: find any connected agent that belongs to this user
  if (!targetAgentId) {
    const found = Object.entries(db.agents).find(([, a]) => a.userId === userId);
    if (found) targetAgentId = found[0];
  }

  if (!targetAgentId) {
    return res.status(400).json({ error: 'No agent connected. Make sure your agent is running and registered.' });
  }

  const cmdObj = queueAgentCommand(targetAgentId, cmd, {
    kind: 'shell',
    summary: cmd.substring(0, 120)
  });
  appendClientLog(targetAgentId, {
    type: 'command_queued',
    at: new Date().toISOString(),
    userId,
    cmdId: cmdObj.id,
    summary: cmdObj.summary,
  });
  persistRuntimeSnapshot();

  console.log(`[cmd] Queued for agent ${targetAgentId}: ${cmd.substring(0, 80)}...`);
  res.json({ success: true, cmdId: cmdObj.id });
});


// WireGuard Tunnel Endpoints (User triggered)
app.post('/api/me/tunnel/create', authMiddleware, privilegedSupabaseMiddleware, async (req, res) => {
  const agentId = req.user.agent_id;
  const clientIp = db.agents[agentId]?.ip || normalizeIp(req.headers['x-forwarded-for'] || req.socket.remoteAddress);
  return setupTunnel(req, res, agentId, clientIp, {
    source: 'user',
    force: req.body?.force === true || req.query?.force === '1',
  });
});

// WireGuard Tunnel Endpoints (Agent triggered)
app.post('/api/agent/tunnel/create', agentAuthMiddleware, privilegedSupabaseMiddleware, async (req, res) => {
  const agentId = req.user.agentId;
  const clientIp = normalizeIp(req.body.clientIp || req.headers['x-forwarded-for'] || req.socket.remoteAddress);
  return setupTunnel(req, res, agentId, clientIp, { source: 'agent' });
});

async function setupTunnel(req, res, agentId, clientIp, options = {}) {
  console.log(`[tunnel] setupTunnel triggered for agentId: ${agentId}, clientIp: ${clientIp}`);

  if (!agentId) {
    return res.status(400).json({ error: 'No agent ID associated with this account.' });
  }

  if (!clientIp || clientIp === 'auto') {
    return res.status(400).json({ error: 'Could not determine client IP. Please ensure agent is connected.' });
  }

  if (!db.agents[agentId]) {
    return res.status(409).json({ error: 'Tunnel setup requires the agent to be connected so the client service can be provisioned.' });
  }

  try {
    const existingState = getTunnelRuntimeState(agentId);
    if (!options.force && shouldReuseTunnelSetup(existingState, options.source)) {
      const nextStatus = existingState.status === 'active' ? 'active' : 'provisioning';
      await syncTunnelProfileStatus(agentId, nextStatus, clientIp);

      return res.json({
        success: true,
        reused: true,
        status: nextStatus,
        tunnelName: existingState.tunnelName,
        guardInterfacePresent: existingState.systemState.exists,
        clientTunnelPresent: existingState.clientTunnelPresent,
        guardTunnelIp: existingState.tunnelConfig?.guardTunnelIp || null,
        clientTunnelIp: existingState.tunnelConfig?.clientTunnelIp || null,
        subnet: existingState.tunnelConfig?.subnet || null,
        statePath: existingState.tunnelConfig?.statePath || null,
        clientCommandId: existingState.lastTunnelCommand?.id || null,
        detail: 'Tunnel setup already active or in progress.',
      });
    }

    const guardPubIp = resolveGuardPublicIp(req);

    // Allocate config and generate keys if missing or invalid
    let tunnelConfig = getTunnelConfig(agentId);
    const hasInvalidKeys = tunnelConfig && (String(tunnelConfig.guardPrivateKey).includes('FALLBACK') || !tunnelConfig.guardPrivateKey);

    if (!tunnelConfig || hasInvalidKeys) {
      const guardKeys = generateWgKeys();
      const clientKeys = generateWgKeys();
      tunnelConfig = getOrAllocateTunnelConfig(agentId, {
        userId: req.user.id,
        clientPublicIp: clientIp,
        guardPublicIp: guardPubIp,
        guardPrivateKey: guardKeys.priv,
        guardPublicKey: guardKeys.pub,
        clientPrivateKey: clientKeys.priv,
        clientPublicKey: clientKeys.pub,
        listenPort: 51820 + (getTunnelConfig(agentId)?.subnetIndex || 0), // Spread ports if needed
      });
    }

    // 1. Setup Guard side
    console.log(`[tunnel] Setting up guard WG for agent ${agentId} at ${clientIp}...`);
    const tunnelRun = runTunnelManager('add', tunnelConfig);
    console.log(`[tunnel] Guard tunnel manager used: ${tunnelRun.scriptPath}`);
    const guardState = readGuardTunnelState(agentId);
    // Note: readGuardTunnelState might need update for WG check if sysfs path differs
    
    // 2. Queue command for Client side
    const clientCommand = queueAgentCommand(agentId, buildClientTunnelBootstrapCommand(tunnelConfig), {
      kind: 'tunnel:apply',
      summary: `Bootstrap ${tunnelConfig.tunnelName} (WireGuard) on client`
    });

      // 3. Update Supabase
      await supabaseAdmin.from('user_profiles')
        .update({ 
          tunnel_status: 'provisioning', 
          client_ip: clientIp,
          tunnel_created_at: new Date().toISOString()
        })
        .eq('agent_id', agentId);

      if (!db.profileTunnelStatus) db.profileTunnelStatus = {};
      db.profileTunnelStatus[agentId] = 'provisioning';
  
      res.json({
        success: true,
        guardIp: guardPubIp,
        tunnelName: guardState.tunnelName,
        guardTunnelIp: tunnelConfig.guardTunnelIp,
        clientTunnelIp: tunnelConfig.clientTunnelIp,
        subnet: tunnelConfig.subnet,
        status: 'provisioning',
        statePath: tunnelConfig.statePath,
        clientCommandId: clientCommand.id,
      });
  } catch (err) {
    console.error(`[tunnel] Tunnel creation failed for agent ${agentId}:`, err);
    res.status(500).json({ 
      error: 'Tunnel creation failed', 
      message: err.message
    });
  }
}

function getTunnelInterfaceName(agentId) {
  return tunnelNameForAgent(agentId);
}

function runTunnelManager(action, tunnelConfig) {
  const { execFileSync } = require('child_process');
  const candidates = [
    '/opt/detroit-sbs/tunnel-manager.sh',
    path.join(__dirname, 'tunnel-manager.sh')
  ];
  const scriptPath = candidates.find((candidate) => fs.existsSync(candidate));

  if (!scriptPath) {
    throw new Error('Tunnel manager script not found. Expected /opt/detroit-sbs/tunnel-manager.sh or local tunnel-manager.sh.');
  }

  const bashArgs = [
    scriptPath,
    action,
    tunnelConfig?.agentId || '',
    tunnelConfig?.clientPublicIp || '',
    tunnelConfig?.guardPublicIp || '',
    tunnelConfig?.guardTunnelIp || '',
    tunnelConfig?.clientTunnelIp || '',
    String(tunnelConfig?.listenPort || ''),
  ];

  const isRoot = typeof process.getuid === 'function' ? process.getuid() === 0 : false;
  const command = isRoot ? 'bash' : 'sudo';
  const args = isRoot ? bashArgs : ['-E', 'bash', ...bashArgs];
  
  // Pass keys via env for security
  const env = { 
    ...process.env,
    SBS_GUARD_PRIVATE_KEY: tunnelConfig?.guardPrivateKey,
    SBS_CLIENT_PUBLIC_KEY: tunnelConfig?.clientPublicKey
  };

  const output = execFileSync(command, args, { encoding: 'utf8', env });

  return { output, scriptPath };
}

function readGuardTunnelState(agentId) {
  const tunnelName = getTunnelInterfaceName(agentId);
  const sysfsPath = path.join('/sys/class/net', tunnelName);

  if (!fs.existsSync(sysfsPath)) {
    return { exists: false, tunnelName, linkInfo: null };
  }

  try {
    const { execFileSync } = require('child_process');
    const linkInfo = execFileSync('ip', ['-o', 'link', 'show', tunnelName], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    return { exists: true, tunnelName, linkInfo };
  } catch (_) {
    return { exists: true, tunnelName, linkInfo: null };
  }
}

function getTunnelRuntimeState(agentId) {
  const systemState = readGuardTunnelState(agentId);
  const clientState = db.agents[agentId] || null;
  const tunnelConfig = getTunnelConfig(agentId);
  const clientTunnelPresent = Boolean(clientState?.tunnelPresent);
  const clientTunnelName = clientState?.tunnelName || getTunnelInterfaceName(agentId);
  const lastTunnelCommand = getLatestAgentCommand(agentId, 'tunnel:');
  const commandPending = Boolean(lastTunnelCommand && ['queued', 'sent'].includes(lastTunnelCommand.status));
  const updatedAt = tunnelConfig?.updatedAt || tunnelConfig?.createdAt || null;
  const configAgeMs = updatedAt ? Date.now() - Date.parse(updatedAt) : Infinity;
  const configRecentlyTouched = Number.isFinite(configAgeMs) && configAgeMs >= 0 && configAgeMs < 120000;

  let status = 'inactive';
  if (systemState.exists && clientTunnelPresent) {
    status = 'active';
  } else if (commandPending) {
    status = 'provisioning';
  } else if (systemState.exists || clientTunnelPresent || tunnelConfig) {
    status = 'degraded';
  }

  return {
    status,
    tunnelName: systemState.tunnelName,
    systemState,
    clientState,
    tunnelConfig,
    clientTunnelPresent,
    clientTunnelName,
    lastTunnelCommand,
    commandPending,
    configRecentlyTouched,
  };
}

function shouldReuseTunnelSetup(state, source) {
  if (state.status === 'active' || state.commandPending) return true;
  return source === 'agent' && state.configRecentlyTouched;
}

app.delete('/api/agent/tunnel/remove', authMiddleware, privilegedSupabaseMiddleware, async (req, res) => {
  const { agent_id } = req.user;
  
  try {
    const tunnelConfig = getTunnelConfig(agent_id) || {
      agentId: agent_id,
      tunnelName: getTunnelInterfaceName(agent_id),
    };

    queueAgentCommand(agent_id, buildClientTunnelRemovalCommand(), {
      kind: 'tunnel:remove',
      summary: `Remove ${tunnelConfig.tunnelName || getTunnelInterfaceName(agent_id)} from client`
    });

    const tunnelRun = runTunnelManager('remove', tunnelConfig);
    console.log(`[tunnel] Guard tunnel manager used: ${tunnelRun.scriptPath}`);
    releaseTunnelConfig(agent_id);
    
    // Update Supabase
    await supabaseAdmin.from('user_profiles')
      .update({ tunnel_status: 'inactive' })
      .eq('agent_id', agent_id);

    if (!db.profileTunnelStatus) db.profileTunnelStatus = {};
    db.profileTunnelStatus[agent_id] = 'inactive';

    res.json({ success: true });
  } catch (err) {
    console.error('Tunnel removal failed:', err.message);
    res.status(500).json({ error: 'Tunnel removal failed' });
  }
});

  app.get('/api/agent/tunnel/status', authMiddleware, privilegedSupabaseMiddleware, async (req, res) => {
    const { agent_id } = req.user;
    try {
      const { data } = await supabaseAdmin.from('user_profiles').select('tunnel_status, client_ip').eq('agent_id', agent_id).single();
      const dbStatus = data?.tunnel_status || 'inactive';
      const runtimeState = getTunnelRuntimeState(agent_id);
      const { systemState, clientState, tunnelConfig, clientTunnelPresent, clientTunnelName, lastTunnelCommand } = runtimeState;
      let status = runtimeState.status;

      if (status === 'inactive' && dbStatus === 'provisioning') {
        status = 'provisioning';
      } else if (status === 'inactive' && dbStatus === 'active') {
        status = 'degraded';
      }

      const syncMismatch =
        (systemState.exists && !clientTunnelPresent) ||
        (!systemState.exists && clientTunnelPresent);

      let detail = 'No tunnel interfaces detected.';
      if (systemState.exists && clientTunnelPresent) {
        detail = 'Guard and client tunnel interfaces are both present.';
      } else if (clientTunnelPresent && !systemState.exists) {
        detail = 'Client tunnel exists, but guard tunnel interface is missing.';
      } else if (!clientTunnelPresent && systemState.exists) {
        detail = 'Guard tunnel exists, but client tunnel interface is missing.';
      } else if (dbStatus === 'provisioning') {
        detail = 'Tunnel creation was queued and is still waiting for both sides to come up.';
      }

      if (lastTunnelCommand?.status === 'failed') {
        detail = `Last tunnel job failed: ${trimCommandOutput(lastTunnelCommand.output || 'Unknown error', 240)}`;
      } else if (!systemState.exists && !clientTunnelPresent && lastTunnelCommand?.status === 'sent') {
        detail = 'Tunnel bootstrap command was dispatched to the client and is waiting to finish.';
      } else if (!systemState.exists && !clientTunnelPresent && lastTunnelCommand?.status === 'queued') {
        detail = 'Tunnel bootstrap command is queued for the client agent.';
      }

      syncTunnelProfileStatus(agent_id, status, data?.client_ip || clientState?.ip || null).catch((err) => {
        console.error(`[tunnel] failed to persist status for ${agent_id}:`, err.message);
      });

      res.json({
        status,
        dbStatus,
        clientIp: data?.client_ip || null,
        tunnelName: systemState.tunnelName,
        guardInterfacePresent: systemState.exists,
        clientTunnelPresent,
        clientTunnelName,
        syncMismatch,
        detail,
        subnet: tunnelConfig?.subnet || null,
        guardTunnelIp: tunnelConfig?.guardTunnelIp || null,
        clientTunnelIp: tunnelConfig?.clientTunnelIp || null,
        statePath: getTunnelStatePath(),
        lastTunnelCommand: lastTunnelCommand ? {
          id: lastTunnelCommand.id,
          kind: lastTunnelCommand.kind,
          summary: lastTunnelCommand.summary,
          status: lastTunnelCommand.status,
          exitCode: lastTunnelCommand.exitCode,
          createdAt: lastTunnelCommand.createdAt,
          dispatchedAt: lastTunnelCommand.dispatchedAt || null,
          completedAt: lastTunnelCommand.completedAt || null,
          output: lastTunnelCommand.output || '',
        } : null,
      });
    } catch (err) {
      res.status(500).json({ error: 'Failed to fetch status' });
    }
  });

// ── Global Blocklist Sync ────────────────────────────────────
function broadcastGlobalBan(ip) {
  // Broadcast to all connected agents
  Object.keys(db.agents).forEach(agentId => {
    queueAgentCommand(
      agentId,
      `NFT_TABLE=$(nft list table inet detroit_guard >/dev/null 2>&1 && echo detroit_guard || echo sbs_filter); nft add element inet $NFT_TABLE blacklist '{ ${ip} }' 2>/dev/null || true`,
      { kind: 'firewall:ban', summary: `Block ${ip} on client firewall` }
    );
  });
  console.log(`[global-ban] Syncing ${ip} to all agents.`);
}

function broadcastGlobalUnban(ip) {
  Object.keys(db.agents).forEach(agentId => {
    queueAgentCommand(
      agentId,
      `NFT_TABLE=$(nft list table inet detroit_guard >/dev/null 2>&1 && echo detroit_guard || echo sbs_filter); nft delete element inet $NFT_TABLE blacklist '{ ${ip} }' 2>/dev/null || true`,
      { kind: 'firewall:unban', summary: `Unblock ${ip} on client firewall` }
    );
  });
  console.log(`[global-ban] Removing ${ip} from connected agents.`);
}

async function applyRadarAutoBan(ip, reason, metrics = {}) {
  addGuardBlockedIp(ip);
  appendAttackLog(
    `[auto-ban] ${ip} blocked by Threat Radar: ${reason} | tcp=${metrics.tcp || 0} syn=${metrics.syn || 0} udp=${metrics.udp || 0} delta=${metrics.delta || 0}`
  );
  broadcastGlobalBan(ip);
  broadcastToAll({
    type: 'radar_ban',
    ip,
    reason,
    metrics,
    detectedAt: new Date().toISOString(),
  });
}

// ── Radar Scanner Integration ────────────────────────────────
const RadarScanner = require('./radar-scanner');
radar = new RadarScanner(supabaseAdmin, {
  broadcastToUser,
  onBan: applyRadarAutoBan,
  listBlockedIps: () => listGuardBlockedIps().ips,
});
radar.start();

// ── Websocket logic ──────────────────────────────────────────
const clients = {}; // { userId: [ws1, ws2] }

wss.on('connection', async (ws, req) => {
  const url = new URL(req.url, 'http://localhost');
  const token = url.searchParams.get('token');
  if (!token) return ws.close();
  
  try {
    const { data: { user }, error } = await supabase.auth.getUser(token);
    if (error || !user) throw new Error();
    
    const userId = user.id;
    if (!clients[userId]) clients[userId] = [];
    clients[userId].push(ws);
    
    // Check if their agent is connected
    const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: `Bearer ${token}` } }
    });
    const { data: profile } = await userClient.from('user_profiles').select('agent_id').eq('id', user.id).single();
    
    if (profile && db.agents[profile.agent_id]) {
      ws.send(JSON.stringify(buildAgentConnectedMessage(db.agents[profile.agent_id])));
    }
    
    ws.on('close', () => {
      clients[userId] = clients[userId].filter(c => c !== ws);
    });
  } catch (err) {
    ws.close();
  }
});

function broadcastToUser(userId, message) {
  if (clients[userId]) {
    const msg = JSON.stringify(message);
    clients[userId].forEach(ws => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(msg);
      }
    });
  }
}

// Global broadcast (to all dashboards)
function broadcastToAll(message) {
  const msg = JSON.stringify(message);
  Object.values(clients).forEach(userClients => {
    userClients.forEach(ws => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(msg);
      }
    });
  });
}

// ── Agent Heartbeat Checker ──────────────────────────────────
setInterval(() => {
  const now = Date.now();
  for (const [agentId, agent] of Object.entries(db.agents)) {
    if (now - agent.lastSeen > 30000) {
      delete db.agents[agentId];
      if (agent.userId) {
        broadcastToUser(agent.userId, { type: 'agent_disconnected', agentId, agentStatus: 'NO AGENT' });
      }
    }
  }
}, 5000);

// Health & Internal endpoints
app.get('/api/internal/agents', (req, res) => {
  const clientIp = req.socket.remoteAddress;
  if (clientIp !== '127.0.0.1' && clientIp !== '::1' && clientIp !== '::ffff:127.0.0.1') {
    return res.status(403).json({ error: 'Forbidden' });
  }
  res.json(db.agents);
});

app.get('/api/internal/storage-status', (req, res) => {
  const clientIp = req.socket.remoteAddress;
  if (clientIp !== '127.0.0.1' && clientIp !== '::1' && clientIp !== '::ffff:127.0.0.1') {
    return res.status(403).json({ error: 'Forbidden' });
  }

  let runtimeState = null;
  try {
    if (fs.existsSync(RUNTIME_STATE_PATH)) {
      runtimeState = JSON.parse(fs.readFileSync(RUNTIME_STATE_PATH, 'utf8'));
    }
  } catch (_) {
    runtimeState = null;
  }

  res.json({
    ok: true,
    storageRoot: STORAGE_ROOT,
    runtimeStatePath: RUNTIME_STATE_PATH,
    runtimeStateUpdatedAt: runtimeState?.updatedAt || null,
    connectedAgents: Object.keys(db.agents || {}).length,
    knownClients: [
      ...new Set([
        ...Object.keys(db.agents || {}),
        ...Object.values(db.lastStats || {}).map((entry) => entry?.agent?.agentId).filter(Boolean),
      ]),
    ],
  });
});

app.get('/api/health', (req, res) => {
  res.json({ ok: true });
});

// Threat Radar API
app.get('/api/radar/config', authMiddleware, (req, res) => {
  if (!radar) {
    return res.status(503).json({ error: 'Threat Radar is not initialized.' });
  }
  res.json(radar.getStatus());
});

app.post('/api/radar/config', authMiddleware, adminMiddleware, (req, res) => {
  if (!radar) {
    return res.status(503).json({ error: 'Threat Radar is not initialized.' });
  }

  try {
    const next = radar.updateConfig(req.body || {});
    res.json(next);
  } catch (err) {
    res.status(400).json({ error: err.message || 'Failed to update Threat Radar config.' });
  }
});

app.post('/api/radar/scan', authMiddleware, adminMiddleware, async (req, res) => {
  if (!radar) {
    return res.status(503).json({ error: 'Threat Radar is not initialized.' });
  }

  try {
    const next = await radar.scanNow();
    res.json(next);
  } catch (err) {
    res.status(500).json({ error: err.message || 'Threat Radar scan failed.' });
  }
});

app.get('/api/radar/stats', authMiddleware, async (req, res) => {
  try {
    const since = new Date(Date.now() - 86400000).toISOString();

    const { data: recent, error: recentError } = await supabaseAdmin
      .from('threat_radar')
      .select('*')
      .order('detected_at', { ascending: false })
      .limit(50);
    if (recentError) throw recentError;
      
    const { count: scannedToday, error: scannedError } = await supabaseAdmin
      .from('threat_radar')
      .select('*', { count: 'exact', head: true })
      .gte('detected_at', since);
    if (scannedError) throw scannedError;

    const { count: blockedToday, error: blockedError } = await supabaseAdmin
      .from('threat_radar')
      .select('*', { count: 'exact', head: true })
      .eq('action', 'banned')
      .gte('detected_at', since);
    if (blockedError) throw blockedError;

    res.json({
      recent: recent || [],
      liveScores: radar ? radar.getLiveScores() : [],
      stats: {
        scannedToday: scannedToday || 0,
        blockedToday: blockedToday || 0
      },
      radar: radar ? radar.getStatus() : null,
    });
  } catch (err) {
    const missingRadarTable = err?.code === '42P01' || /threat_radar/i.test(err?.message || '');
    res.status(missingRadarTable ? 503 : 500).json({
      error: missingRadarTable
        ? 'Threat Radar database setup is incomplete. Run supabase_threat_radar.sql in Supabase.'
        : (err.message || 'Threat Radar stats failed to load.'),
      setupRequired: missingRadarTable,
      code: err?.code || null
    });
  }
});

// Catch all for SPA
app.use((req, res) => {
  res.sendFile(path.join(__dirname, 'frontend', 'dist', 'index.html'));
});

server.listen(PORT, () => {
  console.log(`\x1b[32m[✓] SBS Detroit Server listening on port ${PORT}\x1b[0m`);
});
