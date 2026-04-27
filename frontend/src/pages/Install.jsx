import { useState } from 'react';

export default function Install({ token, user }) {
  const [osType, setOsType] = useState('ubuntu');
  const [panelUrl, setPanelUrl] = useState(window.location.origin);
  const [feedback, setFeedback] = useState('');
  const [isBusy, setIsBusy] = useState(false);

  const handleDownload = async () => {
    setFeedback('');
    setIsBusy(true);

    try {
      const response = await fetch(`/api/agent/download?os=${osType}&serverUrl=${encodeURIComponent(panelUrl)}`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });

      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.error || 'Failed to generate installer.');
      }

      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `sparrowx-agent-${user.agentId}.sh`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
      setFeedback('Fresh installer downloaded. Upload it to the target server and run it as root.');
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
          <p className="eyebrow">Deployment</p>
          <h1 className="page-title">Install Agent</h1>
          <p className="page-copy">
            Generate a dedicated installer for your server, upload it, and bring that server into the dashboard with a single command.
          </p>
        </div>
        <div className="hero-status-stack">
          <div className={`status-pill ${user?.agentStatus === 'CONNECTED' ? 'connected' : 'disconnected'}`}>
            {user?.agentStatus || 'NO AGENT'}
          </div>
          <div className="meta-chip">{user?.agentId}</div>
        </div>
      </section>

      <section className="content-grid two-up">
        <article className="glass-panel elevated-panel">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">Generator</p>
              <h3>Create Installer</h3>
            </div>
          </div>

          <div className="form-stack">
            <label>
              <span className="credential-label">Target OS</span>
              <select value={osType} onChange={e => setOsType(e.target.value)}>
                <option value="ubuntu">Ubuntu (20.04, 22.04, 24.04)</option>
                <option value="debian">Debian (11, 12, 13)</option>
              </select>
            </label>

            <label>
              <span className="credential-label">Panel Public URL</span>
              <input
                type="text"
                value={panelUrl}
                onChange={e => setPanelUrl(e.target.value)}
                placeholder="https://your-panel-domain"
              />
            </label>

            <div className="callout-inline warning">
              Download a fresh installer whenever you update credentials or the panel address. The agent connects to the dashboard immediately upon install.
            </div>

            {feedback ? (
              <div className={`callout-inline ${feedback.toLowerCase().includes('downloaded') ? 'success' : 'danger'}`}>
                {feedback}
              </div>
            ) : null}

            <div className="button-row">
              <button type="button" onClick={handleDownload} disabled={isBusy}>
                {isBusy ? 'Preparing Installer...' : 'Download Installer'}
              </button>
            </div>
          </div>
        </article>

        <article className="glass-panel elevated-panel">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">Runbook</p>
              <h3>Operator Steps</h3>
            </div>
          </div>

          <div className="stack-list">
            <div className="action-card">
              <span className="action-card-title">1. Upload the installer</span>
              <span className="action-card-copy command-output">scp sparrowx-agent-{user?.agentId}.sh root@YOUR_SERVER_IP:/root/</span>
            </div>
            <div className="action-card">
              <span className="action-card-title">2. Run it as root</span>
              <span className="action-card-copy command-output">sudo bash /root/sparrowx-agent-{user?.agentId}.sh</span>
            </div>
            <div className="action-card">
              <span className="action-card-title">3. Watch the dashboard</span>
              <span className="action-card-copy">Keep this tab open. The status badge should flip to connected when the agent registers and starts sending telemetry.</span>
            </div>
          </div>
        </article>
      </section>
    </div>
  );
}
