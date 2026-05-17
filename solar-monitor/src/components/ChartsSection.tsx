import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  AreaChart, Area, BarChart, Bar, LineChart, Line,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, Legend, ReferenceLine
} from 'recharts';
import { useTheme } from '../hooks/useTheme';
import { useTelemetryHistory, useDailyAggregates, useHistory, useBillingCycles, HistoryPoint } from '../hooks/useApi';
import { useWebSocket } from '../hooks/useWebSocket';
import { formatNumber } from '../utils/helpers';
import { TrendingUp, Calendar, Clock, BarChart3, PieChart as PieIcon, Activity, ZoomIn, ZoomOut } from 'lucide-react';

type ChartTab = 'hourly' | 'daily' | 'cycles' | 'production' | 'distribution';

type ZoomLevel = '5sec' | '1min' | '5min' | '1hour' | '1day' | '1month';

interface ZoomConfig {
  level: ZoomLevel;
  interval: string;
  limit: number;
  label: string;
  xFormat: (value: string) => string;
  unit: string;
  useDaily: boolean;
}

const ZOOM_LEVELS: ZoomConfig[] = [
  {
    level: '5sec',
    interval: '5 second',
    limit: 720,
    label: '5s',
    unit: 'W',
    useDaily: false,
    xFormat: (v: string) => {
      try {
        const d = new Date(v);
        return d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
      } catch { return v; }
    },
  },
  {
    level: '1min',
    interval: '1 minute',
    limit: 480,
    label: '1m',
    unit: 'W',
    useDaily: false,
    xFormat: (v: string) => {
      try {
        const d = new Date(v);
        return d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
      } catch { return v; }
    },
  },
  {
    level: '5min',
    interval: '5 minute',
    limit: 288,
    label: '5m',
    unit: 'W',
    useDaily: false,
    xFormat: (v: string) => {
      try {
        const d = new Date(v);
        return d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
      } catch { return v; }
    },
  },
  {
    level: '1hour',
    interval: '1 hour',
    limit: 48,
    label: '1h',
    unit: 'W',
    useDaily: false,
    xFormat: (v: string) => {
      try {
        const d = new Date(v);
        return d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
      } catch { return v; }
    },
  },
  {
    level: '1day',
    interval: '1 day',
    limit: 60,
    label: '1d',
    unit: 'kWh',
    useDaily: true,
    xFormat: (v: string) => {
      try {
        const d = new Date(v);
        return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
      } catch { return v; }
    },
  },
  {
    level: '1month',
    interval: '1 day',
    limit: 90,
    label: '1mo',
    unit: 'kWh',
    useDaily: true,
    xFormat: (v: string) => {
      try {
        const d = new Date(v);
        return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
      } catch { return v; }
    },
  },
];

function cycleRangeLabel(cycle: { cycle_start: string; cycle_end: string | null; is_current: boolean }): string {
  if (cycle.is_current) return 'Current';
  const start = new Date(cycle.cycle_start);
  const end = cycle.cycle_end ? new Date(cycle.cycle_end) : null;
  const startStr = start.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  const endStr = end ? end.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : 'Present';
  return `${startStr} \u2013 ${endStr}`;
}

const getEntryUnit = (name: string, fallback: string) => {
  if (name === 'Daily Savings') return 'INR';
  if (name === 'Daily Production') return 'kWh';
  return fallback;
};

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
            {formatNumber(entry.value, 1)} {getEntryUnit(entry.name, unit)}
          </span>
        </div>
      ))}
    </div>
  );
};

export const ChartsSection: React.FC = () => {
  const { themeColors, timeOfDay } = useTheme();
  const [activeTab, setActiveTab] = useState<ChartTab>('hourly');
  const [zoomIndex, setZoomIndex] = useState(3);
  const [sliderIndex, setSliderIndex] = useState(0);
  const userInteracted = useRef(false);
  const dailyData = useHistory(14);
  const billingCycles = useBillingCycles(12);
  const { telemetry } = useWebSocket();

  useEffect(() => { userInteracted.current = false; setSliderIndex(0); }, [activeTab]);

  const zoom = ZOOM_LEVELS[zoomIndex];
  const timeData = zoom.useDaily
    ? useDailyAggregates(zoom.limit)
    : useTelemetryHistory(zoom.interval, zoom.limit);

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

  const zoomIn = useCallback(() => setZoomIndex(prev => Math.max(0, prev - 1)), []);
  const zoomOut = useCallback(() => setZoomIndex(prev => Math.min(ZOOM_LEVELS.length - 1, prev + 1)), []);
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === '+' || e.key === '=') { e.preventDefault(); zoomIn(); }
      if (e.key === '-') { e.preventDefault(); zoomOut(); }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [zoomIn, zoomOut]);

  const chartData = timeData.data.length > 0
    ? timeData.data.map(d => {
        const isDaily = zoom.useDaily;
        const prod = isDaily ? (d.daily_production_kwh || 0) : (d.avg_pv_power || 0);
        const inv = isDaily ? 0 : ((d.avg_inverter_power || 0) * 0.85);
        return {
          time: zoom.xFormat(d.time || ''),
          timeRaw: d.time,
          production: prod,
          consumption: inv,
        };
      })
    : [];

  const xAxisHeight = 30;
  const xAxisAngle = 0;
  const xAxisAnchor = 'middle' as const;

  const formatAxisDate = (iso: string | undefined, fallback: string) => {
    try {
      return new Date(iso!).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    } catch { return fallback; }
  };

  const dailyProdData = dailyData.map(d => ({
    day: formatAxisDate(d.time, d.time?.slice(5) || ''),
    production: d.daily_production_kwh || 0,
    savings: d.daily_savings || 0,
  }));

  const cyclesChartData = billingCycles.data
    .slice()
    .reverse()
    .map(c => ({
      label: cycleRangeLabel(c),
      production: c.total_production_kwh,
      savings: c.total_savings,
      export: c.total_grid_export_kwh,
      import: c.total_grid_import_kwh,
      isCurrent: c.is_current,
    }));

  const HOURLY_WINDOW = Math.max(1, Math.floor(chartData.length * 0.4));
  const DAILY_WINDOW = 7;
  const CYCLES_WINDOW = 4;
  const PROD_WINDOW = Math.max(1, Math.floor(chartData.length * 0.4));

  const chartWindow = activeTab === 'daily' ? DAILY_WINDOW
    : activeTab === 'cycles' ? CYCLES_WINDOW
    : activeTab === 'production' ? PROD_WINDOW
    : HOURLY_WINDOW;

  const rawData = activeTab === 'daily' ? dailyProdData
    : activeTab === 'cycles' ? cyclesChartData
    : chartData.length > 0 ? chartData
    : [];

  const sliderMax = Math.max(0, rawData.length - chartWindow);
  const defaultEnd = sliderMax;
  const safeIndex = userInteracted.current ? Math.min(sliderIndex, sliderMax) : defaultEnd;
  const slicedData = rawData.slice(safeIndex, safeIndex + chartWindow);

  const distributionData = [
    { name: 'PV1 Power', value: telemetry?.pv1_power || 0, color: accentColor },
    { name: 'Load Power', value: telemetry?.load_power || 0, color: '#22C55E' },
    { name: 'Grid Export', value: Math.max(0, telemetry?.daily_grid_export || 0), color: '#F59E0B' },
  ].filter(d => d.value > 0);

  const tabs: { key: ChartTab; label: string; icon: React.ReactNode }[] = [
    { key: 'hourly', label: 'Hourly', icon: <Clock className="w-4 h-4" /> },
    { key: 'daily', label: 'Daily', icon: <Calendar className="w-4 h-4" /> },
    { key: 'cycles', label: 'Cycles', icon: <BarChart3 className="w-4 h-4" /> },
    { key: 'production', label: 'Production', icon: <Activity className="w-4 h-4" /> },
    { key: 'distribution', label: 'Distribution', icon: <PieIcon className="w-4 h-4" /> },
  ];

  const isZoomable = activeTab === 'hourly' || activeTab === 'production';

  return (
    <div className={`rounded-2xl ${themeColors.surface} ${themeColors.cardShadow} p-4 sm:p-6`}>
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-5">
        <div className="flex items-center gap-3">
          <div>
            <h2 className={`text-base sm:text-lg font-bold ${themeColors.text}`}>Analytics & Trends</h2>
            <p className={`text-xs ${themeColors.textSecondary} mt-0.5`}>Visualize your solar performance</p>
          </div>
          {isZoomable && (
            <div className="flex items-center gap-1 p-1 rounded-xl bg-gray-100/50 dark:bg-white/5">
              <button
                onClick={zoomIn}
                disabled={zoomIndex === 0}
                className={`p-1.5 rounded-lg transition-all ${
                  zoomIndex === 0
                    ? 'opacity-30 cursor-not-allowed'
                    : `${themeColors.textSecondary} hover:${themeColors.surfaceHover}`
                }`}
                title="Zoom In (+)"
              >
                <ZoomIn className="w-4 h-4" />
              </button>
              <span className={`px-2 text-xs font-mono font-bold ${themeColors.text} min-w-[48px] text-center`}>
                {zoom.label}
              </span>
              <button
                onClick={zoomOut}
                disabled={zoomIndex === ZOOM_LEVELS.length - 1}
                className={`p-1.5 rounded-lg transition-all ${
                  zoomIndex === ZOOM_LEVELS.length - 1
                    ? 'opacity-30 cursor-not-allowed'
                    : `${themeColors.textSecondary} hover:${themeColors.surfaceHover}`
                }`}
                title="Zoom Out (-)"
              >
                <ZoomOut className="w-4 h-4" />
              </button>
            </div>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex gap-1 p-1 rounded-xl bg-gray-100/50 dark:bg-white/5 overflow-x-auto scrollbar-hide">
            {tabs.map((tab) => (
              <button
                key={tab.key}
                onClick={() => { setActiveTab(tab.key); if (tab.key === 'hourly' || tab.key === 'production') setZoomIndex(3); }}
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
      </div>

      <div className="h-[250px] sm:h-[350px] md:h-[400px]">
        <ResponsiveContainer width="100%" height="100%">
          {activeTab === 'hourly' && (
            chartData.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full">
                <Clock className={`w-12 h-12 ${themeColors.textSecondary} opacity-30 mb-3`} />
                <p className={`text-sm font-medium ${themeColors.textSecondary}`}>
                  {timeData.loading ? 'Loading data...' : 'No data available'}
                </p>
                <p className={`text-xs ${themeColors.textSecondary} mt-1`}>
                  {timeData.loading ? 'Fetching from collector...' : 'Try zooming out for a wider range'}
                </p>
              </div>
            ) : (
            <AreaChart data={slicedData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
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
                fontSize={10} 
                tickLine={false}
                axisLine={false}
                interval="preserveStartEnd"
                angle={xAxisAngle}
                textAnchor={xAxisAnchor}
                height={xAxisHeight}
              />
              <YAxis 
                stroke={textColor} 
                fontSize={11} 
                tickLine={false}
                axisLine={false}
                tickFormatter={(v) => `${v}`}
              />
              <Tooltip cursor={false} content={<CustomTooltip unit={zoom.unit} />} />
              <Area
                type="monotone"
                dataKey="production"
                name="PV Power"
                stroke={accentColor}
                strokeWidth={2}
                fill="url(#pvGradient)"
              />
              <Area
                type="monotone"
                dataKey="consumption"
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
            )
          )}

          {activeTab === 'daily' && (
            <BarChart data={slicedData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={gridColor} vertical={false} />
              <XAxis 
                dataKey="day" 
                stroke={textColor} 
                fontSize={11}
                tickLine={false}
                axisLine={false}
              />
              <YAxis 
                yAxisId="left"
                stroke={textColor} 
                fontSize={11}
                tickLine={false}
                axisLine={false}
                label={{ value: 'kWh', angle: -90, position: 'insideLeft', offset: 5, style: { fill: textColor, fontSize: 11 } }}
              />
              <YAxis 
                yAxisId="right"
                orientation="right"
                stroke={textColor} 
                fontSize={11}
                tickLine={false}
                axisLine={false}
                tickFormatter={(v: number) => `₹${v}`}
              />
              <Tooltip cursor={false} content={<CustomTooltip unit="" />} />
              <Bar 
                yAxisId="left"
                dataKey="production" 
                name="Daily Production" 
                fill={accentColor} 
                radius={[4, 4, 0, 0]}
                maxBarSize={40}
              />
              <Bar 
                yAxisId="right"
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

          {activeTab === 'cycles' && (
            cyclesChartData.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full">
                <BarChart3 className={`w-12 h-12 ${themeColors.textSecondary} opacity-30 mb-3`} />
                <p className={`text-sm font-medium ${themeColors.textSecondary}`}>No cycle data available yet</p>
                <p className={`text-xs ${themeColors.textSecondary} mt-1`}>Data accumulates as billing cycles complete</p>
              </div>
            ) : (
            <BarChart data={slicedData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={gridColor} vertical={false} />
              <XAxis 
                dataKey="label" 
                stroke={textColor} 
                fontSize={10}
                tickLine={false}
                axisLine={false}
                interval={0}
                height={30}
              />
              <YAxis 
                stroke={textColor} 
                fontSize={11}
                tickLine={false}
                axisLine={false}
              />
              <Tooltip cursor={false} content={<CustomTooltip unit="kWh" />} />
              <Bar 
                dataKey="production" 
                name="Production" 
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
            chartData.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full">
                <Activity className={`w-12 h-12 ${themeColors.textSecondary} opacity-30 mb-3`} />
                <p className={`text-sm font-medium ${themeColors.textSecondary}`}>
                  {timeData.loading ? 'Loading data...' : 'No data available'}
                </p>
                <p className={`text-xs ${themeColors.textSecondary} mt-1`}>
                  {timeData.loading ? 'Fetching from collector...' : 'Try zooming out for a wider range'}
                </p>
              </div>
            ) : (
            <AreaChart data={slicedData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
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
                fontSize={10}
                tickLine={false}
                axisLine={false}
                interval="preserveStartEnd"
                angle={xAxisAngle}
                textAnchor={xAxisAnchor}
                height={xAxisHeight}
              />
              <YAxis 
                stroke={textColor} 
                fontSize={11}
                tickLine={false}
                axisLine={false}
              />
              <Tooltip cursor={false} content={<CustomTooltip unit={zoom.unit} />} />
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
            )
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
      {activeTab !== 'distribution' && sliderMax > 0 && (
        <div className="px-1 mt-1">
          <input
            type="range"
            min={0}
            max={sliderMax}
            value={safeIndex}
            onChange={(e) => { userInteracted.current = true; setSliderIndex(parseInt(e.target.value)); }}
            style={{
              width: '100%',
              height: 4,
              accentColor: accentColor,
              background: gridColor,
              borderRadius: 2,
              cursor: 'pointer',
            }}
          />
        </div>
      )}
    </div>
  );
};
