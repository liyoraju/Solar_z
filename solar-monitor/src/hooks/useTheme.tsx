import React, { createContext, useContext, useEffect, useState } from 'react';

export type TimeOfDay = 'morning' | 'afternoon' | 'evening' | 'night';

interface ThemeContextType {
  timeOfDay: TimeOfDay;
  currentTime: Date;
  themeColors: ThemeColors;
}

export interface ThemeColors {
  bg: string;
  surface: string;
  surfaceHover: string;
  border: string;
  text: string;
  textSecondary: string;
  accent: string;
  accentLight: string;
  accentGlow: string;
  chartGrid: string;
  success: string;
  warning: string;
  danger: string;
  gradientFrom: string;
  gradientTo: string;
  glass: string;
  cardShadow: string;
}

const themeMap: Record<TimeOfDay, ThemeColors> = {
  morning: {
    bg: 'bg-morning-bg',
    surface: 'bg-morning-surface',
    surfaceHover: 'hover:bg-morning-surface-hover',
    border: 'border-morning-border',
    text: 'text-morning-text',
    textSecondary: 'text-morning-text-secondary',
    accent: 'text-morning-accent',
    accentLight: 'bg-morning-accent-light',
    accentGlow: 'shadow-morning-accent-glow',
    chartGrid: '#EDE5D8',
    success: '#4CAF50',
    warning: '#FF9800',
    danger: '#F44336',
    gradientFrom: 'from-morning-gradient-from',
    gradientTo: 'to-morning-gradient-to',
    glass: 'glass-morning',
    cardShadow: 'shadow-[0_2px_16px_rgba(232,122,42,0.08)]',
  },
  afternoon: {
    bg: 'bg-afternoon-bg',
    surface: 'bg-afternoon-surface',
    surfaceHover: 'hover:bg-afternoon-surface-hover',
    border: 'border-afternoon-border',
    text: 'text-afternoon-text',
    textSecondary: 'text-afternoon-text-secondary',
    accent: 'text-afternoon-accent',
    accentLight: 'bg-afternoon-accent-light',
    accentGlow: 'shadow-afternoon-accent-glow',
    chartGrid: '#E0E6EC',
    success: '#22C55E',
    warning: '#F59E0B',
    danger: '#EF4444',
    gradientFrom: 'from-afternoon-gradient-from',
    gradientTo: 'to-afternoon-gradient-to',
    glass: 'glass-afternoon',
    cardShadow: 'shadow-[0_2px_16px_rgba(26,122,232,0.08)]',
  },
  evening: {
    bg: 'bg-evening-bg',
    surface: 'bg-evening-surface',
    surfaceHover: 'hover:bg-evening-surface-hover',
    border: 'border-evening-border',
    text: 'text-evening-text',
    textSecondary: 'text-evening-text-secondary',
    accent: 'text-evening-accent',
    accentLight: 'bg-evening-accent-light',
    accentGlow: 'shadow-evening-accent-glow',
    chartGrid: '#E8E0D8',
    success: '#4CAF50',
    warning: '#FF9800',
    danger: '#F44336',
    gradientFrom: 'from-evening-gradient-from',
    gradientTo: 'to-evening-gradient-to',
    glass: 'glass-evening',
    cardShadow: 'shadow-[0_2px_16px_rgba(196,93,58,0.08)]',
  },
  night: {
    bg: 'bg-night-bg',
    surface: 'bg-night-surface',
    surfaceHover: 'hover:bg-night-surface-hover',
    border: 'border-night-border',
    text: 'text-night-text',
    textSecondary: 'text-night-text-secondary',
    accent: 'text-night-accent',
    accentLight: 'bg-night-accent-light',
    accentGlow: 'shadow-night-accent-glow',
    chartGrid: '#2A3440',
    success: '#4ADE80',
    warning: '#FBBF24',
    danger: '#F87171',
    gradientFrom: 'from-night-gradient-from',
    gradientTo: 'to-night-gradient-to',
    glass: 'glass-night',
    cardShadow: 'shadow-[0_2px_16px_rgba(0,0,0,0.3)]',
  },
};

function getTimeOfDay(date: Date): TimeOfDay {
  const hour = date.getHours();
  if (hour >= 5 && hour < 12) return 'morning';
  if (hour >= 12 && hour < 17) return 'afternoon';
  if (hour >= 17 && hour < 20) return 'evening';
  return 'night';
}

const ThemeContext = createContext<ThemeContextType>({
  timeOfDay: 'morning',
  currentTime: new Date(),
  themeColors: themeMap.morning,
});

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [currentTime, setCurrentTime] = useState(new Date());
  const [timeOfDay, setTimeOfDay] = useState<TimeOfDay>(getTimeOfDay(new Date()));

  useEffect(() => {
    const interval = setInterval(() => {
      const now = new Date();
      setCurrentTime(now);
      setTimeOfDay(getTimeOfDay(now));
    }, 60000);
    return () => clearInterval(interval);
  }, []);

  return (
    <ThemeContext.Provider
      value={{
        timeOfDay,
        currentTime,
        themeColors: themeMap[timeOfDay],
      }}
    >
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  return useContext(ThemeContext);
}
