'use strict';
/**
 * SPARROWX BRAIN — Natural Language Interface
 * Conversational, context-aware threat intelligence assistant.
 */
const fs      = require('fs');
const path    = require('path');
const readline = require('readline');

const BRAIN_DIR    = path.join(__dirname, 'intel', 'brain');
const MEMORY_FILE  = path.join(BRAIN_DIR, 'memory.json');
const TEACH_FILE   = path.join(BRAIN_DIR, 'taught-knowledge.json');
const CHAT_LOG     = path.join(BRAIN_DIR, 'chat-history.jsonl');
const ATTACK_LOG   = '/var/log/sbs/attacks.log';

fs.mkdirSync(BRAIN_DIR, { recursive: true });

// ── Terminal colors ──────────────────────────────────────────────
const G = s => `\x1b[32m${s}\x1b[0m`;
const C = s => `\x1b[36m${s}\x1b[0m`;
const Y = s => `\x1b[33m${s}\x1b[0m`;
const R = s => `\x1b[31m${s}\x1b[0m`;
const B = s => `\x1b[1m${s}\x1b[0m`;
const D = s => `\x1b[2m${s}\x1b[0m`;

// ── Helpers ──────────────────────────────────────────────────────
const pick = arr => arr[Math.floor(Math.random() * arr.length)];
const loadMemory = () => {
  try { if (fs.existsSync(MEMORY_FILE)) return JSON.parse(fs.readFileSync(MEMORY_FILE,'utf8')); } catch(_){}
  return { knownAttackers:{}, attackPatterns:{}, hourlyActivity:{}, bannedIpCount:0, totalEventsProcessed:0, totalCycles:0, learnedThresholds:null, lastAnalyzedAt:null };
};
const loadKnowledge = () => {
  try { if (fs.existsSync(TEACH_FILE)) return JSON.parse(fs.readFileSync(TEACH_FILE,'utf8')); } catch(_){}
  return { trustedIps:[], suspiciousIps:[], notes:[] };
};
const saveKnowledge = k => fs.writeFileSync(TEACH_FILE, JSON.stringify(k,null,2));
const logChat = (role, text) => fs.appendFileSync(CHAT_LOG, JSON.stringify({ts:new Date().toISOString(),role,text})+'\n');
const extractIp = s => { const m = s.match(/\b(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})\b/); return m?m[1]:null; };

// ── Conversation context ─────────────────────────────────────────
const ctx = { lastIntent: null, lastIp: null, topic: null };

// ── Fuzzy NLP tokenizer ──────────────────────────────────────────
function tokenize(input) {
  return input.toLowerCase()
    .replace(/[^\w\s.]/g,'')
    .split(/\s+/)
    .filter(w => !['the','a','an','is','are','what','who','how','me','i','my','can','do','you','of','to','and','in'].includes(w));
}

function score(tokens, keywords) {
  return keywords.filter(k => tokens.some(t => t.includes(k) || k.includes(t))).length;
}

// ── Intent classifier ────────────────────────────────────────────
const INTENTS = [
  { id:'GREET',       keys:['hi','hello','hey','sup','morning','evening','hiya','yo'] },
  { id:'STATUS',      keys:['status','summary','overview','happening','report','update','situation','know','doing','tell'] },
  { id:'ATTACKERS',   keys:['attacker','worst','offender','threat','attacking','hacker','ip','enemy','who'] },
  { id:'PATTERNS',    keys:['pattern','type','kind','attack','method','how','technique','flood','syn','udp','scan','brute'] },
  { id:'HOURS',       keys:['hour','time','when','peak','busy','night','day','schedule'] },
  { id:'BANS',        keys:['ban','block','blocked','count','many','total','number'] },
  { id:'LOOKUP',      keys:['check','lookup','look','about','investigate','info','tell','detail','specific'] },
  { id:'RECENT',      keys:['recent','last','latest','just','happened','new','today'] },
  { id:'THRESHOLDS',  keys:['threshold','setting','config','sensitivity','tune','learn','recommend'] },
  { id:'TRUST',       keys:['trust','safe','allow','whitelist','mine','my server','friendly'] },
  { id:'FLAG',        keys:['flag','watch','suspicious','suspect','bad','dangerous','mark'] },
  { id:'NOTE',        keys:['remember','note','write','forget','keep','mind','store'] },
  { id:'KNOWLEDGE',   keys:['taught','custom','rule','note','know','saved','memory'] },
  { id:'FORGET',      keys:['forget','remove','delete','clear','undo','unwatch'] },
  { id:'DISK',        keys:['disk','space','log','size','storage','big','full'] },
  { id:'ANALYZE',     keys:['analyze','learn','scan','refresh','rescan','train','update'] },
  { id:'HELP',        keys:['help','guide','what','command','option','can','do'] },
  { id:'THANKS',      keys:['thanks','thank','great','awesome','good','nice','cool','perfect','love'] },
  { id:'HOW_WORK',    keys:['work','brain','built','made','function','explain','yourself'] },
];

function classify(input) {
  const tokens = tokenize(input);
  const ip = extractIp(input);
  if (ip) return 'LOOKUP';
  let best = { id: 'UNKNOWN', sc: 0 };
  for (const intent of INTENTS) {
    const s = score(tokens, intent.keys);
    if (s > best.sc) best = { id: intent.id, sc: s };
  }
  return best.sc > 0 ? best.id : 'UNKNOWN';
}

// ── Response bank ────────────────────────────────────────────────
const R_GREET = [
  "Hey! Sparrow here. What do you want to know about your infrastructure?",
  "Hi there! I'm watching your network 24/7. What's on your mind?",
  "Hello! Ready to dig into some threat data. What do you need?",
  "Hey, good to hear from you. What's up?",
];
const R_THANKS = [
  "Anytime. I'm always here watching.",
  "Happy to help. Anything else you want to know?",
  "Of course! That's what I'm here for.",
  "No problem at all. Stay safe out there.",
];
const R_UNKNOWN = [
  "I'm not quite sure what you mean. Try asking about attackers, threat patterns, a specific IP, or say 'help'.",
  "Hmm, I didn't catch that. I understand questions about threats, IPs, attack patterns, bans — try rephrasing?",
  "Not sure I follow. You can ask me things like 'who is attacking?' or 'check 1.2.3.4'.",
  "That one went over my head. Try 'help' to see what I can do.",
];
const R_HOW_WORK = [
  "I read your attack logs and intel files, tokenize and classify threats, track repeat offenders, and learn patterns over time. No cloud, no API — just local statistical analysis. I get smarter every time you run 'analyze'.",
  "I'm a local NLP engine trained on your own attack data. I read /var/log/sbs/attacks.log and the intel logs, classify threats into categories like SYN floods and port scans, and recommend radar thresholds based on what I've seen.",
  "Think of me as a security analyst that never sleeps. I read your logs, spot patterns, remember bad actors, and help you tune defenses — all offline, all private.",
];

// ── Response generators ──────────────────────────────────────────
function genStatus(mem, know) {
  const n = Object.keys(mem.knownAttackers).length;
  const top = Object.entries(mem.attackPatterns).sort((a,b)=>b[1].count-a[1].count)[0];
  const last = mem.lastAnalyzedAt ? new Date(mem.lastAnalyzedAt).toLocaleString() : 'not yet';
  const lines = [
    pick([
      `Alright, here's where things stand:`,
      `Here's my current read on your network:`,
      `Sure, let me break it down for you:`,
    ]),
    `  • I've processed ${B(mem.totalEventsProcessed)} threat events across ${mem.totalCycles} learning cycles.`,
    `  • Currently tracking ${B(n)} unique attacker IPs.`,
    `  • Total ban events logged: ${B(mem.bannedIpCount)}.`,
  ];
  if (top) lines.push(`  • The most common attack type I've seen is ${Y(top[0])} — hit you ${top[1].count} times.`);
  if (know.trustedIps.length) lines.push(`  • You've whitelisted ${know.trustedIps.length} IP(s) as trusted.`);
  if (know.suspiciousIps.length) lines.push(`  • You've flagged ${know.suspiciousIps.length} IP(s) as suspicious.`);
  lines.push(`  • Last trained: ${D(last)}`);
  if (mem.totalEventsProcessed === 0) lines.push(`\n  ${Y("I don't have much data yet — run 'analyze' to teach me from your logs.")}`);
  return lines.join('\n');
}

function genAttackers(mem) {
  const top = Object.entries(mem.knownAttackers).sort((a,b)=>b[1].hitCount-a[1].hitCount).slice(0,8);
  if (!top.length) return pick([
    "I haven't logged any attackers yet. Run 'analyze' and I'll learn from your logs.",
    "No attackers in memory yet. Try running 'analyze' first so I have data to work with.",
  ]);
  const lines = [pick([
    `Here are the worst offenders I'm tracking right now:`,
    `These are the IPs that keep coming back:`,
    `Alright, the repeat attackers — here's who's been hitting you the most:`,
  ])];
  top.forEach(([ip,d],i) => {
    const types = Object.keys(d.types).join(', ');
    const age = d.lastSeen ? `last seen ${new Date(d.lastSeen).toLocaleDateString()}` : '';
    lines.push(`  ${i+1}. ${R(ip.padEnd(18))} — ${B(d.hitCount)} hits  [${Y(types)}]  ${D(age)}`);
  });
  return lines.join('\n');
}

function genPatterns(mem) {
  const types = Object.entries(mem.attackPatterns).sort((a,b)=>b[1].count-a[1].count);
  if (!types.length) return "I haven't identified any attack patterns yet. Run 'analyze' and I'll dig into your logs.";
  const total = types.reduce((a,b)=>a+b[1].count,0);
  const lines = [pick([
    `Based on everything I've learned, here's how they're attacking you:`,
    `Here's the breakdown of attack methods I've observed:`,
    `Let me show you what attack types have been hitting your network:`,
  ])];
  types.forEach(([type,d]) => {
    const pct = total>0 ? Math.round(d.count/total*100) : 0;
    const bar = '▓'.repeat(Math.round(pct/5)).padEnd(20);
    lines.push(`  ${Y(type.padEnd(22))} ${bar} ${pct}%  (${d.count} events, peak score ${d.peakScore})`);
  });
  return lines.join('\n');
}

function genHours(mem) {
  const hours = Object.entries(mem.hourlyActivity).sort((a,b)=>b[1]-a[1]);
  if (!hours.length) return "Not enough data to find peak hours yet. Run 'analyze' so I can figure out when attacks are worst.";
  const max = hours[0][1];
  const lines = [pick([
    `Here's when attacks are hitting you hardest (UTC):`,
    `Based on my logs, the peak attack windows look like this:`,
    `Your busiest threat hours — watch these windows:`,
  ])];
  hours.slice(0,6).forEach(([h,count]) => {
    const bar = '█'.repeat(Math.min(25,Math.round(count/max*25))).padEnd(25);
    const label = count===max ? R(`${h}:00`) : `${h}:00`;
    lines.push(`  ${label.padEnd(7)} ${bar} ${count}`);
  });
  lines.push(`\n  ${Y('Highest risk:')} ${hours[0][0]}:00 — consider tightening radar mode during this window.`);
  return lines.join('\n');
}

function genLookup(input, mem, know) {
  const ip = extractIp(input) || ctx.lastIp;
  if (!ip) return "Which IP do you want me to look up? Just type the address, like '45.23.11.4'.";
  ctx.lastIp = ip;
  const data = mem.knownAttackers[ip];
  const trusted = know.trustedIps.includes(ip);
  const suspect = know.suspiciousIps.includes(ip);
  const lines = [pick([`Alright, here's what I know about ${B(ip)}:`, `Let me pull up my intel on ${B(ip)}:`])];
  if (trusted)  lines.push(`  ${G('⚠  You marked this IP as trusted — it\'s on your whitelist.')} `);
  if (suspect)  lines.push(`  ${R('🚩  You flagged this as suspicious. Keep an eye on it.')} `);
  if (!data) {
    lines.push(`  I have no threat history on this IP. It may be clean, or it just hasn't shown up in my analyzed logs yet.`);
    return lines.join('\n');
  }
  const types = Object.entries(data.types).map(([t,c])=>`${t}(×${c})`).join(', ');
  lines.push(`  Hit count   : ${R(data.hitCount+'')} events`);
  lines.push(`  Attack types: ${Y(types)}`);
  lines.push(`  First seen  : ${data.firstSeen ? new Date(data.firstSeen).toLocaleString():'unknown'}`);
  lines.push(`  Last seen   : ${data.lastSeen  ? new Date(data.lastSeen).toLocaleString() :'unknown'}`);
  if (data.hitCount > 20)      lines.push(`\n  ${R('My assessment: HIGH RISK. This IP is a serial offender.')}`);
  else if (data.hitCount > 5)  lines.push(`\n  ${Y('My assessment: MODERATE. Has shown suspicious behaviour multiple times.')}`);
  else                         lines.push(`\n  ${D('My assessment: LOW activity so far. Worth monitoring though.')}`);
  return lines.join('\n');
}

function genRecent() {
  if (!fs.existsSync(ATTACK_LOG)) return "I can't find the attack log at /var/log/sbs/attacks.log. Has the agent been installed on your guard server?";
  const lines = fs.readFileSync(ATTACK_LOG,'utf8').split('\n').filter(Boolean).slice(-8);
  if (!lines.length) return "The attack log exists but is empty right now. Looks quiet — which is good!";
  return pick([`Here are the last few attack log entries:`, `Latest activity from your logs:`])
    + '\n' + lines.map(l=>`  ${D(l)}`).join('\n');
}

function genThresholds(mem) {
  const t = mem.learnedThresholds;
  if (!t) return "I haven't generated learned thresholds yet. Run 'analyze' and I'll crunch the data and give you recommendations.";
  const lines = [pick([
    `Based on everything I've seen, here are the radar settings I'd recommend:`,
    `Here's what I'd tune your radar to, based on observed attack patterns:`,
  ])];
  lines.push(`  Ban threshold     : ${Y(t.threshold+'')}  (factory default: 90)`);
  lines.push(`  Watch threshold   : ${Y(t.watchThreshold+'')}  (factory default: 55)`);
  lines.push(`  SYN ban trigger   : ${Y(t.synBan+'')}  (factory default: 90)`);
  lines.push(`  UDP ban trigger   : ${Y(t.udpBan+'')}  (factory default: 360)`);
  lines.push(`  Burst ban trigger : ${Y(t.burstBan+'')}  (factory default: 180)`);
  lines.push(`  Port fanout ban   : ${Y(t.portFanoutBan+'')}  (factory default: 12)`);
  lines.push(`\n  These are calibrated on ${D(t._attackFrequency+' observed attack events')}.`);
  lines.push(`  To apply them to your live radar: ${D('node sparrow-brain.js --apply')}`);
  return lines.join('\n');
}

function genTrust(input, know) {
  const ip = extractIp(input);
  if (!ip) return "Sure, which IP should I trust? Just give me the address.";
  if (know.trustedIps.includes(ip)) return `${ip} is already on your trusted list. I won't flag it.`;
  know.trustedIps.push(ip); saveKnowledge(know);
  return pick([
    `Got it — ${B(ip)} is now trusted. I'll make sure not to flag it as a threat.`,
    `Done. I've whitelisted ${B(ip)}. It won't get caught in my radar.`,
    `${B(ip)} added to your trusted list. Consider it safe in my books.`,
  ]);
}

function genFlag(input, know) {
  const ip = extractIp(input);
  if (!ip) return "Which IP should I keep an eye on? Give me the address and I'll flag it.";
  if (know.suspiciousIps.includes(ip)) return `I already have ${ip} flagged as suspicious. It's on my watchlist.`;
  know.suspiciousIps.push(ip); saveKnowledge(know);
  return pick([
    `Noted. ${B(ip)} is now flagged. I'll treat it as suspicious from now on.`,
    `${B(ip)} added to my watchlist. I'll pay extra attention to any activity from it.`,
    `Flagged. I'm watching ${B(ip)} closely.`,
  ]);
}

function genNote(input, know) {
  const m = input.match(/(?:remember|note|write|keep in mind)[:\s]+(.+)/i);
  const note = m ? m[1].trim() : input.replace(/^(remember|note)\s*/i,'').trim();
  if (!note || note.length < 3) return "What would you like me to remember? Tell me like: 'remember that port 8080 is my dev server'";
  know.notes.push({ text:note, addedAt:new Date().toISOString() });
  saveKnowledge(know);
  return pick([
    `Stored. I'll keep that in mind: "${note}"`,
    `Got it, I've written that down: "${note}"`,
    `Noted: "${note}" — I won't forget it.`,
  ]);
}

function genShowKnowledge(know) {
  const lines = [pick([`Here's everything you've personally taught me:`, `This is what I've learned from you directly:`])];
  lines.push(`\n  ${G('Trusted IPs:')} ${know.trustedIps.length ? know.trustedIps.join(', ') : 'none yet'}`);
  lines.push(`  ${Y('Flagged IPs:')} ${know.suspiciousIps.length ? know.suspiciousIps.join(', ') : 'none yet'}`);
  lines.push(`\n  ${C('Your notes:')}`);
  if (!know.notes.length) lines.push(`  (nothing saved yet)`);
  else know.notes.forEach((n,i) => lines.push(`  ${i+1}. ${n.text}  ${D('('+new Date(n.addedAt).toLocaleDateString()+')')}`));
  return lines.join('\n');
}

function genForget(input, know) {
  const ip = extractIp(input);
  if (ip) {
    const before = know.trustedIps.length + know.suspiciousIps.length;
    know.trustedIps = know.trustedIps.filter(i=>i!==ip);
    know.suspiciousIps = know.suspiciousIps.filter(i=>i!==ip);
    saveKnowledge(know);
    const after = know.trustedIps.length + know.suspiciousIps.length;
    return before>after ? `Done — removed ${ip} from all my lists.` : `${ip} wasn't in any of my custom lists.`;
  }
  const nm = input.match(/note\s+#?(\d+)/i);
  if (nm) {
    const idx = parseInt(nm[1])-1;
    if (idx>=0 && idx<know.notes.length) {
      const removed = know.notes.splice(idx,1)[0];
      saveKnowledge(know);
      return `Removed note ${nm[1]}: "${removed.text}"`;
    }
    return `I don't have a note #${nm[1]}. Say 'show what you know' to see all notes.`;
  }
  return "Tell me what to forget — an IP address, or 'forget note 2' for a specific note.";
}

function genDisk() {
  const { execSync } = require('child_process');
  const dirs = ['/var/log/sbs', path.join(__dirname,'storage'), path.join(__dirname,'intel')];
  const lines = [pick([`Here's your disk usage for logs and storage:`, `Storage breakdown:`])];
  for (const d of dirs) {
    try {
      const sz = execSync(`du -sh "${d}" 2>/dev/null`, {encoding:'utf8'}).trim().split('\t')[0];
      lines.push(`  ${d.padEnd(40)} ${Y(sz)}`);
    } catch(_) { lines.push(`  ${d} — can't read (may not exist yet)`); }
  }
  lines.push(`\n  To manage logs, rotate archives, or clear old months: ${D('sudo bash sbs-disk-manager.sh')}`);
  return lines.join('\n');
}

function genAnalyze() {
  const { execSync } = require('child_process');
  try {
    console.log(D('\n  [running analysis cycle...]\n'));
    execSync(`node "${path.join(__dirname,'sparrow-brain.js')}" --apply`, {stdio:'inherit'});
    return pick([
      `Analysis done! I've updated my memory and applied the learned thresholds. Ask me anything.`,
      `Finished learning from your logs. My knowledge is now up to date. What do you want to know?`,
    ]);
  } catch(e) {
    return `I ran the analysis but hit an issue: ${e.message}`;
  }
}

function genHelp() {
  return `Here's what you can ask me:\n
  ${C('Understanding threats:')}
    "give me a status overview"
    "who's been attacking me?"
    "what attack methods are they using?"
    "when are attacks worst?"
    "check 45.23.11.4"
    "show me recent attacks"
    "how many IPs are banned?"
    "what thresholds did you learn?"

  ${C('Teaching me things:')}
    "trust 10.0.0.5"                      → whitelist your own IP
    "flag 45.2.3.4 as suspicious"         → mark IP for close watching
    "remember that port 8080 is my dev"   → save a note
    "forget 10.0.0.5" / "forget note 2"  → remove from lists
    "show what you know"                  → see all custom rules

  ${C('System:')}
    "analyze" / "learn from logs"         → run a training cycle
    "show disk usage"                     → check log sizes
    "how do you work?"                    → explain myself
    "exit" / "quit"                       → close chat`;
}

// ── Main respond function ────────────────────────────────────────
function respond(input) {
  const mem   = loadMemory();
  const know  = loadKnowledge();
  const intent = classify(input);
  ctx.lastIntent = intent;

  switch(intent) {
    case 'GREET':      return pick(R_GREET);
    case 'STATUS':     return genStatus(mem, know);
    case 'ATTACKERS':  return genAttackers(mem);
    case 'PATTERNS':   return genPatterns(mem);
    case 'HOURS':      return genHours(mem);
    case 'BANS':       return `I've logged ${B(mem.bannedIpCount)} ban events and have ${B(Object.keys(mem.knownAttackers).length)} unique attacker IPs in memory across ${mem.totalCycles} analysis cycles.`;
    case 'LOOKUP':     return genLookup(input, mem, know);
    case 'RECENT':     return genRecent();
    case 'THRESHOLDS': return genThresholds(mem);
    case 'TRUST':      return genTrust(input, know);
    case 'FLAG':       return genFlag(input, know);
    case 'NOTE':       return genNote(input, know);
    case 'KNOWLEDGE':  return genShowKnowledge(know);
    case 'FORGET':     return genForget(input, know);
    case 'DISK':       return genDisk();
    case 'ANALYZE':    return genAnalyze();
    case 'HELP':       return genHelp();
    case 'THANKS':     return pick(R_THANKS);
    case 'HOW_WORK':   return pick(R_HOW_WORK);
    default:           return pick(R_UNKNOWN);
  }
}

// ── Boot ─────────────────────────────────────────────────────────
const mem0 = loadMemory();
const greetings = [
  `Sparrow online. ${mem0.totalEventsProcessed > 0 ? `I've processed ${mem0.totalEventsProcessed} events and I'm tracking ${Object.keys(mem0.knownAttackers).length} attackers.` : `No memory yet — say 'analyze' and I'll learn from your logs.`}`,
  `Sparrow here. ${mem0.totalEventsProcessed > 0 ? `Memory loaded: ${mem0.totalEventsProcessed} events, ${Object.keys(mem0.knownAttackers).length} known attackers.` : `Fresh start. Tell me to 'analyze' so I can read your logs.`}`,
];

console.log(C(`
╔══════════════════════════════════════════════════════╗
║         SPARROWX — Threat Intelligence Brain         ║
║         Local NLP  ·  No API  ·  Always watching     ║
╚══════════════════════════════════════════════════════╝`));
console.log(`  ${G(pick(greetings))}`);
console.log(D(`  Type naturally. Say 'help' if you get stuck. 'exit' to quit.\n`));

const rl = readline.createInterface({ input:process.stdin, output:process.stdout });

function ask() {
  rl.question(C('you ') + D('→ '), raw => {
    const input = raw.trim();
    if (!input) { ask(); return; }
    if (['exit','quit','bye','q'].includes(input.toLowerCase())) {
      console.log(`\n  ${G('Sparrow signing off. Stay protected. 🛡️')}\n`);
      rl.close(); return;
    }
    logChat('user', input);
    const reply = respond(input);
    const clean = reply.replace(/\x1b\[[0-9;]*m/g,'');
    logChat('sparrow', clean);
    console.log(`\n${G('sparrow')} ${D('→')}\n${reply.split('\n').map(l=>`  ${l}`).join('\n')}\n`);
    ask();
  });
}

ask();
