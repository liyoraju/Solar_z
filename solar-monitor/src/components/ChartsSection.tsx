import React, { useState } from 'react';
import {
  AreaChart, Area, BarChart, Bar, LineChart, Line,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, Legend, ReferenceLine
} from 'recharts';
import { useTheme } from '../hooks/useTheme';
import { useHourlyHistory, useHistory, useMonthlyStats } from '../hooks/useApi';
import { useWebSocket } from '../hooks/useWebSocket';
import { formatNumber, formatCurrency } from '../utils/helpers';
import { TrendingUp, Calendar, Clock, BarChart3, PieChart as PieIcon, Activity } from 'lucide-react';

type ChartTab = 'hourly' | 'daily' | 'monthly' | 'production' | 'distribution';

const CustomTooltip: React.FC<any> = ({ active, payload, label, unit = '' }) => {
  const { themeColors } = useTheme();
  if (!active || !payload?.length) return null;

  return (
    <div className={`${themeColors.surface} border ${themeColors.border} rounded-xl p-3 shadow-lg`}>
      <p className={`text-xs font-medium ${themeColors.textSecondary} mb-2`}>{label}</p>
      {payload.map((entry: any, idx: number) => (
        <div key={idx} className="flex items-center gap-2 text-xs">
          <div className="w-2 h-2 rounded-full" style={{ backgroundColor: entry.color }} />
          <span className={themeColors.textSecondary}>{entry.name}:</span>
          <span className={`font-bold ${themeColors.text}`}>
            {formatNumber(entry.value, 1)} {unit}
          </span>
        </div>
      ))}
    </div>
  );
};

export const ChartsSection: React.FC = () => {
  const { themeColors, timeOfDay } = useTheme();
  const [activeTab, setActiveTab] = useState<ChartTab>('hourly');
  const hourlyData = useHourlyHistory();
  const dailyData = useHistory(14);
  const monthlyData = useMonthlyStats(12);
  const { telemetry } = useWebSocket();

  const accentColor = {
    morning: '#E87A2A',
    afternoon: '#1A7AE8',
    evening: '#C45D3A',
    night: '#5BA3F5',
  }[timeOfDay];

  const secondaryColor = {
    morning: '#FFB347',
    afternoon: '#60A5FA',
    evening: '#E8965A',
    night: '#7EC8E3',
  }[timeOfDay];

  const gridColor = themeColors.chartGrid;
  const textColor = timeOfDay === 'night' ? '#8B95A5' : '#6B7B8B';

  // Production vs Consumption data
  const productionData = hourlyData.map(d => ({
    time: d.time,
    production: d.avg_pv_power || 0,
    consumption: (d.avg_inverter_power || 0) * 0.85,
  }));

  // Daily production data
  const dailyProdData = dailyData.map(d => ({
    day: d.time?.slice(5) || '',
    production: d.daily_production_kwh || 0,
    savings: d.daily_savings || 0,
  }));

  // Monthly production data
  const monthlyChartData = monthlyData.data
    .slice()
    .reverse()
    .map(d => {
      const monthLabel = new Date(d.month + '-01').toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
      return {
        month: monthLabel,
        production: d.monthly_production_kwh,
        savings: d.monthly_savings,
        export: d.total_grid_export_kwh,
        import: d.total_grid_import_kwh,
        selfConsumption: d.self_consumption_pct,
      };
    });

  const hasMonthlyData = monthlyChartData.length >= 2 && monthlyChartData.some(d => d.production > 0 || d.export > 0 || d.import > 0);

  // Power distribution
  const totalPv = (telemetry?.pv1_power || 0);
  const distributionData = [
    { name: 'PV1 Power', value: telemetry?.pv1_power || 0, color: accentColor },
    { name: 'Load Power', value: telemetry?.load_power || 0, color: '#22C55E' },
    { name: 'Grid Export', value: Math.max(0, telemetry?.daily_grid_export || 0), color: '#F59E0B' },
  ].filter(d => d.value > 0);

  const tabs: { key: ChartTab; label: string; icon: React.ReactNode }[] = [
    { key: 'hourly', label: 'Hourly', icon: <Clock className="w-4 h-4" /> },
    { key: 'daily', label: 'Daily', icon: <Calendar className="w-4 h-4" /> },
    { key: 'monthly', label: 'Monthly', icon: <BarChart3 className="w-4 h-4" /> },
    { key: 'production', label: 'Production', icon: <Activity className="w-4 h-4" /> },
    { key: 'distribution', label: 'Distribution', icon: <PieIcon className="w-4 h-4" /> },
  ];

  return (
    <div className={`rounded-2xl ${themeColors.surface} ${themeColors.cardShadow} p-4 sm:p-6`}>
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-5">
        <div>
          <h2 className={`text-base sm:text-lg font-bold ${themeColors.text}`}>Analytics & Trends</h2>
          <p className={`text-xs ${themeColors.textSecondary} mt-0.5`}>Visualize your solar performance</p>
        </div>
        <div className="flex gap-1 p-1 rounded-xl bg-gray-100/50 dark:bg-white/5 overflow-x-auto scrollbar-hide">
          {tabs.map((tab) => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium transition-all duration-300 whitespace-nowrap ${
                activeTab === tab.key
                  ? `${themeColors.accentLight} ${themeColors.accent}`
                  : `${themeColors.textSecondary} hover:${themeColors.surfaceHover}`
              }`}
            >
              {tab.icon}
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      <div className="h-[250px] sm:h-[350px] md:h-[400px]">
        <ResponsiveContainer width="100%" height="100%">
          {activeTab === 'hourly' && (
            <AreaChart data={hourlyData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
              <defs>
                <linearGradient id="pvGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor={accentColor} stopOpacity={0.3} />
                  <stop offset="95%" stopColor={accentColor} stopOpacity={0} />
                </linearGradient>
                <linearGradient id="invGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor={secondaryColor} stopOpacity={0.2} />
                  <stop offset="95%" stopColor={secondaryColor} stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke={gridColor} vertical={false} />
              <XAxis 
                dataKey="time" 
                stroke={textColor} 
                fontSize={11} 
                tickLine={false}
                axisLine={false}
              />
              <YAxis 
                stroke={textColor} 
                fontSize={11} 
                tickLine={false}
                axisLine={false}
                tickFormatter={(v) => `${v}`}
              />
              <Tooltip content={<CustomTooltip unit="W" />} />
              <Area
                type="monotone"
                dataKey="avg_pv_power"
                name="PV Power"
                stroke={accentColor}
                strokeWidth={2}
                fill="url(#pvGradient)"
              />
              <Area
                type="monotone"
                dataKey="avg_inverter_power"
                name="Inverter Power"
                stroke={secondaryColor}
                strokeWidth={2}
                fill="url(#invGradient)"
              />
              <Legend 
                wrapperStyle={{ fontSize: '12px', paddingTop: '10px' }}
                iconType="circle"
                iconSize={8}
              />
            </AreaChart>
          )}

          {activeTab === 'daily' && (
            <BarChart data={dailyProdData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={gridColor} vertical={false} />
              <XAxis 
                dataKey="day" 
                stroke={textColor} 
                fontSize={11}
                tickLine={false}
                axisLine={false}
              />
              <YAxis 
                stroke={textColor} 
                fontSize={11}
                tickLine={false}
                axisLine={false}
              />
              <Tooltip content={<CustomTooltip unit="kWh" />} />
              <Bar 
                dataKey="production" 
                name="Daily Production" 
                fill={accentColor} 
                radius={[4, 4, 0, 0]}
                maxBarSize={40}
              />
              <Bar 
                dataKey="savings" 
                name="Daily Savings" 
                fill={secondaryColor} 
                radius={[4, 4, 0, 0]}
                maxBarSize={40}
              />
              <Legend 
                wrapperStyle={{ fontSize: '12px', paddingTop: '10px' }}
                iconType="circle"
                iconSize={8}
              />
            </BarChart>
          )}

          {activeTab === 'monthly' && (
            !hasMonthlyData ? (
              <div className="flex flex-col items-center justify-center h-full">
                <BarChart3 className={`w-12 h-12 ${themeColors.textSecondary} opacity-30 mb-3`} />
                <p className={`text-sm font-medium ${themeColors.textSecondary}`}>No monthly data available yet</p>
                <p className={`text-xs ${themeColors.textSecondary} mt-1`}>Needs 2+ months of data to show trends</p>
              </div>
            ) : (
            <BarChart data={monthlyChartData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={gridColor} vertical={false} />
              <XAxis 
                dataKey="month" 
                stroke={textColor} 
                fontSize={11}
                tickLine={false}
                axisLine={false}
              />
              <YAxis 
                stroke={textColor} 
                fontSize={11}
                tickLine={false}
                axisLine={false}
              />
              <Tooltip content={<CustomTooltip unit="kWh" />} />
              <Bar 
                dataKey="production" 
                name="Monthly Production" 
                fill={accentColor} 
                radius={[4, 4, 0, 0]}
                maxBarSize={40}
              />
              <Bar 
                dataKey="export" 
                name="Grid Export" 
                fill="#F59E0B" 
                radius={[4, 4, 0, 0]}
                maxBarSize={40}
              />
              <Bar 
                dataKey="import" 
                name="Grid Import" 
                fill="#EF4444" 
                radius={[4, 4, 0, 0]}
                maxBarSize={40}
              />
              <Legend 
                wrapperStyle={{ fontSize: '12px', paddingTop: '10px' }}
                iconType="circle"
                iconSize={8}
              />
            </BarChart>
            )
          )}

          {activeTab === 'production' && (
            <AreaChart data={productionData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
              <defs>
                <linearGradient id="prodGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#22C55E" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="#22C55E" stopOpacity={0} />
                </linearGradient>
                <linearGradient id="consGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#EF4444" stopOpacity={0.2} />
                  <stop offset="95%" stopColor="#EF4444" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke={gridColor} vertical={false} />
              <XAxis 
                dataKey="time" 
                stroke={textColor} 
                fontSize={11}
                tickLine={false}
                axisLine={false}
              />
              <YAxis 
                stroke={textColor} 
                fontSize={11}
                tickLine={false}
                axisLine={false}
              />
              <Tooltip content={<CustomTooltip unit="W" />} />
              <ReferenceLine y={0} stroke={gridColor} />
              <Area
                type="monotone"
                dataKey="production"
                name="Solar Production"
                stroke="#22C55E"
                strokeWidth={2}
                fill="url(#prodGradient)"
              />
              <Area
                type="monotone"
                dataKey="consumption"
                name="Load Consumption"
                stroke="#EF4444"
                strokeWidth={2}
                fill="url(#consGradient)"
              />
              <Legend 
                wrapperStyle={{ fontSize: '12px', paddingTop: '10px' }}
                iconType="circle"
                iconSize={8}
              />
            </AreaChart>
          )}

          {activeTab === 'distribution' && (
            <PieChart>
              <Pie
                data={distributionData}
                cx="50%"
                cy="50%"
                innerRadius={60}
                outerRadius={100}
                paddingAngle={4}
                dataKey="value"
                stroke="none"
              >
                {distributionData.map((entry, index) => (
                  <Cell key={`cell-${index}`} fill={entry.color} />
                ))}
              </Pie>
              <Tooltip 
                content={({ active, payload }) => {
                  if (!active || !payload?.length) return null;
                  const data = payload[0].payload;
                  return (
                    <div className={`${themeColors.surface} border ${themeColors.border} rounded-xl p-3 shadow-lg`}>
                      <div className="flex items-center gap-2">
                        <div className="w-3 h-3 rounded-full" style={{ backgroundColor: data.color }} />
                        <span className={`text-sm font-medium ${themeColors.text}`}>{data.name}</span>
                      </div>
                      <p className={`text-lg font-bold ${themeColors.text} mt-1`}>
                        {formatNumber(data.value, 0)} W
                      </p>
                    </div>
                  );
                }}
              />
              <Legend 
                verticalAlign="bottom" 
                height={36}
                wrapperStyle={{ fontSize: '12px' }}
                iconType="circle"
                iconSize={8}
              />
            </PieChart>
          )}
        </ResponsiveContainer>
      </div>
    </div>
  );
};
