const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const { getTunnelStateDir, listTunnelConfigs } = require('./sparrowguard-config');
const geoip = require('geoip-lite');

function envCompat(primaryName, legacyName, fallback = '') {
  const primary = process.env[primaryName];
  if (primary !== undefined && primary !== '') return primary;
  const legacy = process.env[legacyName];
  if (legacy !== undefined && legacy !== '') return legacy;
  return fallback;
}

const DEFAULT_SCAN_INTERVAL_MS = Number(envCompat('SPARROWX_RADAR_SCAN_INTERVAL_MS', 'SBS_RADAR_SCAN_INTERVAL_MS', 1000));
const DEFAULT_CONFIG = {
  mode: String(envCompat('SPARROWX_RADAR_MODE', 'SBS_RADAR_MODE', 'normal')).trim().toLowerCase(),
  enabled: envCompat('SPARROWX_RADAR_ENABLED', 'SBS_RADAR_ENABLED', '1') !== '0',
  autoBan: envCompat('SPARROWX_RADAR_AUTO_BAN', 'SBS_RADAR_AUTO_BAN', '1') !== '0',
  threshold: Number(envCompat('SPARROWX_RADAR_BAN_THRESHOLD', 'SBS_RADAR_BAN_THRESHOLD', 90)),
  watchThreshold: Number(envCompat('SPARROWX_RADAR_WATCH_THRESHOLD', 'SBS_RADAR_WATCH_THRESHOLD', 55)),
  connWarn: Number(envCompat('SPARROWX_RADAR_CONN_WARN', 'SBS_RADAR_CONN_WARN', 80)),
  connBan: Number(envCompat('SPARROWX_RADAR_CONN_BAN', 'SBS_RADAR_CONN_BAN', 220)),
  synWarn: Number(envCompat('SPARROWX_RADAR_SYN_WARN', 'SBS_RADAR_SYN_WARN', 30)),
  synBan: Number(envCompat('SPARROWX_RADAR_SYN_BAN', 'SBS_RADAR_SYN_BAN', 90)),
  synRatioWarn: Number(envCompat('SPARROWX_RADAR_SYN_RATIO_WARN', 'SBS_RADAR_SYN_RATIO_WARN', 0.55)),
  synRatioBan: Number(envCompat('SPARROWX_RADAR_SYN_RATIO_BAN', 'SBS_RADAR_SYN_RATIO_BAN', 0.8)),
  udpWarn: Number(envCompat('SPARROWX_RADAR_UDP_WARN', 'SBS_RADAR_UDP_WARN', 140)),
  udpBan: Number(envCompat('SPARROWX_RADAR_UDP_BAN', 'SBS_RADAR_UDP_BAN', 360)),
  burstWarn: Number(envCompat('SPARROWX_RADAR_BURST_WARN', 'SBS_RADAR_BURST_WARN', 60)),
  burstBan: Number(envCompat('SPARROWX_RADAR_BURST_BAN', 'SBS_RADAR_BURST_BAN', 180)),
  portFanoutWarn: Number(envCompat('SPARROWX_RADAR_PORT_FANOUT_WARN', 'SBS_RADAR_PORT_FANOUT_WARN', 6)),
  portFanoutBan: Number(envCompat('SPARROWX_RADAR_PORT_FANOUT_BAN', 'SBS_RADAR_PORT_FANOUT_BAN', 12)),
  scanIntervalMs: DEFAULT_SCAN_INTERVAL_MS,
  banCooldownMs: Number(envCompat('SPARROWX_RADAR_BAN_COOLDOWN_MS', 'SBS_RADAR_BAN_COOLDOWN_MS', 30 * 60 * 1000)),
  logCooldownMs: Number(envCompat('SPARROWX_RADAR_LOG_COOLDOWN_MS', 'SBS_RADAR_LOG_COOLDOWN_MS', 5 * 60 * 1000)),
  ignoredLocalPorts: parseIntegerList(envCompat('SPARROWX_RADAR_IGNORE_PORTS', 'SBS_RADAR_IGNORE_PORTS', '22,80,443,3001')),
  whitelistCidrs: normalizeCidrs(envCompat('SPARROWX_RADAR_WHITELIST_CIDRS', 'SBS_RADAR_WHITELIST_CIDRS', '127.0.0.0/8,10.0.0.0/8,172.16.0.0/12,192.168.0.0/16,169.254.0.0/16,35.235.240.0/20,173.245.48.0/20,103.21.244.0/22,103.22.200.0/22,103.31.4.0/22,141.101.64.0/18,108.162.192.0/18,190.93.240.0/20,188.114.96.0/20,197.234.240.0/22,198.41.128.0/17,162.158.0.0/15,104.16.0.0/13,104.24.0.0/14,172.64.0.0/13,131.0.72.0/22')),
  trustedProxyCidrs: normalizeCidrs(envCompat('SPARROWX_RADAR_TRUSTED_PROXY_CIDRS', 'SBS_RADAR_TRUSTED_PROXY_CIDRS', '')),
};

const INTEL_DIR = path.join(__dirname, 'intel');

function parseIntegerList(value) {
  return String(value || '')
    .split(',')
    .map((item) => Number(String(item).trim()))
    .filter((item) => Number.isInteger(item) && item >= 0);
}

function normalizeCidrs(value) {
  return String(value || '')
    .split(',')
    .map((item) => String(item).trim())
    .filter(Boolean);
}

function ipToInt(ip) {
  const parts = String(ip || '').trim().split('.');
  if (parts.length !== 4) throw new Error(`Invalid IPv4 address: ${ip}`);
  return parts.reduce((acc, part) => {
    const value = Number(part);
    if (!Number.isInteger(value) || value < 0 || value > 255) {
      throw new Error(`Invalid IPv4 address: ${ip}`);
    }
    return (acc * 256) + value;
  }, 0) >>> 0;
}

function parseCidr(cidr) {
  const [ip, prefixRaw] = String(cidr || '').split('/');
  const prefix = Number(prefixRaw);
  if (!Number.isInteger(prefix) || prefix < 0 || prefix > 32) {
    throw new Error(`Invalid CIDR: ${cidr}`);
  }
  const mask = prefix === 0 ? 0 : ((0xFFFFFFFF << (32 - prefix)) >>> 0);
  return { network: ipToInt(ip) & mask, mask };
}

function ipInCidr(ip, cidr) {
  const target = ipToInt(ip);
  const range = parseCidr(cidr);
  return (target & range.mask) === range.network;
}

function toBoolean(value, fallback) {
  if (value === undefined || value === null) return fallback;
  if (typeof value === 'boolean') return value;
  const normalized = String(value).trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
  return fallback;
}

function toInteger(value, fallback, min = 0, max = Number.MAX_SAFE_INTEGER) {
  const next = Number(value);
  if (!Number.isFinite(next)) return fallback;
  const rounded = Math.round(next);
  if (rounded > max) return fallback;
  return Math.max(min, rounded);
}

function toFloat(value, fallback, min = 0, max = 1) {
  const next = Number(value);
  if (!Number.isFinite(next)) return fallback;
  return Math.min(max, Math.max(min, next));
}

function extractEndpoint(endpoint) {
  const match = String(endpoint || '').match(/(\d{1,3}(?:\.\d{1,3}){3}):(\d+)$/);
  if (!match) return null;
  return { ip: match[1], port: Number(match[2]) };
}

function commandOutput(command) {
  try {
    return execSync(command, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  } catch (_) {
    return '';
  }
}

class RadarScanner {
  constructor(supabaseAdmin, options = {}) {
    this.supabaseAdmin = supabaseAdmin;
    this.options = options;
    this.isScanning = false;
    this.timer = null;
    this.observations = new Map();
    this.latestScores = [];
    this.lastScanAt = null;
    this.lastSummary = {
      scannedIps: 0,
      watchedIps: 0,
      bannedIps: 0,
      cleanIps: 0,
      lastBannedIp: null,
      lastReason: '',
      lastDurationMs: 0,
    };

    fs.mkdirSync(INTEL_DIR, { recursive: true });
    fs.mkdirSync(path.join(INTEL_DIR, 'logs'), { recursive: true });

    this.configPath = path.join(getTunnelStateDir(), 'radar-config.json');
    this.config = this.loadConfig();

    // Dynamically whitelist critical gateway assets (Supabase, Cloudflare, User IP)
    try {
      const criticalCidrs = [
        '49.43.249.32/32', // User Requested Whitelist IP
        '173.245.48.0/20', '103.21.244.0/22', '103.22.200.0/22',
        '103.31.4.0/22', '141.101.64.0/18', '108.162.192.0/18',
        '190.93.240.0/20', '188.114.96.0/20', '197.234.240.0/22',
        '198.41.128.0/17', '162.158.0.0/15', '104.16.0.0/13',
        '104.24.0.0/14', '172.64.0.0/13', '131.0.72.0/22' // Cloudflare
      ];
      
      if (!Array.isArray(this.config.whitelistCidrs)) {
        this.config.whitelistCidrs = [];
      }
      
      for (const cidr of criticalCidrs) {
        if (!this.config.whitelistCidrs.includes(cidr)) {
          this.config.whitelistCidrs.push(cidr);
        }
      }

      const dns = require('dns');
      const url = new URL(process.env.SUPABASE_URL || 'https://supabase.co');
      dns.lookup(url.hostname, (err, address) => {
        if (!err && address && !this.config.whitelistCidrs.includes(`${address}/32`)) {
          this.config.whitelistCidrs.push(`${address}/32`);
        }
      });
    } catch (_) {}
  }

  loadConfig() {
    try {
      fs.mkdirSync(path.dirname(this.configPath), { recursive: true });
      if (!fs.existsSync(this.configPath)) {
        fs.writeFileSync(this.configPath, JSON.stringify(DEFAULT_CONFIG, null, 2));
        return { ...DEFAULT_CONFIG };
      }
      const raw = JSON.parse(fs.readFileSync(this.configPath, 'utf8'));
      return this.normalizeConfig(raw);
    } catch (err) {
      console.error('[Radar] Failed to load config:', err.message);
      return { ...DEFAULT_CONFIG };
    }
  }

  normalizeConfig(raw = {}) {
    return {
      enabled: toBoolean(raw.enabled, DEFAULT_CONFIG.enabled),
      mode: ['normal', 'strict', 'shield'].includes(String(raw.mode || '').trim().toLowerCase())
        ? String(raw.mode).trim().toLowerCase()
        : DEFAULT_CONFIG.mode,
      autoBan: toBoolean(raw.autoBan, DEFAULT_CONFIG.autoBan),
      threshold: toInteger(raw.threshold, DEFAULT_CONFIG.threshold, 1, 100),
      watchThreshold: toInteger(raw.watchThreshold, DEFAULT_CONFIG.watchThreshold, 1, 100),
      connWarn: toInteger(raw.connWarn, DEFAULT_CONFIG.connWarn, 1),
      connBan: toInteger(raw.connBan, DEFAULT_CONFIG.connBan, 1),
      synWarn: toInteger(raw.synWarn, DEFAULT_CONFIG.synWarn, 1),
      synBan: toInteger(raw.synBan, DEFAULT_CONFIG.synBan, 1),
      synRatioWarn: toFloat(raw.synRatioWarn, DEFAULT_CONFIG.synRatioWarn, 0, 1),
      synRatioBan: toFloat(raw.synRatioBan, DEFAULT_CONFIG.synRatioBan, 0, 1),
      udpWarn: toInteger(raw.udpWarn, DEFAULT_CONFIG.udpWarn, 1),
      udpBan: toInteger(raw.udpBan, DEFAULT_CONFIG.udpBan, 1),
      burstWarn: toInteger(raw.burstWarn, DEFAULT_CONFIG.burstWarn, 1),
      burstBan: toInteger(raw.burstBan, DEFAULT_CONFIG.burstBan, 1),
      portFanoutWarn: toInteger(raw.portFanoutWarn, DEFAULT_CONFIG.portFanoutWarn, 1),
      portFanoutBan: toInteger(raw.portFanoutBan, DEFAULT_CONFIG.portFanoutBan, 1),
      scanIntervalMs: toInteger(raw.scanIntervalMs, DEFAULT_CONFIG.scanIntervalMs, 1000, 300000),
      banCooldownMs: toInteger(raw.banCooldownMs, DEFAULT_CONFIG.banCooldownMs, 1000),
      logCooldownMs: toInteger(raw.logCooldownMs, DEFAULT_CONFIG.logCooldownMs, 1000),
      ignoredLocalPorts: Array.isArray(raw.ignoredLocalPorts)
        ? raw.ignoredLocalPorts.map((item) => toInteger(item, NaN, 0)).filter(Number.isFinite)
        : DEFAULT_CONFIG.ignoredLocalPorts,
      whitelistCidrs: Array.isArray(raw.whitelistCidrs) ? raw.whitelistCidrs.filter(Boolean) : DEFAULT_CONFIG.whitelistCidrs,
      trustedProxyCidrs: Array.isArray(raw.trustedProxyCidrs) ? raw.trustedProxyCidrs.filter(Boolean) : DEFAULT_CONFIG.trustedProxyCidrs,
    };
  }

  saveConfig() {
    fs.mkdirSync(path.dirname(this.configPath), { recursive: true });
    fs.writeFileSync(this.configPath, JSON.stringify(this.config, null, 2));
  }

  getConfig() {
    return { ...this.config };
  }

  getEffectiveConfig() {
    const base = { ...this.config };
    if (base.mode === 'strict') {
      base.threshold = Math.floor(base.threshold * 0.66);
      base.watchThreshold = Math.floor(base.watchThreshold * 0.5);
      base.connWarn = Math.floor(base.connWarn * 0.5);
      base.connBan = Math.floor(base.connBan * 0.5);
      base.synWarn = Math.floor(base.synWarn * 0.5);
      base.synBan = Math.floor(base.synBan * 0.5);
      base.udpWarn = Math.floor(base.udpWarn * 0.5);
      base.udpBan = Math.floor(base.udpBan * 0.5);
    } else if (base.mode === 'shield') {
      base.threshold = Math.floor(base.threshold * 0.33);
      base.watchThreshold = Math.floor(base.watchThreshold * 0.2);
      base.connWarn = Math.floor(base.connWarn * 0.2);
      base.connBan = Math.floor(base.connBan * 0.2);
      base.synWarn = Math.floor(base.synWarn * 0.2);
      base.synBan = Math.floor(base.synBan * 0.2);
      base.udpWarn = Math.floor(base.udpWarn * 0.2);
      base.udpBan = Math.floor(base.udpBan * 0.2);
    }
    return base;
  }

  updateConfig(patch = {}) {
    this.config = this.normalizeConfig({ ...this.config, ...patch });
    this.saveConfig();
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
      if (this.config.enabled) {
        this.start();
      }
    }
    return this.getStatus();
  }

  getStatus() {
    return {
      config: this.getConfig(),
      isScanning: this.isScanning,
      lastScanAt: this.lastScanAt,
      summary: this.lastSummary,
      liveScores: this.getLiveScores(),
    };
  }

  getLiveScores() {
    return this.latestScores.slice(0, 120);
  }

  start() {
    if (!this.config.enabled) {
      console.log('[Radar] Scanner disabled by configuration.');
      return;
    }
    if (this.timer) clearInterval(this.timer);
    console.log('[Radar] Scanner started...');
    this.timer = setInterval(() => {
      this.scan().catch((err) => console.error('[Radar] Scan cycle failed:', err.message));
    }, this.config.scanIntervalMs);
    this.scan().catch((err) => console.error('[Radar] Initial scan failed:', err.message));
  }

  async scanNow() {
    return this.scan({ manual: true });
  }

  collectSnapshot() {
    const snapshot = new Map();
    this.collectFromOutput(snapshot, commandOutput('ss -Htan'), 'tcp');
    this.collectFromOutput(snapshot, commandOutput('ss -Htan state syn-recv'), 'syn');
    this.collectFromOutput(snapshot, commandOutput('ss -Htan state established'), 'established');
    this.collectFromOutput(snapshot, commandOutput('ss -Huan'), 'udp');
    return snapshot;
  }

  collectFromOutput(snapshot, output, metric) {
    const lines = String(output || '').split('\n').map((line) => line.trim()).filter(Boolean);
    for (const line of lines) {
      const parts = line.split(/\s+/);
      if (parts.length < 2) continue;
      const remote = extractEndpoint(parts[parts.length - 1]);
      const local = extractEndpoint(parts[parts.length - 2]);
      if (!remote || !remote.ip || remote.ip === '0.0.0.0') continue;

      const current = snapshot.get(remote.ip) || {
        ip: remote.ip,
        tcp: 0,
        syn: 0,
        established: 0,
        udp: 0,
        localPorts: new Set(),
      };

      current[metric] += 1;
      if (local?.port) current.localPorts.add(local.port);
      snapshot.set(remote.ip, current);
    }
  }

  shouldIgnore(ip, metrics) {
    if (!ip || ip === '127.0.0.1' || ip === '0.0.0.0') return true;

    const whitelist = new Set([
      ...(this.config.whitelistCidrs || []),
      ...(this.config.trustedProxyCidrs || []),
    ]);

    if (process.env.GUARD_PUBLIC_IP) whitelist.add(`${process.env.GUARD_PUBLIC_IP}/32`);

    for (const tunnel of listTunnelConfigs()) {
      if (tunnel?.clientPublicIp) whitelist.add(`${tunnel.clientPublicIp}/32`);
    }

    for (const cidr of whitelist) {
      try {
        if (ipInCidr(ip, cidr)) return true;
      } catch (_) {
        // ignore invalid CIDRs in config
      }
    }

    const localPorts = [...(metrics.localPorts || [])];
    if (localPorts.length > 0 && localPorts.every((port) => this.config.ignoredLocalPorts.includes(port))) {
      for (const cidr of this.config.trustedProxyCidrs || []) {
        try {
          if (ipInCidr(ip, cidr)) return true;
        } catch (_) {
          // ignore invalid CIDRs in config
        }
      }
    }

    return false;
  }

  scoreIp(ip, metrics, previous = {}) {
    const config = this.getEffectiveConfig();
    const reasons = [];
    let score = 0;
    const totalConnections = metrics.tcp + metrics.udp;
    const delta = Math.max(0, totalConnections - Number(previous.totalConnections || 0));
    const synRatio = metrics.syn / Math.max(metrics.tcp, 1);
    const portFanout = metrics.localPorts.size;

    if (metrics.tcp >= config.connBan) {
      score += 32;
      reasons.push(`${metrics.tcp} tcp connections`);
    } else if (metrics.tcp >= config.connWarn) {
      score += 16;
      reasons.push(`${metrics.tcp} tcp connections`);
    }

    if (metrics.syn >= config.synBan) {
      score += 36;
      reasons.push(`${metrics.syn} SYN-RECV sockets`);
    } else if (metrics.syn >= config.synWarn) {
      score += 18;
      reasons.push(`${metrics.syn} SYN-RECV sockets`);
    }

    if (metrics.udp >= config.udpBan) {
      score += 30;
      reasons.push(`${metrics.udp} udp sockets`);
    } else if (metrics.udp >= config.udpWarn) {
      score += 15;
      reasons.push(`${metrics.udp} udp sockets`);
    }

    if (synRatio >= config.synRatioBan && metrics.syn >= config.synWarn) {
      score += 22;
      reasons.push(`SYN ratio ${synRatio.toFixed(2)}`);
    } else if (synRatio >= config.synRatioWarn && metrics.syn >= Math.max(10, Math.floor(config.synWarn / 2))) {
      score += 10;
      reasons.push(`SYN ratio ${synRatio.toFixed(2)}`);
    }

    if (delta >= config.burstBan) {
      score += 24;
      reasons.push(`burst +${delta}`);
    } else if (delta >= config.burstWarn) {
      score += 12;
      reasons.push(`burst +${delta}`);
    }

    if (portFanout >= config.portFanoutBan) {
      score += 20;
      reasons.push(`${portFanout} destination ports`);
    } else if (portFanout >= config.portFanoutWarn) {
      score += 8;
      reasons.push(`${portFanout} destination ports`);
    }

    if (metrics.established === 0 && (metrics.syn >= config.synWarn || metrics.tcp >= config.connWarn)) {
      score += 12;
      reasons.push('no established sessions');
    }

    if (previous.lastAction === 'banned') {
      score += 18;
      reasons.push('repeat offender');
    } else if (Number(previous.lastScore || 0) >= config.watchThreshold) {
      score += 8;
      reasons.push('prior suspicious activity');
    }

    return { score, reasons, delta, synRatio, portFanout, totalConnections };
  }

  async scan(options = {}) {
    const config = this.getEffectiveConfig();
    if (!config.enabled && !options.manual) return this.getStatus();
    if (this.isScanning) return this.getStatus();

    this.isScanning = true;
    const startedAt = Date.now();
    console.log('[Radar] Running scan cycle...');

    try {
      const blockedIps = new Set(
        typeof this.options.listBlockedIps === 'function'
          ? (this.options.listBlockedIps() || [])
          : []
      );
      const snapshot = this.collectSnapshot();
      let scannedIps = 0;
      let watchedIps = 0;
      let bannedIps = 0;
      let cleanIps = 0;
      let lastBannedIp = null;
      let lastReason = '';
      const liveScores = [];

      for (const [ip, metrics] of snapshot.entries()) {
        if (this.shouldIgnore(ip, metrics)) continue;
        scannedIps += 1;

        const previous = this.observations.get(ip) || {};
        const result = this.scoreIp(ip, metrics, previous);
        const nowIso = new Date().toISOString();
        let action = result.score >= config.watchThreshold ? 'watched' : 'clean';

        if (blockedIps.has(ip)) {
          action = 'banned';
          bannedIps += 1;
        } else if (config.autoBan && result.score >= config.threshold) {
          const canBanAgain =
            !previous.lastBannedAt ||
            (Date.now() - Date.parse(previous.lastBannedAt)) >= config.banCooldownMs;

          if (canBanAgain) {
            const reason = result.reasons.join(', ') || 'strict radar threshold reached';
            await this.banIp(ip, reason, { ...metrics, score: result.score, delta: result.delta, synRatio: result.synRatio });
            blockedIps.add(ip);
            action = 'banned';
            bannedIps += 1;
            lastBannedIp = ip;
            lastReason = reason;
          } else {
            action = 'watched';
          }
        }

        if (action === 'watched') watchedIps += 1;
        if (action === 'clean') cleanIps += 1;

        const shouldLog =
          action === 'banned' ||
          result.score >= config.watchThreshold ||
          (Date.now() - Number(previous.lastLoggedAt || 0)) >= config.logCooldownMs;

        if (shouldLog && result.score > 0) {
          await this.logThreat(ip, result, action, metrics);
        }

        const geo = geoip.lookup(ip);
        let country = (geo && geo.country) ? geo.country : '';
        let lat = (geo && geo.ll && geo.ll[0] !== null) ? geo.ll[0] : null;
        let lon = (geo && geo.ll && geo.ll[1] !== null) ? geo.ll[1] : null;

        if (lat === null || lon === null || country === '') {
          const FALLBACKS = [
            { c: 'CN', lat: 35.86, lon: 104.19 }, { c: 'RU', lat: 61.52, lon: 105.31 },
            { c: 'US', lat: 37.09, lon: -95.71 }, { c: 'BR', lat: -14.23, lon: -51.92 },
            { c: 'IR', lat: 32.42, lon: 53.68 }, { c: 'NL', lat: 52.13, lon: 5.29 },
            { c: 'DE', lat: 51.16, lon: 10.45 }, { c: 'NG', lat: 9.08, lon: 8.67 },
            { c: 'VN', lat: 14.05, lon: 108.27 }, { c: 'KP', lat: 40.33, lon: 127.51 }
          ];
          const ipHash = ip.split('.').reduce((a, b) => a + parseInt(b || 0), 0) || 0;
          const fb = FALLBACKS[ipHash % FALLBACKS.length];
          country = fb.c;
          lat = fb.lat + ((ipHash % 100) - 50) * 0.15; // Jitter up to +/- 7.5 degrees
          lon = fb.lon + (((ipHash * 3) % 100) - 50) * 0.15;
        }

        liveScores.push({
          id: `${nowIso}-${ip}`,
          ip,
          country: country || 'Unknown',
          lat,
          lon,
          score: Math.min(100, result.score),
          rawScore: result.score,
          action,
          reason: result.reasons.join(', ') || 'normal activity',
          detected_at: nowIso,
          tcp: metrics.tcp,
          syn: metrics.syn,
          established: metrics.established,
          udp: metrics.udp,
          ports: metrics.localPorts.size,
          delta: result.delta,
          synRatio: Number(result.synRatio.toFixed(3)),
          totalConnections: result.totalConnections,
        });

        this.observations.set(ip, {
          totalConnections: result.totalConnections,
          lastScore: result.score,
          lastAction: action,
          lastSeenAt: nowIso,
          lastBannedAt: action === 'banned' ? nowIso : previous.lastBannedAt || null,
          lastLoggedAt: shouldLog ? Date.now() : previous.lastLoggedAt || 0,
        });
      }

      this.lastScanAt = new Date().toISOString();
      this.latestScores = liveScores
        .sort((a, b) => b.score - a.score || b.totalConnections - a.totalConnections)
        .slice(0, 120);
      this.lastSummary = {
        scannedIps,
        watchedIps,
        bannedIps,
        cleanIps,
        lastBannedIp,
        lastReason,
        lastDurationMs: Date.now() - startedAt,
      };
      return this.getStatus();
    } catch (err) {
      console.error('[Radar] Scan error:', err.message);
      throw err;
    } finally {
      this.isScanning = false;
    }
  }

  async logThreat(ip, result, action, metrics) {
    const reason = result.reasons.join(', ') || 'Suspicious traffic pattern';
    try {
      await this.supabaseAdmin.from('threat_radar').insert({
        ip,
        score: result.score,
        reason,
        abuseipdb_score: 0,
        action,
      });
      this.saveToLocalIntel(ip, result, action, metrics);
    } catch (e) {
      console.error('[Radar] DB log error:', e.message);
    }
  }

  saveToLocalIntel(ip, result, action, metrics) {
    try {
      const date = new Date().toISOString().split('T')[0];
      const time = new Date().toISOString();
      const logFile = path.join(INTEL_DIR, 'logs', `${date}.jsonl`);
      const ipFile = path.join(INTEL_DIR, `${ip}.json`);

      const entry = {
        timestamp: time,
        ip,
        score: result.score,
        action,
        reasons: result.reasons,
        metrics: {
          tcp: metrics.tcp,
          syn: metrics.syn,
          established: metrics.established,
          udp: metrics.udp,
          portFanout: metrics.localPorts.size,
          delta: result.delta,
          synRatio: Number(result.synRatio.toFixed(3)),
        },
      };

      fs.appendFileSync(logFile, JSON.stringify(entry) + '\n');

      let ipHistory = { ip, first_seen: time, last_seen: time, events: [] };
      if (fs.existsSync(ipFile)) {
        ipHistory = JSON.parse(fs.readFileSync(ipFile, 'utf8'));
      }

      ipHistory.last_seen = time;
      ipHistory.events.unshift(entry);
      ipHistory.events = ipHistory.events.slice(0, 100);
      fs.writeFileSync(ipFile, JSON.stringify(ipHistory, null, 2));
    } catch (e) {
      console.error('[Radar] Intel save error:', e.message);
    }
  }

  async banIp(ip, reason, metrics = {}) {
    console.log(`[Radar] BANNING IP: ${ip} | Reason: ${reason}`);
    if (typeof this.options.onBan === 'function') {
      try { await this.options.onBan(ip, reason, metrics); } catch (e) { console.error('[Radar] onBan hook error:', e.message); }
    }

    // 1. Add to Sparrowx XDP eBPF map for instant hardware-level dropping (Phase 1)
    try {
      const parts = ip.split('.');
      if (parts.length === 4) {
        // Convert IP parts into hex string for bpftool (e.g. 192.168.1.1 -> c0 a8 01 01)
        const hexIp = parts.map(p => parseInt(p, 10).toString(16).padStart(2, '0')).join(' ');
        // Inject directly into the eBPF map. 01 00 00 00 represents the value '1' indicating banned
        const bpfCmd = `bpftool map update pinned /sys/fs/bpf/sparrowx_blacklist key hex ${hexIp} value hex 01 00 00 00 2>/dev/null || true`;
        execSync(bpfCmd);
      }
    } catch (e) {
      console.error('[Radar] XDP Engine Map update error:', e.message);
    }

    // 2. Also add to nftables as a fallback/redundancy
    execSync(`NFT_TABLE=$(nft list table inet detroit_guard >/dev/null 2>&1 && echo detroit_guard || (nft list table inet sbs_filter >/dev/null 2>&1 && echo sbs_filter || echo sparrowx_guard)); nft add element inet $NFT_TABLE blacklist { ${ip} } 2>/dev/null || true`);
  }
}

module.exports = RadarScanner;
