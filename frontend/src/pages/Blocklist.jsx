import { useCallback, useEffect, useRef, useState } from 'react';
import { useTelemetry } from '../context/TelemetryContext';

const ipv4Pattern = /^(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}$/;

export default function Blocklist({ token }) {
  const { isConnected, refreshGuardBlocklistSummary } = useTelemetry();

  const [banInput, setBanInput] = useState('');
  const [ips, setIps] = useState([]);
  const [loading, setLoading] = useState(false);
  const [guardReady, setGuardReady] = useState(false);
  const [guardTable, setGuardTable] = useState('inet detroit_guard');
  const [lastSync, setLastSync] = useState(null);
  const [feedback, setFeedback] = useState({ msg: '', type: '' });
  const [unbanning, setUnbanning] = useState(null);
  const intervalRef = useRef(null);

  const refresh = useCallback(async (silent = false) => {
    if (!token) return;
    if (!silent) setLoading(true);

    try {
      const res = await fetch('/api/guard/blocklist', {
        headers: { Authorization: `Bearer ${token}` }
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to load guard blocklist.');

      setIps(data.ips || []);
      setGuardTable(data.table || 'inet detroit_guard');
      setGuardReady(true);
      setLastSync(new Date());
      refreshGuardBlocklistSummary?.();
      if (!silent) setFeedback({ msg: '', type: '' });
    } catch (err) {
      setGuardReady(false);
      if (!silent) setFeedback({ msg: err.message, type: 'danger' });
    } finally {
      if (!silent) setLoading(false);
    }
  }, [token, refreshGuardBlocklistSummary]);

  useEffect(() => {
    if (!token) return undefined;

    const initial = setTimeout(() => refresh(), 0);
    intervalRef.current = setInterval(() => refresh(true), 15000);
    return () => {
      clearTimeout(initial);
      clearInterval(intervalRef.current);
    };
  }, [token, refresh]);

  const banIp = async () => {
    const ip = banInput.trim();
    if (!ipv4Pattern.test(ip)) {
      setFeedback({ msg: 'Enter a valid IPv4 address.', type: 'danger' });
      return;
    }

    setFeedback({ msg: '', type: '' });
    setLoading(true);
    const approved = window.confirm(`Ban ${ip} on the guard firewall and sync to connected agents?`);
    if (!approved) {
      setLoading(false);
      return;
    }

    try {
      const res = await fetch('/api/guard/blocklist', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ ip })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `Failed to ban ${ip}.`);

      setIps(data.ips || []);
      setGuardTable(data.table || 'inet detroit_guard');
      setGuardReady(true);
      setLastSync(new Date());
      refreshGuardBlocklistSummary?.();
      setBanInput('');
      setFeedback({ msg: `${ip} banned on the guard firewall.`, type: 'success' });
    } catch (err) {
      setFeedback({ msg: err.message, type: 'danger' });
    } finally {
      setLoading(false);
    }
  };

  const unbanIp = async (ip) => {
    const approved = window.confirm(`Remove ${ip} from the guard firewall blocklist?`);
    if (!approved) return;

    setUnbanning(ip);
    setFeedback({ msg: '', type: '' });

    try {
      const res = await fetch(`/api/guard/blocklist/${encodeURIComponent(ip)}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` }
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `Failed to unban ${ip}.`);

      setIps(data.ips || []);
      setGuardTable(data.table || 'inet detroit_guard');
      setGuardReady(true);
      setLastSync(new Date());
      refreshGuardBlocklistSummary?.();
      setFeedback({ msg: `${ip} removed from the guard firewall.`, type: 'success' });
    } catch (err) {
      setFeedback({ msg: err.message, type: 'danger' });
    } finally {
      setUnbanning(null);
    }
  };

  const onKeyDown = (e) => {
    if (e.key === 'Enter' && !loading && token) {
      banIp();
    }
  };

  const syncLabel = lastSync
    ? `Last synced ${lastSync.toLocaleTimeString()} - auto-refreshes every 15s`
    : 'Fetching from guard firewall...';

  return (
    <div className="page-shell">
      <section className="hero-panel compact">
        <div>
          <p className="eyebrow">Security</p>
          <h1 className="page-title">Block List</h1>
          <p className="page-copy">
            Live view of the central guard blacklist. Ban or unban IPs on the guard firewall and propagate the change to connected agents.
          </p>
        </div>
        <div className="hero-status-stack">
          <div className={`status-pill ${guardReady ? 'connected' : 'disconnected'}`}>
            {guardReady ? 'Guard Firewall Ready' : 'Guard Firewall Unreachable'}
          </div>
          <div className={`meta-chip ${isConnected ? '' : 'danger-text'}`}>
            {isConnected ? 'Agent Reachable' : 'Agent Offline'}
          </div>
          <div className="meta-chip">
            {ips.length > 0 ? `${ips.length} IP${ips.length > 1 ? 's' : ''} blocked` : 'No IPs blocked'}
          </div>
        </div>
      </section>

      <section className="glass-panel elevated-panel" style={{ padding: '1.25rem 1.5rem' }}>
        <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center', flexWrap: 'wrap' }}>
          <div style={{ flex: 1, minWidth: '220px' }}>
            <input
              id="ban-ip-input"
              type="text"
              placeholder="Enter IP to ban  e.g. 203.0.113.24"
              value={banInput}
              onChange={(e) => setBanInput(e.target.value)}
              onKeyDown={onKeyDown}
              disabled={loading || !token}
              style={{ width: '100%', margin: 0 }}
            />
          </div>
          <button
            id="ban-ip-btn"
            className="danger"
            type="button"
            onClick={banIp}
            disabled={loading || !token}
            style={{ whiteSpace: 'nowrap' }}
          >
            Ban IP
          </button>
          <button
            id="refresh-blocklist-btn"
            type="button"
            onClick={() => refresh(false)}
            disabled={loading || !token}
            style={{ whiteSpace: 'nowrap' }}
          >
            {loading ? 'Loading...' : 'Refresh'}
          </button>
          <span style={{ fontSize: '0.72rem', color: 'var(--text-dim)', whiteSpace: 'nowrap' }}>
            {syncLabel}
          </span>
        </div>

        <div style={{ marginTop: '0.75rem', fontSize: '0.72rem', color: 'var(--text-dim)' }}>
          Guard Engine: <span className="font-mono">{guardTable.includes('detroit_guard') ? 'SparrowX Guard' : guardTable}</span>
        </div>

        {feedback.msg && (
          <div className={`callout-inline ${feedback.type}`} style={{ marginTop: '0.75rem' }}>
            {feedback.msg}
          </div>
        )}
      </section>

      <section className="glass-panel elevated-panel">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">Live Firewall Set</p>
            <h3>Blocked IP Addresses</h3>
          </div>
          {ips.length > 0 && (
            <div className="meta-chip" style={{ color: 'var(--danger)' }}>
              {ips.length} active block{ips.length > 1 ? 's' : ''}
            </div>
          )}
        </div>

        {!guardReady && !loading ? (
          <div className="empty-state">Waiting for the guard firewall to respond...</div>
        ) : loading && ips.length === 0 ? (
          <div className="empty-state">Fetching blocked IPs from the guard firewall...</div>
        ) : ips.length === 0 ? (
          <div className="empty-state" style={{ padding: '2.5rem' }}>
            <div style={{ fontSize: '2rem', marginBottom: '0.5rem' }}>OK</div>
            <div>No IPs are currently blocked on the guard firewall.</div>
            <div style={{ fontSize: '0.8rem', color: 'var(--text-dim)', marginTop: '0.4rem' }}>
              Global auto-ban and manual blacklist actions show up here in real time.
            </div>
          </div>
        ) : (
          <div className="table-shell">
            <table>
              <thead>
                <tr>
                  <th style={{ width: '2rem' }}>#</th>
                  <th>IP Address</th>
                  <th>Status</th>
                  <th style={{ textAlign: 'right' }}>Action</th>
                </tr>
              </thead>
              <tbody>
                {ips.map((ip, i) => (
                  <tr key={ip}>
                    <td style={{ color: 'var(--text-dim)', fontSize: '0.8rem' }}>{i + 1}</td>
                    <td className="font-mono" style={{ fontSize: '1rem', letterSpacing: '0.04em' }}>
                      {ip}
                    </td>
                    <td>
                      <span
                        style={{
                          background: 'rgba(239,68,68,0.15)',
                          color: '#f87171',
                          padding: '0.2rem 0.6rem',
                          borderRadius: '4px',
                          fontSize: '0.75rem',
                          fontWeight: 600,
                        }}
                      >
                        BLOCKED
                      </span>
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      <button
                        type="button"
                        className="secondary-button small"
                        onClick={() => unbanIp(ip)}
                        disabled={Boolean(unbanning) || loading || !token}
                      >
                        {unbanning === ip ? 'Removing...' : 'Unban'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
