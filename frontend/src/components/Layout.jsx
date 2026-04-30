import { useEffect, useState } from 'react';
import { NavLink, Outlet, useNavigate, useLocation } from 'react-router-dom';
import { Activity, Terminal, Shield, ListX, Download, Key, Settings, LogOut, RadioTower, ServerCog, Globe, Sparkles } from 'lucide-react';
import { useTelemetry } from '../context/TelemetryContext';

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
  ];

  const { isConnected, agentStatus, wsState } = useTelemetry();

  return (
    <div className="app-layout">
      <header className="topbar">
        <div className="brand-lockup">
          <img src="/logo.png" alt="SBS Logo" className="brand-logo" />
        </div>

        <div className="topbar-meta">
          <div className={`status-pill ${isConnected ? 'connected' : 'disconnected'}`}>
            <RadioTower size={14} />
            {agentStatus === 'CONNECTED' ? 'CONNECTED' : 'NO AGENT'}
          </div>
          <div className="meta-chip">WS {wsState}</div>
          <div className="topbar-time">{time}</div>
          <div className="user-chip">@{user?.username}</div>
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
              <span>Linked Agent</span>
            </div>
            <div className="sidebar-card-value">{user?.agentId || 'Not assigned'}</div>
            <div className="sidebar-card-meta">{isConnected ? 'Agent is streaming telemetry live.' : 'Download a fresh installer to attach a server.'}</div>
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

              return (
                <NavLink
                  key={idx}
                  to={item.path}
                  className={`nav-link ${isActive ? 'active' : ''}`}
                >
                  <div className="nav-link-icon">{item.icon}</div>
                  <div>
                    <div className="nav-link-title">{item.name}</div>
                    <div className="nav-link-caption">{item.caption}</div>
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
    </div>
  );
}
