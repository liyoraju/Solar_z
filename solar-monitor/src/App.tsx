import React, { useState } from 'react';
import { ThemeProvider } from './hooks/useTheme';
import { WeatherBackground } from './components/WeatherBackground';
import { Header } from './components/Header';
import { StatsCards } from './components/StatsCards';
import { TelemetryGrid } from './components/TelemetryGrid';
import { ChartsSection } from './components/ChartsSection';
import { SolarHouseVisualization } from './components/SolarHouseVisualization';
import { FinancialOverview } from './components/FinancialOverview';
import { AlertsPanel } from './components/AlertsPanel';
import { useTheme } from './hooks/useTheme';
import { LayoutDashboard, Activity, Settings, FileText, Menu, X } from 'lucide-react';

type Tab = 'dashboard' | 'telemetry' | 'reports' | 'settings';

const Navigation: React.FC<{ activeTab: Tab; onTabChange: (tab: Tab) => void }> = ({ activeTab, onTabChange }) => {
  const { themeColors } = useTheme();
  const [mobileOpen, setMobileOpen] = useState(false);

  const tabs: { key: Tab; label: string; icon: React.ReactNode }[] = [
    { key: 'dashboard', label: 'Dashboard', icon: <LayoutDashboard className="w-4 h-4" /> },
    { key: 'telemetry', label: 'Telemetry', icon: <Activity className="w-4 h-4" /> },
    { key: 'reports', label: 'Reports', icon: <FileText className="w-4 h-4" /> },
    { key: 'settings', label: 'Settings', icon: <Settings className="w-4 h-4" /> },
  ];

  return (
    <>
      {/* Mobile menu button */}
      <button 
        onClick={() => setMobileOpen(!mobileOpen)}
        className={`lg:hidden fixed bottom-6 right-6 z-50 w-14 h-14 rounded-full ${themeColors.surface} ${themeColors.cardShadow} flex items-center justify-center ${themeColors.text}`}
      >
        {mobileOpen ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
      </button>

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

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4 sm:gap-6">
        <div className="xl:col-span-2">
          <ChartsSection />
        </div>
        <div className="space-y-4 sm:space-y-6">
          <SolarHouseVisualization />
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-6">
        <FinancialOverview />
        <AlertsPanel />
      </div>
    </div>
  );
};

const TelemetryContent: React.FC = () => {
  return (
    <div className="space-y-4 sm:space-y-6 pb-24 lg:pb-6">
      <StatsCards />
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

const SettingsContent: React.FC = () => {
  const { themeColors } = useTheme();
  return (
    <div className={`rounded-2xl ${themeColors.surface} ${themeColors.cardShadow} p-8 text-center`}>
      <Settings className={`w-12 h-12 mx-auto mb-4 ${themeColors.textSecondary}`} />
      <h2 className={`text-xl font-bold ${themeColors.text} mb-2`}>Settings</h2>
      <p className={`text-sm ${themeColors.textSecondary}`}>System configuration panel coming soon.</p>
    </div>
  );
};

const AppContent: React.FC = () => {
  const [activeTab, setActiveTab] = useState<Tab>('dashboard');
  const { themeColors } = useTheme();

  return (
    <div className={`min-h-screen ${themeColors.bg} transition-colors duration-[2000ms]`}>
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
