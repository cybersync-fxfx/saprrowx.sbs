/**
 * =================================================================
 *  SPARROWX - LOCAL THREAT BRAIN (No Third-Party AI)
 *  A self-training pattern recognition engine that reads attack
 *  and traffic logs, identifies threat signatures, and
 *  automatically tunes radar thresholds for future defense.
 *
 *  Usage:
 *    node sparrow-brain.js              -- Run full analysis
 *    node sparrow-brain.js --report     -- Print report only
 *    node sparrow-brain.js --apply      -- Apply learned thresholds to radar
 *    node sparrow-brain.js --watch      -- Continuous mode (runs every 5min)
 * =================================================================
 */

'use strict';

const fs   = require('fs');
const path = require('path');

// ── Config ────────────────────────────────────────────────────────
const BRAIN_DIR      = path.join(__dirname, 'intel', 'brain');
const MEMORY_FILE    = path.join(BRAIN_DIR, 'memory.json');
const REPORT_FILE    = path.join(BRAIN_DIR, 'last-report.json');
const RADAR_CFG_PATH = path.join(__dirname, 'tunnels.json'); // resolved dynamically

const ATTACK_LOG    = '/var/log/sbs/attacks.log';
const INTEL_LOG_DIR = path.join(__dirname, 'intel', 'logs');
const STORAGE_DIR   = path.join(__dirname, 'storage');

const WATCH_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

const ARGS = process.argv.slice(2);
const MODE = {
  report: ARGS.includes('--report'),
  apply:  ARGS.includes('--apply'),
  watch:  ARGS.includes('--watch'),
};

fs.mkdirSync(BRAIN_DIR, { recursive: true });

// ── Memory (persistent learned knowledge) ────────────────────────
function loadMemory() {
  try {
    if (fs.existsSync(MEMORY_FILE)) {
      return JSON.parse(fs.readFileSync(MEMORY_FILE, 'utf8'));
    }
  } catch (_) {}
  return {
    version: 1,
    createdAt: new Date().toISOString(),
    totalCycles: 0,
    totalEventsProcessed: 0,
    knownAttackers: {},      // ip -> { hitCount, firstSeen, lastSeen, types }
    attackPatterns: {},      // type -> { count, avgScore, peakScore }
    hourlyActivity: {},      // "HH" -> count (0-23)
    bannedIpCount: 0,
    learnedThresholds: null, // the recommended thresholds from learned data
    lastAnalyzedAt: null,
  };
}

function saveMemory(memory) {
  fs.writeFileSync(MEMORY_FILE, JSON.stringify(memory, null, 2));
}

// ── Log Parsers ──────────────────────────────────────────────────

/** Parse /var/log/sbs/attacks.log
 *  Expected format: [2025-04-30T10:22:11.000Z] [auto-ban] 1.2.3.4 blocked... */
function parseAttackLog() {
  const events = [];
  if (!fs.existsSync(ATTACK_LOG)) return events;

  const lines = fs.readFileSync(ATTACK_LOG, 'utf8').split('\n').filter(Boolean);
  for (const line of lines) {
    const tsMatch  = line.match(/\[(\d{4}-\d{2}-\d{2}T[\d:.]+Z?)\]/);
    const ipMatch  = line.match(/\b(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})\b/);
    const typeMatch = line.match(/\[(auto-ban|manual-ban|radar|manual-unban|radar-mode|shield)\]/i);

    if (!ipMatch) continue;

    events.push({
      ts:   tsMatch  ? new Date(tsMatch[1])  : new Date(),
      ip:   ipMatch[1],
      type: typeMatch ? typeMatch[1].toLowerCase() : 'unknown',
      raw:  line,
    });
  }
  return events;
}

/** Parse intel/logs/*.jsonl (written by radar-scanner.js) */
function parseIntelLogs() {
  const events = [];
  if (!fs.existsSync(INTEL_LOG_DIR)) return events;

  const files = fs.readdirSync(INTEL_LOG_DIR)
    .filter(f => f.endsWith('.jsonl'))
    .sort()
    .slice(-30); // Last 30 daily logs

  for (const file of files) {
    const lines = fs.readFileSync(path.join(INTEL_LOG_DIR, file), 'utf8').split('\n').filter(Boolean);
    for (const line of lines) {
      try {
        events.push(JSON.parse(line));
      } catch (_) {}
    }
  }
  return events;
}

/** Parse storage/*/logs/*.jsonl (written by server.js per-agent) */
function parseStorageLogs() {
  const events = [];
  if (!fs.existsSync(STORAGE_DIR)) return events;

  const clients = fs.readdirSync(STORAGE_DIR)
    .map(d => path.join(STORAGE_DIR, d, 'logs'))
    .filter(d => {
      try { return fs.statSync(d).isDirectory(); } catch (_) { return false; }
    });

  for (const logsDir of clients) {
    const files = fs.readdirSync(logsDir)
      .filter(f => f.endsWith('.jsonl'))
      .sort()
      .slice(-7); // Last 7 days per client

    for (const file of files) {
      const lines = fs.readFileSync(path.join(logsDir, file), 'utf8').split('\n').filter(Boolean);
      for (const line of lines) {
        try {
          events.push(JSON.parse(line));
        } catch (_) {}
      }
    }
  }
  return events;
}

// ── Threat Classification ─────────────────────────────────────────
function classifyThreat(event) {
  const reasons = (event.reasons || []).join(' ').toLowerCase();
  const raw = (event.raw || '').toLowerCase();

  if (/syn/i.test(reasons + raw))        return 'syn-flood';
  if (/udp/i.test(reasons + raw))        return 'udp-flood';
  if (/port.*fanout|scan/i.test(reasons + raw)) return 'port-scan';
  if (/burst/i.test(reasons + raw))      return 'burst-flood';
  if (/brute|ssh|auth/i.test(raw))       return 'brute-force';
  if (/repeat.*offender/i.test(reasons)) return 'repeat-offender';
  if (/ratio/i.test(reasons))            return 'syn-ratio-flood';
  return 'generic-flood';
}

// ── Core Analysis ─────────────────────────────────────────────────
function analyze(memory) {
  console.log('[Brain] Starting analysis cycle...');

  const attackLogEvents  = parseAttackLog();
  const intelLogEvents   = parseIntelLogs();
  const storageLogEvents = parseStorageLogs();

  let totalProcessed = 0;
  const hourlyBuckets  = new Array(24).fill(0);
  const scoresByType   = {};  // type -> [scores]
  const ipHits         = {};  // ip -> hit count this cycle

  // Process intel logs (richest data)
  for (const ev of intelLogEvents) {
    if (!ev.ip) continue;
    totalProcessed++;

    const type = classifyThreat(ev);
    const score = Number(ev.score || 0);
    const ts = ev.timestamp ? new Date(ev.timestamp) : new Date();
    const hour = ts.getHours();

    // Hourly activity pattern
    hourlyBuckets[hour]++;

    // Score tracking per type
    if (!scoresByType[type]) scoresByType[type] = [];
    scoresByType[type].push(score);

    // IP hit tracking
    ipHits[ev.ip] = (ipHits[ev.ip] || 0) + 1;

    // Update memory for known attackers
    const existing = memory.knownAttackers[ev.ip] || { hitCount: 0, types: {} };
    existing.hitCount++;
    existing.firstSeen = existing.firstSeen || ts.toISOString();
    existing.lastSeen  = ts.toISOString();
    existing.types[type] = (existing.types[type] || 0) + 1;
    memory.knownAttackers[ev.ip] = existing;
  }

  // Process raw attack log events
  for (const ev of attackLogEvents) {
    totalProcessed++;
    const hour = ev.ts.getHours();
    hourlyBuckets[hour]++;
    if (ev.type === 'auto-ban' || ev.type === 'manual-ban') {
      memory.bannedIpCount++;
    }
    ipHits[ev.ip] = (ipHits[ev.ip] || 0) + 1;
    const existing = memory.knownAttackers[ev.ip] || { hitCount: 0, types: {} };
    existing.hitCount++;
    existing.lastSeen = ev.ts.toISOString();
    existing.firstSeen = existing.firstSeen || ev.ts.toISOString();
    existing.types[ev.type] = (existing.types[ev.type] || 0) + 1;
    memory.knownAttackers[ev.ip] = existing;
  }

  // Merge hourly activity
  for (let h = 0; h < 24; h++) {
    const key = String(h).padStart(2, '0');
    memory.hourlyActivity[key] = (memory.hourlyActivity[key] || 0) + hourlyBuckets[h];
  }

  // Update attack patterns
  for (const [type, scores] of Object.entries(scoresByType)) {
    const avg  = scores.reduce((a, b) => a + b, 0) / scores.length;
    const peak = Math.max(...scores);
    const prev = memory.attackPatterns[type] || { count: 0, avgScore: 0, peakScore: 0 };
    memory.attackPatterns[type] = {
      count:     prev.count + scores.length,
      avgScore:  Math.round((prev.avgScore + avg) / 2),
      peakScore: Math.max(prev.peakScore, peak),
    };
  }

  // Update memory
  memory.totalCycles++;
  memory.totalEventsProcessed += totalProcessed;
  memory.lastAnalyzedAt = new Date().toISOString();

  // ── Learn & Recommend Thresholds ──────────────────────────────
  // Based on observed attack patterns, recommend tighter or looser thresholds
  const synData   = memory.attackPatterns['syn-flood']   || { avgScore: 0, peakScore: 0 };
  const udpData   = memory.attackPatterns['udp-flood']   || { avgScore: 0, peakScore: 0 };
  const burstData = memory.attackPatterns['burst-flood'] || { avgScore: 0, peakScore: 0 };
  const scanData  = memory.attackPatterns['port-scan']   || { avgScore: 0, peakScore: 0 };

  // If we see frequent attacks, tighten thresholds. If quiet, relax slightly.
  const attackFrequency = Object.values(memory.attackPatterns).reduce((a, b) => a + b.count, 0);
  const tighteningFactor = Math.min(0.85, 1 - Math.min(attackFrequency / 5000, 0.15));

  memory.learnedThresholds = {
    _comment: 'Auto-generated by Sparrow Brain. Apply with --apply flag.',
    _generatedAt: new Date().toISOString(),
    _basedOnEvents: totalProcessed,
    _attackFrequency: attackFrequency,
    threshold: Math.round(90 * tighteningFactor),
    watchThreshold: Math.round(55 * tighteningFactor),
    synBan: synData.avgScore > 30 ? Math.max(20, Math.round(synData.avgScore * 0.7)) : 90,
    udpBan: udpData.avgScore > 30 ? Math.max(80, Math.round(udpData.avgScore * 0.8)) : 360,
    burstBan: burstData.avgScore > 30 ? Math.max(60, Math.round(burstData.avgScore * 0.75)) : 180,
    portFanoutBan: scanData.count > 50 ? 8 : 12,
  };

  return {
    memory,
    cycle: {
      processedThisCycle: totalProcessed,
      ipsSeen: Object.keys(ipHits).length,
      topAttackIps: Object.entries(ipHits).sort((a, b) => b[1] - a[1]).slice(0, 10),
      peakHour: hourlyBuckets.indexOf(Math.max(...hourlyBuckets)),
      scoresByType,
    },
  };
}

// ── Report Generator ─────────────────────────────────────────────
function printReport(memory, cycle) {
  const line = '='.repeat(62);
  console.log(`\n${line}`);
  console.log('  SPARROWX LOCAL THREAT BRAIN — INTELLIGENCE REPORT');
  console.log(`  Generated: ${new Date().toLocaleString()}`);
  console.log(line);

  console.log(`\n📊 MEMORY STATS`);
  console.log(`  Total analysis cycles : ${memory.totalCycles}`);
  console.log(`  Total events learned  : ${memory.totalEventsProcessed}`);
  console.log(`  Unique attackers seen : ${Object.keys(memory.knownAttackers).length}`);
  console.log(`  Total bans logged     : ${memory.bannedIpCount}`);

  console.log(`\n⏰ PEAK ATTACK HOURS`);
  const sortedHours = Object.entries(memory.hourlyActivity)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);
  for (const [hour, count] of sortedHours) {
    const bar = '█'.repeat(Math.min(20, Math.ceil(count / 10)));
    console.log(`  ${hour}:00  ${bar.padEnd(20)} ${count} events`);
  }

  console.log(`\n🎯 ATTACK PATTERN BREAKDOWN`);
  for (const [type, data] of Object.entries(memory.attackPatterns).sort((a, b) => b[1].count - a[1].count)) {
    console.log(`  ${type.padEnd(22)} count=${data.count} avg=${data.avgScore} peak=${data.peakScore}`);
  }

  console.log(`\n🔥 TOP 10 REPEAT OFFENDERS`);
  const topIps = Object.entries(memory.knownAttackers)
    .sort((a, b) => b[1].hitCount - a[1].hitCount)
    .slice(0, 10);
  for (const [ip, data] of topIps) {
    const types = Object.keys(data.types).join(', ');
    console.log(`  ${ip.padEnd(18)} hits=${data.hitCount} types=[${types}]`);
  }

  if (memory.learnedThresholds) {
    const t = memory.learnedThresholds;
    console.log(`\n🧠 LEARNED RADAR THRESHOLDS`);
    console.log(`  (Based on ${t._attackFrequency} observed attack events)`);
    console.log(`  Ban threshold    : ${t.threshold} (default: 90)`);
    console.log(`  Watch threshold  : ${t.watchThreshold} (default: 55)`);
    console.log(`  SYN ban          : ${t.synBan} (default: 90)`);
    console.log(`  UDP ban          : ${t.udpBan} (default: 360)`);
    console.log(`  Burst ban        : ${t.burstBan} (default: 180)`);
    console.log(`  Port fanout ban  : ${t.portFanoutBan} (default: 12)`);
    console.log(`\n  To apply these:  node sparrow-brain.js --apply`);
  }

  console.log(`\n${line}\n`);
}

// ── Apply Learned Thresholds ─────────────────────────────────────
function applyThresholds(memory) {
  if (!memory.learnedThresholds) {
    console.log('[Brain] No learned thresholds yet. Run analysis first.');
    return;
  }

  // Find the radar config path (same as sparrowguard-config.js logic)
  let radarConfigPath;
  const candidates = [
    path.join(__dirname, 'intel', 'radar-config.json'),
    '/opt/sparrowx/radar-config.json',
    '/opt/detroit-sbs/radar-config.json',
  ];

  if (fs.existsSync(path.join(__dirname, 'tunnels.json'))) {
    radarConfigPath = path.join(__dirname, 'intel', 'radar-config.json');
  } else {
    radarConfigPath = candidates.find(p => fs.existsSync(p)) || candidates[0];
  }

  let currentConfig = {};
  try {
    if (fs.existsSync(radarConfigPath)) {
      currentConfig = JSON.parse(fs.readFileSync(radarConfigPath, 'utf8'));
    }
  } catch (_) {}

  const t = memory.learnedThresholds;
  const merged = {
    ...currentConfig,
    threshold:     t.threshold,
    watchThreshold: t.watchThreshold,
    synBan:        t.synBan,
    udpBan:        t.udpBan,
    burstBan:      t.burstBan,
    portFanoutBan: t.portFanoutBan,
    _lastAppliedAt: new Date().toISOString(),
    _appliedBy: 'sparrow-brain',
  };

  fs.mkdirSync(path.dirname(radarConfigPath), { recursive: true });
  fs.writeFileSync(radarConfigPath, JSON.stringify(merged, null, 2));
  console.log(`[Brain] ✅ Learned thresholds applied to: ${radarConfigPath}`);
  console.log('[Brain] Restart the server or wait for the next radar config reload.');
}

// ── Persist Report ────────────────────────────────────────────────
function saveReport(memory, cycle) {
  const report = {
    generatedAt: new Date().toISOString(),
    totalCycles: memory.totalCycles,
    totalEventsProcessed: memory.totalEventsProcessed,
    uniqueAttackers: Object.keys(memory.knownAttackers).length,
    bannedIpCount: memory.bannedIpCount,
    attackPatterns: memory.attackPatterns,
    topOffenders: Object.entries(memory.knownAttackers)
      .sort((a, b) => b[1].hitCount - a[1].hitCount)
      .slice(0, 20)
      .map(([ip, data]) => ({ ip, ...data })),
    learnedThresholds: memory.learnedThresholds,
    peakHour: Object.entries(memory.hourlyActivity)
      .sort((a, b) => b[1] - a[1])[0]?.[0] || null,
  };
  fs.writeFileSync(REPORT_FILE, JSON.stringify(report, null, 2));
  console.log(`[Brain] Report saved to: ${REPORT_FILE}`);
}

// ── Main ─────────────────────────────────────────────────────────
function run() {
  const memory = loadMemory();
  const { memory: updated, cycle } = analyze(memory);
  saveMemory(updated);
  saveReport(updated, cycle);

  if (!MODE.apply) {
    printReport(updated, cycle);
  }

  if (MODE.apply) {
    applyThresholds(updated);
  }
}

if (MODE.watch) {
  console.log(`[Brain] Watch mode active — running every ${WATCH_INTERVAL_MS / 60000} minutes.`);
  run();
  setInterval(run, WATCH_INTERVAL_MS);
} else {
  run();
}
