import React, { useEffect, useState } from 'react';
import { useTheme } from '../hooks/useTheme';
import { useWebSocket } from '../hooks/useWebSocket';
import { AlertTriangle, CheckCircle, Info, XCircle, Bell, Clock } from 'lucide-react';
import { apiFetch } from '../services/apiConfig';

interface AlertItem {
  id: number;
  created_at: string;
  inverter_sn: string;
  alert_type: string;
  severity: string;
  message: string;
  value?: number;
  threshold?: number;
  acknowledged: boolean;
}

const severityConfig: Record<string, { icon: React.FC<any>; color: string; bg: string; border: string }> = {
  critical: { icon: XCircle, color: 'text-red-500', bg: 'bg-red-50', border: 'border-red-200' },
  warning: { icon: AlertTriangle, color: 'text-orange-500', bg: 'bg-orange-50', border: 'border-orange-200' },
  info: { icon: Info, color: 'text-blue-500', bg: 'bg-blue-50', border: 'border-blue-200' },
};

function timeAgo(dateStr: string): string {
  const s = Math.floor((Date.now() - new Date(dateStr).getTime()) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} hour ago`;
  return `${Math.floor(s / 86400)} days ago`;
}

export const AlertsPanel: React.FC = () => {
  const { themeColors } = useTheme();
  const [alerts, setAlerts] = useState<AlertItem[]>([]);

  useEffect(() => {
    const fetchAlerts = async () => {
      try {
        const res = await apiFetch('/api/alerts?limit=20');
        if (res.ok) setAlerts(await res.json());
      } catch {}
    };
    fetchAlerts();
    const id = setInterval(fetchAlerts, 30000);
    return () => clearInterval(id);
  }, []);

  const unacknowledged = alerts.filter(a => !a.acknowledged);

  const handleAck = async (id: number) => {
    try {
      await apiFetch(`/api/alerts/${id}/acknowledge`, { method: 'POST' });
      setAlerts(prev => prev.map(a => a.id === id ? { ...a, acknowledged: true } : a));
    } catch {}
  };

  return (
    <div className={`rounded-2xl ${themeColors.surface} ${themeColors.cardShadow} p-4 sm:p-6`}>
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <h2 className={`text-base sm:text-lg font-bold ${themeColors.text}`}>Alerts</h2>
          {unacknowledged.length > 0 && (
            <span className="px-2 py-0.5 rounded-full bg-red-500 text-white text-[10px] font-bold">
              {unacknowledged.length}
            </span>
          )}
        </div>
        <Bell className={`w-5 h-5 ${themeColors.textSecondary}`} />
      </div>

      <div className="space-y-2 max-h-[300px] overflow-y-auto scrollbar-hide">
        {alerts.length === 0 ? (
          <div className={`text-center py-8 ${themeColors.textSecondary}`}>
            <CheckCircle className="w-8 h-8 mx-auto mb-2 opacity-50" />
            <p className="text-sm">No active alerts</p>
          </div>
        ) : (
          alerts.map((alert) => {
            const config = severityConfig[alert.severity] || severityConfig.info;
            const Icon = config.icon;
            return (
              <div key={alert.id}
                className={`flex items-start gap-3 p-3 rounded-xl border transition-all duration-300 ${
                  alert.acknowledged
                    ? `${themeColors.bg} ${themeColors.border} opacity-60`
                    : `${config.bg} ${config.border}`
                }`}
              >
                <div className={`flex-shrink-0 mt-0.5 ${config.color}`}>
                  <Icon className="w-4 h-4" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className={`text-xs font-medium ${themeColors.text} leading-relaxed`}>
                    {alert.message}
                  </p>
                  <div className="flex items-center gap-2 mt-1.5">
                    <Clock className={`w-3 h-3 ${themeColors.textSecondary}`} />
                    <span className={`text-[10px] ${themeColors.textSecondary}`}>{timeAgo(alert.created_at)}</span>
                    <span className={`text-[10px] px-1.5 py-0.5 rounded-full uppercase font-medium ${config.bg} ${config.color}`}>
                      {alert.severity}
                    </span>
                  </div>
                </div>
                {!alert.acknowledged && (
                  <button onClick={() => handleAck(alert.id)}
                    className={`flex-shrink-0 p-1.5 rounded-lg ${themeColors.surfaceHover} transition-colors`}
                  >
                    <CheckCircle className="w-4 h-4 text-green-500" />
                  </button>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};
