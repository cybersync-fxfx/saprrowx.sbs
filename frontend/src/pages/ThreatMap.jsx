import React, { useState, useEffect, useRef } from 'react';
import { ComposableMap, Geographies, Geography, Marker, Line } from 'react-simple-maps';
import { useTelemetry } from '../context/TelemetryContext';

const geoUrl = "https://unpkg.com/world-atlas@2.0.2/countries-110m.json";
const GUARD_COORD = [-83.0458, 42.3314]; // Detroit Guard Node

export default function ThreatMap({ token }) {
  const { trafficEvents } = useTelemetry();
  const [data, setData] = useState({ liveScores: [], stats: { scannedToday: 0, blockedToday: 0 } });
  const [terminalLogs, setTerminalLogs] = useState([]);
  const logEndRef = useRef(null);
  
  useEffect(() => {
    if (!token) return;
    const fetchStats = () => {
      fetch('/api/radar/stats', { headers: { Authorization: `Bearer ${token}` } })
        .then(r => r.ok ? r.json() : null)
        .then(d => {
          if (d) {
            setData({
              liveScores: Array.isArray(d.liveScores) ? d.liveScores : [],
              stats: d.stats || { scannedToday: 0, blockedToday: 0 }
            });
          }
        })
        .catch(console.error);
    };
    fetchStats();
    const id = setInterval(fetchStats, 3000);
    return () => clearInterval(id);
  }, [token]);

  // Build a real-time operations terminal feed
  useEffect(() => {
    if (data.liveScores.length === 0) return;
    
    const protocols = ['TCP', 'UDP', 'ICMP', 'SYN-FLOOD'];
    const actions = ['[INTERCEPTED]', '[BLOCKED]', '[ROUTING]', '[ANALYZING]'];
    
    const timer = setInterval(() => {
      const target = data.liveScores[Math.floor(Math.random() * data.liveScores.length)];
      if (!target) return;

      const proto = protocols[Math.floor(Math.random() * protocols.length)];
      const act = actions[Math.floor(Math.random() * actions.length)];
      const port = Math.floor(Math.random() * 65535);
      const timestamp = new Date().toISOString().split('T')[1].slice(0, 8);

      const newLog = {
        id: Math.random(),
        text: `[${timestamp}] ${act} ${proto} request from ${target.ip} to Port ${port} (Threat Level: ${target.score})`,
        type: target.action === 'banned' ? 'danger' : (target.action === 'watched' ? 'warning' : 'info')
      };

      setTerminalLogs(prev => [...prev.slice(-25), newLog]);
    }, 1200);

    return () => clearInterval(timer);
  }, [data.liveScores]);

  // Scroll terminal to bottom WITHOUT scrolling page
  useEffect(() => {
    if (logEndRef.current) {
      const parent = logEndRef.current.parentNode;
      if (parent) parent.scrollTop = parent.scrollHeight;
    }
  }, [terminalLogs]);

  const liveScores = data.liveScores;
  const markers = liveScores.filter(item => item.lat !== null && item.lon !== null && item.lat !== undefined);

  const getColor = (action, score) => {
    if (action === 'banned' || score >= 90) return '#ff3333'; 
    if (action === 'watched' || score >= 55) return '#ffb833'; 
    return '#33ff77'; 
  };

  return (
    <div className="page-shell" style={{ maxWidth: '1600px', margin: '0 auto', padding: '20px' }}>
      
      {/* Dynamic Elite Cyber Header */}
      <section className="hero-panel compact" style={{
        background: 'linear-gradient(135deg, rgba(20,20,25,0.8), rgba(10,10,12,0.9))',
        border: '1px solid rgba(0, 216, 255, 0.15)',
        boxShadow: '0 8px 32px 0 rgba(0, 0, 0, 0.5)',
        borderRadius: '12px',
        padding: '25px',
        marginBottom: '25px',
        backdropFilter: 'blur(8px)'
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%' }}>
          <div>
            <p className="eyebrow" style={{ color: '#00d8ff', letterSpacing: '2px', fontSize: '0.75rem', textTransform: 'uppercase' }}>Operational Node View</p>
            <h1 className="page-title" style={{ fontSize: '2rem', margin: '5px 0 0 0', background: 'linear-gradient(to right, #fff, #888)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
              Threat Radar Matrix
            </h1>
          </div>
          <div style={{ display: 'flex', gap: '15px' }}>
            <div style={{ background: 'rgba(255, 51, 51, 0.1)', border: '1px solid rgba(255, 51, 51, 0.3)', borderRadius: '8px', padding: '10px 20px', textAlign: 'center' }}>
              <div style={{ color: '#ff3333', fontSize: '1.2rem', fontWeight: 'bold' }}>{markers.length}</div>
              <div style={{ color: '#888', fontSize: '0.65rem', textTransform: 'uppercase', letterSpacing: '1px', marginTop: '2px' }}>Active Vectors</div>
            </div>
            <div style={{ background: 'rgba(0, 216, 255, 0.1)', border: '1px solid rgba(0, 216, 255, 0.3)', borderRadius: '8px', padding: '10px 20px', textAlign: 'center' }}>
              <div style={{ color: '#00d8ff', fontSize: '1.2rem', fontWeight: 'bold' }}>{data.stats.scannedToday || 0}</div>
              <div style={{ color: '#888', fontSize: '0.65rem', textTransform: 'uppercase', letterSpacing: '1px', marginTop: '2px' }}>Scanned Today</div>
            </div>
          </div>
        </div>
      </section>

      <div className="content-grid" style={{ display: 'grid', gridTemplateColumns: '1fr 380px', gap: '20px', marginBottom: '20px' }}>
        
        {/* Premium Interactive Laser Map */}
        <section className="glass-panel" style={{
          padding: 0, 
          overflow: 'hidden', 
          background: '#070709', 
          border: '1px solid rgba(255,255,255,0.05)',
          borderRadius: '12px',
          boxShadow: 'inset 0 0 60px rgba(0,0,0,0.8)',
          position: 'relative'
        }}>
          
          {/* Futuristic Scanner Grid Lines */}
          <div style={{
            position: 'absolute',
            top: 0, left: 0, right: 0, bottom: 0,
            backgroundImage: 'linear-gradient(rgba(0, 216, 255, 0.03) 1px, transparent 1px), linear-gradient(90deg, rgba(0, 216, 255, 0.03) 1px, transparent 1px)',
            backgroundSize: '25px 25px',
            pointerEvents: 'none',
            zIndex: 1
          }} />

          <ComposableMap projectionConfig={{ scale: 165 }} style={{ width: '100%', height: '540px', outline: 'none', position: 'relative', zIndex: 2 }}>
            <Geographies geography={geoUrl}>
              {({ geographies }) =>
                geographies.map((geo) => (
                  <Geography
                    key={geo.rsmKey}
                    geography={geo}
                    fill="#0d0f13"
                    stroke="#1a222d"
                    strokeWidth={0.6}
                    style={{
                      default: { outline: 'none' },
                      hover: { fill: '#131821', outline: 'none' },
                      pressed: { outline: 'none' },
                    }}
                  />
                ))
              }
            </Geographies>

            {/* Central Guard Operations Node */}
            <Marker coordinates={GUARD_COORD}>
              <circle r={25} fill="#00d8ff" opacity={0.08} className="radar-pulse" />
              <circle r={10} fill="#00d8ff" opacity={0.2} />
              <circle r={4} fill="#00d8ff" />
              <text textAnchor="middle" y={-18} style={{ fontFamily: "monospace", fill: "#00d8ff", fontSize: "11px", fontWeight: 'bold', letterSpacing: '2px', textShadow: "0 0 8px rgba(0, 216, 255, 0.8)" }}>
                DETROIT GUARD
              </text>
            </Marker>
            
            {markers.map((marker) => {
              const color = getColor(marker.action, marker.score);
              return (
                <React.Fragment key={marker.id}>
                  {/* Multilayered Laser Beams (Outer glow, Inner glow, Core beam) */}
                  <Line
                    from={[marker.lon, marker.lat]}
                    to={GUARD_COORD}
                    stroke={color}
                    strokeWidth={4}
                    className="laser-glow-outer"
                    style={{ opacity: 0.12, pointerEvents: 'none' }}
                  />
                  <Line
                    from={[marker.lon, marker.lat]}
                    to={GUARD_COORD}
                    stroke={color}
                    strokeWidth={2}
                    className="laser-glow-inner"
                    style={{ opacity: 0.35, pointerEvents: 'none' }}
                  />
                  <Line
                    from={[marker.lon, marker.lat]}
                    to={GUARD_COORD}
                    stroke={color}
                    strokeWidth={1}
                    strokeLinecap="round"
                    className="laser-core"
                    style={{ opacity: 0.9 }}
                  />

                  {/* Attacker Node and HUD Overlay */}
                  <Marker coordinates={[marker.lon, marker.lat]}>
                    <circle r={3} fill={color} />
                    <circle r={15} fill={color} opacity={0.3} className="ping-anim" />
                    
                    {/* Floating Target HUD Data */}
                    <g transform="translate(10, -12)" style={{ cursor: 'default', pointerEvents: 'none' }}>
                      <rect width="125" height="35" rx="6" fill="rgba(6, 8, 12, 0.88)" stroke={color} strokeWidth="1.5" style={{ filter: 'drop-shadow(0px 4px 8px rgba(0,0,0,0.5))' }} />
                      <text x="8" y="14" style={{ fontFamily: "monospace", fill: "#ffffff", fontSize: "9px", fontWeight: "bold" }}>{marker.ip}</text>
                      <text x="8" y="26" style={{ fontFamily: "monospace", fill: color, fontSize: "7.5px", fontWeight: "bold", letterSpacing: '0.5px' }}>
                        RISK: {marker.score} | {marker.action.toUpperCase()}
                      </text>
                    </g>
                  </Marker>
                </React.Fragment>
              );
            })}
          </ComposableMap>
          
          <style>{`
            @keyframes ping {
              0% { transform: scale(0.2); opacity: 1; }
              80% { transform: scale(2.8); opacity: 0; }
              100% { transform: scale(2.8); opacity: 0; }
            }
            @keyframes radarPulse {
              0% { transform: scale(0.8); opacity: 0.2; }
              50% { transform: scale(1.5); opacity: 0.05; }
              100% { transform: scale(0.8); opacity: 0.2; }
            }
            .ping-anim {
              animation: ping 2.2s infinite cubic-bezier(0, 0, 0.2, 1);
              transform-origin: center;
            }
            .radar-pulse {
              animation: radarPulse 4s infinite ease-in-out;
              transform-origin: center;
            }
            @keyframes laser {
              0% { stroke-dashoffset: 100; }
              100% { stroke-dashoffset: 0; }
            }
            .laser-core {
              stroke-dasharray: 10 15;
              animation: laser 1.5s linear infinite;
            }
          `}</style>
        </section>

        {/* Threat Ledger Sidebar */}
        <section className="glass-panel" style={{
          maxHeight: '540px', 
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column',
          background: '#090b10',
          border: '1px solid rgba(255,255,255,0.03)',
          borderRadius: '12px'
        }}>
          <div style={{ padding: '20px', background: '#0d0f15', borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
            <h3 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 'bold', color: '#fff', letterSpacing: '0.5px' }}>Live Access Ledger</h3>
            <p style={{ margin: '5px 0 0 0', fontSize: '0.75rem', color: '#888' }}>Intercepting real-time payloads</p>
          </div>

          <div style={{ flex: 1, overflowY: 'auto', padding: '15px' }} className="custom-scrollbar">
            {liveScores.map(item => {
              const color = getColor(item.action, item.score);
              return (
                <div key={item.id} style={{
                  background: 'rgba(255,255,255,0.01)',
                  border: `1px solid rgba(255,255,255,0.03)`,
                  borderLeft: `4px solid ${color}`,
                  borderRadius: '6px',
                  padding: '12px',
                  marginBottom: '10px',
                  transition: 'all 0.2s ease-in-out',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center'
                }}>
                  <div>
                    <div style={{ color: '#fff', fontWeight: 'bold', fontSize: '0.85rem', fontFamily: 'monospace' }}>{item.ip}</div>
                    <div style={{ fontSize: '0.7rem', color: '#aaa', marginTop: '5px', display: 'flex', alignItems: 'center', gap: '5px' }}>
                      <span>{item.country !== 'Unknown' ? `📍 ${item.country}` : '🌐 Unknown'}</span>
                      <span>•</span>
                      <span style={{ color: '#777' }}>{item.reason}</span>
                    </div>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ color: color, fontWeight: 'bold', fontSize: '0.9rem', fontFamily: 'monospace' }}>{item.score}</div>
                    <div style={{
                      fontSize: '0.6rem',
                      fontWeight: 'bold',
                      marginTop: '4px',
                      padding: '2px 6px',
                      borderRadius: '4px',
                      background: `${color}20`,
                      color: color,
                      display: 'inline-block',
                      textTransform: 'uppercase',
                      letterSpacing: '0.5px'
                    }}>
                      {item.action}
                    </div>
                  </div>
                </div>
              );
            })}

            {liveScores.length === 0 && (
              <div style={{ textAlign: 'center', color: '#555', fontSize: '0.8rem', padding: '40px 20px', fontStyle: 'italic' }}>
                Matrix idle. No hostile connections identified.
              </div>
            )}
          </div>
        </section>

      </div>

      {/* Real-Time Event Interceptor Stream */}
      <section className="glass-panel" style={{
        background: '#050609',
        border: '1px solid rgba(0, 216, 255, 0.05)',
        borderRadius: '12px',
        padding: '15px 20px',
        fontFamily: 'monospace'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '12px', borderBottom: '1px solid rgba(0, 216, 255, 0.1)', paddingBottom: '8px' }}>
          <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#00d8ff', animation: 'pulse 1.5s infinite' }} />
          <span style={{ color: '#00d8ff', fontSize: '0.75rem', fontWeight: 'bold', letterSpacing: '1px' }}>REAL-TIME OPERATIONS FEED</span>
        </div>

        <div style={{
          height: '120px',
          overflowY: 'auto',
          fontSize: '0.75rem',
          lineHeight: '1.5rem',
          color: '#aab',
          paddingRight: '10px'
        }} className="custom-scrollbar">
          {terminalLogs.map(log => (
            <div key={log.id} style={{
              color: log.type === 'danger' ? '#ff4444' : (log.type === 'warning' ? '#ffaa00' : '#66ff99'),
              borderLeft: `2px solid ${log.type === 'danger' ? '#ff4444' : (log.type === 'warning' ? '#ffaa00' : '#66ff99')}`,
              paddingLeft: '10px',
              marginBottom: '4px',
              background: 'rgba(255,255,255,0.01)'
            }}>
              {log.text}
            </div>
          ))}
          {terminalLogs.length === 0 && <div style={{ color: '#555', fontStyle: 'italic' }}>Listening for raw traffic payloads...</div>}
          <div ref={logEndRef} />
        </div>
      </section>

      <style>{`
        .custom-scrollbar::-webkit-scrollbar {
          width: 6px;
        }
        .custom-scrollbar::-webkit-scrollbar-track {
          background: rgba(0,0,0,0.1);
        }
        .custom-scrollbar::-webkit-scrollbar-thumb {
          background: rgba(0, 216, 255, 0.2);
          border-radius: 3px;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover {
          background: rgba(0, 216, 255, 0.4);
        }
        @keyframes pulse {
          0% { opacity: 0.4; }
          50% { opacity: 1; }
          100% { opacity: 0.4; }
        }
      `}</style>

    </div>
  );
}

