import { useState, useEffect, useCallback } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { TelemetryProvider } from './context/TelemetryContext';
import Landing  from './pages/Landing';
import Auth     from './pages/Auth';
import Docs     from './pages/Docs';
import Layout   from './components/Layout';
import Dashboard from './pages/Dashboard';
import Terminal  from './pages/Terminal';
import Firewall  from './pages/Firewall';
import Blocklist from './pages/Blocklist';
import Install   from './pages/Install';
import ApiKeys   from './pages/ApiKeys';
import Settings  from './pages/Settings';
import ThreatRadar from './pages/ThreatRadar';
import ThreatMap   from './pages/ThreatMap';
import Security    from './pages/Security';

function App() {
  const [token,   setToken]   = useState(localStorage.getItem('sparrowx_token') || localStorage.getItem('sbs_token'));
  const [user,    setUser]    = useState(null);
  const [loading, setLoading] = useState(true);

  // -- Fetch /api/me ---------------------------------------------------------
  const fetchMe = useCallback((tk) => {
    fetch('/api/me', { headers: { Authorization: `Bearer ${tk}` } })
      .then(res => {
        if (res.ok) return res.json();
        throw new Error('session expired');
      })
      .then(data => setUser(data))
      .catch(() => {
        localStorage.removeItem('sparrowx_token');
        localStorage.removeItem('sbs_token');
        setToken(null);
        setUser(null);
      });
  }, []);

  // Initial load
  useEffect(() => {
    if (token) {
      fetch('/api/me', { headers: { Authorization: `Bearer ${token}` } })
        .then(res => {
          if (res.ok) return res.json();
          throw new Error('session expired');
        })
        .then(data => { setUser(data); setLoading(false); })
        .catch(() => {
          localStorage.removeItem('sparrowx_token');
          localStorage.removeItem('sbs_token');
          setToken(null);
          setLoading(false);
        });
    } else {
      setLoading(false);
    }
  }, [token]);

  // Poll /api/me every 10s to keep user fresh
  useEffect(() => {
    if (!token || !user) return;
    const id = setInterval(() => fetchMe(token), 10000);
    return () => clearInterval(id);
  }, [token, user?.id, fetchMe]);

  const handleSetToken = (t) => {
    setToken(t);
    localStorage.setItem('sparrowx_token', t);
    localStorage.removeItem('sbs_token');
  };

  if (loading) {
    return (
      <div style={{
        display: 'flex', flexDirection: 'column',
        height: '100vh', justifyContent: 'center', alignItems: 'center',
        background: '#030305', color: '#289912',
        fontFamily: "'JetBrains Mono', monospace", gap: '16px'
      }}>
        <div style={{
          width: '40px', height: '40px',
          border: '2px solid rgba(40,153,18,0.22)',
          borderTop: '2px solid #289912',
          borderRadius: '50%',
          animation: 'spin 0.8s linear infinite'
        }} />
        <span style={{ fontSize: '0.8rem', letterSpacing: '3px', textTransform: 'uppercase' }}>
          Authenticating...
        </span>
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    );
  }

  return (
    <BrowserRouter>
      <Routes>
        <Route path="/docs" element={<Docs />} />
        {!token ? (
          <>
            <Route path="/"      element={<Landing />} />
            <Route path="/login" element={<Auth setToken={handleSetToken} />} />
            <Route path="*"      element={<Navigate to="/" />} />
          </>
        ) : (
          <Route element={
            <TelemetryProvider token={token}>
              <Layout user={user} setToken={setToken} />
            </TelemetryProvider>
          }>
            <Route path="/"          element={<Dashboard token={token} />} />
            <Route path="/terminal"  element={<Terminal  token={token} user={user} />} />
            <Route path="/firewall"  element={<Firewall  token={token} user={user} />} />
            <Route path="/blocklist" element={<Blocklist token={token} user={user} />} />
            <Route path="/install"   element={<Install   token={token} user={user} />} />
            <Route path="/apikeys"   element={<ApiKeys   token={token} user={user} setUser={setUser} />} />
            <Route path="/settings"  element={<Settings  token={token} user={user} />} />
            <Route path="/radar"     element={<ThreatRadar token={token} />} />
            <Route path="/map"       element={<ThreatMap token={token} />} />
            <Route path="/security"  element={<Security  token={token} />} />
            <Route path="*"          element={<Navigate to="/" />} />
          </Route>
        )}
      </Routes>
    </BrowserRouter>
  );
}

export default App;
