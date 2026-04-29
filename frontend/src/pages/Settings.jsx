import { useEffect, useState } from 'react';

export default function Settings({ token, user }) {
  const [tunnelStatus, setTunnelStatus] = useState('inactive');
  const [feedback, setFeedback] = useState('');
  const [isBusy, setIsBusy] = useState(false);

  useEffect(() => {
    if (!token) return;

    const fetchStatus = () => {
      fetch('/api/agent/tunnel/status', {
        headers: { 'Authorization': `Bearer ${token}` }
      })
        .then(async (response) => {
          const data = await response.json();
          if (!response.ok) {
            throw new Error(data.error || 'Unable to load tunnel status.');
          }
          setTunnelStatus(data.status || 'inactive');
        })
        .catch((error) => setFeedback(error.message));
    };

    fetchStatus();
    const id = setInterval(fetchStatus, 10000);
    return () => clearInterval(id);
  }, [token]);

  const handleRemoveTunnel = async () => {
    if (!confirm('Disconnecting protection removes the tunnel state tracked by the panel. Continue?')) return;

    setIsBusy(true);
    setFeedback('');

    try {
      const response = await fetch('/api/agent/tunnel/remove', {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${token}` }
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || 'Failed to disconnect protection.');
      }
      setTunnelStatus('inactive');
      setFeedback('Protection disconnect request sent successfully.');
    } catch (error) {
      setFeedback(error.message);
    } finally {
      setIsBusy(false);
    }
  };

  return (
    <div className="page-shell">
      <section className="hero-panel compact">
        <div>
          <p className="eyebrow">Account</p>
          <h1 className="page-title">Settings</h1>
          <p className="page-copy">
            Review the current account identity, linked agent credentials, and live protection state. Only real controls are surfaced here.
          </p>
        </div>
        <div className="hero-status-stack">
          <div className={`status-pill ${user?.agentStatus === 'CONNECTED' ? 'connected' : 'disconnected'}`}>
            {user?.agentStatus || 'NO AGENT'}
          </div>
          <div className={`status-pill ${tunnelStatus === 'active' ? 'connected' : 'disconnected'}`}>
            Tunnel {tunnelStatus}
          </div>
        </div>
      </section>

      <section className="content-grid two-up">
        <article className="glass-panel elevated-panel">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">Identity</p>
              <h3>Account Details</h3>
            </div>
          </div>
          <div className="fact-list">
            <div className="fact-row">
              <span>Username</span>
              <span className="fact-value">@{user?.username || '-'}</span>
            </div>
            <div className="fact-row">
              <span>Email</span>
              <span className="fact-value">{user?.email || '-'}</span>
            </div>
            <div className="fact-row">
              <span>Role</span>
              <span className="fact-value">{user?.role || 'user'}</span>
            </div>
            <div className="fact-row">
              <span>Agent ID</span>
              <span className="fact-value">{user?.agentId || '-'}</span>
            </div>
          </div>
        </article>

        <article className="glass-panel elevated-panel">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">Protection</p>
              <h3>Network Controls</h3>
            </div>
          </div>
          <div className="fact-list compact">
            <div className="fact-row">
              <span>Agent Connectivity</span>
              <span className={`fact-value ${user?.agentStatus === 'CONNECTED' ? '' : 'danger'}`}>{user?.agentStatus || 'NO AGENT'}</span>
            </div>
            <div className="fact-row">
              <span>Tunnel Status</span>
              <span className={`fact-value ${tunnelStatus === 'active' ? '' : 'danger'}`}>{tunnelStatus}</span>
            </div>
            <div className="fact-row">
              <span>Installer Mode</span>
              <span className="fact-value">Agent-first / SparrowGuard auto</span>
            </div>
          </div>

          {feedback ? <div className={`callout-inline ${feedback.toLowerCase().includes('successfully') ? 'success' : 'danger'}`}>{feedback}</div> : null}

          <div className="button-row">
            <button
              type="button"
              className="danger"
              onClick={handleRemoveTunnel}
              disabled={isBusy || tunnelStatus !== 'active'}
            >
              {isBusy ? 'Disconnecting...' : 'Disconnect Protection'}
            </button>
          </div>
        </article>
      </section>
    </div>
  );
}
