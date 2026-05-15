import React from 'react';
import { useTheme } from '../hooks/useTheme';
import { useWebSocket } from '../hooks/useWebSocket';
import { useOverview } from '../hooks/useApi';
import { formatNumber } from '../utils/helpers';
import { Zap, Home, ArrowRight, ArrowLeft, Sun } from 'lucide-react';

export const SolarHouseVisualization: React.FC = () => {
  const { themeColors, timeOfDay } = useTheme();
  const { telemetry } = useWebSocket();
  const { data: overview } = useOverview();

  const pv1Power = telemetry?.pv1_power ?? 0;
  const pv2Power = telemetry?.pv2_power ?? 0;
  const totalPv = pv1Power + pv2Power;
  const loadPower = telemetry?.load_power ?? overview?.load_power ?? 0;
  const gridPower = telemetry?.grid_power ?? overview?.grid_power ?? 0;

  const isExporting = gridPower > 0;

  const accentColor = {
    morning: '#E87A2A',
    afternoon: '#1A7AE8',
    evening: '#C45D3A',
    night: '#5BA3F5',
  }[timeOfDay];

  const glowColor = {
    morning: 'rgba(232, 122, 42, 0.3)',
    afternoon: 'rgba(26, 122, 232, 0.3)',
    evening: 'rgba(196, 93, 58, 0.3)',
    night: 'rgba(91, 163, 245, 0.3)',
  }[timeOfDay];

  return (
    <div className={`rounded-2xl ${themeColors.surface} ${themeColors.cardShadow} p-4 sm:p-6`}>
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className={`text-base sm:text-lg font-bold ${themeColors.text}`}>Energy Flow</h2>
          <p className={`text-xs ${themeColors.textSecondary} mt-0.5`}>Real-time system visualization</p>
        </div>
        <div className={`px-3 py-1 rounded-full text-xs font-medium ${themeColors.accentLight} ${themeColors.accent}`}>
          {isExporting ? 'Exporting to Grid' : 'Self-Consuming'}
        </div>
      </div>

      <div className="relative flex flex-col items-center gap-6 py-4">
        {/* Sun / Moon */}
        <div className="flex items-center gap-4">
          <div 
            className="w-16 h-16 rounded-full flex items-center justify-center animate-pulse-slow"
            style={{ 
              background: `radial-gradient(circle, ${accentColor}40, ${accentColor}10)`,
              boxShadow: `0 0 40px ${glowColor}` 
            }}
          >
            <Sun className="w-8 h-8" style={{ color: accentColor }} />
          </div>
          <div className="text-center">
            <p className={`text-xs ${themeColors.textSecondary}`}>Solar Generation</p>
            <p className={`text-xl font-bold ${themeColors.text}`}>{formatNumber(totalPv, 0)} W</p>
            <p className={`text-[10px] ${themeColors.textSecondary}`}>
              PV1: {formatNumber(pv1Power, 0)}W · PV2: {formatNumber(pv2Power, 0)}W
            </p>
          </div>
        </div>

        {/* Flow arrows */}
        <div className="flex items-center gap-2">
          <div className="w-0.5 h-8 bg-gradient-to-b from-current to-transparent opacity-30" style={{ color: accentColor }} />
          <ArrowRight className="w-4 h-4 animate-bounce" style={{ color: accentColor }} />
        </div>

        {/* House */}
          <div 
            className="w-32 h-32 sm:w-40 sm:h-40 rounded-2xl flex flex-col items-center justify-center gap-2"
            style={{ 
              background: `linear-gradient(135deg, ${accentColor}15, ${accentColor}05)`,
              border: `2px solid ${accentColor}30`,
              boxShadow: `0 0 30px ${glowColor}` 
            }}
          >
            <Home className="w-10 h-10 sm:w-12 sm:h-12" style={{ color: accentColor }} />
            <div className="text-center">
              <p className={`text-[10px] ${themeColors.textSecondary}`}>Load</p>
              <p className={`text-sm font-bold ${themeColors.text}`}>{formatNumber(loadPower, 0)} W</p>
            </div>
          </div>

        {/* Grid connection */}
        <div className="flex items-center gap-4 mt-2">
          <div className="flex items-center gap-2 px-4 py-2 rounded-xl" style={{ background: `${accentColor}10` }}>
            {isExporting ? (
              <ArrowRight className="w-4 h-4 text-green-500" />
            ) : (
              <ArrowLeft className="w-4 h-4 text-orange-500" />
            )}
            <div>
              <p className={`text-[10px] ${themeColors.textSecondary}`}>{isExporting ? 'Exporting' : 'Importing'}</p>
              <p className={`text-sm font-bold ${themeColors.text}`}>{formatNumber(Math.abs(gridPower), 0)} W</p>
            </div>
          </div>
        </div>

        {/* Stats row */}
        <div className="grid grid-cols-3 gap-3 w-full mt-2">
          <div className={`text-center p-2 rounded-lg ${themeColors.bg}`}>
            <p className={`text-[10px] ${themeColors.textSecondary}`}>Daily Prod</p>
            <p className={`text-sm font-bold ${themeColors.text}`}>{formatNumber(telemetry?.daily_production || overview?.daily_production, 1)} kWh</p>
          </div>
          <div className={`text-center p-2 rounded-lg ${themeColors.bg}`}>
            <p className={`text-[10px] ${themeColors.textSecondary}`}>Daily Export</p>
            <p className={`text-sm font-bold ${themeColors.text}`}>{formatNumber(telemetry?.daily_grid_export, 1)} kWh</p>
          </div>
          <div className={`text-center p-2 rounded-lg ${themeColors.bg}`}>
            <p className={`text-[10px] ${themeColors.textSecondary}`}>Daily Import</p>
            <p className={`text-sm font-bold ${themeColors.text}`}>{formatNumber(telemetry?.daily_grid_import, 1)} kWh</p>
          </div>
        </div>
      </div>
    </div>
  );
};
