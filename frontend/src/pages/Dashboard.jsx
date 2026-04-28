import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Chart as ChartJS,
  CategoryScale, LinearScale, PointElement,
  LineElement, Tooltip, Legend, Filler,
} from 'chart.js';
import { Line } from 'react-chartjs-2';
import { useTelemetry } from '../context/TelemetryContext';
import TrafficLedger from '../components/TrafficLedger';

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Tooltip, Legend, Filler);

const CHART_POINTS = 60;

export default function Dashboard({ token }) {
  const {
    stats, cpuHistory, netHistory, connHistory, logs,
    trafficEvents, isConnected, wsState, lastUpdateMs,
  } = useTelemetry();

  const [graphTab, setGraphTab] = useState('bandwidth'); // 'bandwidth' | 'tcp' | 'udp'

  const [tunnelStatus, setTunnelStatus] = useState('loading');
  const [tunnelMeta,   setTunnelMeta]   = useState(null);
  const [ageSec,       setAgeSec]       = useState(null);

  // ── Live telemetry age ticker ────────────────────────────────────────────
  useEffect(() => {
    const id = setInterval(() => {
      setAgeSec(lastUpdateMs ? Math.floor((Date.now() - lastUpdateMs) / 1000) : null);
    }, 1000);
    return () => clearInterval(id);
  }, [lastUpdateMs]);

  const fetchTunnelStatus = () => {
    if (!token) return;
    console.log('[Tunnel] Fetching status...');
    fetch('/api/agent/tunnel/status', { headers: { Authorization: `Bearer ${token}` } })
      .then(async (r) => {
        const data = await r.json();
        if (!r.ok) throw new Error(data.error || 'Unable to load tunnel status.');
        return data;
      })
      .then(d => {
        console.log('[Tunnel] Status received:', d);
        setTunnelStatus(d.status || 'inactive');
        setTunnelMeta(d);
      })
      .catch((err) => {
        console.error('[Tunnel] Status fetch failed:', err);
        setTunnelStatus('inactive');
        setTunnelMeta(null);
      });
  };

  useEffect(() => {
    fetchTunnelStatus();
    if (!token) return undefined;
    const pollMs = tunnelStatus === 'active' ? 10000 : 3000;
    const id = setInterval(fetchTunnelStatus, pollMs);
    return () => clearInterval(id);
  }, [token, tunnelStatus]);

  // ── Build chart data objects from context history ─────────────────────────
  const cpuChartData = useMemo(() => ({
    labels: Array(CHART_POINTS).fill(''),
    datasets: [
      {
        label: 'CPU %', borderColor: '#289912', backgroundColor: 'rgba(40,153,18,0.1)',
        borderWidth: 1.5, tension: 0.4, fill: true, data: cpuHistory.cpu, pointRadius: 0,
      },
      {
        label: 'MEM %', borderColor: '#ef4444', backgroundColor: 'rgba(239,68,68,0.08)',
        borderWidth: 1.5, tension: 0.4, fill: true, data: cpuHistory.mem, pointRadius: 0,
      },
    ],
  }), [cpuHistory]);

  const netChartData = useMemo(() => ({
    labels: Array(CHART_POINTS).fill(''),
    datasets: [
      {
        label: 'In (Mbps)', borderColor: '#289912', backgroundColor: 'rgba(40,153,18,0.1)',
        borderWidth: 1.5, tension: 0.4, fill: true, data: netHistory.inb, pointRadius: 0,
      },
      {
        label: 'Out (Mbps)', borderColor: '#55c934', backgroundColor: 'rgba(85,201,52,0.09)',
        borderWidth: 1.5, tension: 0.4, fill: true, data: netHistory.out, pointRadius: 0,
      },
    ],
  }), [netHistory]);

  const tcpChartData = useMemo(() => ({
    labels: Array(CHART_POINTS).fill(''),
    datasets: [
      {
        label: 'Established TCP', borderColor: '#22d3ee', backgroundColor: 'rgba(34,211,238,0.08)',
        borderWidth: 1.5, tension: 0.4, fill: true, data: connHistory.tcp, pointRadius: 0,
      },
    ],
  }), [connHistory]);

  const udpChartData = useMemo(() => ({
    labels: Array(CHART_POINTS).fill(''),
    datasets: [
      {
        label: 'UDP Connections', borderColor: '#a78bfa', backgroundColor: 'rgba(167,139,250,0.08)',
        borderWidth: 1.5, tension: 0.4, fill: true, data: connHistory.udp, pointRadius: 0,
      },
    ],
  }), [connHistory]);

  // ── Derived ──────────────────────────────────────────────────────────────
  const uptimeLabel = useMemo(() => {
    if (!stats.uptime) return '—';
    if (stats.uptime > 86400) return `${(stats.uptime / 86400).toFixed(1)}d`;
    if (stats.uptime > 3600)  return `${(stats.uptime / 3600).toFixed(1)}h`;
    return `${stats.uptime.toFixed(0)}s`;
  }, [stats.uptime]);

  const telemetryLabel = useMemo(() => {
    if (!isConnected)    return 'No agent';
    if (ageSec === null) return 'LIVE';
    if (ageSec < 3)      return 'LIVE';
    return `${ageSec}s ago`;
  }, [isConnected, ageSec]);

  const wsLabel = { open: 'WS OK', connecting: 'WS Connecting', reconnecting: 'WS Reconnecting', error: 'WS Error' }[wsState] || wsState;
  const packetCounterReady = stats.telemetryAgentBuild === 'netdev-v2';
  const packetDelta = Number(stats.packetDiff || 0);
  const packetSourceLabel = packetCounterReady ? (stats.telemetrySource || '/proc/net/dev') : 'Legacy agent';
  const topAttackSources = useMemo(() => {
    const scores = new Map();
    for (const event of trafficEvents) {
      const direction = String(event?.direction || '').toLowerCase();
      const severity = String(event?.severity || '').toLowerCase();
      if (direction !== 'incoming') continue;
      if (!['warning', 'danger'].includes(severity)) continue;
      const ip = String(event?.remoteIp || '').trim();
      if (!ip || ip === '-' || ip === 'network') continue;
      const increment = severity === 'danger' ? 3 : 1;
      scores.set(ip, (scores.get(ip) || 0) + increment);
    }
    return [...scores.entries()]
      .map(([ip, score]) => ({ ip, score }))
      .sort((a, b) => b.score - a.score)
      .slice(0, 6);
  }, [trafficEvents]);
  const latestTunnelJob = tunnelMeta?.lastTunnelCommand || null;
  const postureTunnelLabel =
    tunnelStatus === 'loading' ? 'Checking' :
    tunnelStatus === 'active' ? 'Active' :
    tunnelStatus === 'degraded' ? 'Degraded' :
    'Inactive';
  const postureTunnelTone =
    tunnelStatus === 'active' ? '' :
    tunnelStatus === 'degraded' ? 'warning' :
    'danger';
  const commandChannelLabel = isConnected ? (wsState === 'open' ? 'Ready' : 'Degraded') : 'Waiting for agent';
  const commandChannelTone = isConnected ? (wsState === 'open' ? '' : 'warning') : 'danger';
  const firewallLabel = tunnelMeta?.clientTunnelPresent ? 'Tunnel-Enforced' : (isConnected ? 'Active' : 'Unknown');
  const firewallTone = tunnelMeta?.clientTunnelPresent ? '' : (isConnected ? '' : 'danger');
  const totalSbsBans = Number(stats.sbsBanTotal || 0);
  const currentBlockedIps = Number(stats.bannedIPs || 0);

  const statCards = [
    { label: 'Active Connections', value: stats.connections,                tone: 'blue' },
    { label: 'Blocked IPs',       value: totalSbsBans,                     tone: 'red', note: 'Since SBS activation' },
    { label: 'CPU Usage',         value: `${stats.cpuPercent.toFixed(1)}%`, tone: 'blue' },
    { label: 'Memory',            value: `${(stats.memPercent || 0).toFixed(1)}%`, tone: 'red' },
    { label: 'Packets / Sec',     value: (stats.pps || 0).toFixed(1),      tone: 'blue' },
    { label: 'Packet Delta',      value: packetDelta,                      tone: 'blue' },
  ];

  const handleCreateTunnel = async () => {
    console.log('[Tunnel] Initiate creation command');
    try {
      const res = await fetch('/api/me/tunnel/create', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      });
      const data = await res.json();
      console.log('[Tunnel] Creation response:', res.status, data);

      if (res.ok) {
        alert('Tunnel setup queued. This only confirms the job was accepted. The tunnel will show active after both the guard and client interfaces are up.');
        fetchTunnelStatus();
      } else {
        alert('Failed: ' + (data.error || 'Unknown error'));
      }
    } catch (e) {
      console.error('[Tunnel] Creation error:', e);
      alert('Error connecting to server.');
    }
  };

  const tunnelJobLabel = latestTunnelJob
    ? `${latestTunnelJob.status}${typeof latestTunnelJob.exitCode === 'number' ? ` (${latestTunnelJob.exitCode})` : ''}`
    : 'none';
  const tunnelJobOutput = latestTunnelJob?.output
    ? latestTunnelJob.output.slice(0, 180)
    : 'No tunnel job output yet.';

  const getTunnelDisplay = () => {
    if (tunnelStatus === 'inactive' || tunnelStatus === 'degraded') {
      return (
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span className={`fact-value ${tunnelStatus === 'degraded' ? 'warning' : 'danger'}`}>{tunnelStatus}</span>
          <button 
            className="secondary-button" 
            style={{ 
              padding: '2px 10px', 
              fontSize: '0.62rem', 
              height: '20px',
              display: 'flex',
              alignItems: 'center',
              background: 'rgba(239,68,68,0.1)', 
              border: '1px solid rgba(239,68,68,0.3)', 
              color: '#ef4444', 
              cursor: 'pointer',
              fontWeight: '700',
              letterSpacing: '0.05em',
              borderRadius: '2px'
            }}
            onClick={handleCreateTunnel}
          >
            {tunnelStatus === 'degraded' ? 'RETRY TUNNEL' : 'SETUP TUNNEL'}
          </button>
        </div>
      );
    }
    return (
      <span className={`fact-value ${
        tunnelStatus === 'active' ? 'success' : 'warning'
      }`}>
        {tunnelStatus}
      </span>
    );
  };

  const agentFacts = [
    { label: 'Hostname',   value: stats.hostname },
    { label: 'IP Address', value: stats.ip },
    { label: 'OS',         value: stats.os || '—' },
    { label: 'Interface',  value: stats.iface },
    { label: 'Agent Build', value: stats.agentBuild || 'legacy' },
    { label: 'Uptime',     value: uptimeLabel },
    { label: 'In (Mbps)',  value: stats.inMbps.toFixed(3) },
    { label: 'Out (Mbps)', value: stats.outMbps.toFixed(3) },
    { label: 'SYN Rate',   value: stats.synRate },
    { label: 'Tunnel',     value: getTunnelDisplay() },
    { label: 'Guard Host', value: window.location.hostname },
    { label: 'Telemetry',  value: telemetryLabel },
    { label: 'WebSocket',  value: wsLabel },
    { label: 'Guard Tunnel', value: tunnelMeta ? (tunnelMeta.guardInterfacePresent ? 'present' : 'missing') : 'unknown' },
    { label: 'Client Tunnel', value: tunnelMeta ? (tunnelMeta.clientTunnelPresent ? 'present' : 'missing') : 'unknown' },
    { label: 'Tunnel Sync', value: tunnelMeta?.syncMismatch ? 'mismatch' : 'OK' },
    { label: 'Tunnel Detail', value: tunnelMeta?.detail || 'Waiting for tunnel status...' },
    { label: 'Tunnel Job', value: tunnelJobLabel },
    { label: 'Tunnel Job Detail', value: tunnelJobOutput },
  ];

  // ── IP/Port chip parser ───────────────────────────────────────────────────
  const [copiedChip, setCopiedChip] = useState(null);
  const copyTimerRef = useRef(null);

  const copyChip = (text, id) => {
    navigator.clipboard.writeText(text).catch(() => {});
    setCopiedChip(id);
    clearTimeout(copyTimerRef.current);
    copyTimerRef.current = setTimeout(() => setCopiedChip(null), 1800);
  };

  // Parse a log line and return React nodes with IP/port highlighted
  const parseLogLine = (text, lineIdx) => {
    // Regex: matches IPv4 addresses optionally followed by " port NNNNN" or ":NNNNN"
    const IP_RE = /(\d{1,3}(?:\.\d{1,3}){3})(?:\s+port\s+(\d+))?/g;
    const parts = [];
    let last = 0;
    let match;
    let chipIdx = 0;
    while ((match = IP_RE.exec(text)) !== null) {
      if (match.index > last) parts.push(text.slice(last, match.index));
      const ip   = match[1];
      const port = match[2];
      const fullText = port ? `${ip}:${port}` : ip;
      const chipId   = `${lineIdx}-${chipIdx++}`;
      const isCopied = copiedChip === chipId;
      parts.push(
        <span
          key={chipId}
          className={`log-ip-chip${isCopied ? ' copied' : ''}`}
          title={`Click to copy ${fullText}`}
          onClick={(e) => { e.stopPropagation(); copyChip(fullText, chipId); }}
        >
          {ip}{port && <span className="log-port-badge">:{port}</span>}
          {isCopied && <span className="log-chip-tick">✓</span>}
        </span>
      );
      last = match.index + match[0].length;
    }
    if (last < text.length) parts.push(text.slice(last));
    return parts;
  };

  const chartOptions = (yLabel, maxY) => ({
    responsive: true,
    maintainAspectRatio: false,
    animation: { duration: 600, easing: 'easeInOutCubic' },
    transitions: { active: { animation: { duration: 300 } } },
    plugins: {
      legend: { labels: { color: '#64748b', font: { family: 'JetBrains Mono', size: 11 } } }
    },
    scales: {
      y: {
        min: 0, ...(maxY ? { max: maxY } : {}),
        grid: { color: 'rgba(40,153,18,0.1)' },
        ticks: { color: '#64748b', font: { family: 'JetBrains Mono', size: 10 }, callback: v => `${v}${yLabel}` }
      },
      x: { grid: { display: false }, ticks: { display: false } }
    }
  });

  return (
    <div className="page-shell">

      <section className="hero-panel">
        <div>
          <p className="eyebrow">Operations Center</p>
          <h1 className="page-title">System Dashboard</h1>
          <p className="page-copy">Live telemetry · network traffic · SSH events · firewall metrics</p>
        </div>
        <div className="hero-status-stack">
          <div className={`status-pill ${isConnected ? 'connected' : 'disconnected'}`}>
            {isConnected ? '● Agent Online' : '○ No Agent'}
          </div>
          <div className="meta-chip" style={{ color: ageSec !== null && ageSec < 3 ? 'var(--accent-cyan)' : undefined }}>
            {telemetryLabel}
          </div>
          <div className="meta-chip" style={{ color: wsState === 'open' ? 'var(--accent-cyan)' : 'var(--warn-amber)' }}>
            {wsLabel}
          </div>
        </div>
      </section>

      {!isConnected && (
        <section className="callout-banner warning">
          <strong>[!]</strong>
          <span>No agent connected. Go to Install Agent, download a fresh script, and run it as root on your target server.</span>
        </section>
      )}

      {isConnected && !packetCounterReady && (
        <section className="callout-banner warning">
          <strong>Packet telemetry needs agent refresh.</strong>
          <span>The panel is receiving agent stats, but this client has not reported the new packet-counter build yet.</span>
        </section>
      )}

      <section className="metric-grid">
        {statCards.map(card => (
          <article key={card.label} className={`metric-card tone-${card.tone}`}>
            <div className="metric-label">{card.label}</div>
            <div className="metric-value">{card.value}</div>
            {card.note ? <div className="metric-note">{card.note}</div> : null}
          </article>
        ))}
      </section>

      <section className="content-grid two-up">
        <article className="glass-panel elevated-panel">
          <div className="panel-heading">
            <div><p className="eyebrow">Telemetry</p><h3>CPU &amp; Memory — Live</h3></div>
            <div className="meta-chip">{CHART_POINTS}s window</div>
          </div>
          <div className="chart-frame">
            <Line data={cpuChartData} options={chartOptions('%', 100)} />
          </div>
          <div className="traffic-panel-fill dashboard-flow-fill">
            <div className="inline-section-heading">
              <span>Realtime Traffic</span>
              <span>{packetDelta} packets / {(stats.pps || 0).toFixed(1)} pps</span>
            </div>
            <TrafficLedger events={trafficEvents} limit={6} compact />
          </div>
        </article>

        <article className="glass-panel elevated-panel agent-facts-panel">
          <div className="panel-heading">
            <div><p className="eyebrow">Agent</p><h3>Live Facts</h3></div>
            <div className="meta-chip">{isConnected ? 'LIVE' : 'idle'}</div>
          </div>
          <div className="fact-list">
            {agentFacts.map(item => (
              <div key={item.label} className="fact-row">
                <span>{item.label}</span>
                {typeof item.value === 'string' || typeof item.value === 'number' ? (
                  <span className={`fact-value ${
                    (item.label === 'Tunnel' && tunnelStatus === 'active') ? 'success' :
                    (item.label === 'Tunnel' && tunnelStatus === 'degraded') ? 'warning' :
                    (item.label === 'Tunnel' && tunnelStatus === 'inactive') ? 'danger' :
                    (item.label === 'WebSocket' && wsState !== 'open') ? 'danger' : ''
                  }`}>{item.value}</span>
                ) : (
                  item.value
                )}
              </div>
            ))}
          </div>
        </article>
      </section>

      <section className="glass-panel elevated-panel">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">Network</p>
            <h3>Live Traffic — {stats.iface !== '-' ? stats.iface : 'Primary Interface'}</h3>
          </div>
          <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
            {/* Tab switcher */}
            {['bandwidth', 'tcp', 'udp'].map(tab => (
              <button
                key={tab}
                type="button"
                onClick={() => setGraphTab(tab)}
                style={{
                  padding: '3px 12px',
                  fontSize: '0.72rem',
                  fontFamily: 'JetBrains Mono, monospace',
                  textTransform: 'uppercase',
                  letterSpacing: '0.08em',
                  borderRadius: '4px',
                  border: graphTab === tab ? '1px solid var(--accent-cyan)' : '1px solid rgba(255,255,255,0.08)',
                  background: graphTab === tab ? 'rgba(34,211,238,0.12)' : 'transparent',
                  color: graphTab === tab ? 'var(--accent-cyan)' : 'var(--text-dim)',
                  cursor: 'pointer',
                  transition: 'all 0.15s',
                }}
              >
                {tab}
              </button>
            ))}
            <div className={`meta-chip ${packetCounterReady ? 'text-green' : 'text-amber'}`}>
              {packetSourceLabel}
            </div>
            <div className="meta-chip">Delta {packetDelta} packets</div>
            <div className="meta-chip" style={{ color: 'var(--accent-cyan)' }}>↓ {stats.inMbps.toFixed(3)}</div>
            <div className="meta-chip" style={{ color: 'var(--warn-amber)' }}>↑ {stats.outMbps.toFixed(3)}</div>
          </div>
        </div>
        <div className="chart-frame">
          {graphTab === 'bandwidth' && (
            <Line data={netChartData} options={chartOptions(' Mbps', undefined)} />
          )}
          {graphTab === 'tcp' && (
            <Line data={tcpChartData} options={chartOptions(' conns', undefined)} />
          )}
          {graphTab === 'udp' && (
            <Line data={udpChartData} options={chartOptions(' conns', undefined)} />
          )}
        </div>
        <div className="traffic-panel-fill">
          <div className="inline-section-heading">
            <span>Live IP Flow</span>
            <span>{packetSourceLabel} / {trafficEvents.length} samples</span>
          </div>
          <TrafficLedger events={trafficEvents} limit={8} compact />
        </div>
      </section>

      <section className="content-grid two-up">
        <article className="glass-panel elevated-panel">
          <div className="panel-heading"><div><p className="eyebrow">Signals</p><h3>Threat Markers</h3></div></div>
          <div className="fact-list compact">
            <div className="fact-row"><span>SYN Rate</span><span className={`fact-value ${stats.synRate > 500 ? 'danger' : ''}`}>{stats.synRate}/s</span></div>
            <div className="fact-row"><span>Packets / Sec</span><span className="fact-value">{stats.pps}</span></div>
            <div className="fact-row"><span>Packet Delta</span><span className="fact-value">{packetDelta}</span></div>
            <div className="fact-row"><span>Avg Packet Size</span><span className="fact-value">{stats.avgPacketBytes || 0} B</span></div>
            <div className="fact-row"><span>Counter Source</span><span className={`fact-value ${packetCounterReady ? 'success' : 'warning'}`}>{packetSourceLabel}</span></div>
            <div className="fact-row"><span>Total SBS Bans</span><span className={`fact-value ${totalSbsBans > 0 ? 'danger' : ''}`}>{totalSbsBans}</span></div>
            <div className="fact-row"><span>Current Blocks</span><span className={`fact-value ${currentBlockedIps > 0 ? 'danger' : ''}`}>{currentBlockedIps}</span></div>
            <div className="fact-row"><span>Established TCP</span><span className="fact-value">{stats.connections}</span></div>
          </div>
        </article>
        <article className="glass-panel elevated-panel">
          <div className="panel-heading"><div><p className="eyebrow">Protection</p><h3>Current Posture</h3></div></div>
          <div className="fact-list compact">
            <div className="fact-row"><span>Agent Presence</span><span className={`fact-value ${isConnected ? '' : 'danger'}`}>{isConnected ? 'Connected' : 'Offline'}</span></div>
            <div className="fact-row"><span>Tunnel Routing</span><span className={`fact-value ${postureTunnelTone}`}>{postureTunnelLabel}</span></div>
            <div className="fact-row"><span>Command Channel</span><span className={`fact-value ${commandChannelTone}`}>{commandChannelLabel}</span></div>
            <div className="fact-row"><span>Firewall Status</span><span className={`fact-value ${firewallTone}`}>{firewallLabel}</span></div>
          </div>
        </article>
      </section>

      <section className="glass-panel elevated-panel">
        <div className="panel-heading">
          <div><p className="eyebrow">DDoS Intel</p><h3>Top Attack Sources (Live)</h3></div>
          <div className="meta-chip">{topAttackSources.length} tracked</div>
        </div>
        {topAttackSources.length === 0 ? (
          <div className="empty-state">No high-risk inbound sources detected in the current live stream.</div>
        ) : (
          <div className="table-shell">
            <table>
              <thead>
                <tr>
                  <th>#</th>
                  <th>Source IP</th>
                  <th>Threat Score</th>
                  <th>Suggested Action</th>
                </tr>
              </thead>
              <tbody>
                {topAttackSources.map((item, idx) => (
                  <tr key={item.ip}>
                    <td>{idx + 1}</td>
                    <td className="font-mono">{item.ip}</td>
                    <td>
                      <span className={`fact-value ${item.score >= 6 ? 'danger' : 'warning'}`}>{item.score}</span>
                    </td>
                    <td>{item.score >= 6 ? 'Immediate ban recommended' : 'Watch and score further'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="glass-panel elevated-panel">
        <div className="panel-heading">
          <div><p className="eyebrow">Events</p><h3>Live Security Log — SSH + Firewall</h3></div>
          <div style={{ display: 'flex', gap: '6px' }}>
            <div className="meta-chip" style={{ color: 'var(--success-green)' }}>SSH</div>
            <div className="meta-chip" style={{ color: 'var(--danger-red)' }}>FW</div>
            <div className="meta-chip">{logs.length} lines</div>
          </div>
        </div>
        <div className="terminal-log security-log-compact">
          {logs.length === 0
            ? <div className="empty-state">Waiting for agent log stream — SSH &amp; firewall events will appear here…</div>
            : logs.map((log, idx) => (
                <div key={idx} className={`log-line ${log.level}`}>
                  {parseLogLine(log.text, idx)}
                </div>
              ))
          }
        </div>
      </section>
    </div>
  );
}
