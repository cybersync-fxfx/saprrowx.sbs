import { useState, useEffect } from 'react';
import { LogIn, UserPlus, Shield, Terminal, Activity, Lock, Server, Zap, Globe, Cpu } from 'lucide-react';

export default function Auth({ setToken }) {
  const [tab, setTab] = useState('login');
  const [user, setUser] = useState('');
  const [pass, setPass] = useState('');
  const [email, setEmail] = useState('');
  const [error, setError] = useState('');
  const [msg, setMsg] = useState('');
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const handleScroll = () => setScrolled(window.scrollY > 50);
    window.addEventListener('scroll', handleScroll);
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setMsg('');
    
    const url = tab === 'login' ? '/api/auth/login' : '/api/auth/register';
    const payload = tab === 'login' 
      ? { username: user, password: pass }
      : { username: user, email, password: pass };
      
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const data = await res.json();
      
      if (res.ok) {
        if (tab === 'login') {
          setToken(data.token);
        } else {
          setMsg('Registration successful! Please wait for admin approval.');
          setTab('login');
          setPass('');
        }
      } else {
        if (data.isPending) {
          setError('Your account is still pending approval by an administrator.');
        } else {
          setError(data.error || 'Authentication failed');
        }
      }
    } catch (err) {
      setError('Network error');
    }
  };

  const scrollToAuth = () => {
    document.getElementById('auth-section').scrollIntoView({ behavior: 'smooth' });
  };

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg-dark)', color: 'var(--text-main)', fontFamily: 'var(--font-body)', overflowX: 'hidden' }}>
      {/* Dynamic Background Effects */}
      <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, zIndex: 0, pointerEvents: 'none' }}>
        <div style={{ position: 'absolute', top: '-20%', left: '-10%', width: '50%', height: '50%', background: 'radial-gradient(circle, rgba(225, 29, 46, 0.045) 0%, transparent 70%)', filter: 'blur(60px)' }}></div>
        <div style={{ position: 'absolute', bottom: '-20%', right: '-10%', width: '50%', height: '50%', background: 'radial-gradient(circle, rgba(40, 153, 18, 0.08) 0%, transparent 70%)', filter: 'blur(60px)' }}></div>
      </div>

      {/* Navbar */}
      <nav style={{ 
        position: 'fixed', top: 0, width: '100%', zIndex: 50, 
        padding: scrolled ? '15px 40px' : '25px 40px', 
        background: scrolled ? 'rgba(3, 5, 8, 0.85)' : 'transparent',
        backdropFilter: scrolled ? 'blur(20px)' : 'none',
        borderBottom: scrolled ? '1px solid rgba(255, 255, 255, 0.05)' : '1px solid transparent',
        transition: 'all 0.3s ease',
        display: 'flex', justifyContent: 'space-between', alignItems: 'center'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '15px' }}>
          <img src="/logo.png" alt="Sparrowx" style={{ width: '36px', height: '36px', objectFit: 'contain' }} />
          <span style={{ fontFamily: 'var(--font-display)', fontSize: '1.5rem', fontWeight: '800', letterSpacing: '-0.5px' }}>
            Sparrowx <span style={{ color: 'var(--text-muted)', fontWeight: '400' }}>Platform</span>
          </span>
        </div>
        <div style={{ display: 'flex', gap: '30px', alignItems: 'center' }}>
          <a href="#services" style={{ color: 'var(--text-muted)', textDecoration: 'none', fontSize: '0.95rem', fontWeight: '500', transition: 'color 0.2s' }} onMouseOver={e => e.target.style.color='white'} onMouseOut={e => e.target.style.color='var(--text-muted)'}>Services</a>
          <a href="#architecture" style={{ color: 'var(--text-muted)', textDecoration: 'none', fontSize: '0.95rem', fontWeight: '500', transition: 'color 0.2s' }} onMouseOver={e => e.target.style.color='white'} onMouseOut={e => e.target.style.color='var(--text-muted)'}>Architecture</a>
          <button onClick={scrollToAuth} style={{ padding: '10px 24px', borderRadius: '8px', fontSize: '0.9rem' }}>
            Client Portal
          </button>
        </div>
      </nav>

      <main style={{ position: 'relative', zIndex: 10, paddingTop: '120px' }}>
        
        {/* Hero Section */}
        <section style={{ padding: '80px 40px', maxWidth: '1400px', margin: '0 auto', display: 'flex', alignItems: 'center', minHeight: '80vh', gap: '60px', flexWrap: 'wrap' }}>
          <div style={{ flex: '1 1 500px' }}>
            <div style={{ display: 'inline-block', padding: '6px 16px', background: 'rgba(40, 153, 18, 0.12)', border: '1px solid rgba(40, 153, 18, 0.24)', borderRadius: '20px', color: 'var(--accent-cyan)', fontSize: '0.85rem', fontWeight: '700', letterSpacing: '1px', marginBottom: '24px', textTransform: 'uppercase' }}>
              Next-Gen Infrastructure Security
            </div>
            <h1 style={{ fontSize: 'clamp(3rem, 5vw, 4.5rem)', lineHeight: '1.1', marginBottom: '24px', textShadow: '0 10px 30px rgba(0,0,0,0.5)' }}>
              Defend Your Network with <span className="glow-text">Autonomous AI</span>
            </h1>
            <p style={{ fontSize: '1.2rem', color: 'var(--text-muted)', lineHeight: '1.6', marginBottom: '40px', maxWidth: '600px' }}>
              Deploy lightweight security agents across your Linux fleet. Monitor traffic, enforce automated rate limits, and neutralize DDoS attacks in real-time without breaking a sweat.
            </p>
            <div style={{ display: 'flex', gap: '20px' }}>
              <button onClick={scrollToAuth} style={{ padding: '16px 32px', fontSize: '1.1rem' }}>Get Started</button>
              <button className="secondary-button" onClick={() => document.getElementById('services').scrollIntoView({ behavior: 'smooth' })} style={{ padding: '16px 32px', fontSize: '1.1rem', borderRadius: '12px' }}>Explore Features</button>
            </div>
          </div>

          {/* Hero Auth Card */}
          <div id="auth-section" style={{ flex: '1 1 400px', display: 'flex', justifyContent: 'center' }}>
            <div className="glass-panel" style={{ width: '100%', maxWidth: '450px', padding: '40px' }}>
              <div style={{ display: 'flex', borderBottom: '1px solid var(--panel-border)', marginBottom: '30px' }}>
                <button 
                  style={{ flex: 1, background: 'none', border: 'none', color: tab === 'login' ? 'var(--accent-cyan)' : 'var(--text-muted)', borderBottom: tab === 'login' ? '2px solid var(--accent-cyan)' : '2px solid transparent', borderRadius: 0, boxShadow: 'none' }}
                  onClick={() => { setTab('login'); setError(''); setMsg(''); }}
                >
                  <LogIn size={18} style={{ marginRight: '8px', verticalAlign: 'middle' }}/> SIGN IN
                </button>
                <button 
                  style={{ flex: 1, background: 'none', border: 'none', color: tab === 'register' ? 'var(--accent-cyan)' : 'var(--text-muted)', borderBottom: tab === 'register' ? '2px solid var(--accent-cyan)' : '2px solid transparent', borderRadius: 0, boxShadow: 'none' }}
                  onClick={() => { setTab('register'); setError(''); setMsg(''); }}
                >
                  <UserPlus size={18} style={{ marginRight: '8px', verticalAlign: 'middle' }}/> REGISTER
                </button>
              </div>

              <h2 style={{ marginBottom: '25px', textAlign: 'center', color: 'var(--text-main)', fontSize: '1.5rem' }}>
                {tab === 'login' ? 'Secure Portal Access' : 'Request Infrastructure Access'}
              </h2>

              {error && <div style={{ color: 'var(--danger-red)', background: 'rgba(225, 29, 46, 0.12)', padding: '12px', borderRadius: '8px', marginBottom: '20px', fontSize: '0.9rem', border: '1px solid var(--danger-red)', display: 'flex', alignItems: 'center', gap: '10px' }}><Shield size={18}/> {error}</div>}
              {msg && <div style={{ color: 'var(--success-green)', background: 'rgba(40, 153, 18, 0.12)', padding: '12px', borderRadius: '8px', marginBottom: '20px', fontSize: '0.9rem', border: '1px solid var(--success-green)' }}>{msg}</div>}

              <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
                <div>
                  <label style={{ display: 'block', fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: '8px', fontWeight: 'bold', letterSpacing: '1px' }}>{tab === 'login' ? 'EMAIL OR USERNAME' : 'USERNAME'}</label>
                  <input type="text" required value={user} onChange={(e) => setUser(e.target.value)} style={{ padding: '14px 16px' }} />
                </div>
                
                {tab === 'register' && (
                  <div>
                    <label style={{ display: 'block', fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: '8px', fontWeight: 'bold', letterSpacing: '1px' }}>EMAIL ADDRESS</label>
                    <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} style={{ padding: '14px 16px' }} />
                  </div>
                )}

                <div>
                  <label style={{ display: 'block', fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: '8px', fontWeight: 'bold', letterSpacing: '1px' }}>PASSWORD</label>
                  <input type="password" required value={pass} onChange={(e) => setPass(e.target.value)} style={{ padding: '14px 16px' }} />
                </div>

                <button type="submit" style={{ marginTop: '15px', padding: '14px', fontSize: '1rem', letterSpacing: '1px', width: '100%' }}>
                  {tab === 'login' ? 'AUTHORIZE SESSION' : 'SUBMIT REQUEST'}
                </button>
              </form>
            </div>
          </div>
        </section>

        {/* Services Section */}
        <section id="services" style={{ padding: '100px 40px', background: 'rgba(5, 7, 12, 0.5)', borderTop: '1px solid rgba(255, 255, 255, 0.05)', borderBottom: '1px solid rgba(255, 255, 255, 0.05)' }}>
          <div style={{ maxWidth: '1400px', margin: '0 auto' }}>
            <div style={{ textAlign: 'center', marginBottom: '80px' }}>
              <h2 style={{ fontSize: '3rem', marginBottom: '20px' }}>Comprehensive <span className="text-cyan">Protection</span></h2>
              <p style={{ color: 'var(--text-muted)', fontSize: '1.2rem', maxWidth: '700px', margin: '0 auto' }}>
                Sparrowx delivers enterprise-grade tools to secure your Linux environments from malicious traffic and unauthorized access.
              </p>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '30px' }}>
              {/* Feature 1 */}
              <div className="glass-panel" style={{ padding: '40px', transition: 'transform 0.3s ease, box-shadow 0.3s ease', cursor: 'default' }} onMouseOver={e => e.currentTarget.style.transform = 'translateY(-10px)'} onMouseOut={e => e.currentTarget.style.transform = 'translateY(0)'}>
                <div style={{ background: 'rgba(40, 153, 18, 0.12)', width: '60px', height: '60px', borderRadius: '15px', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: '25px', color: 'var(--accent-cyan)' }}>
                  <Zap size={30} />
                </div>
                <h3 style={{ fontSize: '1.4rem', marginBottom: '15px' }}>Instant Mitigation</h3>
                <p style={{ color: 'var(--text-muted)', lineHeight: '1.6' }}>
                  Detects network anomalies instantly. Automatically blocks malicious IPs before they impact your services - all within milliseconds.
                </p>
              </div>

              {/* Feature 2 */}
              <div className="glass-panel" style={{ padding: '40px', transition: 'transform 0.3s ease, box-shadow 0.3s ease', cursor: 'default' }} onMouseOver={e => e.currentTarget.style.transform = 'translateY(-10px)'} onMouseOut={e => e.currentTarget.style.transform = 'translateY(0)'}>
                <div style={{ background: 'rgba(40, 153, 18, 0.12)', width: '60px', height: '60px', borderRadius: '15px', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: '25px', color: 'var(--accent-cyan)' }}>
                  <Activity size={30} />
                </div>
                <h3 style={{ fontSize: '1.4rem', marginBottom: '15px' }}>Real-Time Telemetry</h3>
                <p style={{ color: 'var(--text-muted)', lineHeight: '1.6' }}>
                  Monitor live traffic rates, active connections, and system resource usage directly from your browser with sub-second updates.
                </p>
              </div>

              {/* Feature 3 */}
              <div className="glass-panel" style={{ padding: '40px', transition: 'transform 0.3s ease, box-shadow 0.3s ease', cursor: 'default' }} onMouseOver={e => e.currentTarget.style.transform = 'translateY(-10px)'} onMouseOut={e => e.currentTarget.style.transform = 'translateY(0)'}>
                <div style={{ background: 'rgba(40, 153, 18, 0.1)', width: '60px', height: '60px', borderRadius: '15px', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: '25px', color: 'var(--accent-cyan)' }}>
                  <Terminal size={30} />
                </div>
                <h3 style={{ fontSize: '1.4rem', marginBottom: '15px' }}>Remote Execution</h3>
                <p style={{ color: 'var(--text-muted)', lineHeight: '1.6' }}>
                  Securely interact with your server's command line through our authenticated web terminal. No direct SSH access required.
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* Architecture Section */}
        <section id="architecture" style={{ padding: '100px 40px', position: 'relative' }}>
          <div style={{ position: 'absolute', right: 0, top: '20%', width: '40%', height: '60%', background: 'radial-gradient(circle, rgba(255, 51, 102, 0.05) 0%, transparent 60%)', filter: 'blur(50px)', zIndex: -1 }}></div>
          
          <div style={{ maxWidth: '1400px', margin: '0 auto', display: 'flex', gap: '80px', flexWrap: 'wrap', alignItems: 'center' }}>
            <div style={{ flex: '1 1 500px' }}>
              <h2 style={{ fontSize: '2.5rem', marginBottom: '30px' }}>Robust <span className="text-red">Architecture</span></h2>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '30px' }}>
                <div style={{ display: 'flex', gap: '20px', alignItems: 'flex-start' }}>
                  <div style={{ padding: '15px', background: 'rgba(255, 255, 255, 0.03)', borderRadius: '12px', border: '1px solid rgba(255,255,255,0.08)' }}>
                    <Server size={24} color="var(--text-main)" />
                  </div>
                  <div>
                    <h4 style={{ fontSize: '1.2rem', marginBottom: '10px' }}>The Sparrowx Agent</h4>
                    <p style={{ color: 'var(--text-muted)', lineHeight: '1.6' }}>A lightweight protection agent installed on your server, filtering malicious traffic in real time with near-zero overhead.</p>
                  </div>
                </div>

                <div style={{ display: 'flex', gap: '20px', alignItems: 'flex-start' }}>
                  <div style={{ padding: '15px', background: 'rgba(255, 255, 255, 0.03)', borderRadius: '12px', border: '1px solid rgba(255,255,255,0.08)' }}>
                    <Globe size={24} color="var(--text-main)" />
                  </div>
                  <div>
                    <h4 style={{ fontSize: '1.2rem', marginBottom: '10px' }}>Centralized Dashboard</h4>
                    <p style={{ color: 'var(--text-muted)', lineHeight: '1.6' }}>Manage multiple servers from a single pane of glass. Push firewall rules, manage whitelists, and view aggregated attack data effortlessly.</p>
                  </div>
                </div>

                <div style={{ display: 'flex', gap: '20px', alignItems: 'flex-start' }}>
                  <div style={{ padding: '15px', background: 'rgba(255, 255, 255, 0.03)', borderRadius: '12px', border: '1px solid rgba(255,255,255,0.08)' }}>
                    <Lock size={24} color="var(--text-main)" />
                  </div>
                  <div>
                    <h4 style={{ fontSize: '1.2rem', marginBottom: '10px' }}>Zero-Trust Auth</h4>
                    <p style={{ color: 'var(--text-muted)', lineHeight: '1.6' }}>All communication between the agent and dashboard is encrypted end-to-end. No open management ports are exposed to the public internet.</p>
                  </div>
                </div>
              </div>
            </div>

            <div style={{ flex: '1 1 500px' }}>
              <div className="glass-panel" style={{ padding: '30px', position: 'relative', overflow: 'hidden' }}>
                <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: '4px', background: 'linear-gradient(90deg, var(--accent-cyan), var(--danger-red))' }}></div>
                <h4 style={{ color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '2px', fontSize: '0.85rem', marginBottom: '20px' }}>Live System Telemetry Example</h4>
                
                <div style={{ display: 'flex', flexDirection: 'column', gap: '15px', fontFamily: 'var(--font-mono)' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', padding: '15px', background: 'rgba(0,0,0,0.5)', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.05)' }}>
                    <span style={{ color: 'var(--text-muted)' }}>Status</span>
                    <span style={{ color: 'var(--success-green)' }}>* SECURE</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', padding: '15px', background: 'rgba(0,0,0,0.5)', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.05)' }}>
                    <span style={{ color: 'var(--text-muted)' }}>Active Connections</span>
                    <span style={{ color: 'var(--accent-cyan)' }}>1,432</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', padding: '15px', background: 'rgba(0,0,0,0.5)', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.05)' }}>
                    <span style={{ color: 'var(--text-muted)' }}>Blocked Packets (1h)</span>
                    <span style={{ color: 'var(--danger-red)' }}>84,291</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', padding: '15px', background: 'rgba(0,0,0,0.5)', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.05)' }}>
                    <span style={{ color: 'var(--text-muted)' }}>CPU Utilization</span>
                    <span style={{ color: 'var(--warn-amber)' }}>14.2%</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

      </main>

      {/* Footer */}
      <footer style={{ borderTop: '1px solid rgba(255,255,255,0.05)', padding: '40px', background: 'rgba(3, 5, 8, 0.9)', textAlign: 'center', position: 'relative', zIndex: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '10px', marginBottom: '20px' }}>
          <Shield size={24} color="var(--text-muted)" />
          <span style={{ fontFamily: 'var(--font-display)', fontSize: '1.2rem', fontWeight: '800', color: 'var(--text-muted)' }}>Sparrowx</span>
        </div>
        <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>
          (c) {new Date().getFullYear()} Sparrowx. All rights reserved.
        </p>
      </footer>
    </div>
  );
}
