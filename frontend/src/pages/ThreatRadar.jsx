import { useEffect, useMemo, useState } from 'react';
import TrafficLedger from '../components/TrafficLedger';
import { useTelemetry } from '../context/TelemetryContext';

const DEFAULT_CONFIG = {
  enabled: true,
  autoBan: true,
  threshold: 90,
  watchThreshold: 55,
  scanIntervalMs: 10000,
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
  const { trafficEvents, stats } = useTelemetry();
  const [data, setData] = useState({ recent: [], stats: { scannedToday: 0, blockedToday: 0 }, radar: null });
  const [config, setConfig] = useState(DEFAULT_CONFIG);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState('');
  const [setupRequired, setSetupRequired] = useState(false);
  const [flash, setFlash] = useState('');

  const fetchStats = () => {
    fetch('/api/radar/stats', { headers: { Authorization: `Bearer ${token}` } })
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
          stats: {
            scannedToday: Number(d?.stats?.scannedToday || 0),
            blockedToday: Number(d?.stats?.blockedToday || 0),
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
        setData({ recent: [], stats: { scannedToday: 0, blockedToday: 0 }, radar: null });
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

  const saveConfig = async () => {
    setSaving(true);
    setFlash('');
    try {
      const res = await fetch('/api/radar/config', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(config),
      });
      const payload = await res.json();
      if (!res.ok) throw new Error(payload.error || 'Failed to save Threat Radar settings.');
      setData((prev) => ({ ...prev, radar: payload }));
      setConfig((prev) => ({ ...prev, ...(payload.config || {}) }));
      setFlash('Threat Radar settings saved.');
    } catch (e) {
      setError(e.message || 'Failed to save Threat Radar settings.');
    } finally {
      setSaving(false);
    }
  };

  const scanNow = async () => {
    setScanning(true);
    setFlash('');
    try {
      const res = await fetch('/api/radar/scan', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
      const payload = await res.json();
      if (!res.ok) throw new Error(payload.error || 'Threat Radar scan failed.');
      setData((prev) => ({ ...prev, radar: payload }));
      setFlash('Threat Radar scan completed.');
      fetchStats();
    } catch (e) {
      setError(e.message || 'Threat Radar scan failed.');
    } finally {
      setScanning(false);
    }
  };

  const radarStatus = data.radar || null;
  const summary = radarStatus?.summary || null;
  const lastScanLabel = radarStatus?.lastScanAt
    ? new Date(radarStatus.lastScanAt).toLocaleTimeString()
    : 'No scans yet';

  const heuristics = useMemo(() => ([
    `TCP warn ${config.connWarn} / ban ${config.connBan}`,
    `SYN warn ${config.synWarn} / ban ${config.synBan}`,
    `UDP warn ${config.udpWarn} / ban ${config.udpBan}`,
    `Burst warn ${config.burstWarn} / ban ${config.burstBan}`,
  ]), [config]);

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

      {flash ? (
        <section className="callout-banner success">
          <strong>Threat Radar</strong>
          <span>{flash}</span>
        </section>
      ) : null}

      <section className="metric-grid">
        <article className="metric-card tone-blue">
          <div className="metric-label">Observed Today</div>
          <div className="metric-value">{loading ? '...' : data.stats.scannedToday}</div>
        </article>
        <article className="metric-card tone-red">
          <div className="metric-label">Blocked Today</div>
          <div className="metric-value">{loading ? '...' : data.stats.blockedToday}</div>
        </article>
        <article className="metric-card">
          <div className="metric-label">Auto-Ban Threshold</div>
          <div className="metric-value">{config.threshold}</div>
        </article>
        <article className="metric-card">
          <div className="metric-label">Last Cycle</div>
          <div className="metric-value">{summary ? `${summary.scannedIps} IPs` : 'Idle'}</div>
        </article>
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
            <span className="meta-chip">{trafficEvents.length} rows</span>
          </div>
        </div>
        <TrafficLedger events={trafficEvents} limit={32} />
      </section>

      <div className="content-grid two-up">
        <article className="glass-panel elevated-panel">
          <div className="panel-heading">
            <div><h3>Real-Time IP Scoring</h3></div>
            <div className="meta-chip">{radarStatus?.isScanning ? 'Scanning...' : 'Live Feed'}</div>
          </div>
          <div className="terminal-log terminal-large">
            {loading ? (
              <div className="empty-state">Loading Threat Radar telemetry...</div>
            ) : data.recent.length === 0 ? (
              <div className="empty-state">No radar events have been recorded yet.</div>
            ) : (
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.75rem' }}>
                <thead>
                  <tr style={{ textAlign: 'left', borderBottom: '1px solid var(--panel-border)', color: 'var(--text-muted)' }}>
                    <th style={{ padding: '8px' }}>IP ADDRESS</th>
                    <th style={{ padding: '8px' }}>SCORE</th>
                    <th style={{ padding: '8px' }}>REASON</th>
                    <th style={{ padding: '8px' }}>ACTION</th>
                    <th style={{ padding: '8px' }}>TIME</th>
                  </tr>
                </thead>
                <tbody>
                  {data.recent.map((item) => (
                    <tr key={item.id} style={{ borderBottom: '1px solid rgba(255,255,255,0.03)' }}>
                      <td style={{ padding: '8px', fontFamily: 'var(--font-mono)' }}>{item.ip}</td>
                      <td style={{ padding: '8px' }}>
                        <span className={`fact-value ${scoreColor(item.score)}`}>{item.score}</span>
                      </td>
                      <td style={{ padding: '8px', color: 'var(--text-soft)' }}>{item.reason}</td>
                      <td style={{ padding: '8px', textTransform: 'uppercase', fontSize: '0.65rem', fontWeight: 700 }}>
                        <span className={item.action === 'banned' ? 'text-red' : item.action === 'watched' ? 'text-yellow' : 'text-cyan'}>
                          {item.action}
                        </span>
                      </td>
                      <td style={{ padding: '8px', color: 'var(--text-muted)' }}>{new Date(item.detected_at).toLocaleTimeString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </article>

        <article className="glass-panel elevated-panel">
          <div className="panel-heading">
            <div><h3>Radar Controls</h3></div>
            <div style={{ display: 'flex', gap: '8px' }}>
              <button className="secondary-button small" onClick={scanNow} disabled={scanning || !token}>
                {scanning ? 'Scanning...' : 'Scan Now'}
              </button>
              <button className="secondary-button small" onClick={saveConfig} disabled={saving || !token}>
                {saving ? 'Saving...' : 'Save Rules'}
              </button>
            </div>
          </div>
          <div className="fact-list">
            <div className="fact-row">
              <span>Scanner</span>
              <button className={config.enabled ? 'success-outline' : 'danger-outline'} onClick={() => setConfig((prev) => ({ ...prev, enabled: !prev.enabled }))}>
                {config.enabled ? 'ENABLED' : 'DISABLED'}
              </button>
            </div>
            <div className="fact-row">
              <span>Auto-Ban</span>
              <button className={config.autoBan ? 'success-outline' : 'danger-outline'} onClick={() => setConfig((prev) => ({ ...prev, autoBan: !prev.autoBan }))}>
                {config.autoBan ? 'ARMED' : 'WATCH ONLY'}
              </button>
            </div>
            <div className="fact-row">
              <span>Threshold</span>
              <input
                type="range"
                min="50"
                max="100"
                value={config.threshold}
                onChange={(e) => setConfig((prev) => ({ ...prev, threshold: Number(e.target.value) }))}
                style={{ width: '120px' }}
              />
            </div>
            <div className="fact-row">
              <span>Watch Threshold</span>
              <input
                type="range"
                min="20"
                max="90"
                value={config.watchThreshold}
                onChange={(e) => setConfig((prev) => ({ ...prev, watchThreshold: Number(e.target.value) }))}
                style={{ width: '120px' }}
              />
            </div>
            <div className="fact-row">
              <span>Scan Interval</span>
              <span className="text-green">{Math.round(config.scanIntervalMs / 1000)}s</span>
            </div>
            <div className="fact-row">
              <span>Last Cycle</span>
              <span className="text-green">{summary ? `${summary.scannedIps} scanned / ${summary.watchedIps} watched / ${summary.bannedIps} banned` : 'Idle'}</span>
            </div>
          </div>
          <div style={{ marginTop: '20px', padding: '10px', background: 'rgba(59,130,246,0.05)', border: '1px solid var(--panel-border)' }}>
            <p className="eyebrow" style={{ marginBottom: '8px' }}>Strict Heuristics</p>
            <div style={{ fontSize: '0.7rem', color: 'var(--text-soft)', display: 'flex', flexDirection: 'column', gap: '6px' }}>
              {heuristics.map((line) => <div key={line}>[i] {line}</div>)}
              <div>[i] Port fan-out warn {config.portFanoutWarn} / ban {config.portFanoutBan}</div>
              <div>[i] Cooldown {Math.round(config.banCooldownMs / 60000)}m before re-banning the same IP</div>
              {summary?.lastBannedIp && <div>[!] Last auto-ban: {summary.lastBannedIp} - {summary.lastReason}</div>}
            </div>
          </div>
        </article>
      </div>
    </div>
  );
}
