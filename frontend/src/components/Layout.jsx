import { useEffect, useState } from 'react';
import { NavLink, Outlet, useNavigate, useLocation } from 'react-router-dom';
import { Activity, Terminal, Shield, ListX, Download, Key, Settings, LogOut, RadioTower, ServerCog, Globe, Sparkles } from 'lucide-react';
import { useTelemetry } from '../context/TelemetryContext';
import NotificationCenter from './NotificationCenter';

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
              <span>{user?.role === 'admin' ? 'Guard Infrastructure' : 'Linked Agent'}</span>
            </div>
            <div className="sidebar-card-value">{user?.role === 'admin' ? 'Global Node' : (user?.agentId || 'Not assigned')}</div>
            <div className="sidebar-card-meta">{user?.role === 'admin' ? 'Monitoring all traffic scrubbing nodes.' : (isConnected ? 'Agent is streaming telemetry live.' : 'Download a fresh installer to attach a server.')}</div>
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
      <NotificationCenter />
    </div>
  );
}
