import { useEffect, useState } from 'react';
import { Cpu, HardDrive, Package, Check, ArrowRight, Loader2 } from 'lucide-react';

export default function Plans({ token, user }) {
  const [plans, setPlans] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [currency, setCurrency] = useState('USD');
  const [currencies, setCurrencies] = useState([]);

  useEffect(() => {
    fetch('https://dash.detriot.cloud/api/plans')
      .then(res => {
        if (!res.ok) throw new Error('Failed to fetch plans');
        return res.json();
      })
      .then(data => {
        setPlans(data.plans || []);
        setCurrencies(data.currencies || []);
        setLoading(false);
      })
      .catch(err => {
        console.error(err);
        setError(err.message);
        setLoading(false);
      });
  }, []);

  if (loading) {
    return (
      <div className="page-shell" style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '60vh' }}>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '16px' }}>
          <Loader2 className="animate-spin text-cyan" size={32} />
          <span className="eyebrow">Fetching server configurations...</span>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="page-shell">
        <section className="hero-panel">
          <div>
            <p className="eyebrow text-red">Fatal Error</p>
            <h1 className="page-title">Marketplace Offline</h1>
            <p className="page-copy">{error}</p>
          </div>
        </section>
      </div>
    );
  }

  const [redirectingPlanId, setRedirectingPlanId] = useState(null);

  const handleDeploy = (planId) => {
    setRedirectingPlanId(planId);
    setTimeout(() => {
      window.location.href = 'https://dash.detriot.cloud';
    }, 2500);
  };

  const selectedCurrency = currencies.find(c => c.code === currency) || { symbol: '$' };

  return (
    <div className="page-shell">
      <section className="hero-panel">
        <div>
          <p className="eyebrow">Marketplace</p>
          <h1 className="page-title">Deploy Infrastructure</h1>
          <p className="page-copy">
            High-performance virtual servers with enterprise DDoS protection. 
            Select a plan to scale your operations.
          </p>
        </div>
        <div className="hero-status-stack">
          <div className="view-switcher" style={{ background: 'rgba(0,0,0,0.4)', padding: '4px' }}>
            {currencies.map(c => (
              <button
                key={c.code}
                className={`view-button ${currency === c.code ? 'active' : ''}`}
                onClick={() => setCurrency(c.code)}
                style={{ padding: '4px 12px', fontSize: '0.7rem' }}
              >
                {c.code}
              </button>
            ))}
          </div>
        </div>
      </section>

      <div className="plans-grid">
        {plans.map(plan => {
          const priceObj = plan.prices.find(p => p.code === currency) || { amount: plan.price };
          const isRedirecting = redirectingPlanId === plan.id;
          
          return (
            <article key={plan.id} className="glass-panel elevated-panel plan-card">
              <div className="plan-badge">{plan.category.name}</div>
              <h2 className="plan-name">{plan.name}</h2>
              
              <div className="plan-price">
                <span className="price-symbol">{selectedCurrency.symbol}</span>
                <span className="price-amount">{priceObj.amount}</span>
                <span className="price-period">/{plan.billing_period}</span>
              </div>

              <div className="plan-specs">
                <div className="spec-item">
                  <Package size={14} className="text-cyan" />
                  <span>{plan.specs.ram_gb} GB RAM</span>
                </div>
                <div className="spec-item">
                  <Cpu size={14} className="text-cyan" />
                  <span>{plan.specs.cpu_cores} vCores</span>
                </div>
                <div className="spec-item">
                  <HardDrive size={14} className="text-cyan" />
                  <span>{plan.specs.disk_gb} GB NVMe</span>
                </div>
              </div>

              <div className="plan-features">
                <div className="feature-item">
                  <Check size={14} className="text-green" />
                  <span>{plan.features.backups} Backup Slots</span>
                </div>
                <div className="feature-item">
                  <Check size={14} className="text-green" />
                  <span>{plan.features.databases} Database Slots</span>
                </div>
                <div className="feature-item">
                  <Check size={14} className="text-green" />
                  <span>DDoS Protection</span>
                </div>
              </div>

              <button 
                onClick={() => handleDeploy(plan.id)}
                disabled={plan.is_out_of_stock || isRedirecting}
                className={`plan-button ${(plan.is_out_of_stock || isRedirecting) ? 'disabled' : ''}`}
              >
                {plan.is_out_of_stock ? 'OUT OF STOCK' : (isRedirecting ? 'INITIALIZING...' : 'DEPLOY NOW')}
                {isRedirecting ? (
                  <Loader2 className="animate-spin" size={14} />
                ) : (
                  !plan.is_out_of_stock && <ArrowRight size={14} />
                )}
              </button>
            </article>
          )
        })}
      </div>

      <style>{`
        .plans-grid {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
          gap: 16px;
          margin-top: 20px;
        }
        .plan-card {
          display: flex;
          flex-direction: column;
          gap: 16px;
          padding: 24px;
          position: relative;
          overflow: hidden;
          transition: all 0.3s ease;
          border: 1px solid var(--panel-border);
          background: var(--panel-bg);
        }
        .plan-card:hover {
          border-color: var(--accent-cyan);
          transform: translateY(-4px);
          box-shadow: 0 0 30px rgba(255, 26, 26, 0.15);
        }
        .plan-badge {
          position: absolute;
          top: 0;
          right: 0;
          background: var(--accent-cyan);
          color: #000;
          font-size: 0.6rem;
          font-weight: 800;
          padding: 4px 12px;
          letter-spacing: 1px;
          text-transform: uppercase;
        }
        .plan-name {
          font-size: 1.25rem;
          font-weight: 800;
          color: var(--text-main);
          letter-spacing: -0.5px;
        }
        .plan-price {
          display: flex;
          align-items: baseline;
          gap: 4px;
        }
        .price-symbol {
          font-size: 1.2rem;
          font-weight: 600;
          color: var(--accent-cyan);
        }
        .price-amount {
          font-size: 2.6rem;
          font-weight: 800;
          color: var(--text-main);
          font-family: var(--font-display);
        }
        .price-period {
          font-size: 0.8rem;
          color: var(--text-muted);
          text-transform: uppercase;
          font-weight: 600;
        }
        .plan-specs {
          display: flex;
          flex-direction: column;
          gap: 10px;
          padding: 16px 0;
          border-top: 1px solid var(--panel-border);
          border-bottom: 1px solid var(--panel-border);
        }
        .spec-item {
          display: flex;
          align-items: center;
          gap: 12px;
          font-size: 0.9rem;
          font-weight: 500;
          color: var(--text-soft);
        }
        .plan-features {
          display: flex;
          flex-direction: column;
          gap: 8px;
          flex: 1;
        }
        .feature-item {
          display: flex;
          align-items: center;
          gap: 12px;
          font-size: 0.8rem;
          color: var(--text-muted);
        }
        .plan-button {
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 8px;
          padding: 14px;
          background: var(--accent-cyan);
          color: #000;
          text-decoration: none;
          font-weight: 800;
          font-size: 0.8rem;
          letter-spacing: 1px;
          transition: all 0.2s ease;
          border: none;
          cursor: pointer;
        }
        .plan-button:hover:not(.disabled) {
          background: #fff;
          transform: scale(1.02);
        }
        .plan-button.disabled {
          background: rgba(255,255,255,0.05);
          color: var(--text-dim);
          border: 1px solid var(--panel-border);
          pointer-events: none;
          cursor: not-allowed;
        }
        .animate-spin {
          animation: spin 1s linear infinite;
        }
        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
}
