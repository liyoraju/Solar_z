import React from 'react';
import { useTheme } from '../hooks/useTheme';
import { useFinancial, useOverview, useTariffConfig, useBillingCycles } from '../hooks/useApi';
import { useWebSocket } from '../hooks/useWebSocket';
import { formatNumber, formatCurrency } from '../utils/helpers';
import { IndianRupee, TrendingUp, TrendingDown, Leaf, Zap, ArrowUpRight, ArrowDownRight, BarChart3, Calendar } from 'lucide-react';

function cycleLabel(cycle: { cycle_start: string; cycle_end: string | null; is_current: boolean }): string {
  if (cycle.is_current) return 'This Cycle';
  const start = new Date(cycle.cycle_start);
  const end = cycle.cycle_end ? new Date(cycle.cycle_end) : null;
  const startStr = start.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  const endStr = end ? end.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : 'Present';
  return `${startStr} – ${endStr}`;
}

export const FinancialOverview: React.FC = () => {
  const { themeColors, timeOfDay } = useTheme();
  const financial = useFinancial();
  const { data: overview } = useOverview();
  const { telemetry } = useWebSocket();
  const tariffConfig = useTariffConfig();
  const { data: cycles } = useBillingCycles(3);

  const accentColor = {
    morning: 'text-orange-500',
    afternoon: 'text-blue-500',
    evening: 'text-orange-600',
    night: 'text-blue-400',
  }[timeOfDay];

  const accentBg = {
    morning: 'bg-orange-50',
    afternoon: 'bg-blue-50',
    evening: 'bg-orange-50',
    night: 'bg-blue-900/20',
  }[timeOfDay];

  const totalProd = telemetry?.total_production ?? financial?.total_production_kwh ?? overview?.total_production ?? 0;
  const todayProd = telemetry?.daily_production ?? financial?.today_production_kwh ?? overview?.daily_production ?? 0;
  const totalSavings = telemetry?.total_savings ?? financial?.total_savings ?? overview?.total_savings ?? 0;
  const todaySavings = telemetry?.daily_savings ?? financial?.today_savings ?? overview?.daily_savings ?? 0;
  const co2 = financial?.co2_avoided_tonnes ?? (totalProd / 1000 * 0.42);
  const currency = tariffConfig?.currency ?? financial?.currency ?? 'INR';
  const feedIn = tariffConfig?.feed_in_tariff ?? financial?.feed_in_tariff ?? 3.5;
  const importTariff = tariffConfig?.active_rate ?? financial?.grid_import_tariff ?? 6.0;
  const tariffMode = tariffConfig?.mode ?? 'telescopic';

  const currentCycle = cycles.find(c => c.is_current) || null;
  const prevCycle = cycles.length > 1 ? cycles[1] : null;
  const cycleSavings = currentCycle?.total_savings ?? 0;
  const cycleProd = currentCycle?.total_production_kwh ?? 0;
  const cycleLabelStr = currentCycle ? cycleLabel(currentCycle) : 'This Cycle';
  const savingsTrend = prevCycle && prevCycle.total_savings > 0
    ? ((cycleSavings - prevCycle.total_savings) / prevCycle.total_savings * 100)
    : null;

  return (
    <div className={`rounded-2xl ${themeColors.surface} ${themeColors.cardShadow} p-4 sm:p-6`}>
      <div className="flex items-center justify-between mb-5">
        <div>
          <h2 className={`text-base sm:text-lg font-bold ${themeColors.text}`}>Financial Overview</h2>
          <p className={`text-xs ${themeColors.textSecondary} mt-0.5`}>Track your savings and earnings</p>
        </div>
        <div className={`p-2 rounded-xl ${accentBg}`}>
          <IndianRupee className={`w-5 h-5 ${accentColor}`} />
        </div>
      </div>

      {/* Main savings cards */}
      <div className="grid grid-cols-2 gap-3 mb-3">
        <div className={`p-4 rounded-xl ${themeColors.bg} border ${themeColors.border}`}>
          <div className="flex items-center gap-2 mb-2">
            <TrendingUp className={`w-4 h-4 ${accentColor}`} />
            <span className={`text-[10px] uppercase tracking-wider font-medium ${themeColors.textSecondary}`}>Today</span>
          </div>
          <p className={`text-2xl font-bold ${themeColors.text}`}>{formatCurrency(todaySavings, currency)}</p>
          <p className={`text-xs ${themeColors.textSecondary} mt-1`}>{formatNumber(todayProd, 2)} kWh generated</p>
        </div>
        <div className={`p-4 rounded-xl ${themeColors.bg} border ${themeColors.border}`}>
          <div className="flex items-center gap-2 mb-2">
            <BarChart3 className={`w-4 h-4 ${accentColor}`} />
            <span className={`text-[10px] uppercase tracking-wider font-medium ${themeColors.textSecondary}`}>Total</span>
          </div>
          <p className={`text-2xl font-bold ${themeColors.text}`}>{formatCurrency(totalSavings, currency)}</p>
          <p className={`text-xs ${themeColors.textSecondary} mt-1`}>{formatNumber(totalProd, 1)} kWh lifetime</p>
        </div>
      </div>

      {/* Current cycle savings card */}
      {currentCycle && (
        <div className={`p-4 rounded-xl ${accentBg} border ${themeColors.border} mb-3`}>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Calendar className={`w-4 h-4 ${accentColor}`} />
              <span className={`text-[10px] uppercase tracking-wider font-medium ${themeColors.textSecondary}`}>{cycleLabelStr}</span>
            </div>
            {savingsTrend !== null && (
              <div className={`flex items-center gap-1 text-xs font-medium ${
                savingsTrend >= 0 ? 'text-green-500' : 'text-red-500'
              }`}>
                {savingsTrend >= 0 ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
                {Math.abs(savingsTrend).toFixed(0)}%
              </div>
            )}
          </div>
          <div className="flex items-baseline gap-2 mt-2">
            <p className={`text-2xl font-bold ${themeColors.text}`}>{formatCurrency(cycleSavings, currency)}</p>
            <span className={`text-xs ${themeColors.textSecondary}`}>{formatNumber(cycleProd, 1)} kWh</span>
          </div>
        </div>
      )}

      {/* Tariff info */}
      <div className={`p-3 rounded-xl ${themeColors.bg} mb-4`}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <ArrowUpRight className="w-4 h-4 text-green-500" />
            <div>
              <p className={`text-[10px] ${themeColors.textSecondary}`}>Feed-in Tariff</p>
              <p className={`text-sm font-bold ${themeColors.text}`}>{formatCurrency(feedIn, currency)}/kWh</p>
            </div>
          </div>
          <div className="w-px h-8 bg-current opacity-10" />
          <div className="flex items-center gap-2">
            <ArrowDownRight className="w-4 h-4 text-orange-500" />
            <div>
              <p className={`text-[10px] ${themeColors.textSecondary}`}>Import Tariff</p>
              <p className={`text-sm font-bold ${themeColors.text}`}>{formatCurrency(importTariff, currency)}/kWh</p>
            </div>
          </div>
          <div className="w-px h-8 bg-current opacity-10 hidden sm:block" />
          <div className="hidden sm:flex items-center gap-2">
            <Zap className={`w-4 h-4 ${accentColor}`} />
            <div>
              <p className={`text-[10px] ${themeColors.textSecondary}`}>Mode</p>
              <p className={`text-sm font-bold ${themeColors.text} capitalize`}>{tariffMode === 'telescopic' ? 'Slab-wise' : 'Non-telescopic'}</p>
            </div>
          </div>
        </div>
      </div>

      {/* CO2 Impact */}
      <div className={`flex items-center gap-3 p-3 rounded-xl ${accentBg}`}>
        <div className={`p-2 rounded-lg bg-green-500/10`}>
          <Leaf className="w-5 h-5 text-green-500" />
        </div>
        <div>
          <p className={`text-xs font-medium ${themeColors.textSecondary}`}>CO₂ Avoided</p>
          <p className={`text-lg font-bold ${themeColors.text}`}>{formatNumber(co2, 2)} tonnes</p>
        </div>
        <div className="ml-auto">
          <Zap className={`w-5 h-5 ${accentColor} opacity-50`} />
        </div>
      </div>
    </div>
  );
};
