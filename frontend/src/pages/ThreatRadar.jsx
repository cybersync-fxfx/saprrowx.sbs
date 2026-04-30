import { useEffect, useState } from 'react';
import TrafficLedger from '../components/TrafficLedger';
import { useTelemetry } from '../context/TelemetryContext';

const DEFAULT_CONFIG = {
  mode: 'normal',
  enabled: true,
  autoBan: true,
  threshold: 90,
  watchThreshold: 55,
  scanIntervalMs: 1000,
  connWarn: 80,
  connBan: 220,
  synWarn: 30,
  synBan: 90,
  udpWarn: 140,
  udpBan: 360,
  burstWarn: 60,
  burstBan: 180,
  portFanoutWarn: 6,
  portFanoutBan: 12,
};

export default function ThreatRadar({ token }) {
  const { trafficEvents, stats, guardBlocklist, viewMode } = useTelemetry();
  const [data, setData] = useState({ recent: [], liveScores: [], stats: { scannedToday: 0, blockedToday: 0, guardBlockedIps: 0 }, radar: null });
  const [config, setConfig] = useState(DEFAULT_CONFIG);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [setupRequired, setSetupRequired] = useState(false);
  const [modeBusy, setModeBusy] = useState('');

  const fetchStats = () => {
    const scope = viewMode === 'global' ? 'global' : 'agent';
    fetch(`/api/radar/stats?scope=${scope}`, { headers: { Authorization: `Bearer ${token}` } })
      .then(async (r) => {
        const payload = await r.json();
        if (!r.ok) {
          const nextError = payload?.error || 'Threat Radar failed to load.';
          const next = new Error(nextError);
          next.setupRequired = Boolean(payload?.setupRequired);
          throw next;
        }
        return payload;
      })
      .then((d) => {
        const nextRadar = d?.radar || null;
        setData({
          recent: Array.isArray(d?.recent) ? d.recent : [],
          liveScores: Array.isArray(d?.liveScores) ? d.liveScores : [],
          stats: {
            scannedToday: Number(d?.stats?.scannedToday || 0),
            blockedToday: Number(d?.stats?.blockedToday || 0),
            guardBlockedIps: Number(d?.stats?.guardBlockedIps || d?.guardBlocklist?.count || 0),
          },
          radar: nextRadar,
        });
        if (nextRadar?.config) {
          setConfig((prev) => ({ ...prev, ...nextRadar.config }));
        }
        setError('');
        setSetupRequired(false);
        setLoading(false);
      })
      .catch((e) => {
        console.error(e);
        setError(e.message || 'Threat Radar failed to load.');
        setSetupRequired(Boolean(e.setupRequired));
        setData({ recent: [], liveScores: [], stats: { scannedToday: 0, blockedToday: 0, guardBlockedIps: 0 }, radar: null });
        setLoading(false);
      });
  };

  useEffect(() => {
    if (!token) return;
    fetchStats();
    const id = setInterval(fetchStats, 3000);
    return () => clearInterval(id);
  }, [token]);

  const scoreColor = (score) => {
    if (score >= config.threshold) return 'danger';
    if (score >= config.watchThreshold) return 'warning';
    return 'success';
  };

  const radarStatus = data.radar || null;
  const summary = radarStatus?.summary || null;
  const liveScores = Array.isArray(data.liveScores) ? data.liveScores : [];
  const inferMode = () => {
    if (config.mode && ['normal', 'strict', 'shield'].includes(config.mode)) return config.mode;
    if (config.threshold <= 65 || config.synBan <= 35) return 'shield';
    if (config.threshold <= 80 || config.synBan <= 60) return 'strict';
    return 'normal';
  };
  const activeMode = inferMode();
  const modeLabel = activeMode === 'shield' ? 'Shield Mode' : activeMode === 'strict' ? 'Strict Mode' : 'Normal Mode';
  const packetCounterReady = stats.telemetryAgentBuild === 'netdev-v2';
  const packetDelta = Number(stats.packetDiff || 0);
  const packetSourceLabel = packetCounterReady ? (stats.telemetrySource || '/proc/net/dev') : 'Legacy agent';
  const lastScanLabel = radarStatus?.lastScanAt
    ? new Date(radarStatus.lastScanAt).toLocaleTimeString()
    : 'No scans yet';
  const lastFlowLabel = trafficEvents[0]?.timestamp
    ? new Date(trafficEvents[0].timestamp).toLocaleTimeString()
    : 'waiting';
  const liveFlowLabel = trafficEvents.length > 0 ? `Agent stream ${lastFlowLabel}` : 'Waiting for agent stream';
  const guardBlockedIps = guardBlocklist?.ready ? guardBlocklist.count : data.stats.guardBlockedIps;

  const switchMode = async (mode) => {
    if (!token || modeBusy) return;
    setModeBusy(mode);
    try {
      const res = await fetch('/api/radar/mode', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ mode }),
      });
      const payload = await res.json();
      if (!res.ok) throw new Error(payload.error || 'Failed to change defense mode.');
      if (payload?.radar?.config) {
        setConfig((prev) => ({ ...prev, ...payload.radar.config }));
      }
      fetchStats();
    } catch (e) {
      alert(e.message || 'Failed to change defense mode.');
    } finally {
      setModeBusy('');
    }
  };

  return (
    <div className="page-shell">
      <section className="hero-panel">
        <div>
          <p className="eyebrow">Defense Grid</p>
          <h1 className="page-title">Threat Radar</h1>
          <p className="page-copy">Strict active scanning on the guard server, behavior scoring, and automatic blacklist actions before traffic overloads protected services.</p>
        </div>
        <div className="hero-status-stack">
          <div className={`status-pill ${config.enabled ? 'connected' : 'disconnected'}`}>
            {config.enabled ? 'Radar Enabled' : 'Radar Disabled'}
          </div>
          <div className={`meta-chip ${config.autoBan ? '' : 'danger-text'}`}>
            {config.autoBan ? 'Auto-Ban Armed' : 'Watch-Only Mode'}
          </div>
          <div className="meta-chip">Last scan {lastScanLabel}</div>
          <div className={`meta-chip ${trafficEvents.length > 0 ? 'text-green' : 'text-amber'}`}>
            {liveFlowLabel}
          </div>
        </div>
      </section>

      {error ? (
        <section className={`callout-banner ${setupRequired ? 'warning' : 'danger'}`}>
          <strong>{setupRequired ? 'Threat Radar setup required.' : 'Threat Radar unavailable.'}</strong>
          <span>
            {setupRequired
              ? 'Threat Radar database tables are missing. Run supabase_threat_radar.sql in your Supabase SQL editor, then reload this page.'
              : error}
          </span>
        </section>
      ) : null}

      <section className="metric-grid">
        <article className="metric-card tone-blue">
          <div className="metric-label">Live Observed</div>
          <div className="metric-value">{loading ? '...' : (summary?.scannedIps ?? liveScores.length)}</div>
        </article>
        <article className="metric-card tone-red">
          <div className="metric-label">Blocked IPs</div>
          <div className="metric-value">{loading ? '...' : guardBlockedIps}</div>
          <div className="metric-note">Today {data.stats.blockedToday} ban events</div>
        </article>
        <article className="metric-card">
          <div className="metric-label">Active Defense</div>
          <div className="metric-value">{modeLabel.replace(' Mode', '').toUpperCase()}</div>
        </article>
        <article className="metric-card">
          <div className="metric-label">Auto Ban</div>
          <div className="metric-value">{config.autoBan ? 'ARMED' : 'WATCH'}</div>
        </article>
      </section>

      <section className="glass-panel elevated-panel">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">Defense Modes</p>
            <h3>Rapid DDoS Protection Presets</h3>
          </div>
          <div className={`status-pill ${config.enabled ? 'connected' : 'disconnected'}`}>
            Active: {modeLabel}
          </div>
        </div>
        <div className="defense-mode-grid">
          <button
            type="button"
            className={`mode-button ${activeMode === 'normal' ? 'active' : ''}`}
            disabled={Boolean(modeBusy)}
            onClick={() => switchMode('normal')}
          >
            {modeBusy === 'normal' ? 'Applying...' : 'Normal'}
            <span>Balanced score gates</span>
          </button>
          <button
            type="button"
            className={`mode-button ${activeMode === 'strict' ? 'active' : ''}`}
            disabled={Boolean(modeBusy)}
            onClick={() => switchMode('strict')}
          >
            {modeBusy === 'strict' ? 'Applying...' : 'Strict'}
            <span>Lower watch and ban gates</span>
          </button>
          <button
            type="button"
            className={`mode-button shield ${activeMode === 'shield' ? 'active' : ''}`}
            disabled={Boolean(modeBusy)}
            onClick={() => switchMode('shield')}
          >
            {modeBusy === 'shield' ? 'Applying...' : 'Shield Mode'}
            <span>Fast containment thresholds</span>
          </button>
        </div>
        <div className="defense-status-grid">
          <div><span>Scanner</span><strong>{config.enabled ? '24/7 ACTIVE' : 'OFF'}</strong></div>
          <div><span>Auto Ban</span><strong>{config.autoBan ? 'ARMED' : 'WATCH ONLY'}</strong></div>
          <div><span>Ban Score</span><strong>{config.threshold}</strong></div>
          <div><span>Packet Counter</span><strong>{packetSourceLabel}</strong></div>
        </div>
      </section>

      <section className="glass-panel elevated-panel">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">Live Packets</p>
            <h3>Running IP Traffic Ledger</h3>
          </div>
          <div className="traffic-summary-chips">
            <span className="meta-chip text-green">Good</span>
            <span className="meta-chip text-amber">Medium</span>
            <span className="meta-chip text-red">Suspicious</span>
            <span className="meta-chip">{(stats.pps || 0).toFixed(1)} pps</span>
            <span className="meta-chip">Delta {packetDelta} packets</span>
            <span className="meta-chip">{lastFlowLabel}</span>
            <span className="meta-chip">{trafficEvents.length} rows</span>
          </div>
        </div>
        <TrafficLedger events={trafficEvents} limit={32} />
      </section>

      <section className="glass-panel elevated-panel">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">Live Scores</p>
              <h3>Real-Time IP Scoring</h3>
            </div>
            <div className="traffic-summary-chips">
              <span className="meta-chip">{radarStatus?.isScanning ? 'Scanning...' : 'Watching'}</span>
              <span className="meta-chip text-green">Watch {config.watchThreshold}</span>
              <span className="meta-chip text-red">Ban {config.threshold}</span>
              <span className="meta-chip">Last scan {lastScanLabel}</span>
            </div>
          </div>
          <div className="terminal-log radar-score-console">
            {loading ? (
              <div className="empty-state">Loading Threat Radar telemetry...</div>
            ) : liveScores.length === 0 ? (
              <div className="empty-state">No active remote IP sockets in the last scan cycle.</div>
            ) : (
              <table className="radar-score-table">
                <thead>
                  <tr>
                    <th>Time</th>
                    <th>IP Address</th>
                    <th>Score</th>
                    <th>Action</th>
                    <th>TCP</th>
                    <th>SYN</th>
                    <th>UDP</th>
                    <th>EST</th>
                    <th>Ports</th>
                    <th>Burst</th>
                    <th>Reason</th>
                  </tr>
                </thead>
                <tbody>
                  {liveScores.map((item) => (
                    <tr key={item.id || `${item.ip}-${item.detected_at}`} className={`radar-score-row ${scoreColor(item.score)}`}>
                      <td>{new Date(item.detected_at).toLocaleTimeString()}</td>
                      <td className="traffic-endpoint">{item.ip}</td>
                      <td>
                        <span className={`fact-value ${scoreColor(item.score)}`}>{item.score}</span>
                      </td>
                      <td>
                        <span className={item.action === 'banned' ? 'text-red' : item.action === 'watched' ? 'text-amber' : 'text-cyan'}>
                          {item.action}
                        </span>
                      </td>
                      <td>{item.tcp}</td>
                      <td>{item.syn}</td>
                      <td>{item.udp}</td>
                      <td>{item.established}</td>
                      <td>{item.ports}</td>
                      <td>{item.delta}</td>
                      <td>{item.reason}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
      </section>
    </div>
  );
}
