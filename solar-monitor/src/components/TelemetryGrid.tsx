import React from 'react';
import { useTheme } from '../hooks/useTheme';
import { useWebSocket } from '../hooks/useWebSocket';
import { formatNumber } from '../utils/helpers';
import { 
  Zap, Gauge, Activity, Waves, Sun, 
  ArrowRight, ArrowLeft, Thermometer 
} from 'lucide-react';

interface TelemetryItemProps {
  label: string;
  value: number | undefined;
  unit: string;
  icon: React.ReactNode;
  decimals?: number;
  highlight?: boolean;
}

const TelemetryItem: React.FC<TelemetryItemProps> = ({
  label,
  value,
  unit,
  icon,
  decimals = 2,
  highlight = false,
}) => {
  const { themeColors } = useTheme();

  return (
    <div className={`flex items-center gap-3 p-3 rounded-xl transition-all duration-300 ${
      highlight 
        ? `${themeColors.accentLight} ring-1 ring-inset ring-current/10` 
        : `${themeColors.surfaceHover}`
    }`}>
      <div className={`flex-shrink-0 w-9 h-9 rounded-lg flex items-center justify-center ${
        highlight ? themeColors.accentLight : 'bg-gray-100/50 dark:bg-white/5'
      }`}>
        {icon}
      </div>
      <div className="flex-1 min-w-0">
        <p className={`text-[11px] font-medium ${themeColors.textSecondary} truncate`}>{label}</p>
        <div className="flex items-baseline gap-1">
          <span className={`text-sm font-bold ${themeColors.text} tabular-nums`}>
            {formatNumber(value, decimals)}
          </span>
          <span className={`text-[10px] ${themeColors.textSecondary}`}>{unit}</span>
        </div>
      </div>
    </div>
  );
};

export const TelemetryGrid: React.FC = () => {
  const { themeColors, timeOfDay } = useTheme();
  const { telemetry } = useWebSocket();

  const accentColor = {
    morning: 'text-orange-500',
    afternoon: 'text-blue-500',
    evening: 'text-orange-600',
    night: 'text-blue-400',
  }[timeOfDay];

  const t = telemetry;

  return (
    <div className={`rounded-2xl ${themeColors.surface} ${themeColors.cardShadow} p-4 sm:p-6`}>
      <div className="flex items-center justify-between mb-5">
        <div>
          <h2 className={`text-base sm:text-lg font-bold ${themeColors.text}`}>Real-time Telemetry</h2>
          <p className={`text-xs ${themeColors.textSecondary} mt-0.5`}>
            Last updated: {t?.time ? new Date(t.time).toLocaleTimeString() : '—'}
          </p>
        </div>
        <div className={`px-3 py-1 rounded-full text-xs font-medium ${themeColors.accentLight} ${accentColor}`}>
          Live
        </div>
      </div>

      {/* PV Section */}
      <div className="mb-5">
        <div className="flex items-center gap-2 mb-3">
          <Sun className={`w-4 h-4 ${accentColor}`} />
          <h3 className={`text-xs font-bold uppercase tracking-wider ${themeColors.textSecondary}`}>Photovoltaic</h3>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
          <TelemetryItem label="PV1 Voltage" value={t?.pv1_voltage} unit="V" icon={<Zap className={`w-4 h-4 ${accentColor}`} />} decimals={1} />
          <TelemetryItem label="PV1 Current" value={t?.pv1_current} unit="A" icon={<Gauge className={`w-4 h-4 ${accentColor}`} />} decimals={2} />
          <TelemetryItem label="PV1 Power" value={t?.pv1_power} unit="W" icon={<Zap className={`w-4 h-4 ${accentColor}`} />} decimals={0} highlight />
        </div>
      </div>

      {/* Grid Section */}
      <div className="mb-5">
        <div className="flex items-center gap-2 mb-3">
          <Waves className={`w-4 h-4 ${accentColor}`} />
          <h3 className={`text-xs font-bold uppercase tracking-wider ${themeColors.textSecondary}`}>Grid Parameters</h3>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
          <TelemetryItem label="Grid Voltage R" value={t?.grid_voltage_r} unit="V" icon={<Zap className={`w-4 h-4 ${accentColor}`} />} decimals={1} />
          <TelemetryItem label="Grid Current R" value={t?.grid_current_r} unit="A" icon={<Gauge className={`w-4 h-4 ${accentColor}`} />} decimals={2} />
          <TelemetryItem label="Grid Frequency" value={t?.grid_frequency} unit="Hz" icon={<Activity className={`w-4 h-4 ${accentColor}`} />} decimals={2} highlight />
        </div>
      </div>

      {/* Power Section */}
      <div className="mb-5">
        <div className="flex items-center gap-2 mb-3">
          <Activity className={`w-4 h-4 ${accentColor}`} />
          <h3 className={`text-xs font-bold uppercase tracking-wider ${themeColors.textSecondary}`}>Power Flow</h3>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
          <TelemetryItem label="Load Power" value={t?.load_power} unit="W" icon={<Zap className={`w-4 h-4 ${accentColor}`} />} decimals={0} highlight />
          <TelemetryItem label="Inverter Power" value={t?.inverter_power} unit="W" icon={<Zap className={`w-4 h-4 ${accentColor}`} />} decimals={0} highlight />
        </div>
      </div>

      {/* Production Section */}
      <div className="mb-5">
        <div className="flex items-center gap-2 mb-3">
          <Sun className={`w-4 h-4 ${accentColor}`} />
          <h3 className={`text-xs font-bold uppercase tracking-wider ${themeColors.textSecondary}`}>Production & Savings</h3>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
          <TelemetryItem label="Daily Production" value={t?.daily_production} unit="kWh" icon={<Sun className={`w-4 h-4 ${accentColor}`} />} decimals={2} highlight />
          <TelemetryItem label="Total Production" value={t?.total_production} unit="kWh" icon={<Sun className={`w-4 h-4 ${accentColor}`} />} decimals={2} />
          <TelemetryItem label="Daily Grid Export" value={t?.daily_grid_export} unit="kWh" icon={<ArrowRight className={`w-4 h-4 ${accentColor}`} />} decimals={2} />
          <TelemetryItem label="Daily Grid Import" value={t?.daily_grid_import} unit="kWh" icon={<ArrowLeft className={`w-4 h-4 ${accentColor}`} />} decimals={2} />
          <TelemetryItem label="Daily Savings" value={t?.daily_savings} unit="INR" icon={<Zap className={`w-4 h-4 ${accentColor}`} />} decimals={2} highlight />
          <TelemetryItem label="Total Savings" value={t?.total_savings} unit="INR" icon={<Zap className={`w-4 h-4 ${accentColor}`} />} decimals={2} />
        </div>
      </div>

      {/* Temperature */}
      {t?.inverter_temperature !== undefined && (
        <div>
          <div className="flex items-center gap-2 mb-3">
            <Thermometer className={`w-4 h-4 ${accentColor}`} />
            <h3 className={`text-xs font-bold uppercase tracking-wider ${themeColors.textSecondary}`}>System Health</h3>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <TelemetryItem label="Inverter Temp" value={t.inverter_temperature} unit="°C" icon={<Thermometer className={`w-4 h-4 ${accentColor}`} />} decimals={1} />
          </div>
        </div>
      )}
    </div>
  );
};
