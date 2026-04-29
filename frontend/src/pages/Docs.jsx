import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Terminal, Shield, AlertTriangle, CheckCircle, HelpCircle, ArrowLeft, BookOpen, Server, Settings } from 'lucide-react';
import './Docs.css';

export default function Docs() {
  const navigate = useNavigate();
  const [activeSection, setActiveSection] = useState('overview');
  const [typedCommand, setTypedCommand] = useState('');
  const [showOutput, setShowOutput] = useState(false);

  const fullCommand = 'curl -sSL https://sparrowx.sbs/install.sh | bash';

  useEffect(() => {
    let i = 0;
    setTypedCommand('');
    setShowOutput(false);
    
    const interval = setInterval(() => {
      if (i < fullCommand.length) {
        setTypedCommand(prev => prev + fullCommand.charAt(i));
        i++;
      } else {
        clearInterval(interval);
        setTimeout(() => setShowOutput(true), 500);
      }
    }, 50);

    return () => clearInterval(interval);
  }, []);

  const scrollToSection = (id) => {
    setActiveSection(id);
    const element = document.getElementById(id);
    if (element) {
      element.scrollIntoView({ behavior: 'smooth' });
    }
  };

  return (
    <div className="docs-container">
      <div className="docs-glow"></div>
      <div className="docs-glow-bottom"></div>

      <nav className="docs-nav">
        <div className="docs-logo" onClick={() => navigate('/')}>
          <img src="/logo.png" alt="Sparrowx" />
          <span className="docs-logo-text">Sparrowx Docs</span>
        </div>
        <button className="docs-back-btn" onClick={() => navigate('/')}>
          <ArrowLeft size={18} style={{ marginRight: '8px', verticalAlign: 'middle' }} />
          Back to Home
        </button>
      </nav>

      <div className="docs-layout">
        <aside className="docs-sidebar">
          <h3>Documentation</h3>
          <ul>
            <li>
              <a 
                href="#overview" 
                className={activeSection === 'overview' ? 'active' : ''}
                onClick={(e) => { e.preventDefault(); scrollToSection('overview'); }}
              >
                <BookOpen size={16} style={{ marginRight: '8px', verticalAlign: 'middle' }} />
                Overview
              </a>
            </li>
            <li>
              <a 
                href="#installation" 
                className={activeSection === 'installation' ? 'active' : ''}
                onClick={(e) => { e.preventDefault(); scrollToSection('installation'); }}
              >
                <Server size={16} style={{ marginRight: '8px', verticalAlign: 'middle' }} />
                Installation
              </a>
            </li>
            <li>
              <a 
                href="#configuration" 
                className={activeSection === 'configuration' ? 'active' : ''}
                onClick={(e) => { e.preventDefault(); scrollToSection('configuration'); }}
              >
                <Settings size={16} style={{ marginRight: '8px', verticalAlign: 'middle' }} />
                Configuration
              </a>
            </li>
            <li>
              <a 
                href="#troubleshooting" 
                className={activeSection === 'troubleshooting' ? 'active' : ''}
                onClick={(e) => { e.preventDefault(); scrollToSection('troubleshooting'); }}
              >
                <AlertTriangle size={16} style={{ marginRight: '8px', verticalAlign: 'middle' }} />
                Troubleshooting
              </a>
            </li>
          </ul>
        </aside>

        <main className="docs-content">
          {/* Overview */}
          <section id="overview" className="docs-section">
            <h2><Shield /> Platform Overview</h2>
            <p>
              Sparrowx is an autonomous infrastructure security platform designed to protect your networks 
              with zero-trust architecture, real-time threat intelligence, and automated mitigation protocols.
            </p>
            <div className="info-grid">
              <div className="info-card">
                <h4><CheckCircle size={18} style={{ color: '#289912' }} /> Auto Defense</h4>
                <p>Instantly detects and blocks malicious traffic patterns across all nodes.</p>
              </div>
              <div className="info-card">
                <h4><CheckCircle size={18} style={{ color: '#289912' }} /> Smart Tunnels</h4>
                <p>Encrypted mesh networking powered by high-performance WireGuard.</p>
              </div>
            </div>
          </section>

          {/* Installation */}
          <section id="installation" className="docs-section">
            <h2><Terminal /> Quick Installation</h2>
            <p>Deploy the Sparrowx security agent onto your Linux server using our automated setup script.</p>
            
            <div className="terminal-window">
              <div className="terminal-header">
                <div className="terminal-dot red"></div>
                <div className="terminal-dot yellow"></div>
                <div className="terminal-dot green"></div>
                <span className="terminal-title">bash ~ sparrowx-installer</span>
              </div>
              <div className="terminal-body">
                <div>
                  <span className="terminal-prompt">root@sparrowx:~#</span>
                  <span>{typedCommand}</span>
                  {!showOutput && <span className="terminal-cursor"></span>}
                </div>
                {showOutput && (
                  <div style={{ marginTop: '1rem', color: '#718096', animation: 'fadeIn 0.5s ease' }}>
                    <div style={{ color: '#289912' }}>[✓] Downloading Sparrowx security bundle...</div>
                    <div style={{ color: '#289912' }}>[✓] Verifying payload integrity...</div>
                    <div style={{ color: '#289912' }}>[✓] Optimizing firewall kernel components...</div>
                    <div style={{ color: '#a0aec0', marginTop: '0.5rem' }}>Sparrowx Agent v1.4 deployed successfully.</div>
                  </div>
                )}
              </div>
            </div>
          </section>

          {/* Configuration */}
          <section id="configuration" className="docs-section">
            <h2><Settings /> Configuration</h2>
            <p>Manage your deployment by modifying the environment configuration located at <code>/opt/sbs-agent/.env</code>.</p>
            
            <div className="info-grid">
              <div className="info-card">
                <h4>SPARROWX_SERVER</h4>
                <p>The dashboard URL routing data streams (default: <code>https://sparrowx.sbs</code>).</p>
              </div>
              <div className="info-card">
                <h4>SPARROWX_API_KEY</h4>
                <p>Your secret client token generated in the portal settings.</p>
              </div>
            </div>
          </section>

          {/* Troubleshooting */}
          <section id="troubleshooting" className="docs-section">
            <h2><AlertTriangle /> Troubleshooting & Debugging</h2>
            <p>Common deployment errors and immediate resolution instructions.</p>

            <div className="trouble-item">
              <div className="trouble-header">Error: WireGuard Interface not found</div>
              <div className="trouble-fix">
                Run <code>sudo apt-get install wireguard</code> to guarantee essential kernel modules are available.
              </div>
            </div>

            <div className="trouble-item warning">
              <div className="trouble-header">Warning: Remote API Authorization Timeout</div>
              <div className="trouble-fix">
                Ensure your system clock syncs correctly using NTP: <code>timedatectl set-ntp true</code>.
              </div>
            </div>

            <div className="trouble-item">
              <div className="trouble-header">White Screen observed on Accessing Dashboard</div>
              <div className="trouble-fix">
                Trigger an internal rebuild pipeline via: <code>npm run frontend:build</code>.
              </div>
            </div>
          </section>
        </main>
      </div>
    </div>
  );
}
