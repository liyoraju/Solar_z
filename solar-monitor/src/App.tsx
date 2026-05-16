import React, { useState, useEffect } from 'react';
import { ThemeProvider, useTheme, TimeOfDay, ThemeColors, themeLabels, themeIcons } from './hooks/useTheme';
import { useMonthlyStats, useTariffConfig } from './hooks/useApi';
import { WeatherBackground } from './components/WeatherBackground';
import { Header } from './components/Header';
import { StatsCards } from './components/StatsCards';
import { TelemetryGrid } from './components/TelemetryGrid';
import { ChartsSection } from './components/ChartsSection';
import { SolarHouseVisualization } from './components/SolarHouseVisualization';
import { FinancialOverview } from './components/FinancialOverview';
import { LayoutDashboard, Activity, Settings, FileText, Sun, Moon, Sunrise, Sunset, Check, Palette, IndianRupee, Plus, Trash2, Save, Loader2, Zap, ArrowUpRight, ArrowDownRight, Thermometer, Waves, TrendingUp, TrendingDown } from 'lucide-react';
import { formatCurrency } from './utils/helpers';

type Tab = 'dashboard' | 'telemetry' | 'reports' | 'settings';

const Navigation: React.FC<{ activeTab: Tab; onTabChange: (tab: Tab) => void }> = ({ activeTab, onTabChange }) => {
  const { themeColors } = useTheme();

  const tabs: { key: Tab; label: string; icon: React.ReactNode }[] = [
    { key: 'dashboard', label: 'Dashboard', icon: <LayoutDashboard className="w-4 h-4" /> },
    { key: 'telemetry', label: 'Telemetry', icon: <Activity className="w-4 h-4" /> },
    { key: 'reports', label: 'Reports', icon: <FileText className="w-4 h-4" /> },
    { key: 'settings', label: 'Settings', icon: <Settings className="w-4 h-4" /> },
  ];

  return (
    <>
      {/* Desktop sidebar */}
      <nav className={`hidden lg:flex flex-col w-64 h-screen fixed left-0 top-0 ${themeColors.glass} border-r ${themeColors.border} z-40 pt-20 pb-6 px-4`}>
        <div className="space-y-1">
          {tabs.map((tab) => (
            <button
              key={tab.key}
              onClick={() => onTabChange(tab.key)}
              className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium transition-all duration-300 ${
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
      </nav>

      {/* Mobile bottom nav */}
      <nav className={`lg:hidden fixed bottom-0 left-0 right-0 ${themeColors.glass} border-t ${themeColors.border} z-40 px-4 py-2`}>
        <div className="flex items-center justify-around">
          {tabs.map((tab) => (
            <button
              key={tab.key}
              onClick={() => onTabChange(tab.key)}
              className={`flex flex-col items-center gap-1 px-3 py-2 rounded-xl transition-all duration-300 ${
                activeTab === tab.key
                  ? `${themeColors.accentLight} ${themeColors.accent}`
                  : `${themeColors.textSecondary}`
              }`}
            >
              {tab.icon}
              <span className="text-[10px] font-medium">{tab.label}</span>
            </button>
          ))}
        </div>
      </nav>
    </>
  );
};

const DashboardContent: React.FC = () => {
  return (
    <div className="space-y-4 sm:space-y-6 pb-24 lg:pb-6">
      <StatsCards />
      <MonthlyKPI />
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4 sm:gap-6">
        <SolarHouseVisualization />
        <FinancialOverview />
      </div>
      <ChartsSection />
    </div>
  );
};

const MonthlyKPI: React.FC = () => {
  const { themeColors, timeOfDay } = useTheme();
  const { data, loading } = useMonthlyStats(3);
  const tariffConfig = useTariffConfig();
  const currency = tariffConfig?.currency ?? 'INR';

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

  if (loading) {
    return (
      <div className={`rounded-2xl ${themeColors.surface} ${themeColors.cardShadow} p-4 sm:p-6`}>
        <div className="flex items-center gap-2 mb-4">
          <h2 className={`text-base sm:text-lg font-bold ${themeColors.text}`}>Monthly Overview</h2>
          <Loader2 className={`w-4 h-4 animate-spin ${themeColors.textSecondary}`} />
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 sm:gap-3">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className={`p-3 rounded-xl ${themeColors.bg} border ${themeColors.border} animate-pulse`}>
              <div className={`h-3 w-20 rounded ${themeColors.surfaceHover} mb-2`} />
              <div className={`h-6 w-16 rounded ${themeColors.surfaceHover}`} />
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (data.length === 0) return null;

  const current = data[0];
  const previous = data.length > 1 ? data[1] : null;

  const prodTrend = previous && previous.monthly_production_kwh > 0
    ? ((current.monthly_production_kwh - previous.monthly_production_kwh) / previous.monthly_production_kwh * 100)
    : null;
  const savingsTrend = previous && previous.monthly_savings > 0
    ? ((current.monthly_savings - previous.monthly_savings) / previous.monthly_savings * 100)
    : null;
  const selfConsumptionTrend = previous
    ? current.self_consumption_pct - previous.self_consumption_pct
    : null;

  const monthLabel = new Date(current.month + '-01').toLocaleDateString('en-US', { month: 'long', year: 'numeric' });

  const kpis = [
    {
      label: 'Monthly Production',
      value: `${current.monthly_production_kwh.toFixed(0)} kWh`,
      trend: prodTrend,
      icon: <Sun className={`w-4 h-4 ${accentColor}`} />,
      bg: accentBg,
    },
    {
      label: 'Monthly Savings',
      value: formatCurrency(current.monthly_savings, currency),
      trend: savingsTrend,
      icon: <IndianRupee className={`w-4 h-4 ${accentColor}`} />,
      bg: accentBg,
    },
    {
      label: 'Self-Consumption',
      value: `${current.self_consumption_pct.toFixed(0)}%`,
      trend: selfConsumptionTrend,
      icon: <Zap className={`w-4 h-4 ${accentColor}`} />,
      bg: accentBg,
    },
    {
      label: 'Grid Export',
      value: `${current.total_grid_export_kwh.toFixed(0)} kWh`,
      icon: <ArrowUpRight className="w-4 h-4 text-green-500" />,
      bg: 'bg-green-50',
    },
    {
      label: 'Grid Import',
      value: `${current.total_grid_import_kwh.toFixed(0)} kWh`,
      icon: <ArrowDownRight className="w-4 h-4 text-orange-500" />,
      bg: 'bg-orange-50',
    },
    {
      label: 'Peak Power',
      value: current.peak_inverter_power ? `${(current.peak_inverter_power / 1000).toFixed(1)} kW` : '—',
      icon: <Waves className={`w-4 h-4 ${accentColor}`} />,
      bg: accentBg,
    },
    {
      label: 'Max Temp',
      value: current.max_temperature ? `${current.max_temperature.toFixed(0)}°C` : '—',
      icon: <Thermometer className={`w-4 h-4 ${accentColor}`} />,
      bg: accentBg,
    },
    {
      label: 'Load Consumed',
      value: `${current.total_load_kwh.toFixed(0)} kWh`,
      icon: <Activity className={`w-4 h-4 ${accentColor}`} />,
      bg: accentBg,
    },
  ];

  return (
    <div className={`rounded-2xl ${themeColors.surface} ${themeColors.cardShadow} p-4 sm:p-6`}>
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <h2 className={`text-base sm:text-lg font-bold ${themeColors.text}`}>Monthly Overview</h2>
          <span className={`text-xs ${themeColors.textSecondary}`}>{monthLabel}</span>
          <span className="relative flex h-2 w-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
            <span className="relative inline-flex rounded-full h-2 w-2 bg-green-500"></span>
          </span>
        </div>
        {prodTrend !== null && (
          <div className={`flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium ${
            prodTrend >= 0 ? 'bg-green-50 text-green-600' : 'bg-red-50 text-red-500'
          }`}>
            {prodTrend >= 0 ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
            {Math.abs(prodTrend).toFixed(0)}% vs last month
          </div>
        )}
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 sm:gap-3">
        {kpis.map((kpi) => (
          <div key={kpi.label} className={`p-3 rounded-xl ${kpi.bg} border ${themeColors.border}`}>
            <div className="flex items-center gap-1.5 mb-1.5">
              {kpi.icon}
              <span className={`text-[10px] uppercase tracking-wider font-medium ${themeColors.textSecondary} truncate`}>
                {kpi.label}
              </span>
            </div>
            <p className={`text-lg font-bold ${themeColors.text}`}>{kpi.value}</p>
            {kpi.trend !== null && kpi.trend !== 0 && (
              <div className={`flex items-center gap-1 mt-1 text-[10px] font-medium ${
                kpi.trend > 0 ? 'text-green-500' : 'text-red-400'
              }`}>
                {kpi.trend > 0 ? <TrendingUp className="w-2.5 h-2.5" /> : <TrendingDown className="w-2.5 h-2.5" />}
                {Math.abs(kpi.trend).toFixed(0)}%
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
};

const TelemetryContent: React.FC = () => {
  return (
    <div className="space-y-4 sm:space-y-6 pb-24 lg:pb-6">
      <TelemetryGrid />
    </div>
  );
};

const ReportsContent: React.FC = () => {
  const { themeColors } = useTheme();
  return (
    <div className={`rounded-2xl ${themeColors.surface} ${themeColors.cardShadow} p-8 text-center`}>
      <FileText className={`w-12 h-12 mx-auto mb-4 ${themeColors.textSecondary}`} />
      <h2 className={`text-xl font-bold ${themeColors.text} mb-2`}>Reports</h2>
      <p className={`text-sm ${themeColors.textSecondary}`}>Detailed reports coming soon. Check the Dashboard for current analytics.</p>
    </div>
  );
};

interface TariffSlab {
  upper_kwh: number;
  rate: number;
}

interface TariffConfig {
  mode: string;
  slabs: TariffSlab[];
  non_telescopic_slabs: TariffSlab[];
  billing_days: number;
  feed_in_tariff: number;
  grid_import_tariff: number;
  currency: string;
  billing_kwh: number;
  cycle_start: string | null;
  active_rate: number;
}

const SettingsContent: React.FC = () => {
  const { themeColors, activeTheme, setTheme, isAutoTheme, setIsAutoTheme } = useTheme();
  const [activeSection, setActiveSection] = useState<'general' | 'appearance' | 'financial'>('appearance');

  const themeIconMap: Record<TimeOfDay, React.ReactNode> = {
    morning: <Sunrise className="w-6 h-6" />,
    afternoon: <Sun className="w-6 h-6" />,
    evening: <Sunset className="w-6 h-6" />,
    night: <Moon className="w-6 h-6" />,
  };

  const themePreviewColors: Record<TimeOfDay, { bg: string; accent: string; surface: string }> = {
    morning: { bg: '#FFF8F0', accent: '#E87A2A', surface: '#FFFFFF' },
    afternoon: { bg: '#F0F4F8', accent: '#1A7AE8', surface: '#FFFFFF' },
    evening: { bg: '#F5F0EB', accent: '#C45D3A', surface: '#FFFFFF' },
    night: { bg: '#1A1F2E', accent: '#5BA3F5', surface: '#252B3B' },
  };

  const sections = [
    { key: 'general' as const, label: 'General', icon: <Settings className="w-4 h-4" /> },
    { key: 'appearance' as const, label: 'Appearance', icon: <Palette className="w-4 h-4" /> },
    { key: 'financial' as const, label: 'Financial', icon: <IndianRupee className="w-4 h-4" /> },
  ];

  return (
    <div className="space-y-4 sm:space-y-6 pb-24 lg:pb-6">
      <h1 className={`text-xl font-bold ${themeColors.text}`}>Settings</h1>

      {/* Section tabs */}
      <div className="flex gap-1 p-1 rounded-xl bg-gray-100/50 dark:bg-white/5 overflow-x-auto">
        {sections.map((section) => (
          <button
            key={section.key}
            onClick={() => setActiveSection(section.key)}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all duration-300 ${
              activeSection === section.key
                ? `${themeColors.accentLight} ${themeColors.accent}`
                : `${themeColors.textSecondary} hover:${themeColors.surfaceHover}`
            }`}
          >
            {section.icon}
            {section.label}
          </button>
        ))}
      </div>

      {activeSection === 'general' && (
        <div className={`rounded-2xl ${themeColors.surface} ${themeColors.cardShadow} p-6`}>
          <h2 className={`text-lg font-bold ${themeColors.text} mb-4`}>General</h2>
          <p className={`text-sm ${themeColors.textSecondary}`}>General settings coming soon.</p>
        </div>
      )}

      {activeSection === 'appearance' && (
        <div className={`rounded-2xl ${themeColors.surface} ${themeColors.cardShadow} p-6`}>
          <div className="flex items-center justify-between mb-6">
            <div>
              <h2 className={`text-lg font-bold ${themeColors.text}`}>Appearance</h2>
              <p className={`text-xs ${themeColors.textSecondary} mt-0.5`}>Choose your preferred theme</p>
            </div>
            <label className="flex items-center gap-2 cursor-pointer">
              <span className={`text-xs ${themeColors.textSecondary}`}>Auto</span>
              <div
                className={`relative w-10 h-5 rounded-full transition-colors ${
                  isAutoTheme ? 'bg-green-500' : `${themeColors.bg}`
                }`}
                onClick={() => setIsAutoTheme(!isAutoTheme)}
              >
                <div
                  className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${
                    isAutoTheme ? 'translate-x-5' : ''
                  }`}
                />
              </div>
            </label>
          </div>

          {isAutoTheme && (
            <div className={`mb-6 p-3 rounded-xl ${themeColors.accentLight} border ${themeColors.border}`}>
              <p className={`text-xs ${themeColors.textSecondary}`}>
                Currently using <span className={`font-bold ${themeColors.text}`}>{themeIcons[activeTheme]} {themeLabels[activeTheme]}</span> theme based on your local time
              </p>
            </div>
          )}

          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            {(['morning', 'afternoon', 'evening', 'night'] as TimeOfDay[]).map((theme) => {
              const isActive = activeTheme === theme && !isAutoTheme;
              const isAutoActive = activeTheme === theme && isAutoTheme;
              const preview = themePreviewColors[theme];

              return (
                <button
                  key={theme}
                  onClick={() => setTheme(theme)}
                  className={`relative rounded-xl overflow-hidden border-2 transition-all duration-300 hover:scale-[1.02] ${
                    isActive
                      ? 'border-green-500 ring-2 ring-green-500/20'
                      : isAutoActive
                      ? `${themeColors.border}`
                      : `${themeColors.border} hover:border-current/30`
                  }`}
                >
                  {/* Preview */}
                  <div className="h-24 p-3" style={{ backgroundColor: preview.bg }}>
                    <div className="flex items-center gap-2 mb-2">
                      <div
                        className="w-6 h-6 rounded-full flex items-center justify-center"
                        style={{ backgroundColor: preview.accent }}
                      >
                        <div className="text-white" style={{ width: 14, height: 14 }}>
                          {themeIconMap[theme]}
                        </div>
                      </div>
                      <span className="text-xs font-semibold" style={{ color: preview.accent }}>
                        {themeLabels[theme]}
                      </span>
                    </div>
                    <div className="space-y-1.5">
                      <div className="h-2 rounded-full" style={{ backgroundColor: preview.surface, opacity: 0.8 }} />
                      <div className="h-2 rounded-full w-3/4" style={{ backgroundColor: preview.surface, opacity: 0.5 }} />
                    </div>
                  </div>

                  {/* Active indicator */}
                  {(isActive || isAutoActive) && (
                    <div className="absolute top-2 right-2 w-5 h-5 rounded-full bg-green-500 flex items-center justify-center">
                      <Check className="w-3 h-3 text-white" />
                    </div>
                  )}

                  {/* Label */}
                  <div className={`px-3 py-2 ${themeColors.surface}`}>
                    <div className="flex items-center gap-1.5">
                      <span className="text-sm">{themeIcons[theme]}</span>
                      <span className={`text-xs font-medium ${themeColors.text}`}>{themeLabels[theme]}</span>
                    </div>
                    {isAutoActive && (
                      <span className={`text-[10px] ${themeColors.textSecondary} mt-0.5`}>Auto-selected</span>
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {activeSection === 'financial' && <FinancialSettings themeColors={themeColors} />}
    </div>
  );
};

const FinancialSettings: React.FC<{ themeColors: ThemeColors }> = ({ themeColors }) => {
  const [config, setConfig] = useState<TariffConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchTariffConfig();
  }, []);

  const fetchTariffConfig = async () => {
    try {
      const res = await fetch('/api/config/tariff');
      if (res.ok) {
        const data = await res.json();
        setConfig(data);
      }
    } catch {
      setConfig({
        mode: 'telescopic',
        slabs: [
          { upper_kwh: 50, rate: 3.35 },
          { upper_kwh: 100, rate: 4.25 },
          { upper_kwh: 150, rate: 5.35 },
          { upper_kwh: 200, rate: 7.20 },
          { upper_kwh: 250, rate: 8.50 },
        ],
        non_telescopic_slabs: [
          { upper_kwh: 300, rate: 6.75 },
          { upper_kwh: 350, rate: 7.60 },
          { upper_kwh: 400, rate: 7.95 },
          { upper_kwh: 500, rate: 8.25 },
          { upper_kwh: 999999, rate: 9.20 },
        ],
        billing_days: 60,
        feed_in_tariff: 3.50,
        grid_import_tariff: 6.00,
        currency: 'INR',
        billing_kwh: 0,
        cycle_start: null,
        active_rate: 0,
      });
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    if (!config) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch('/api/config/tariff', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(config),
      });
      if (res.ok) {
        setSaved(true);
        setTimeout(() => setSaved(false), 3000);
        fetchTariffConfig();
      } else {
        setError('Failed to save tariff configuration');
      }
    } catch {
      setError('Network error');
    } finally {
      setSaving(false);
    }
  };

  const updateSlab = (type: 'slabs' | 'non_telescopic_slabs', index: number, field: keyof TariffSlab, value: number) => {
    if (!config) return;
    const updated = [...config[type]];
    updated[index] = { ...updated[index], [field]: value };
    setConfig({ ...config, [type]: updated });
  };

  const addSlab = (type: 'slabs' | 'non_telescopic_slabs') => {
    if (!config) return;
    const current = config[type];
    const lastUpper = current.length > 0 ? current[current.length - 1].upper_kwh : 0;
    setConfig({ ...config, [type]: [...current, { upper_kwh: lastUpper + 50, rate: 0 }] });
  };

  const removeSlab = (type: 'slabs' | 'non_telescopic_slabs', index: number) => {
    if (!config || config[type].length <= 1) return;
    const updated = config[type].filter((_, i) => i !== index);
    setConfig({ ...config, [type]: updated });
  };

  if (loading) {
    return (
      <div className={`rounded-2xl ${themeColors.surface} ${themeColors.cardShadow} p-6 flex items-center justify-center`}>
        <Loader2 className={`w-6 h-6 animate-spin ${themeColors.textSecondary}`} />
      </div>
    );
  }

  if (!config) return null;

  const currentSlabs = config.mode === 'non_telescopic' ? config.non_telescopic_slabs : config.slabs;
  const slabType = config.mode === 'non_telescopic' ? 'non_telescopic_slabs' as const : 'slabs' as const;

  return (
    <div className="space-y-4 sm:space-y-6">
      {/* Billing cycle info */}
      <div className={`rounded-2xl ${themeColors.surface} ${themeColors.cardShadow} p-4 sm:p-6`}>
        <h2 className={`text-lg font-bold ${themeColors.text} mb-4`}>Billing Cycle</h2>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div className={`p-3 rounded-xl ${themeColors.bg} border ${themeColors.border}`}>
            <p className={`text-[10px] uppercase tracking-wider font-medium ${themeColors.textSecondary}`}>Current Usage</p>
            <p className={`text-xl font-bold ${themeColors.text} mt-1`}>{config.billing_kwh.toFixed(1)} <span className="text-xs font-normal">kWh</span></p>
          </div>
          <div className={`p-3 rounded-xl ${themeColors.bg} border ${themeColors.border}`}>
            <p className={`text-[10px] uppercase tracking-wider font-medium ${themeColors.textSecondary}`}>Active Rate</p>
            <p className={`text-xl font-bold ${themeColors.accent} mt-1`}>₹{config.active_rate.toFixed(2)} <span className="text-xs font-normal">/kWh</span></p>
          </div>
          <div className={`p-3 rounded-xl ${themeColors.bg} border ${themeColors.border}`}>
            <p className={`text-[10px] uppercase tracking-wider font-medium ${themeColors.textSecondary}`}>Cycle Length</p>
            <p className={`text-xl font-bold ${themeColors.text} mt-1`}>{config.billing_days} <span className="text-xs font-normal">days</span></p>
          </div>
          <div className={`p-3 rounded-xl ${themeColors.bg} border ${themeColors.border}`}>
            <p className={`text-[10px] uppercase tracking-wider font-medium ${themeColors.textSecondary}`}>Cycle Started</p>
            <p className={`text-sm font-bold ${themeColors.text} mt-1`}>
              {config.cycle_start ? new Date(config.cycle_start).toLocaleDateString() : '—'}
            </p>
          </div>
        </div>
      </div>

      {/* Tariff mode */}
      <div className={`rounded-2xl ${themeColors.surface} ${themeColors.cardShadow} p-4 sm:p-6`}>
        <h2 className={`text-lg font-bold ${themeColors.text} mb-4`}>Tariff Mode</h2>
        <div className="flex flex-wrap gap-2">
          {[
            { key: 'telescopic', label: 'Telescopic (Slab-wise)', desc: 'Rate increases per slab for current cycle consumption' },
            { key: 'non_telescopic', label: 'Non-Telescopic', desc: 'Rate based on total consumption tier' },
          ].map((mode) => (
            <button
              key={mode.key}
              onClick={() => setConfig({ ...config, mode: mode.key })}
              className={`flex-1 min-w-[200px] p-4 rounded-xl border-2 text-left transition-all duration-300 ${
                config.mode === mode.key
                  ? `border-green-500 ${themeColors.accentLight}`
                  : `${themeColors.border} ${themeColors.bg}`
              }`}
            >
              <p className={`text-sm font-bold ${themeColors.text}`}>{mode.label}</p>
              <p className={`text-xs ${themeColors.textSecondary} mt-1`}>{mode.desc}</p>
            </button>
          ))}
        </div>
      </div>

      {/* Slab editor */}
      <div className={`rounded-2xl ${themeColors.surface} ${themeColors.cardShadow} p-4 sm:p-6`}>
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className={`text-lg font-bold ${themeColors.text}`}>
              {config.mode === 'telescopic' ? 'Telescopic Slabs' : 'Non-Telescopic Tiers'}
            </h2>
            <p className={`text-xs ${themeColors.textSecondary} mt-0.5`}>
              {config.mode === 'telescopic'
                ? 'Rate applies to consumption within each slab range'
                : 'Rate applies based on total consumption tier'}
            </p>
          </div>
          <button
            onClick={() => addSlab(slabType)}
            className={`p-2 rounded-lg ${themeColors.accentLight} ${themeColors.accent} transition-colors`}
          >
            <Plus className="w-4 h-4" />
          </button>
        </div>

        <div className="space-y-2">
          {currentSlabs.map((slab, index) => {
            const prevUpper = index > 0 ? currentSlabs[index - 1].upper_kwh : 0;
            return (
              <div key={index} className={`flex items-center gap-2 sm:gap-3 p-3 rounded-xl ${themeColors.bg} border ${themeColors.border}`}>
                <span className={`text-xs font-medium ${themeColors.textSecondary} w-6`}>{index + 1}</span>
                <div className="flex-1 grid grid-cols-2 sm:grid-cols-3 gap-2">
                  <div>
                    <label className={`text-[10px] ${themeColors.textSecondary}`}>From (kWh)</label>
                    <input
                      type="number"
                      value={prevUpper + 1}
                      disabled
                      className={`w-full px-2 py-1.5 rounded-lg text-sm ${themeColors.surface} border ${themeColors.border} ${themeColors.text} opacity-60`}
                    />
                  </div>
                  <div>
                    <label className={`text-[10px] ${themeColors.textSecondary}`}>To (kWh)</label>
                    <input
                      type="number"
                      value={slab.upper_kwh}
                      onChange={(e) => updateSlab(slabType, index, 'upper_kwh', parseInt(e.target.value) || 0)}
                      className={`w-full px-2 py-1.5 rounded-lg text-sm ${themeColors.surface} border ${themeColors.border} ${themeColors.text}`}
                    />
                  </div>
                  <div>
                    <label className={`text-[10px] ${themeColors.textSecondary}`}>Rate ({config.currency}/kWh)</label>
                    <input
                      type="number"
                      step="0.01"
                      value={slab.rate}
                      onChange={(e) => updateSlab(slabType, index, 'rate', parseFloat(e.target.value) || 0)}
                      className={`w-full px-2 py-1.5 rounded-lg text-sm ${themeColors.surface} border ${themeColors.border} ${themeColors.text}`}
                    />
                  </div>
                </div>
                <button
                  onClick={() => removeSlab(slabType, index)}
                  className={`p-1.5 rounded-lg ${themeColors.surfaceHover} text-red-400 transition-colors`}
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            );
          })}
        </div>
      </div>

      {/* Feed-in tariff & billing days */}
      <div className={`rounded-2xl ${themeColors.surface} ${themeColors.cardShadow} p-4 sm:p-6`}>
        <h2 className={`text-lg font-bold ${themeColors.text} mb-4`}>Tariff Settings</h2>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div>
            <label className={`text-xs font-medium ${themeColors.textSecondary} mb-1.5 block`}>Feed-in Tariff ({config.currency}/kWh)</label>
            <input
              type="number"
              step="0.01"
              value={config.feed_in_tariff}
              onChange={(e) => setConfig({ ...config, feed_in_tariff: parseFloat(e.target.value) || 0 })}
              className={`w-full px-3 py-2 rounded-xl text-sm ${themeColors.surface} border ${themeColors.border} ${themeColors.text}`}
            />
            <p className={`text-[10px] ${themeColors.textSecondary} mt-1`}>Rate paid for energy exported to grid</p>
          </div>
          <div>
            <label className={`text-xs font-medium ${themeColors.textSecondary} mb-1.5 block`}>Billing Cycle (days)</label>
            <input
              type="number"
              value={config.billing_days}
              onChange={(e) => setConfig({ ...config, billing_days: parseInt(e.target.value) || 60 })}
              className={`w-full px-3 py-2 rounded-xl text-sm ${themeColors.surface} border ${themeColors.border} ${themeColors.text}`}
            />
            <p className={`text-[10px] ${themeColors.textSecondary} mt-1`}>Slab reset period (typically 30 or 60 days)</p>
          </div>
          <div>
            <label className={`text-xs font-medium ${themeColors.textSecondary} mb-1.5 block`}>Currency</label>
            <select
              value={config.currency}
              onChange={(e) => setConfig({ ...config, currency: e.target.value })}
              className={`w-full px-3 py-2 rounded-xl text-sm ${themeColors.surface} border ${themeColors.border} ${themeColors.text}`}
            >
              <option value="INR">INR (₹)</option>
              <option value="USD">USD ($)</option>
              <option value="EUR">EUR (€)</option>
              <option value="GBP">GBP (£)</option>
            </select>
            <p className={`text-[10px] ${themeColors.textSecondary} mt-1`}>Currency for savings display</p>
          </div>
        </div>
      </div>

      {/* Save button */}
      <div className="flex items-center justify-end gap-3">
        {error && <span className="text-xs text-red-500">{error}</span>}
        {saved && <span className="text-xs text-green-500 flex items-center gap-1"><Check className="w-3 h-3" /> Saved successfully</span>}
        <button
          onClick={handleSave}
          disabled={saving}
          className={`flex items-center gap-2 px-6 py-2.5 rounded-xl text-sm font-medium transition-all duration-300 ${
            saving
              ? `${themeColors.bg} ${themeColors.textSecondary} opacity-60 cursor-not-allowed`
              : `${themeColors.accentLight} ${themeColors.accent} hover:opacity-90`
          }`}
        >
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
          {saving ? 'Saving…' : 'Save Tariff Config'}
        </button>
      </div>
    </div>
  );
};

const AppContent: React.FC = () => {
  const [activeTab, setActiveTab] = useState<Tab>('dashboard');
  const { themeColors } = useTheme();

  return (
    <div className={`min-h-screen overflow-x-hidden ${themeColors.bg} transition-colors duration-[2000ms]`}>
      <WeatherBackground />
      <Header />
      <Navigation activeTab={activeTab} onTabChange={setActiveTab} />

      <main className="lg:ml-64">
        <div className="max-w-[1400px] mx-auto px-4 sm:px-6 lg:px-8 py-4 sm:py-6">
          {activeTab === 'dashboard' && <DashboardContent />}
          {activeTab === 'telemetry' && <TelemetryContent />}
          {activeTab === 'reports' && <ReportsContent />}
          {activeTab === 'settings' && <SettingsContent />}
        </div>
      </main>
    </div>
  );
};

function App() {
  return (
    <ThemeProvider>
      <AppContent />
    </ThemeProvider>
  );
}

export default App;
