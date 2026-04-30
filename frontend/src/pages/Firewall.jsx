import { useState } from 'react';
import { useTelemetry } from '../context/TelemetryContext';

const inspectionActions = [
  {
    title: 'Full Firewall Ruleset',
    description: 'Inspect every active firewall table, chain, and rule set on the protected server.',
    command: 'nft list ruleset'
  },
  {
    title: 'Firewall service health',
    description: 'Check whether the firewall service is enabled and currently running.',
    command: 'systemctl status nftables --no-pager'
  },
  {
    title: 'Recent attack log',
    description: 'Review the latest attack-related entries written by the agent host.',
    command: 'tail -n 40 /var/log/sbs/attacks.log'
  },
  {
    title: 'Reload firewall service',
    description: 'Restart the firewall service cleanly and return the status.',
    command: 'systemctl restart nftables && systemctl status nftables --no-pager'
  }
];

export default function Firewall({ token, user }) {
  const { sendCommand, isConnected, commandReady, wsState, viewMode } = useTelemetry();
  const [activeCommand, setActiveCommand] = useState('');
  const [output, setOutput] = useState('');
  const [errorMessage, setErrorMessage] = useState('');
  const [isBusy, setIsBusy] = useState(false);

  const runInspection = async (action) => {
    if (action.command.includes('systemctl restart nftables')) {
      const approved = window.confirm(
        `This will restart nftables on the ${viewMode === 'global' ? 'Guard Infrastructure' : 'remote server'}. Continue?`
      );
      if (!approved) return;
    }
    setActiveCommand(action.title);
    setErrorMessage('');
    setIsBusy(true);

    try {
      if (viewMode === 'global') {
        // Run on guard server via a new internal API or reuse sendCommand if backend supports it
        // Actually, let's implement /api/guard/command for admins
        const res = await fetch('/api/guard/command', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ command: action.command })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Failed to execute guard command.');
        setOutput(data.output || '(no output returned)');
      } else {
        const result = await sendCommand(action.command);
        setOutput(result.output || '(no output returned)');
      }
    } catch (error) {
      setErrorMessage(error.message);
      setOutput('');
    } finally {
      setIsBusy(false);
    }
  };

  return (
    <div className="page-shell">
      <section className="hero-panel compact">
        <div>
          <p className="eyebrow">Security</p>
          <h1 className="page-title">Firewall Control</h1>
          <p className="page-copy">
            Use audited command presets to inspect the live firewall state and verify protection services on your server.
          </p>
        </div>
        <div className="hero-status-stack">
          <div className={`status-pill ${isConnected ? 'connected' : 'disconnected'}`}>
            {isConnected ? 'Agent Reachable' : 'Agent Not Reachable'}
          </div>
          <div className="meta-chip">{isBusy ? 'Command running' : 'Ready'}</div>
        </div>
      </section>

      <section className="content-grid two-up">
        <article className="glass-panel elevated-panel">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">Tools</p>
              <h3>Live Firewall Actions</h3>
            </div>
          </div>

          <div className="stack-list">
            {inspectionActions.map(action => (
              <button
                key={action.title}
                type="button"
                className="action-card"
                onClick={() => runInspection(action)}
                disabled={isBusy || !commandReady}
              >
                <span className="action-card-title">{action.title}</span>
                <span className="action-card-copy">{action.description}</span>
              </button>
            ))}
          </div>
        </article>

        <article className="glass-panel elevated-panel">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">Output</p>
              <h3>{activeCommand || 'Waiting for a firewall command'}</h3>
            </div>
          </div>

          {errorMessage ? <div className="callout-inline danger">{errorMessage}</div> : null}

          <div className="terminal-log medium">
            {output ? <pre className="command-output">{output}</pre> : <div className="empty-state">Run one of the live firewall actions to inspect the protected server.</div>}
          </div>
        </article>
      </section>
    </div>
  );
}
