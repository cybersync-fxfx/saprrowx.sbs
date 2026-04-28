import React, { useState, useEffect } from 'react';
import { ComposableMap, Geographies, Geography, Marker } from 'react-simple-maps';
import { useTelemetry } from '../context/TelemetryContext';

const geoUrl = "https://unpkg.com/world-atlas@2.0.2/countries-110m.json";

export default function ThreatMap({ token }) {
  const { trafficEvents } = useTelemetry();
  const [data, setData] = useState({ liveScores: [], stats: { scannedToday: 0, blockedToday: 0 } });
  
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

  const liveScores = data.liveScores;

  // Filter out markers with no GPS
  const markers = liveScores.filter(item => item.lat !== null && item.lon !== null && item.lat !== undefined);

  const getColor = (action, score) => {
    if (action === 'banned' || score >= 90) return '#ff1a1a'; // Red
    if (action === 'watched' || score >= 55) return '#f39c12'; // Yellow
    return '#2ecc71'; // Green
  };

  return (
    <div className="page-shell">
      <section className="hero-panel compact">
        <div>
          <p className="eyebrow">Global View</p>
          <h1 className="page-title">Live Threat Map</h1>
        </div>
        <div className="hero-status-stack">
          <div className="status-pill connected">Tracking {markers.length} Targets</div>
        </div>
      </section>

      <div className="content-grid two-up">
        <section className="glass-panel elevated-panel" style={{ padding: 0, overflow: 'hidden', background: '#020202', border: '1px solid rgba(180,180,180,0.25)' }}>
          <ComposableMap projectionConfig={{ scale: 160 }} style={{ width: '100%', height: '520px', outline: 'none' }}>
            <Geographies geography={geoUrl}>
              {({ geographies }) =>
                geographies.map((geo) => (
                  <Geography
                    key={geo.rsmKey}
                    geography={geo}
                    fill="#111111"
                    stroke="#333333"
                    strokeWidth={0.5}
                    style={{
                      default: { outline: 'none' },
                      hover: { fill: '#1a1a1a', outline: 'none' },
                      pressed: { outline: 'none' },
                    }}
                  />
                ))
              }
            </Geographies>
            
            {markers.map((marker) => {
              const color = getColor(marker.action, marker.score);
              return (
                <Marker key={marker.id} coordinates={[marker.lon, marker.lat]}>
                  <circle r={3} fill={color} opacity={0.9} />
                  <circle r={12} fill={color} opacity={0.4} className="ping-anim" />
                </Marker>
              );
            })}
          </ComposableMap>
          <style>{`
            @keyframes ping {
              0% { transform: scale(0.2); opacity: 0.8; }
              80% { transform: scale(1.5); opacity: 0; }
              100% { transform: scale(1.5); opacity: 0; }
            }
            .ping-anim {
              animation: ping 2s infinite cubic-bezier(0, 0, 0.2, 1);
              transform-origin: center;
            }
          `}</style>
        </section>

        <section className="glass-panel elevated-panel" style={{ maxHeight: '520px', overflowY: 'auto' }}>
           <div className="panel-heading" style={{ position: 'sticky', top: 0, background: 'rgba(30, 30, 30, 0.95)', zIndex: 10, padding: '15px' }}>
             <h3>Active Targets Ledger</h3>
             <span className="meta-chip">{liveScores.length} detected</span>
           </div>
           <div className="fact-list" style={{ padding: '0 15px' }}>
             {liveScores.map(item => (
               <div key={item.id} style={{ display: 'flex', justifyContent: 'space-between', padding: '12px 0', borderBottom: '1px solid rgba(180,180,180,0.1)' }}>
                 <div style={{ display: 'flex', flexDirection: 'column' }}>
                   <span style={{ color: getColor(item.action, item.score), fontWeight: 'bold', fontSize: '0.85rem' }}>{item.ip}</span>
                   <span style={{ fontSize: '0.7rem', color: '#888', marginTop: '4px' }}>
                     {item.country !== 'Unknown' ? `📍 ${item.country}` : '🌐 Unknown'} • {item.reason}
                   </span>
                 </div>
                 <div style={{ textAlign: 'right' }}>
                   <span style={{ fontSize: '0.85rem', color: '#fff', fontWeight: 'bold' }}>Score: {item.score}</span>
                   <div style={{ fontSize: '0.7rem', fontWeight: 'bold', marginTop: '4px', color: item.action === 'banned' ? '#ff1a1a' : (item.action === 'watched' ? '#f39c12' : '#888'), textTransform: 'uppercase' }}>
                     {item.action}
                   </div>
                 </div>
               </div>
             ))}
             {liveScores.length === 0 && <div style={{ color: '#888', fontSize: '0.8rem', padding: '20px 0' }}>No active threats detected. Waiting for traffic...</div>}
           </div>
        </section>
      </div>
    </div>
  );
}
