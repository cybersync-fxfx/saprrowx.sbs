import { useState, useEffect } from 'react';
import { Sparkles, ShieldCheck, AlertTriangle, Send, Loader2, Eye } from 'lucide-react';

export default function SparrowAi({ token }) {
  const [prompt, setPrompt] = useState('');
  const [analysis, setAnalysis] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [alerts, setAlerts] = useState([]);
  const [chatHistory, setChatHistory] = useState([]);

  const fetchAiInsight = async (userQuery = '') => {
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/ai/analyze', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ prompt: userQuery })
      });

      if (!res.ok) {
        const errData = await res.json();
        throw new Error(errData.error || 'AI scan unsuccessful');
      }

      const data = await res.json();
      setAnalysis(data.analysis);
      
      if (userQuery) {
        setChatHistory(prev => [...prev, { type: 'user', text: userQuery }, { type: 'ai', text: data.analysis }]);
      } else {
        setChatHistory([{ type: 'ai', text: data.analysis }]);
      }

      triggerPopUp('Cybersecurity Assessment Dispatched Successfully.', 'success');
    } catch (err) {
      setError(err.message);
      triggerPopUp('AI Assessment module encountered failure.', 'danger');
    } finally {
      setLoading(false);
    }
  };

  const triggerPopUp = (message, type = 'success') => {
    const id = Math.random().toString(36).substr(2, 9);
    setAlerts(prev => [...prev, { id, message, type }]);
    setTimeout(() => {
      setAlerts(prev => prev.filter(a => a.id !== id));
    }, 5000);
  };

  useEffect(() => {
    fetchAiInsight(); // Load initial assessment
    
    // Simulation of "Watching" popups
    const alertInterval = setInterval(() => {
      const watchMessages = [
        "Sparrow AI actively scanning active routing vectors...",
        "Real-time core telemetry parsing initiated.",
        "No critical database vulnerabilities detected.",
        "Analyzing firewall blocklist integrity.",
        "Sparrow AI Node streaming protective nodes."
      ];
      const randomMessage = watchMessages[Math.floor(Math.random() * watchMessages.length)];
      triggerPopUp(randomMessage, 'info');
    }, 15000);

    return () => clearInterval(alertInterval);
  }, []);

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!prompt.trim() || loading) return;
    fetchAiInsight(prompt);
    setPrompt('');
  };

  return (
    <div className="sparrow-ai-container">
      {/* Floating Popups */}
      <div className="ai-toast-container">
        {alerts.map(alert => (
          <div key={alert.id} className={`ai-toast toast-${alert.type}`}>
            <Eye size={16} className="rotating-eye" />
            <span>{alert.message}</span>
          </div>
        ))}
      </div>

      <div className="ai-header">
        <div className="ai-branding">
          <Sparkles size={32} className="ai-glow-icon" />
          <div>
            <h1>Sparrow AI Assistant</h1>
            <p className="ai-subtitle">Connected via Gemini Intelligence Matrix</p>
          </div>
        </div>
        <div className="ai-status-indicator">
          <span className="glowing-dot"></span>
          SYSTEM WATCHING ACTIVE
        </div>
      </div>

      <div className="ai-main-view">
        {/* The AI Assistant Core Visual */}
        <div className="ai-visual-core">
          <div className={`ai-orb ${loading ? 'orb-thinking' : 'orb-idle'}`}>
            <div className="orb-inner"></div>
            <div className="orb-pulse"></div>
          </div>
          <div className="ai-stats">
            <div className="stat-box">
              <ShieldCheck size={20} color="#289912" />
              <span>Defensive Posture</span>
              <strong>OPTIMAL</strong>
            </div>
            <div className="stat-box">
              <AlertTriangle size={20} color="#ff3333" />
              <span>Active Threat Vectors</span>
              <strong>MONITORED</strong>
            </div>
          </div>
        </div>

        {/* The Chat / Logs Analysis Interface */}
        <div className="ai-dialog-interface">
          <div className="ai-chat-window">
            {chatHistory.map((msg, idx) => (
              <div key={idx} className={`chat-bubble bubble-${msg.type}`}>
                <div className="bubble-header">
                  {msg.type === 'ai' ? 'SPARROW AI' : 'OPERATOR'}
                </div>
                <div className="bubble-content">
                  {msg.text.split('\n').map((para, pIdx) => (
                    <p key={pIdx}>{para}</p>
                  ))}
                </div>
              </div>
            ))}

            {loading && (
              <div className="chat-bubble bubble-ai">
                <div className="bubble-header">SPARROW AI</div>
                <div className="bubble-content ai-typing">
                  <Loader2 size={18} className="spinning" />
                  <span>Interfacing with log clusters...</span>
                </div>
              </div>
            )}

            {error && (
              <div className="ai-error-box">
                <AlertTriangle size={20} />
                <span>{error}</span>
              </div>
            )}
          </div>

          <form onSubmit={handleSubmit} className="ai-input-form">
            <input
              type="text"
              placeholder="Query threat assessment or command Sparrow AI..."
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              disabled={loading}
              className="ai-text-input"
            />
            <button type="submit" className="ai-send-button" disabled={loading || !prompt.trim()}>
              {loading ? <Loader2 className="spinning" size={18} /> : <Send size={18} />}
            </button>
          </form>
        </div>
      </div>

      {/* Embedded Aesthetics Styling */}
      <style>{`
        .sparrow-ai-container {
          padding: 2rem;
          background: linear-gradient(145deg, #050a05 0%, #020305 100%);
          min-height: calc(100vh - 100px);
          color: #ffffff;
          font-family: 'Inter', sans-serif;
          position: relative;
          overflow: hidden;
        }

        .ai-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          border-bottom: 1px solid rgba(40, 153, 18, 0.2);
          padding-bottom: 1.5rem;
          margin-bottom: 2rem;
        }

        .ai-branding {
          display: flex;
          align-items: center;
          gap: 1.5rem;
        }

        .ai-branding h1 {
          font-size: 1.8rem;
          color: #289912;
          margin: 0;
          text-shadow: 0 0 15px rgba(40, 153, 18, 0.4);
        }

        .ai-subtitle {
          font-size: 0.9rem;
          color: rgba(255, 255, 255, 0.6);
          margin: 0.2rem 0 0 0;
        }

        .ai-glow-icon {
          color: #289912;
          filter: drop-shadow(0 0 10px rgba(40, 153, 18, 0.6));
          animation: pulse 2s infinite alternate;
        }

        .ai-status-indicator {
          display: flex;
          align-items: center;
          gap: 0.5rem;
          background: rgba(40, 153, 18, 0.1);
          border: 1px solid rgba(40, 153, 18, 0.3);
          padding: 0.5rem 1rem;
          border-radius: 20px;
          font-size: 0.8rem;
          letter-spacing: 1px;
          color: #289912;
        }

        .glowing-dot {
          width: 8px;
          height: 8px;
          background-color: #289912;
          border-radius: 50%;
          box-shadow: 0 0 10px #289912;
          animation: blink 1.5s infinite;
        }

        .ai-main-view {
          display: grid;
          grid-template-columns: 1fr 2fr;
          gap: 2rem;
        }

        .ai-visual-core {
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          background: rgba(255, 255, 255, 0.03);
          border: 1px solid rgba(255, 255, 255, 0.05);
          border-radius: 16px;
          padding: 2rem;
          backdrop-filter: blur(10px);
        }

        /* AI Assistant Orb */
        .ai-orb {
          width: 150px;
          height: 150px;
          border-radius: 50%;
          position: relative;
          margin-bottom: 2rem;
          background: radial-gradient(circle at 30% 30%, rgba(40, 153, 18, 0.8), rgba(5, 20, 5, 1));
          box-shadow: 0 0 40px rgba(40, 153, 18, 0.3), inset 0 0 20px rgba(0, 0, 0, 0.8);
        }

        .orb-inner {
          position: absolute;
          top: 20%;
          left: 20%;
          width: 60%;
          height: 60%;
          border-radius: 50%;
          background: radial-gradient(circle, rgba(255, 255, 255, 0.2), transparent);
        }

        .orb-pulse {
          position: absolute;
          top: -10%;
          left: -10%;
          width: 120%;
          height: 120%;
          border: 2px solid rgba(40, 153, 18, 0.3);
          border-radius: 50%;
          animation: orb-expand 2s infinite linear;
        }

        .orb-thinking {
          animation: spin 3s infinite linear;
          background: radial-gradient(circle at 30% 30%, rgba(255, 50, 50, 0.8), rgba(20, 5, 5, 1));
          box-shadow: 0 0 40px rgba(255, 50, 50, 0.4);
        }

        .orb-thinking .orb-pulse {
          border-color: rgba(255, 50, 50, 0.4);
        }

        .ai-stats {
          display: flex;
          gap: 1rem;
          width: 100%;
        }

        .stat-box {
          flex: 1;
          background: rgba(0, 0, 0, 0.4);
          padding: 1rem;
          border-radius: 12px;
          border: 1px solid rgba(255, 255, 255, 0.05);
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 0.3rem;
          font-size: 0.8rem;
        }

        .stat-box strong {
          font-size: 1rem;
          color: #289912;
        }

        /* Chat / Output Windows */
        .ai-dialog-interface {
          display: flex;
          flex-direction: column;
          height: calc(100vh - 250px);
          background: rgba(0, 0, 0, 0.3);
          border: 1px solid rgba(255, 255, 255, 0.05);
          border-radius: 16px;
          overflow: hidden;
        }

        .ai-chat-window {
          flex: 1;
          padding: 1.5rem;
          overflow-y: auto;
          display: flex;
          flex-direction: column;
          gap: 1.5rem;
        }

        .chat-bubble {
          max-width: 85%;
          padding: 1rem;
          border-radius: 12px;
          line-height: 1.5;
        }

        .bubble-ai {
          align-self: flex-start;
          background: rgba(40, 153, 18, 0.1);
          border: 1px solid rgba(40, 153, 18, 0.2);
        }

        .bubble-user {
          align-self: flex-end;
          background: rgba(255, 255, 255, 0.05);
          border: 1px solid rgba(255, 255, 255, 0.1);
          color: #e0e0e0;
        }

        .bubble-header {
          font-size: 0.75rem;
          font-weight: bold;
          letter-spacing: 1px;
          margin-bottom: 0.5rem;
          color: rgba(255, 255, 255, 0.4);
        }

        .bubble-ai .bubble-header {
          color: #289912;
        }

        .ai-typing {
          display: flex;
          align-items: center;
          gap: 0.8rem;
          color: #289912;
        }

        .ai-error-box {
          background: rgba(255, 50, 50, 0.1);
          border: 1px solid rgba(255, 50, 50, 0.2);
          color: #ff3333;
          padding: 1rem;
          border-radius: 12px;
          display: flex;
          align-items: center;
          gap: 0.8rem;
        }

        /* Form Input */
        .ai-input-form {
          display: flex;
          padding: 1rem;
          background: rgba(0, 0, 0, 0.5);
          border-top: 1px solid rgba(255, 255, 255, 0.05);
          gap: 1rem;
        }

        .ai-text-input {
          flex: 1;
          background: rgba(255, 255, 255, 0.03);
          border: 1px solid rgba(255, 255, 255, 0.1);
          border-radius: 8px;
          padding: 0.8rem 1.2rem;
          color: #ffffff;
          font-size: 0.95rem;
          outline: none;
          transition: border-color 0.3s;
        }

        .ai-text-input:focus {
          border-color: #289912;
        }

        .ai-send-button {
          background: #289912;
          border: none;
          color: #000;
          padding: 0 1.5rem;
          border-radius: 8px;
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: center;
          transition: background 0.3s, transform 0.1s;
        }

        .ai-send-button:hover:not(:disabled) {
          background: #34c718;
        }

        .ai-send-button:active:not(:disabled) {
          transform: scale(0.95);
        }

        .ai-send-button:disabled {
          background: rgba(255, 255, 255, 0.1);
          color: rgba(255, 255, 255, 0.3);
          cursor: not-allowed;
        }

        /* Popups / Toasts */
        .ai-toast-container {
          position: fixed;
          bottom: 2rem;
          right: 2rem;
          display: flex;
          flex-direction: column;
          gap: 0.8rem;
          z-index: 9999;
        }

        .ai-toast {
          background: rgba(5, 10, 5, 0.9);
          border-radius: 8px;
          padding: 1rem 1.5rem;
          display: flex;
          align-items: center;
          gap: 0.8rem;
          font-size: 0.85rem;
          backdrop-filter: blur(10px);
          box-shadow: 0 10px 30px rgba(0, 0, 0, 0.5);
          animation: slide-in 0.3s ease-out;
        }

        .toast-success { border: 1px solid #289912; color: #289912; }
        .toast-info { border: 1px solid #18b5c7; color: #18b5c7; }
        .toast-danger { border: 1px solid #ff3333; color: #ff3333; }

        .rotating-eye {
          animation: spin 4s infinite linear;
        }

        /* Animations */
        @keyframes pulse { 0% { opacity: 0.7; } 100% { opacity: 1; } }
        @keyframes blink { 0%, 100% { opacity: 1; } 50% { opacity: 0.3; } }
        @keyframes spin { 100% { transform: rotate(360deg); } }
        @keyframes orb-expand {
          0% { transform: scale(1); opacity: 0.5; }
          100% { transform: scale(1.3); opacity: 0; }
        }
        @keyframes slide-in {
          from { transform: translateX(100%); opacity: 0; }
          to { transform: translateX(0); opacity: 1; }
        }

        .spinning {
          animation: spin 1s infinite linear;
        }
      `}</style>
    </div>
  );
}
