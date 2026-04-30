import { useState, useEffect } from 'react';
import { ShieldCheck, ShieldAlert, Cpu, Activity, RefreshCw, AlertCircle, CheckCircle2, Terminal } from 'lucide-react';

export default function SecurityStatus({ token }) {
  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(true);
  const [fixing, setFixing] = useState(false);
  const [error, setError] = useState(null);

  const fetchStatus = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/internal/security-status', {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (!res.ok) throw new Error('Failed to fetch security status');
      const data = await res.json();
      setStatus(data);
      setError(null);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleFix = async () => {
    if (!confirm('Are you sure you want to run the automated security repair? This will restart key services.')) return;
    setFixing(true);
    try {
      const res = await fetch('/api/internal/security-fix', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (!res.ok) throw new Error('Failed to trigger repair');
      alert('Automated repair started in the background. Please wait 30-60 seconds for services to restart.');
      setTimeout(fetchStatus, 30000);
    } catch (err) {
      alert('Error: ' + err.message);
    } finally {
      setFixing(false);
    }
  };

  useEffect(() => {
    fetchStatus();
    const id = setInterval(fetchStatus, 60000);
    return () => clearInterval(id);
  }, []);

  if (loading && !status) {
    return (
      <div className="page-container">
        <div className="loading-state">
          <RefreshCw className="spin" />
          <span>Polling infrastructure status...</span>
        </div>
      </div>
    );
  }

  const layers = [
    { id: 'xdp', name: 'Layer 1: XDP/eBPF', icon: <Cpu />, desc: 'Wire-speed packet filtering in the kernel' },
    { id: 'nftables', name: 'Layer 2: nftables', icon: <ShieldCheck />, desc: 'Kernel-level firewall and rate limiting' },
    { id: 'haproxy', name: 'Layer 3: HAProxy WAF', icon: <Activity />, desc: 'Application-level filter and bot blocker' },
    { id: 'fastnetmon', name: 'Layer 4: FastNetMon', icon: <AlertCircle />, desc: 'Intelligent attack detection and blackholing' }
  ];

  return (
    <div className="page-container">
      <header className="page-header">
        <div>
          <h1 className="page-title">Infrastructure Status</h1>
          <p className="page-subtitle">Monitoring and health check for the 4-layer defense stack</p>
        </div>
        <button 
          className={`btn-primary ${fixing ? 'loading' : ''}`} 
          onClick={handleFix}
          disabled={fixing}
        >
          {fixing ? <RefreshCw className="spin" size={16} /> : <RefreshCw size={16} />}
          <span>Run Auto-Fix</span>
        </button>
      </header>

      {error && (
        <div className="error-banner">
          <AlertCircle size={18} />
          <span>{error}</span>
        </div>
      )}

      <div className="security-grid">
        {layers.map(layer => {
          const isActive = status?.[layer.id]?.active;
          const details = status?.[layer.id]?.details;

          return (
            <div key={layer.id} className={`security-card ${isActive ? 'active' : 'inactive'}`}>
              <div className="card-top">
                <div className="layer-icon">{layer.icon}</div>
                <div className={`status-badge ${isActive ? 'online' : 'offline'}`}>
                  {isActive ? <CheckCircle2 size={12} /> : <AlertCircle size={12} />}
                  {isActive ? 'ACTIVE' : 'INACTIVE'}
                </div>
              </div>
              <div className="card-body">
                <h3>{layer.name}</h3>
                <p className="desc">{layer.desc}</p>
                <div className="details-box">
                  <Terminal size={14} className="details-icon" />
                  <code>{details || 'No data available'}</code>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <style dangerouslySetInnerHTML={{ __html: `
        .security-grid {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
          gap: 20px;
          margin-top: 24px;
        }
        .security-card {
          background: rgba(20, 20, 25, 0.6);
          border: 1px solid rgba(255, 255, 255, 0.05);
          border-radius: 12px;
          padding: 24px;
          transition: all 0.3s ease;
          display: flex;
          flex-direction: column;
          gap: 16px;
        }
        .security-card.active {
          border-color: rgba(40, 153, 18, 0.3);
          box-shadow: 0 0 20px rgba(40, 153, 18, 0.05);
        }
        .security-card.inactive {
          border-color: rgba(220, 38, 38, 0.3);
        }
        .card-top {
          display: flex;
          justify-content: space-between;
          align-items: center;
        }
        .layer-icon {
          width: 42px;
          height: 42px;
          border-radius: 10px;
          background: rgba(255, 255, 255, 0.03);
          display: flex;
          align-items: center;
          justify-content: center;
          color: #289912;
        }
        .status-badge {
          display: flex;
          align-items: center;
          gap: 6px;
          padding: 4px 10px;
          border-radius: 20px;
          font-size: 0.65rem;
          font-weight: 700;
          letter-spacing: 1px;
        }
        .status-badge.online {
          background: rgba(40, 153, 18, 0.15);
          color: #289912;
        }
        .status-badge.offline {
          background: rgba(220, 38, 38, 0.15);
          color: #ef4444;
        }
        .card-body h3 {
          margin: 0;
          font-size: 1rem;
          color: #fff;
        }
        .card-body .desc {
          font-size: 0.8rem;
          color: rgba(255, 255, 255, 0.5);
          margin: 6px 0 16px 0;
        }
        .details-box {
          background: rgba(0, 0, 0, 0.3);
          padding: 12px;
          border-radius: 8px;
          display: flex;
          gap: 10px;
          align-items: flex-start;
          border: 1px solid rgba(255, 255, 255, 0.03);
        }
        .details-icon {
          margin-top: 3px;
          color: rgba(255, 255, 255, 0.2);
        }
        .details-box code {
          font-family: 'JetBrains Mono', monospace;
          font-size: 0.7rem;
          color: rgba(255, 255, 255, 0.8);
          word-break: break-all;
          white-space: pre-wrap;
        }
        .btn-primary.loading {
          opacity: 0.7;
          cursor: wait;
        }
        .spin {
          animation: spin 1s linear infinite;
        }
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
      `}} />
    </div>
  );
}
