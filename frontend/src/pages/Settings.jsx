import { useEffect, useState } from 'react';
import { useTelemetry } from '../context/TelemetryContext';
import { UserCheck, UserX, ShieldCheck, RefreshCw, Trash2 } from 'lucide-react';

export default function Settings({ token, user }) {
  const { viewMode } = useTelemetry();
  const [tunnelStatus, setTunnelStatus] = useState('inactive');
  const [users, setUsers] = useState([]);
  const [loadingUsers, setLoadingUsers] = useState(false);
  const [feedback, setFeedback] = useState('');
  const [isBusy, setIsBusy] = useState(false);

  const fetchUsers = async () => {
    if (user?.role !== 'admin') return;
    setLoadingUsers(true);
    try {
      const res = await fetch('/api/internal/users', {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      const data = await res.json();
      if (res.ok) setUsers(data);
    } catch (e) {
      console.error('Failed to fetch users:', e);
    } finally {
      setLoadingUsers(false);
    }
  };

  useEffect(() => {
    if (!token) return;

    const fetchStatus = () => {
      if (viewMode !== 'global') {
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
      }
    };

    fetchStatus();
    if (user?.role === 'admin') fetchUsers();
    
    const id = setInterval(fetchStatus, 10000);
    return () => clearInterval(id);
  }, [token, viewMode]);

  const handleUpdateUser = async (username, status) => {
    try {
      const res = await fetch('/api/internal/users/status', {
        method: 'POST',
        headers: { 
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ username, status })
      });
      if (res.ok) {
        setFeedback(`User ${username} updated to ${status}.`);
        fetchUsers();
      }
    } catch (e) {
      setFeedback('Failed to update user.');
    }
  };

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
          <p className="eyebrow">{viewMode === 'global' ? 'Infrastructure' : 'Account'}</p>
          <h1 className="page-title">{viewMode === 'global' ? 'Global Management' : 'Settings'}</h1>
          <p className="page-copy">
            {viewMode === 'global' 
              ? 'Centralized control for user approvals, global security postures, and infrastructure health.'
              : 'Review the current account identity, linked agent credentials, and live protection state.'}
          </p>
        </div>
        <div className="hero-status-stack">
          {viewMode !== 'global' && (
            <>
              <div className={`status-pill ${user?.agentStatus === 'CONNECTED' ? 'connected' : 'disconnected'}`}>
                {user?.agentStatus || 'NO AGENT'}
              </div>
              <div className={`status-pill ${tunnelStatus === 'active' ? 'connected' : 'disconnected'}`}>
                Tunnel {tunnelStatus}
              </div>
            </>
          )}
          {viewMode === 'global' && (
            <div className="status-pill connected">
              GUARD INFRASTRUCTURE ONLINE
            </div>
          )}
        </div>
      </section>

      <section className="content-grid two-up">
        {viewMode === 'global' ? (
          <article className="glass-panel elevated-panel full-width">
            <div className="panel-heading">
              <div>
                <p className="eyebrow">Administration</p>
                <h3>User Management</h3>
              </div>
              <button className="icon-button" onClick={fetchUsers} disabled={loadingUsers}>
                <RefreshCw size={16} className={loadingUsers ? 'spin' : ''} />
              </button>
            </div>
            
            <div className="user-table-wrapper">
              <table className="user-table">
                <thead>
                  <tr>
                    <th>Username</th>
                    <th>Role</th>
                    <th>Status</th>
                    <th>Agent ID</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {users.map(u => (
                    <tr key={u.id}>
                      <td className="bold">@{u.username}</td>
                      <td><span className={`role-badge ${u.role}`}>{u.role}</span></td>
                      <td><span className={`status-badge ${u.status}`}>{u.status}</span></td>
                      <td className="mono">{u.agent_id || '—'}</td>
                      <td>
                        <div className="action-row-mini">
                          {u.status === 'pending' && (
                            <button title="Approve" onClick={() => handleUpdateUser(u.username, 'active')} className="icon-btn-sm success"><UserCheck size={14}/></button>
                          )}
                          {u.status === 'active' && (
                            <button title="Suspend" onClick={() => handleUpdateUser(u.username, 'pending')} className="icon-btn-sm warning"><UserX size={14}/></button>
                          )}
                          <button title="Promote Admin" onClick={() => handleUpdateUser(u.username, 'admin')} className="icon-btn-sm info"><ShieldCheck size={14}/></button>
                        </div>
                      </td>
                    </tr>
                  ))}
                  {users.length === 0 && (
                    <tr>
                      <td colSpan="5" className="empty-row">No users found.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </article>
        ) : (
          <>
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

              {feedback ? <div className={`callout-inline ${feedback.toLowerCase().includes('successfully') || feedback.toLowerCase().includes('updated') ? 'success' : 'danger'}`}>{feedback}</div> : null}

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
          </>
        )}
      </section>

      <style dangerouslySetInnerHTML={{ __html: `
        .full-width { grid-column: 1 / -1; }
        .user-table-wrapper { overflow-x: auto; margin-top: 10px; }
        .user-table { width: 100%; border-collapse: collapse; text-align: left; }
        .user-table th { padding: 12px; font-size: 0.7rem; color: rgba(255,255,255,0.4); text-transform: uppercase; border-bottom: 1px solid rgba(255,255,255,0.05); }
        .user-table td { padding: 16px 12px; font-size: 0.85rem; border-bottom: 1px solid rgba(255,255,255,0.02); color: rgba(255,255,255,0.8); }
        .user-table .bold { color: #fff; font-weight: 600; }
        .user-table .mono { font-family: 'JetBrains Mono', monospace; font-size: 0.75rem; color: var(--accent-cyan); }
        .role-badge { padding: 2px 8px; border-radius: 4px; font-size: 0.7rem; text-transform: uppercase; font-weight: 700; background: rgba(255,255,255,0.05); }
        .role-badge.admin { background: rgba(34,211,238,0.1); color: var(--accent-cyan); }
        .status-badge { padding: 2px 8px; border-radius: 4px; font-size: 0.7rem; text-transform: uppercase; font-weight: 700; }
        .status-badge.active { background: rgba(40,153,18,0.1); color: #289912; }
        .status-badge.pending { background: rgba(245,158,11,0.1); color: #f59e0b; }
        .action-row-mini { display: flex; gap: 8px; }
        .icon-btn-sm { width: 28px; height: 28px; border-radius: 6px; display: flex; align-items: center; justify-content: center; cursor: pointer; border: 1px solid rgba(255,255,255,0.1); background: transparent; color: #fff; transition: all 0.2s; }
        .icon-btn-sm:hover { background: rgba(255,255,255,0.05); }
        .icon-btn-sm.success:hover { color: #289912; border-color: #289912; }
        .icon-btn-sm.warning:hover { color: #f59e0b; border-color: #f59e0b; }
        .icon-btn-sm.info:hover { color: var(--accent-cyan); border-color: var(--accent-cyan); }
        .empty-row { text-align: center; color: rgba(255,255,255,0.2); font-style: italic; }
        .spin { animation: spin 1s linear infinite; }
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
      `}} />
    </div>
  );
}
