const fs = require('fs');
const path = require('path');

function envCompat(primaryName, legacyName, fallback = '') {
  const primary = process.env[primaryName];
  if (primary !== undefined && primary !== '') return primary;
  const legacy = process.env[legacyName];
  if (legacy !== undefined && legacy !== '') return legacy;
  return fallback;
}

const DEFAULT_POOL_CIDR = envCompat('SPARROWX_TUNNEL_POOL', 'SBS_TUNNEL_POOL', '10.200.0.0/16');

function getTunnelStateDir() {
  if (process.env.SPARROWX_STATE_DIR) return process.env.SPARROWX_STATE_DIR;
  if (process.env.SBS_STATE_DIR) return process.env.SBS_STATE_DIR;
  
  // Priority: 
  // 1. Current directory if tunnels.json exists there
  // 2. /opt paths for legacy support
  // 3. Fallback to current directory
  if (fs.existsSync(path.join(__dirname, 'tunnels.json'))) return __dirname;
  if (fs.existsSync('/opt/sparrowx')) return '/opt/sparrowx';
  if (fs.existsSync('/opt/detroit-sbs')) return '/opt/detroit-sbs';
  return __dirname;
}

function getTunnelStatePath() {
  return envCompat('SPARROWX_TUNNEL_STATE_PATH', 'SBS_TUNNEL_STATE_PATH', path.join(getTunnelStateDir(), 'tunnels.json'));
}

function ensureStateStorage() {
  const dir = getTunnelStateDir();
  fs.mkdirSync(dir, { recursive: true });
}

function ipv4ToInt(ip) {
  const parts = String(ip).trim().split('.');
  if (parts.length !== 4) throw new Error(`Invalid IPv4 address: ${ip}`);
  return parts.reduce((acc, part) => {
    const value = Number(part);
    if (!Number.isInteger(value) || value < 0 || value > 255) {
      throw new Error(`Invalid IPv4 address: ${ip}`);
    }
    return (acc * 256) + value;
  }, 0);
}

function intToIpv4(value) {
  const intValue = Number(value);
  if (!Number.isInteger(intValue) || intValue < 0 || intValue > 0xFFFFFFFF) {
    throw new Error(`Invalid IPv4 integer: ${value}`);
  }
  return [
    (intValue >>> 24) & 255,
    (intValue >>> 16) & 255,
    (intValue >>> 8) & 255,
    intValue & 255,
  ].join('.');
}

function parsePool(cidr = DEFAULT_POOL_CIDR) {
  const [networkIp, prefixRaw] = String(cidr).trim().split('/');
  const prefix = Number(prefixRaw);
  if (!Number.isInteger(prefix) || prefix < 0 || prefix > 30) {
    throw new Error(`Invalid tunnel pool prefix: ${cidr}`);
  }

  const networkInt = ipv4ToInt(networkIp);
  const mask = prefix === 0 ? 0 : ((0xFFFFFFFF << (32 - prefix)) >>> 0);
  const normalizedNetwork = networkInt & mask;
  const subnetCount = Math.pow(2, 30 - prefix);

  return {
    cidr: `${intToIpv4(normalizedNetwork)}/${prefix}`,
    networkInt: normalizedNetwork,
    prefix,
    subnetCount,
  };
}

function buildAllocation(pool, subnetIndex) {
  if (!Number.isInteger(subnetIndex) || subnetIndex < 0 || subnetIndex >= pool.subnetCount) {
    throw new Error(`Tunnel pool exhausted for subnet index ${subnetIndex}.`);
  }

  const networkInt = pool.networkInt + (subnetIndex * 4);
  return {
    subnetIndex,
    subnet: `${intToIpv4(networkInt)}/30`,
    guardTunnelIp: intToIpv4(networkInt + 1),
    clientTunnelIp: intToIpv4(networkInt + 2),
    tunnelCidr: 30,
  };
}

function normalizeState(raw) {
  const pool = parsePool(raw?.poolCidr || DEFAULT_POOL_CIDR);
  const allocations = raw?.allocations && typeof raw.allocations === 'object' ? raw.allocations : {};
  return {
    version: 1,
    poolCidr: pool.cidr,
    allocations,
  };
}

function loadTunnelState() {
  ensureStateStorage();
  const statePath = getTunnelStatePath();
  if (!fs.existsSync(statePath)) {
    return normalizeState(null);
  }

  const raw = JSON.parse(fs.readFileSync(statePath, 'utf8'));
  return normalizeState(raw);
}

function saveTunnelState(state) {
  ensureStateStorage();
  const statePath = getTunnelStatePath();
  const tmpPath = `${statePath}.tmp`;
  fs.writeFileSync(tmpPath, JSON.stringify(normalizeState(state), null, 2));
  fs.renameSync(tmpPath, statePath);
}

function tunnelNameForAgent(agentId) {
  return `spx_${String(agentId || '').substring(0, 8)}`;
}

function getTunnelConfig(agentId) {
  const state = loadTunnelState();
  const existing = state.allocations[String(agentId)];
  if (!existing) return null;
  return {
    ...existing,
    tunnelName: existing.tunnelName || tunnelNameForAgent(agentId),
    statePath: getTunnelStatePath(),
  };
}

function getOrAllocateTunnelConfig(agentId, meta = {}) {
  const key = String(agentId);
  const state = loadTunnelState();
  const pool = parsePool(state.poolCidr);
  const existing = state.allocations[key];

  if (existing) {
    const merged = {
      ...existing,
      ...meta,
      tunnelName: existing.tunnelName || tunnelNameForAgent(agentId),
      updatedAt: new Date().toISOString(),
    };
    state.allocations[key] = merged;
    saveTunnelState(state);
    return { ...merged, statePath: getTunnelStatePath() };
  }

  const used = new Set(
    Object.values(state.allocations)
      .map((entry) => entry?.subnetIndex)
      .filter((value) => Number.isInteger(value))
  );

  let subnetIndex = 0;
  while (used.has(subnetIndex) && subnetIndex < pool.subnetCount) {
    subnetIndex += 1;
  }
  if (subnetIndex >= pool.subnetCount) {
    throw new Error(`Tunnel pool ${pool.cidr} has no free /30 allocations left.`);
  }

  const allocation = buildAllocation(pool, subnetIndex);
  const now = new Date().toISOString();
  const config = {
    agentId: key,
    tunnelName: tunnelNameForAgent(agentId),
    ...allocation,
    ...meta,
    createdAt: now,
    updatedAt: now,
  };

  state.allocations[key] = config;
  state.allocations[key] = config;
  saveTunnelState(state);
  return { ...config, statePath: getTunnelStatePath() };
}

function releaseTunnelConfig(agentId) {
  const key = String(agentId);
  const state = loadTunnelState();
  const existing = state.allocations[key];
  if (!existing) return null;
  delete state.allocations[key];
  saveTunnelState(state);
  return existing;
}

function listTunnelConfigs() {
  const state = loadTunnelState();
  return Object.values(state.allocations || {});
}

module.exports = {
  DEFAULT_POOL_CIDR,
  getTunnelStateDir,
  getTunnelStatePath,
  getTunnelConfig,
  getOrAllocateTunnelConfig,
  releaseTunnelConfig,
  listTunnelConfigs,
  tunnelNameForAgent,
};
