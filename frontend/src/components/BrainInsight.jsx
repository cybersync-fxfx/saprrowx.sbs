import { useState, useEffect } from 'react';
import { Sparkles, Brain, Target, Clock, ShieldCheck, Zap, AlertTriangle } from 'lucide-react';
import { useTelemetry } from '../context/TelemetryContext';

export default function BrainInsight({ token }) {
  const { viewMode } = useTelemetry();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  const fetchInsight = async () => {
    try {
      const res = await fetch(`/api/internal/brain-insight?scope=${viewMode}`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (res.ok) {
        const json = await res.json();
        setData(json);
      }
    } catch (err) {
      console.error('Failed to fetch brain insight:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchInsight();
    const id = setInterval(fetchInsight, 300000); // 5 mins
    return () => clearInterval(id);
  }, [viewMode]);

  if (loading || !data || !data.memory.lastAnalyzed) {
    return (
      <div className="brain-empty">
        <Brain size={20} className="brain-icon" />
        <span>Waiting for Brain analysis cycle... Run 'analyze' in sparrow brain to start.</span>
      </div>
    );
  }

  const mem = data.memory;
  const thresholds = mem.learnedThresholds;

  return (
    <div className="brain-insight-container">
      <div className="brain-header">
        <div className="title-lockup">
          <Sparkles size={18} className="sparkle-icon" />
          <h3>Local Intelligence — Sparrow Brain</h3>
        </div>
        <div className="last-sync">Last learned: {new Date(mem.lastAnalyzed).toLocaleString()}</div>
      </div>

      <div className="brain-grid">
        <div className="brain-stat-card">
          <div className="stat-label"><Target size={14} /> Known Attackers</div>
          <div className="stat-value">{mem.knownAttackersCount}</div>
          <div className="stat-sub">From {mem.totalEvents} analyzed events</div>
        </div>
        <div className="brain-stat-card">
          <div className="stat-label"><Zap size={14} /> Learned Threshold</div>
          <div className="stat-value">{thresholds?.threshold || 90}</div>
          <div className="stat-sub">Optimized for your traffic</div>
        </div>
        <div className="brain-stat-card">
          <div className="stat-label"><Clock size={14} /> Peak Attack Hour</div>
          <div className="stat-value">{Object.entries(mem.peakHours).sort((a,b)=>b[1]-a[1])[0]?.[0] || '--'}:00</div>
          <div className="stat-sub">Busiest threat window</div>
        </div>
      </div>

      <div className="brain-analysis-row">
        <div className="analysis-box">
          <h4>Top Repeat Offenders</h4>
          <div className="mini-list">
            {mem.topAttackers.map(att => (
              <div key={att.ip} className="mini-item">
                <span className="ip">{att.ip}</span>
                <span className="hits">{att.hitCount} hits</span>
              </div>
            ))}
            {mem.topAttackers.length === 0 && <div className="dim">No repeat offenders yet.</div>}
          </div>
        </div>

        <div className="analysis-box">
          <h4>Recommended Tuning</h4>
          <div className="tuning-grid">
            <div className="tune-item">
              <span>SYN Ban</span>
              <strong>{thresholds?.synBan || 90}</strong>
            </div>
            <div className="tune-item">
              <span>UDP Ban</span>
              <strong>{thresholds?.udpBan || 360}</strong>
            </div>
            <div className="tune-item">
              <span>Port Scan</span>
              <strong>{thresholds?.portFanoutBan || 12}</strong>
            </div>
          </div>
          <div className="tuning-note">
            <ShieldCheck size={12} />
            <span>These were calculated from your specific attack patterns.</span>
          </div>
        </div>
      </div>

      <style dangerouslySetInnerHTML={{ __html: `
        .brain-insight-container {
          background: linear-gradient(135deg, rgba(40, 153, 18, 0.05) 0%, rgba(34, 211, 238, 0.05) 100%);
          border: 1px solid rgba(40, 153, 18, 0.15);
          border-radius: 12px;
          padding: 24px;
          margin-top: 24px;
        }
        .brain-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 20px;
        }
        .title-lockup {
          display: flex;
          align-items: center;
          gap: 10px;
        }
        .title-lockup h3 {
          margin: 0;
          font-size: 1.1rem;
          color: #fff;
          font-weight: 600;
        }
        .sparkle-icon {
          color: #289912;
        }
        .last-sync {
          font-size: 0.7rem;
          color: rgba(255, 255, 255, 0.4);
          font-family: 'JetBrains Mono', monospace;
        }
        .brain-grid {
          display: grid;
          grid-template-columns: repeat(3, 1fr);
          gap: 16px;
          margin-bottom: 24px;
        }
        .brain-stat-card {
          background: rgba(0, 0, 0, 0.2);
          padding: 16px;
          border-radius: 10px;
          border: 1px solid rgba(255, 255, 255, 0.03);
        }
        .stat-label {
          font-size: 0.7rem;
          color: rgba(255, 255, 255, 0.5);
          display: flex;
          align-items: center;
          gap: 6px;
          margin-bottom: 8px;
          text-transform: uppercase;
          letter-spacing: 0.5px;
        }
        .stat-value {
          font-size: 1.8rem;
          font-weight: 700;
          color: #289912;
          font-family: 'JetBrains Mono', monospace;
        }
        .stat-sub {
          font-size: 0.65rem;
          color: rgba(255, 255, 255, 0.3);
          margin-top: 4px;
        }
        .brain-analysis-row {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 24px;
        }
        .analysis-box h4 {
          margin: 0 0 12px 0;
          font-size: 0.8rem;
          color: rgba(255, 255, 255, 0.7);
          text-transform: uppercase;
          letter-spacing: 1px;
        }
        .mini-list {
          display: flex;
          flex-direction: column;
          gap: 8px;
        }
        .mini-item {
          display: flex;
          justify-content: space-between;
          padding: 8px 12px;
          background: rgba(255, 255, 255, 0.03);
          border-radius: 6px;
          font-size: 0.8rem;
          font-family: 'JetBrains Mono', monospace;
        }
        .mini-item .ip { color: #fff; }
        .mini-item .hits { color: #ef4444; }
        .tuning-grid {
          display: grid;
          grid-template-columns: repeat(3, 1fr);
          gap: 10px;
          margin-bottom: 16px;
        }
        .tune-item {
          background: rgba(255, 255, 255, 0.03);
          padding: 10px;
          border-radius: 6px;
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 4px;
        }
        .tune-item span { font-size: 0.6rem; color: rgba(255, 255, 255, 0.5); text-transform: uppercase; }
        .tune-item strong { color: #22d3ee; font-family: 'JetBrains Mono', monospace; font-size: 1rem; }
        .tuning-note {
          display: flex;
          align-items: center;
          gap: 8px;
          font-size: 0.7rem;
          color: rgba(40, 153, 18, 0.6);
          font-style: italic;
        }
        .brain-empty {
          padding: 40px;
          text-align: center;
          background: rgba(0,0,0,0.2);
          border-radius: 12px;
          border: 1px dashed rgba(255,255,255,0.1);
          color: rgba(255,255,255,0.4);
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 12px;
          font-size: 0.85rem;
        }
        .brain-icon { color: rgba(255,255,255,0.2); }
      `}} />
    </div>
  );
}
