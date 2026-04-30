import React, { useEffect } from 'react';
import { X, ShieldAlert, ShieldCheck, Settings, Bell } from 'lucide-react';
import { useTelemetry } from '../context/TelemetryContext';

export default function NotificationCenter() {
  const { notifications, setNotifications } = useTelemetry();

  const removeNotification = (id) => {
    setNotifications(prev => prev.filter(n => n.id !== id));
  };

  useEffect(() => {
    if (notifications.length > 0) {
      const timer = setTimeout(() => {
        removeNotification(notifications[notifications.length - 1].id);
      }, 8000);
      return () => clearTimeout(timer);
    }
  }, [notifications]);

  return (
    <div className="notification-container">
      {notifications.map((n) => (
        <div key={n.id} className={`notification-toast ${n.type}`}>
          <div className="notification-icon">
            {n.type === 'danger' && <ShieldAlert size={18} />}
            {n.type === 'success' && <ShieldCheck size={18} />}
            {n.type === 'warning' && <Settings size={18} />}
            {!['danger', 'success', 'warning'].includes(n.type) && <Bell size={18} />}
          </div>
          <div className="notification-content">
            <div className="notification-title">{n.title}</div>
            <div className="notification-message">{n.message}</div>
          </div>
          <button className="notification-close" onClick={() => removeNotification(n.id)}>
            <X size={14} />
          </button>
        </div>
      ))}

      <style>{`
        .notification-container {
          position: fixed;
          bottom: 24px;
          right: 24px;
          z-index: 9999;
          display: flex;
          flex-direction: column;
          gap: 12px;
          pointer-events: none;
        }

        .notification-toast {
          pointer-events: auto;
          min-width: 320px;
          max-width: 420px;
          background: rgba(13, 13, 18, 0.85);
          backdrop-filter: blur(12px);
          -webkit-backdrop-filter: blur(12px);
          border: 1px solid rgba(255, 255, 255, 0.1);
          border-radius: 12px;
          padding: 16px;
          display: flex;
          gap: 16px;
          box-shadow: 0 12px 32px rgba(0, 0, 0, 0.4);
          animation: slideIn 0.4s cubic-bezier(0.16, 1, 0.3, 1) forwards;
          position: relative;
          overflow: hidden;
        }

        @keyframes slideIn {
          from { transform: translateX(100%); opacity: 0; }
          to { transform: translateX(0); opacity: 1; }
        }

        .notification-toast::after {
          content: '';
          position: absolute;
          bottom: 0;
          left: 0;
          height: 3px;
          width: 100%;
          background: rgba(255, 255, 255, 0.2);
          animation: progress 8s linear forwards;
        }

        @keyframes progress {
          from { width: 100%; }
          to { width: 0%; }
        }

        .notification-toast.danger { border-left: 4px solid #ef4444; }
        .notification-toast.danger .notification-icon { color: #ef4444; }
        .notification-toast.danger::after { background: #ef4444; }

        .notification-toast.success { border-left: 4px solid #289912; }
        .notification-toast.success .notification-icon { color: #289912; }
        .notification-toast.success::after { background: #289912; }

        .notification-toast.warning { border-left: 4px solid #f59e0b; }
        .notification-toast.warning .notification-icon { color: #f59e0b; }
        .notification-toast.warning::after { background: #f59e0b; }

        .notification-icon {
          display: flex;
          align-items: center;
          justify-content: center;
          width: 24px;
        }

        .notification-content {
          flex: 1;
        }

        .notification-title {
          font-weight: 700;
          font-size: 0.9rem;
          color: #fff;
          margin-bottom: 4px;
        }

        .notification-message {
          font-size: 0.8rem;
          color: rgba(255, 255, 255, 0.7);
          line-height: 1.4;
        }

        .notification-close {
          background: transparent;
          border: none;
          color: rgba(255, 255, 255, 0.4);
          cursor: pointer;
          padding: 4px;
          border-radius: 4px;
          height: fit-content;
          transition: all 0.2s;
        }

        .notification-close:hover {
          background: rgba(255, 255, 255, 0.1);
          color: #fff;
        }
      `}</style>
    </div>
  );
}
