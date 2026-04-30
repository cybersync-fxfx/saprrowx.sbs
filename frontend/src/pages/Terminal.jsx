import { useEffect, useRef, useState } from 'react';
import { useTelemetry } from '../context/TelemetryContext';

const quickActions = [
  'uptime',
  'free -h',
  'df -h',
  'ss -ant | wc -l',
  'top -bn1 | head -5',
  'systemctl status sbs-agent --no-pager',
  'tail -n 40 /var/log/sbs/agent.log',
  'nft list ruleset | head -30',
];
const dangerousCommandPattern = /\b(rm\s+-rf|mkfs|dd\s+if=|shutdown|reboot|poweroff|iptables\s+-F|nft\s+flush|systemctl\s+(stop|disable)\s+)/i;

const needsConfirmation = (cmd) => dangerousCommandPattern.test(String(cmd || '').trim());

export default function Terminal({ token, user }) {
  const { sendCommand, isConnected, commandReady, wsState, viewMode } = useTelemetry();

  const [logs, setLogs] = useState([
    { text: '[ SPARROWX SECURE TERMINAL ]', level: 'info' },
    { text: 'Agent commands execute on your protected server via the secure channel.', level: 'default' },
  ]);
  const [input, setInput] = useState('');
  const [isRunning, setIsRunning] = useState(false);
  const [history, setHistory] = useState([]);
  const [histIdx, setHistIdx] = useState(-1);
  const logEndRef = useRef(null);

  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logs]);

  const runCommand = async (cmd) => {
    if (!cmd.trim()) return;
    if (needsConfirmation(cmd)) {
      const approved = window.confirm(
        `This command looks potentially destructive:\n\n${cmd}\n\nRun it on the ${viewMode === 'global' ? 'Guard Infrastructure' : 'remote server'}?`
      );
      if (!approved) return;
    }
    setLogs(prev => [...prev, { text: `root@${viewMode === 'global' ? 'guard' : 'server'}:~$ ${cmd}`, level: 'info' }]);
    setHistory(prev => [cmd, ...prev].slice(0, 50));
    setHistIdx(-1);
    setIsRunning(true);
    try {
      if (viewMode === 'global') {
        const res = await fetch('/api/guard/command', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ command: cmd.trim() })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Failed to execute guard command.');
        setLogs(prev => [...prev, {
          text: data.output || '(no output)',
          level: 'default'
        }]);
      } else {
        const result = await sendCommand(cmd.trim());
        setLogs(prev => [...prev, {
          text: result.output || '(no output)',
          level: result.exitCode === 0 ? 'default' : 'error'
        }]);
      }
    } catch (error) {
      setLogs(prev => [...prev, { text: `[error] ${error.message}`, level: 'error' }]);
    } finally {
      setIsRunning(false);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!input.trim()) return;
    const cmd = input;
    setInput('');
    await runCommand(cmd);
  };

  const handleKeyDown = (e) => {
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      const next = Math.min(histIdx + 1, history.length - 1);
      setHistIdx(next);
      if (history[next]) setInput(history[next]);
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      const next = Math.max(histIdx - 1, -1);
      setHistIdx(next);
      setInput(next === -1 ? '' : history[next]);
    }
  };

  return (
    <div className="page-shell">
      <section className="hero-panel compact">
        <div>
          <p className="eyebrow">Operations</p>
          <h1 className="page-title">Remote Terminal</h1>
          <p className="page-copy">Execute live commands on your protected server through the secure agent channel.</p>
        </div>
        <div className="hero-status-stack">
          <div className={`status-pill ${isConnected ? 'connected' : 'disconnected'}`}>
            {isConnected ? '* Agent Ready' : 'o No Agent'}
          </div>
          <div className="meta-chip" style={{ color: wsState === 'open' ? 'var(--accent-cyan)' : 'var(--warn-amber)' }}>
            WS {wsState}
          </div>
        </div>
      </section>

      {!commandReady && (
        <section className="callout-banner warning">
          <strong>[!]</strong>
          <span>
            {wsState === 'reconnecting'
              ? 'Reconnecting - commands will be available once the connection is restored.'
              : 'Agent not connected. Install the agent on your target server first.'}
          </span>
        </section>
      )}

      <section className="glass-panel elevated-panel">
        <div className="panel-heading">
          <div><p className="eyebrow">Session</p><h3>Live Command Console</h3></div>
          <div className="meta-chip">{isRunning ? '[ Running... ]' : commandReady ? '[ Ready ]' : '[ Offline ]'}</div>
        </div>

        <div className="terminal-log terminal-large">
          {logs.map((log, idx) => (
            <div key={idx} className={`log-line ${log.level}`}>{log.text}</div>
          ))}
          <div ref={logEndRef} />
        </div>

        <form onSubmit={handleSubmit} className="terminal-form">
          <label className="terminal-prompt">root@server:~$</label>
          <input
            type="text"
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            className="terminal-input"
            autoComplete="off"
            disabled={isRunning || !commandReady}
            placeholder={commandReady ? 'Enter a command (UpDown history)' : 'Waiting for agent...'}
          />
          <button type="submit" disabled={isRunning || !commandReady}>
            {isRunning ? '...' : 'RUN'}
          </button>
        </form>

        <div className="action-grid">
          {quickActions.map(cmd => (
            <button key={cmd} type="button" className="secondary-button"
              onClick={() => runCommand(cmd)} disabled={isRunning || !commandReady}>
              {cmd}
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}
