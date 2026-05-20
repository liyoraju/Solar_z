import React from 'react';
import { Zap, TrendingUp, TrendingDown, Sun, AlertTriangle } from 'lucide-react';
import { useTheme } from '../hooks/useTheme';
import { useOverview, useHistory } from '../hooks/useApi';
import { useWebSocket } from '../hooks/useWebSocket';
import { formatNumber, formatCurrency } from '../utils/helpers';

interface StatCardProps {
  title: string;
  value: string;
  unit?: string;
  icon: React.ReactNode;
  trend?: number;
  trendLabel?: string;
  bgColor: string;
  progress?: number;
  progressColor?: string;
  gapInfo?: { kwh: number };
}

const StatCard: React.FC<StatCardProps> = ({
  title,
  value,
  unit,
  icon,
  trend,
  trendLabel,
  bgColor,
  progress,
  progressColor,
  gapInfo,
}) => {
  const { themeColors } = useTheme();

  return (
    <div className={`relative overflow-hidden rounded-2xl ${themeColors.surface} ${themeColors.cardShadow} p-4 sm:p-5 transition-all duration-500 hover:scale-[1.02]`}>
      <div className="flex items-start justify-between mb-3">
        <div className={`p-2.5 rounded-xl ${bgColor}`}>
          {icon}
        </div>
        {trend !== undefined && (
          <div className={`flex items-center gap-1 text-xs font-medium ${trend >= 0 ? 'text-green-500' : 'text-red-500'}`}>
            {trend >= 0 ? <TrendingUp className="w-3.5 h-3.5" /> : <TrendingDown className="w-3.5 h-3.5" />}
            {Math.abs(trend)}%
            {trendLabel && <span className={themeColors.textSecondary}>{trendLabel}</span>}
          </div>
        )}
      </div>
      <p className={`text-xs font-medium ${themeColors.textSecondary} mb-1`}>{title}</p>
      <div className="flex items-baseline gap-1">
        <span className={`text-2xl sm:text-3xl font-bold ${themeColors.text}`}>{value}</span>
        {unit && <span className={`text-sm ${themeColors.textSecondary}`}>{unit}</span>}
      </div>
      {gapInfo && gapInfo.kwh > 0 && (
        <div className="flex items-center gap-1 mt-1.5 text-amber-600 dark:text-amber-400 text-[10px] font-medium">
          <AlertTriangle className="w-3 h-3" />
          <span>+{formatNumber(gapInfo.kwh, 2)} kWh gap</span>
        </div>
      )}
      {progress !== undefined && (
        <div className="mt-3">
          <div className={`h-2 rounded-full ${themeColors.bg} overflow-hidden`}>
            <div
              className={`h-full rounded-full transition-all duration-1000 ${progressColor}`}
              style={{ width: `${Math.min(100, progress)}%` }}
            />
          </div>
        </div>
      )}
    </div>
  );
};

export const StatsCards: React.FC = () => {
  const { timeOfDay } = useTheme();
  const { data: overview } = useOverview();
  const { telemetry } = useWebSocket();
  const history = useHistory(7);

  const accentColors = {
    morning: { primary: 'text-orange-500', bg: 'bg-orange-50', bar: 'bg-orange-400' },
    afternoon: { primary: 'text-blue-500', bg: 'bg-blue-50', bar: 'bg-blue-400' },
    evening: { primary: 'text-orange-600', bg: 'bg-orange-50', bar: 'bg-orange-500' },
    night: { primary: 'text-blue-400', bg: 'bg-blue-900/20', bar: 'bg-blue-400' },
  }[timeOfDay];

  const pv1Power = telemetry?.pv1_power ?? overview?.pv_power ?? 0;
  const pv2Power = telemetry?.pv2_power ?? 0;
  const totalPv = pv1Power + pv2Power;
  const loadPower = telemetry?.load_power ?? overview?.load_power ?? 0;
  const dailyProd = telemetry?.daily_production ?? overview?.daily_production ?? 0;
  const dailySavings = telemetry?.daily_savings ?? overview?.daily_savings ?? 0;

  const avgPvPower = (() => {
    const vals = history.map(h => h.avg_pv_power).filter((v): v is number => v != null);
    return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : 0;
  })();
  const avgDailyProd = (() => {
    const vals = history.map(h => h.daily_production_kwh).filter((v): v is number => v != null);
    return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : 0;
  })();
  const avgDailySavings = (() => {
    const vals = history.map(h => h.daily_savings).filter((v): v is number => v != null);
    return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : 0;
  })();

  const pvTrend = avgPvPower > 0 ? ((totalPv - avgPvPower) / avgPvPower) * 100 : 0;
  const prodTrend = avgDailyProd > 0 ? ((dailyProd - avgDailyProd) / avgDailyProd) * 100 : 0;
  const savingsTrend = avgDailySavings > 0 ? ((dailySavings - avgDailySavings) / avgDailySavings) * 100 : 0;

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
      <StatCard
        title="Daily Production"
        value={formatNumber(dailyProd, 2)}
        unit="kWh"
        icon={<Sun className={`w-5 h-5 ${accentColors.primary}`} />}
        trend={Math.round(prodTrend * 10) / 10}
        trendLabel="vs avg"
        bgColor={accentColors.bg}
        gapInfo={{ kwh: overview?.daily_gap_kwh ?? 0 }}
      />
      <StatCard
        title="PV Power"
        value={formatNumber(totalPv, 0)}
        unit="W"
        icon={<Sun className={`w-5 h-5 ${accentColors.primary}`} />}
        trend={Math.round(pvTrend * 10) / 10}
        trendLabel="vs avg"
        bgColor={accentColors.bg}
      />
      <StatCard
        title="Load Power"
        value={formatNumber(loadPower, 0)}
        unit="W"
        icon={<Zap className={`w-5 h-5 ${accentColors.primary}`} />}
        bgColor={accentColors.bg}
      />
      <StatCard
        title="Daily Savings"
        value={formatCurrency(dailySavings, 'INR')}
        icon={<TrendingUp className={`w-5 h-5 ${accentColors.primary}`} />}
        trend={Math.round(savingsTrend * 10) / 10}
        bgColor={accentColors.bg}
      />
    </div>
  );
};
