import React from 'react';
import { Sun, Sunrise, Sunset, Moon, Bell, Wifi, WifiOff, Zap } from 'lucide-react';
import { useTheme } from '../hooks/useTheme';
import { useWebSocket } from '../hooks/useWebSocket';
import { formatTime, formatDate, getGreeting } from '../utils/helpers';

export const Header: React.FC = () => {
  const { timeOfDay, currentTime, themeColors } = useTheme();
  const { connected } = useWebSocket();

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
      <div className="max-w-[1600px] mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16 sm:h-18">
          {/* Logo */}
          <div className="flex items-center gap-3">
            <div className={`relative w-9 h-9 rounded-xl flex items-center justify-center ${themeColors.accentLight}`}>
              <Zap className={`w-5 h-5 ${accentColor}`} />
              <div className={`absolute -top-0.5 -right-0.5 w-2.5 h-2.5 rounded-full ${connected ? 'bg-green-500' : 'bg-red-500'} border-2 border-white`} />
            </div>
            <div className="hidden sm:block">
              <h1 className={`text-lg font-bold ${themeColors.text} leading-tight`}>Lumos</h1>
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
            <button className={`relative p-2 rounded-xl ${themeColors.surfaceHover} transition-colors`}>
              <Bell className={`w-5 h-5 ${themeColors.textSecondary}`} />
              <span className="absolute top-1.5 right-1.5 w-2 h-2 bg-red-500 rounded-full" />
            </button>
            <div className={`w-8 h-8 rounded-full bg-gradient-to-br from-gray-300 to-gray-400 flex items-center justify-center text-xs font-bold text-white`}>
              U
            </div>
          </div>
        </div>
      </div>
    </header>
  );
};
