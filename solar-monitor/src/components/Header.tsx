import React, { useState, useEffect, useRef } from 'react';
import { Sun, Sunrise, Sunset, Moon, Bell, Wifi, WifiOff, Zap, CheckCircle, X, AlertTriangle, Info, XCircle, Clock } from 'lucide-react';
import { useTheme } from '../hooks/useTheme';
import { useWebSocket } from '../hooks/useWebSocket';
import { formatTime, formatDate, getGreeting } from '../utils/helpers';

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

const severityConfig: Record<string, { icon: React.FC<any>; color: string }> = {
  critical: { icon: XCircle, color: 'text-red-500' },
  warning: { icon: AlertTriangle, color: 'text-orange-500' },
  info: { icon: Info, color: 'text-blue-500' },
};

function timeAgo(dateStr: string): string {
  const s = Math.floor((Date.now() - new Date(dateStr).getTime()) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} hour ago`;
  return `${Math.floor(s / 86400)} days ago`;
}

export const Header: React.FC = () => {
  const { timeOfDay, currentTime, themeColors } = useTheme();
  const { connected, alerts: wsAlerts } = useWebSocket();
  const [showDropdown, setShowDropdown] = useState(false);
  const [alerts, setAlerts] = useState<AlertItem[]>([]);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const ignorePhaseAlerts = (alert: AlertItem) =>
    !alert.message?.includes('Phase T') && !alert.message?.includes('Phase S');

  useEffect(() => {
    const fetchAlerts = async () => {
      try {
        const res = await fetch('/api/alerts?limit=20');
        if (res.ok) {
          const data = await res.json();
          setAlerts(data.filter(ignorePhaseAlerts));
        }
      } catch {}
    };
    fetchAlerts();
  }, []);

  useEffect(() => {
    if (wsAlerts.length > 0) {
      setAlerts(prev => {
        const existingIds = new Set(prev.map(a => a.id));
        const newAlerts = wsAlerts.filter((a: AlertItem) => !existingIds.has(a.id)).filter(ignorePhaseAlerts);
        return [...newAlerts, ...prev].slice(0, 50);
      });
    }
  }, [wsAlerts]);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setShowDropdown(false);
      }
    };
    if (showDropdown) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showDropdown]);

  const unacknowledged = alerts.filter(a => !a.acknowledged).length;

  const handleAck = async (id: number) => {
    try {
      await fetch(`/api/alerts/${id}/acknowledge`, { method: 'POST' });
      setAlerts(prev => prev.map(a => a.id === id ? { ...a, acknowledged: true } : a));
    } catch {}
  };

  const TimeIcon = {
    morning: Sunrise,
    afternoon: Sun,
    evening: Sunset,
    night: Moon,
  }[timeOfDay];

  const accentColor = {
    morning: 'text-orange-500',
    afternoon: 'text-blue-500',
    evening: 'text-orange-600',
    night: 'text-blue-400',
  }[timeOfDay];

  return (
    <header className={`sticky top-0 z-50 ${themeColors.glass} transition-all duration-700`}>
      <div className="max-w-[1400px] mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16 sm:h-18">
          {/* Logo */}
          <div className="flex items-center gap-3">
            <div className={`relative w-9 h-9 rounded-xl flex items-center justify-center ${themeColors.accentLight}`}>
              <Zap className={`w-5 h-5 ${accentColor}`} />
              <div className={`absolute -top-0.5 -right-0.5 w-2.5 h-2.5 rounded-full ${connected ? 'bg-green-500' : 'bg-red-500'} border-2 border-white`} />
            </div>
            <div className="hidden sm:block">
              <h1 className={`text-lg font-bold ${themeColors.text} leading-tight`}>SolarApp</h1>
              <p className={`text-[10px] ${themeColors.textSecondary} -mt-0.5 tracking-wider uppercase`}>Solar Intelligence</p>
            </div>
          </div>

          {/* Center - Time & Greeting */}
          <div className="hidden md:flex flex-col items-center">
            <div className="flex items-center gap-2">
              <TimeIcon className={`w-4 h-4 ${accentColor}`} />
              <span className={`text-sm font-medium ${themeColors.textSecondary}`}>
                {getGreeting(currentTime.getHours())}
              </span>
            </div>
            <span className={`text-xs ${themeColors.textSecondary}`}>
              {formatDate(currentTime)} · {formatTime(currentTime)}
            </span>
          </div>

          {/* Right side */}
          <div className="flex items-center gap-2 sm:gap-3">
            <div className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-white/50 dark:bg-white/5">
              {connected ? (
                <Wifi className="w-3.5 h-3.5 text-green-500" />
              ) : (
                <WifiOff className="w-3.5 h-3.5 text-red-400" />
              )}
              <span className={`text-xs font-medium ${themeColors.textSecondary} hidden sm:inline`}>
                {connected ? 'Live' : 'Offline'}
              </span>
            </div>
            <div className="relative" ref={dropdownRef}>
              <button 
                onClick={() => setShowDropdown(!showDropdown)}
                className={`relative p-2 rounded-xl ${themeColors.surfaceHover} transition-colors`}
              >
                <Bell className={`w-5 h-5 ${themeColors.textSecondary}`} />
                {unacknowledged > 0 && (
                  <span className="absolute top-1 right-1 min-w-[16px] h-4 px-1 flex items-center justify-center bg-red-500 text-white text-[9px] font-bold rounded-full">
                    {unacknowledged > 9 ? '9+' : unacknowledged}
                  </span>
                )}
              </button>

              {showDropdown && (
                <div className={`fixed inset-x-2 top-[68px] sm:absolute sm:inset-x-auto sm:top-full sm:right-0 sm:mt-2 w-[calc(100%-1rem)] sm:w-80 md:w-96 max-h-[calc(100vh-80px)] sm:max-h-[400px] overflow-hidden rounded-2xl ${themeColors.surface} ${themeColors.cardShadow} border ${themeColors.border} z-[60]`}>
                  <div className={`flex items-center justify-between px-4 py-3 border-b ${themeColors.border}`}>
                    <h3 className={`text-sm font-bold ${themeColors.text}`}>
                      Alerts
                      {unacknowledged > 0 && (
                        <span className="ml-2 px-2 py-0.5 rounded-full bg-red-500 text-white text-[10px] font-bold">
                          {unacknowledged}
                        </span>
                      )}
                    </h3>
                    <button onClick={() => setShowDropdown(false)} className={`p-1 rounded-lg ${themeColors.surfaceHover}`}>
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                  <div className="overflow-y-auto max-h-[calc(100vh-140px)] sm:max-h-[340px] p-2">
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
                            className={`flex items-start gap-3 p-3 rounded-xl mb-1 transition-all duration-300 ${
                              alert.acknowledged
                                ? `${themeColors.bg} opacity-60`
                                : `${themeColors.surfaceHover}`
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
                                <span className={`text-[10px] px-1.5 py-0.5 rounded-full uppercase font-medium ${config.color}`}>
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
              )}
            </div>
            <div className={`w-8 h-8 rounded-full bg-gradient-to-br from-gray-300 to-gray-400 flex items-center justify-center text-xs font-bold text-white`}>
              U
            </div>
          </div>
        </div>
      </div>
    </header>
  );
};
