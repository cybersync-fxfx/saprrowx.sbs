import { Shield, ExternalLink, Activity, Terminal, Lock } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import './Landing.css';

export default function Landing() {
  const navigate = useNavigate();

  return (
    <div className="landing-body">
      {/* Background glow effects without images */}
      <div className="bg-glow bg-glow-blue"></div>
      <div className="bg-glow bg-glow-cyan"></div>
      
      <main className="content-wrapper">
        <div className="brand-header">
          {/* Logo redirects to login */}
          <div onClick={() => navigate('/login')} style={{ display: 'inline-block', cursor: 'pointer' }}>
            <img src="/logo.png" alt="Sparrowx Logo" style={{ width: '72px', height: '72px', objectFit: 'contain' }} />
          </div>
          <h1 className="brand-title">Sparrowx Platform</h1>
          <p className="brand-subtitle">Next-Generation Infrastructure Security</p>
        </div>

        <div className="redirect-grid">
          {/* Client Portal redirects to login */}
          <div onClick={() => navigate('/login')} className="redirect-card primary-card">
            <div className="card-icon-wrapper">
              <Lock size={24} />
            </div>
            <div className="card-content">
              <h2>Client Portal</h2>
              <p>Access your centralized security dashboard</p>
            </div>
            <ExternalLink size={20} className="link-icon" />
          </div>

          <div onClick={() => navigate('/docs')} className="redirect-card pointer" style={{ cursor: 'pointer' }}>
            <div className="card-icon-wrapper">
              <Terminal size={24} />
            </div>
            <div className="card-content">
              <h2>Documentation</h2>
              <p>Integration guides and API references</p>
            </div>
            <ExternalLink size={20} className="link-icon" />
          </div>

          <div onClick={() => navigate('/dashboard')} className="redirect-card pointer" style={{ cursor: 'pointer' }}>
            <div className="card-icon-wrapper">
              <Activity size={24} />
            </div>
            <div className="card-content">
              <h2>System Status</h2>
              <p>View real-time network telemetry</p>
            </div>
            <ExternalLink size={20} className="link-icon" />
          </div>
        </div>
      </main>
    </div>
  );
}
