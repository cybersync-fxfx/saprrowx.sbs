import { useEffect, useState } from 'react';
import { NavLink, Outlet, useNavigate, useLocation } from 'react-router-dom';
import { Activity, Terminal, Shield, ListX, Download, Key, Settings, LogOut, RadioTower, ServerCog, Globe, Sparkles, ShoppingCart } from 'lucide-react';
import { useTelemetry } from '../context/TelemetryContext';
import NotificationCenter from './NotificationCenter';

const DiscordIcon = ({ size = 18 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
    <path d="M20.317 4.3698a19.7913 19.7913 0 00-4.8851-1.5152.0741.0741 0 00-.0785.0371c-.211.3753-.4447.8648-.6083 1.2495-1.8447-.2762-3.68-.2762-5.4868 0-.1636-.3933-.4058-.8742-.6177-1.2495a.077.077 0 00-.0785-.037 19.7363 19.7363 0 00-4.8852 1.515.0699.0699 0 00-.0321.0277C.5334 9.0458-.319 13.5799.0992 18.0578a.0824.0824 0 00.0312.0561c2.8528 2.0944 5.5947 3.37 8.2913 4.2031a.0766.0766 0 00.0839-.0279c.6437-.8786 1.2064-1.8155 1.6787-2.793a.0772.0772 0 00-.0422-.107c-.918-.348-1.789-.783-2.6103-1.2825a.077.077 0 01-.0075-.1278c.1741-.1312.3482-.2676.5134-.4077a.0762.0762 0 01.0795-.0108c5.4085 2.4758 11.2646 2.4758 16.6021 0a.0765.0765 0 01.0805.0104c.1652.1405.3393.2766.5144.4077a.077.077 0 01-.0063.1278c-.8136.495-1.6853.93-2.6033 1.2753a.0773.0773 0 00-.0415.1077c.4735.9729 1.0375 1.9052 1.6811 2.784a.077.077 0 00.0837.0284c2.704-.8284 5.4463-2.1087 8.3033-4.2081a.077.077 0 00.0313-.0552c.5004-5.177-.8382-9.6739-3.5485-13.6604a.061.061 0 00-.0312-.0286zM8.02 15.3312c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9555-2.4189 2.157-2.4189 1.2108 0 2.1757 1.095 2.1568 2.419 0 1.3332-.9555 2.419-2.1569 2.419zm7.9748 0c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9554-2.4189 2.1569-2.4189 1.2108 0 2.1757 1.095 2.1568 2.419 0 1.3332-.946 2.419-2.1568 2.419z" />
  </svg>
);

export default function Layout({ user, setToken }) {
  const navigate = useNavigate();
  const location = useLocation();
  const [time, setTime] = useState(new Date().toLocaleTimeString());

  useEffect(() => {
    const timer = setInterval(() => setTime(new Date().toLocaleTimeString()), 1000);
    return () => clearInterval(timer);
  }, []);

  const handleLogout = () => {
    setToken(null);
    localStorage.removeItem('sparrowx_token');
    localStorage.removeItem('sbs_token');
    navigate('/');
  };

  const navItems = [
    { section: 'Monitor' },
    { path: '/', name: 'Dashboard', icon: <Activity size={18} />, caption: 'Live telemetry and connection health' },
    { path: '/terminal', name: 'Terminal', icon: <Terminal size={18} />, caption: 'Run remote commands through the agent' },
    { path: '/plans', name: 'Marketplace', icon: <ShoppingCart size={18} />, caption: 'Deploy new infrastructure and server plans' },
    { section: 'Security' },
    { path: '/firewall', name: 'Firewall', icon: <Shield size={18} />, caption: 'Inspect active firewall rules and service state' },
    { path: '/blocklist', name: 'Block List', icon: <ListX size={18} />, caption: 'Ban, review, and remove blocked IPs' },
    { path: '/radar', name: 'Threat Radar', icon: <RadioTower size={18} />, caption: 'Live IP scoring and automated defense' },
    { path: '/map', name: 'Global Threat Map', icon: <Globe size={18} />, caption: 'Live geographic visualization' },
    { path: '/security', name: 'Infra Status', icon: <ServerCog size={18} />, caption: 'Check status of XDP, HAProxy, and defense layers' },
    { section: 'Setup' },
    { path: '/install', name: 'Install Agent', icon: <Download size={18} />, caption: 'Generate the installer and deploy to a server' },
    { path: '/apikeys', name: 'API & Keys', icon: <Key size={18} />, caption: 'Manage agent credentials and API access' },
    { path: '/settings', name: 'Settings', icon: <Settings size={18} />, caption: 'Account details and network controls' },
    { section: 'Support' },
    { path: 'https://discord.gg/u3cQ3zwMgC', name: 'Discord', icon: <DiscordIcon size={18} />, caption: 'Join our community for support and updates', isExternal: true },
  ];

  const { isConnected, agentStatus, wsState, viewMode, setViewMode } = useTelemetry();

  return (
    <div className="app-layout">
      <header className="topbar">
        <div className="brand-lockup">
          <img src="/logo.png" alt="SBS Logo" className="brand-logo" />
        </div>

        <div className="topbar-meta">
          {user?.role === 'admin' && (
            <div className="view-switcher">
              <button 
                className={`view-button ${viewMode === 'global' ? 'active' : ''}`}
                onClick={() => setViewMode('global')}
                title="Global Guard Infrastructure View"
              >
                <Globe size={14} />
                <span>GUARD</span>
              </button>
              <button 
                className={`view-button ${viewMode === 'agent' ? 'active' : ''}`}
                onClick={() => setViewMode('agent')}
                title="Local VPS Agent View"
              >
                <ServerCog size={14} />
                <span>LOCAL</span>
              </button>
            </div>
          )}

          <div className={`status-pill ${isConnected || user?.role === 'admin' ? 'connected' : 'disconnected'}`}>
            <RadioTower size={14} />
            {user?.role === 'admin' ? (viewMode === 'global' ? 'GUARD ONLINE' : 'LOCAL MONITORING') : (agentStatus === 'CONNECTED' ? 'CONNECTED' : 'NO AGENT')}
          </div>
          <div className="meta-chip">WS {wsState}</div>
          <div className="topbar-time">{time}</div>
          <div className="user-chip">@{user?.username} {user?.role === 'admin' && '(ADMIN)'}</div>
          
          <a 
            href="https://discord.gg/u3cQ3zwMgC" 
            target="_blank" 
            rel="noopener noreferrer"
            className="icon-button secondary-button"
            title="Join Discord"
            style={{ color: '#fff' }}
          >
            <DiscordIcon size={16} />
          </a>

          <button className="icon-button danger-outline" onClick={handleLogout} aria-label="Log out">
            <LogOut size={16} />
          </button>
        </div>
      </header>

      <div className="main-area">
        <aside className="sidebar">
          <div className="sidebar-card">
            <div className="sidebar-card-header">
              <ServerCog size={16} />
              <span>{viewMode === 'global' ? 'Guard Infrastructure' : 'Linked Agent'}</span>
            </div>
            <div className="sidebar-card-value">
              {viewMode === 'global' ? 'Primary Guard Node' : (user?.agentId || 'Not assigned')}
            </div>
            <div className="sidebar-card-meta">
              {viewMode === 'global' 
                ? 'Monitoring all traffic scrubbing nodes.' 
                : (isConnected ? 'Agent is streaming telemetry live.' : 'Download a fresh installer to attach a server.')
              }
            </div>
          </div>

          <nav className="sidebar-nav">
            {navItems.map((item, idx) => {
              if (item.section) {
                return <div key={idx} className="sidebar-section">{item.section}</div>;
              }

              // Hide admin-only items
              if (item.path === '/security' && user?.role !== 'admin') {
                return null;
              }

              const isActive = location.pathname === item.path;

              if (item.isExternal) {
                return (
                  <a
                    key={idx}
                    href={item.path}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="nav-link"
                  >
                    <div className="nav-link-icon">{item.icon}</div>
                    <div>
                      <div className="nav-link-title">{item.name}</div>
                      <div className="nav-link-caption">{item.caption}</div>
                    </div>
                  </a>
                );
              }

              return (
                <NavLink
                  key={idx}
                  to={item.path}
                  className={`nav-link ${isActive ? 'active' : ''}`}
                >
                  <div className="nav-link-icon">{item.icon}</div>
                  <div>
                    <div className="nav-link-title">{item.name}</div>
                    <div className="nav-link-caption">
                      {(() => {
                        const cap = item.caption || '';
                        return viewMode === 'global' 
                          ? cap.replace(/your server|the agent/gi, 'global infrastructure') 
                          : cap;
                      })()}
                    </div>
                  </div>
                </NavLink>
              );
            })}
          </nav>
        </aside>

        <main className="content-area">
          <Outlet />
        </main>
      </div>
      <NotificationCenter />
    </div>
  );
}
