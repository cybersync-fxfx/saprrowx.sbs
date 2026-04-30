'use strict';
/**
 * SPARROWX BRAIN CHAT - Local NLP Interactive Interface
 * Usage: node sparrow-brain-chat.js
 */
const fs = require('fs');
const path = require('path');
const readline = require('readline');

const BRAIN_DIR   = path.join(__dirname, 'intel', 'brain');
const MEMORY_FILE = path.join(BRAIN_DIR, 'memory.json');
const TEACH_FILE  = path.join(BRAIN_DIR, 'taught-knowledge.json');
const CHAT_LOG    = path.join(BRAIN_DIR, 'chat-history.jsonl');
const ATTACK_LOG  = '/var/log/sbs/attacks.log';

fs.mkdirSync(BRAIN_DIR, { recursive: true });

// ── Color helpers ────────────────────────────────────────────────
const C = {
  green:  s => `\x1b[32m${s}\x1b[0m`,
  cyan:   s => `\x1b[36m${s}\x1b[0m`,
  yellow: s => `\x1b[33m${s}\x1b[0m`,
  red:    s => `\x1b[31m${s}\x1b[0m`,
  bold:   s => `\x1b[1m${s}\x1b[0m`,
  dim:    s => `\x1b[2m${s}\x1b[0m`,
};

// ── Load persistent memory ───────────────────────────────────────
function loadMemory() {
  try {
    if (fs.existsSync(MEMORY_FILE)) return JSON.parse(fs.readFileSync(MEMORY_FILE, 'utf8'));
  } catch (_) {}
  return { knownAttackers: {}, attackPatterns: {}, hourlyActivity: {}, bannedIpCount: 0, totalEventsProcessed: 0, totalCycles: 0, learnedThresholds: null, lastAnalyzedAt: null };
}

// ── Load taught knowledge ─────────────────────────────────────────
function loadKnowledge() {
  try {
    if (fs.existsSync(TEACH_FILE)) return JSON.parse(fs.readFileSync(TEACH_FILE, 'utf8'));
  } catch (_) {}
  return { trustedIps: [], suspiciousIps: [], customRules: [], notes: [] };
}

function saveKnowledge(k) {
  fs.writeFileSync(TEACH_FILE, JSON.stringify(k, null, 2));
}

// ── Log helper ───────────────────────────────────────────────────
function logChat(role, text) {
  fs.appendFileSync(CHAT_LOG, JSON.stringify({ ts: new Date().toISOString(), role, text }) + '\n');
}

// ── NLP Intent Engine ────────────────────────────────────────────
const INTENTS = [
  // Status / overview
  { patterns: ['how are you', 'status', "what's happening", 'overview', 'summary', 'report', 'show me', 'what do you know', 'update me'], fn: 'STATUS' },
  // Threat queries
  { patterns: ['top attacker', 'worst ip', 'most attack', 'biggest threat', 'who is attacking', 'top threat', 'repeat offender'], fn: 'TOP_ATTACKERS' },
  { patterns: ['attack type', 'what kind of attack', 'type of threat', 'pattern', 'how they attack', 'attack method'], fn: 'ATTACK_TYPES' },
  { patterns: ['peak hour', 'when do they attack', 'busiest time', 'what time', 'attack schedule', 'worst hour'], fn: 'PEAK_HOURS' },
  { patterns: ['total ban', 'how many banned', 'ban count', 'blocked ip', 'how many block'], fn: 'BAN_COUNT' },
  // IP lookup
  { patterns: ['look up', 'lookup', 'check ip', 'tell me about', 'info on', 'what about ip', 'investigate'], fn: 'IP_LOOKUP' },
  // Last attacks
  { patterns: ['last attack', 'recent attack', 'latest threat', 'recent event', 'what happened recently'], fn: 'RECENT_ATTACKS' },
  // Thresholds
  { patterns: ['threshold', 'radar setting', 'current config', 'sensitivity', 'learned setting', 'recommended'], fn: 'THRESHOLDS' },
  // Teaching
  { patterns: ['trust', 'whitelist', 'my server', 'safe ip', 'allow', 'add trusted', 'mark as safe'], fn: 'TEACH_TRUST' },
  { patterns: ['suspicious', 'watch', 'flag', 'mark as bad', 'add suspect', 'that ip is bad', 'keep eye on'], fn: 'TEACH_SUSPECT' },
  { patterns: ['remember', 'note', 'write down', 'dont forget', "don't forget", 'keep in mind', 'add note'], fn: 'TEACH_NOTE' },
  { patterns: ['what did i teach', 'what you know', 'my rules', 'custom rules', 'show knowledge', 'show notes'], fn: 'SHOW_KNOWLEDGE' },
  { patterns: ['forget', 'remove', 'delete rule', 'clear note', 'undo'], fn: 'FORGET' },
  // Help
  { patterns: ['help', 'what can you do', 'commands', '?', 'how to', 'guide'], fn: 'HELP' },
  // Disk
  { patterns: ['disk', 'log size', 'storage', 'space', 'how big', 'log file'], fn: 'DISK_INFO' },
  // Refresh / analyze
  { patterns: ['analyze', 'refresh', 'learn', 'rescan', 'update knowledge', 'relearn', 'scan again'], fn: 'ANALYZE' },
];

function detectIntent(input) {
  const lower = input.toLowerCase().trim();
  for (const intent of INTENTS) {
    if (intent.patterns.some(p => lower.includes(p))) return intent.fn;
  }
  // IP address directly typed
  if (/\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/.test(lower)) return 'IP_LOOKUP';
  return 'UNKNOWN';
}

function extractIp(input) {
  const match = input.match(/\b(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})\b/);
  return match ? match[1] : null;
}

// ── Response Handlers ────────────────────────────────────────────
function handleStatus(mem, knowledge) {
  const patterns = Object.keys(mem.attackPatterns).length;
  const attackers = Object.keys(mem.knownAttackers).length;
  const topType = Object.entries(mem.attackPatterns).sort((a, b) => b[1].count - a[1].count)[0];
  const last = mem.lastAnalyzedAt ? new Date(mem.lastAnalyzedAt).toLocaleString() : 'never';
  let r = `Here's what I know right now:\n`;
  r += `  • I've processed ${C.bold(mem.totalEventsProcessed)} threat events across ${mem.totalCycles} analysis cycles.\n`;
  r += `  • I'm tracking ${C.bold(attackers)} unique attacker IPs.\n`;
  r += `  • Total bans logged: ${C.bold(mem.bannedIpCount)}.\n`;
  r += `  • I've seen ${patterns} distinct attack patterns.\n`;
  if (topType) r += `  • Most common attack: ${C.yellow(topType[0])} (${topType[1].count} times).\n`;
  r += `  • ${knowledge.trustedIps.length} trusted IPs, ${knowledge.suspiciousIps.length} flagged IPs in custom rules.\n`;
  r += `  • Last analyzed: ${C.dim(last)}`;
  return r;
}

function handleTopAttackers(mem) {
  const top = Object.entries(mem.knownAttackers)
    .sort((a, b) => b[1].hitCount - a[1].hitCount)
    .slice(0, 8);
  if (!top.length) return `I haven't seen any attackers yet. Run an analysis cycle first.`;
  let r = `${C.bold('Top repeat offenders I\'m tracking:')}\n`;
  top.forEach(([ip, d], i) => {
    const types = Object.keys(d.types).join(', ');
    r += `  ${i + 1}. ${C.red(ip.padEnd(18))} — ${d.hitCount} hits  [${types}]\n`;
    r += `     Last seen: ${d.lastSeen ? new Date(d.lastSeen).toLocaleString() : 'unknown'}\n`;
  });
  return r.trimEnd();
}

function handleAttackTypes(mem) {
  const types = Object.entries(mem.attackPatterns).sort((a, b) => b[1].count - a[1].count);
  if (!types.length) return `No attack patterns learned yet. Let me analyze some logs first.`;
  let r = `${C.bold('Attack patterns I\'ve identified:')}\n`;
  const total = types.reduce((a, b) => a + b[1].count, 0);
  types.forEach(([type, d]) => {
    const pct = total > 0 ? Math.round(d.count / total * 100) : 0;
    const bar = '▓'.repeat(Math.round(pct / 5));
    r += `  ${C.yellow(type.padEnd(20))}  ${bar.padEnd(20)} ${pct}% (${d.count} events, peak score: ${d.peakScore})\n`;
  });
  return r.trimEnd();
}

function handlePeakHours(mem) {
  const hours = Object.entries(mem.hourlyActivity).sort((a, b) => b[1] - a[1]);
  if (!hours.length) return `Not enough data to determine peak hours yet.`;
  const max = hours[0][1];
  let r = `${C.bold('Attack activity by hour (UTC):')}\n`;
  hours.slice(0, 8).forEach(([h, count]) => {
    const bar = '█'.repeat(Math.min(25, Math.round(count / max * 25)));
    const label = count === max ? C.red(`${h}:00`) : `${h}:00`;
    r += `  ${label.padEnd(7)} ${bar.padEnd(25)} ${count}\n`;
  });
  r += `\n  ${C.yellow('Highest risk window:')} ${hours[0][0]}:00 – ${String(Number(hours[0][0]) + 1).padStart(2,'0')}:00`;
  return r;
}

function handleBanCount(mem) {
  return `I have ${C.bold(mem.bannedIpCount)} ban events in memory, tracking ${Object.keys(mem.knownAttackers).length} unique attacker IPs total.\nThis number grows as I process more log cycles.`;
}

function handleIpLookup(input, mem, knowledge) {
  const ip = extractIp(input);
  if (!ip) return `Which IP do you want me to look up? (e.g. "check 1.2.3.4")`;

  const data = mem.knownAttackers[ip];
  const trusted = knowledge.trustedIps.includes(ip);
  const suspect = knowledge.suspiciousIps.includes(ip);

  let r = `${C.bold(`Intel on ${ip}:`)}\n`;

  if (trusted) r += `  ⚠️  ${C.green('YOU MARKED THIS AS TRUSTED')} — treat with care.\n`;
  if (suspect) r += `  🚩  ${C.red('YOU FLAGGED THIS AS SUSPICIOUS.')}\n`;

  if (!data) {
    r += `  I have no threat history on this IP in my memory.\n`;
    r += `  It may be clean, or it may not have appeared in analyzed logs yet.`;
    return r;
  }

  const types = Object.entries(data.types).map(([t, c]) => `${t}(${c})`).join(', ');
  r += `  Hit count   : ${C.red(data.hitCount)} events\n`;
  r += `  Attack types: ${C.yellow(types)}\n`;
  r += `  First seen  : ${data.firstSeen ? new Date(data.firstSeen).toLocaleString() : 'unknown'}\n`;
  r += `  Last seen   : ${data.lastSeen  ? new Date(data.lastSeen).toLocaleString()  : 'unknown'}\n`;
  r += data.hitCount > 20
    ? `  ${C.red('Assessment: HIGH RISK — this IP is a repeat offender.')}`
    : data.hitCount > 5
    ? `  ${C.yellow('Assessment: MODERATE — has shown suspicious behavior.')}`
    : `  ${C.dim('Assessment: LOW — limited activity seen so far.')}`;
  return r;
}

function handleRecentAttacks() {
  if (!fs.existsSync(ATTACK_LOG)) return `No attack log found at ${ATTACK_LOG}.`;
  const lines = fs.readFileSync(ATTACK_LOG, 'utf8').split('\n').filter(Boolean).slice(-10);
  if (!lines.length) return `The attack log is empty right now.`;
  let r = `${C.bold('Last 10 attack log entries:')}\n`;
  lines.forEach(l => { r += `  ${C.dim(l)}\n`; });
  return r.trimEnd();
}

function handleThresholds(mem) {
  const t = mem.learnedThresholds;
  if (!t) return `I haven't generated learned thresholds yet. Run "analyze" first.`;
  let r = `${C.bold('My recommended radar thresholds (based on learned patterns):')}\n`;
  r += `  Ban threshold    : ${C.yellow(t.threshold)}  (default 90)\n`;
  r += `  Watch threshold  : ${C.yellow(t.watchThreshold)}  (default 55)\n`;
  r += `  SYN ban trigger  : ${C.yellow(t.synBan)}  (default 90)\n`;
  r += `  UDP ban trigger  : ${C.yellow(t.udpBan)}  (default 360)\n`;
  r += `  Burst ban trigger: ${C.yellow(t.burstBan)}  (default 180)\n`;
  r += `  Port fanout ban  : ${C.yellow(t.portFanoutBan)}  (default 12)\n`;
  r += `  Based on ${t._attackFrequency} observed attack events.\n`;
  r += `  To apply: ${C.dim('node sparrow-brain.js --apply')}`;
  return r;
}

function handleTeachTrust(input, knowledge) {
  const ip = extractIp(input);
  if (!ip) return `Tell me which IP to trust. Example: "trust 1.2.3.4" or "my server is 1.2.3.4"`;
  if (!knowledge.trustedIps.includes(ip)) {
    knowledge.trustedIps.push(ip);
    saveKnowledge(knowledge);
    return `${C.green('Got it.')} I've marked ${C.bold(ip)} as trusted. I'll remember not to flag this IP as a threat.`;
  }
  return `${ip} is already in my trusted list.`;
}

function handleTeachSuspect(input, knowledge) {
  const ip = extractIp(input);
  if (!ip) return `Which IP should I watch? Example: "flag 1.2.3.4 as suspicious"`;
  if (!knowledge.suspiciousIps.includes(ip)) {
    knowledge.suspiciousIps.push(ip);
    saveKnowledge(knowledge);
    return `${C.yellow('Noted.')} I've flagged ${C.bold(ip)} as suspicious. I'll keep a close eye on it.`;
  }
  return `${ip} is already in my watch list.`;
}

function handleTeachNote(input, knowledge) {
  const noteMatch = input.match(/(?:remember|note|write down|keep in mind|add note)[:\s]+(.+)/i);
  const note = noteMatch ? noteMatch[1].trim() : input.replace(/^(remember|note|dont forget|don't forget)\s*/i, '').trim();
  if (!note || note.length < 3) return `What should I remember? Tell me like: "remember that port 8080 is my dev server"`;
  const entry = { text: note, addedAt: new Date().toISOString() };
  knowledge.notes.push(entry);
  saveKnowledge(knowledge);
  return `${C.green('Stored.')} I'll remember: "${note}"`;
}

function handleShowKnowledge(knowledge) {
  let r = `${C.bold('Everything you\'ve taught me:')}\n`;
  r += `\n  ${C.green('Trusted IPs:')} ${knowledge.trustedIps.length ? knowledge.trustedIps.join(', ') : 'none'}\n`;
  r += `  ${C.yellow('Flagged IPs:')} ${knowledge.suspiciousIps.length ? knowledge.suspiciousIps.join(', ') : 'none'}\n`;
  r += `\n  ${C.cyan('Notes:')}\n`;
  if (!knowledge.notes.length) { r += `  (none yet)\n`; }
  else knowledge.notes.forEach((n, i) => { r += `  ${i + 1}. ${n.text} ${C.dim('(' + new Date(n.addedAt).toLocaleDateString() + ')')}\n`; });
  return r.trimEnd();
}

function handleForget(input, knowledge) {
  const ip = extractIp(input);
  if (ip) {
    const before = knowledge.trustedIps.length + knowledge.suspiciousIps.length;
    knowledge.trustedIps    = knowledge.trustedIps.filter(i => i !== ip);
    knowledge.suspiciousIps = knowledge.suspiciousIps.filter(i => i !== ip);
    const after = knowledge.trustedIps.length + knowledge.suspiciousIps.length;
    saveKnowledge(knowledge);
    return before > after ? `${C.green('Done.')} Removed ${ip} from all my custom lists.` : `I don't have ${ip} in any custom list.`;
  }
  const numMatch = input.match(/note\s+#?(\d+)/i);
  if (numMatch) {
    const idx = parseInt(numMatch[1]) - 1;
    if (idx >= 0 && idx < knowledge.notes.length) {
      const removed = knowledge.notes.splice(idx, 1)[0];
      saveKnowledge(knowledge);
      return `${C.green('Removed note:')} "${removed.text}"`;
    }
    return `Note #${numMatch[1]} not found. Use "show notes" to see them.`;
  }
  return `Tell me what to forget — an IP (e.g. "forget 1.2.3.4") or a note number (e.g. "forget note 2").`;
}

function handleDiskInfo() {
  const dirs = ['/var/log/sbs', path.join(__dirname, 'storage'), path.join(__dirname, 'intel')];
  let r = `${C.bold('Log & storage disk usage:')}\n`;
  const { execSync } = require('child_process');
  for (const d of dirs) {
    try {
      const size = execSync(`du -sh "${d}" 2>/dev/null || echo "N/A"`, { encoding: 'utf8' }).trim().split('\t')[0];
      r += `  ${d.padEnd(40)} ${C.yellow(size)}\n`;
    } catch (_) { r += `  ${d} — unable to read\n`; }
  }
  r += `\n  To manage logs: ${C.dim('sudo bash sbs-disk-manager.sh')}`;
  return r;
}

function handleAnalyze() {
  const { execSync } = require('child_process');
  try {
    execSync(`node "${path.join(__dirname, 'sparrow-brain.js')}" --apply`, { stdio: 'inherit' });
    return `${C.green('Analysis complete!')} Memory updated and thresholds applied. Ask me for a summary!`;
  } catch (e) {
    return `${C.yellow('Analysis ran but may have had issues:')} ${e.message}`;
  }
}

function handleHelp() {
  return `${C.bold('Things you can ask me:')}\n
  ${C.cyan('INTEL')}
    "give me a status summary"
    "who are the top attackers?"
    "what types of attacks are you seeing?"
    "when do attacks peak?"
    "check 1.2.3.4" / "tell me about 1.2.3.4"
    "show me recent attacks"
    "what thresholds did you learn?"
    "how many IPs are banned?"

  ${C.cyan('TEACH ME')}
    "trust 10.0.0.5"             → whitelist an IP
    "flag 45.67.8.9 as suspicious" → watch an IP
    "remember that port 8080 is my dev server"
    "forget 10.0.0.5"            → remove from lists
    "forget note 2"              → remove a note
    "show what you know"         → see all custom rules

  ${C.cyan('SYSTEM')}
    "analyze" / "rescan"         → run a learning cycle
    "show disk usage"            → check log file sizes
    "help"                       → this menu`;
}

// ── Main chat loop ───────────────────────────────────────────────
function reply(input) {
  const mem       = loadMemory();
  const knowledge = loadKnowledge();
  const intent    = detectIntent(input);

  switch (intent) {
    case 'STATUS':         return handleStatus(mem, knowledge);
    case 'TOP_ATTACKERS':  return handleTopAttackers(mem);
    case 'ATTACK_TYPES':   return handleAttackTypes(mem);
    case 'PEAK_HOURS':     return handlePeakHours(mem);
    case 'BAN_COUNT':      return handleBanCount(mem);
    case 'IP_LOOKUP':      return handleIpLookup(input, mem, knowledge);
    case 'RECENT_ATTACKS': return handleRecentAttacks();
    case 'THRESHOLDS':     return handleThresholds(mem);
    case 'TEACH_TRUST':    return handleTeachTrust(input, knowledge);
    case 'TEACH_SUSPECT':  return handleTeachSuspect(input, knowledge);
    case 'TEACH_NOTE':     return handleTeachNote(input, knowledge);
    case 'SHOW_KNOWLEDGE': return handleShowKnowledge(knowledge);
    case 'FORGET':         return handleForget(input, knowledge);
    case 'DISK_INFO':      return handleDiskInfo();
    case 'ANALYZE':        return handleAnalyze();
    case 'HELP':           return handleHelp();
    default:
      return `I'm not sure what you mean. Try asking about threats, IPs, attack patterns, or type "${C.dim('help')}" to see what I can do.`;
  }
}

// ── Boot ─────────────────────────────────────────────────────────
console.log(C.cyan(`
╔══════════════════════════════════════════════════════╗
║      SPARROWX BRAIN — Local Threat Intelligence      ║
║      No API. No cloud. Pure local learning.          ║
╚══════════════════════════════════════════════════════╝`));
console.log(C.dim(`  Type "help" to see what I can do. Type "exit" to quit.\n`));

const mem0 = loadMemory();
if (mem0.totalEventsProcessed > 0) {
  console.log(C.green(`  Brain loaded: ${mem0.totalEventsProcessed} events in memory, ${Object.keys(mem0.knownAttackers).length} attackers tracked.\n`));
} else {
  console.log(C.yellow(`  No memory yet. Type "analyze" to run a learning cycle first.\n`));
}

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const PROMPT = C.cyan('you') + C.dim(' → ') ;
const BRAIN_TAG = C.green('brain') + C.dim(' → ');

function ask() {
  rl.question(PROMPT, input => {
    const trimmed = input.trim();
    if (!trimmed) { ask(); return; }
    if (['exit', 'quit', 'bye', 'q'].includes(trimmed.toLowerCase())) {
      console.log(C.cyan('\n  Sparrow Brain signing off. Stay protected. 🛡️\n'));
      rl.close();
      return;
    }
    logChat('user', trimmed);
    const response = reply(trimmed);
    logChat('brain', response.replace(/\x1b\[[0-9;]*m/g, ''));
    console.log(`\n${BRAIN_TAG}\n${response.split('\n').map(l => `  ${l}`).join('\n')}\n`);
    ask();
  });
}

ask();
