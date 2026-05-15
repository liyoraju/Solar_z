import React from 'react';
import { useTheme, type TimeOfDay } from '../hooks/useTheme';

const skyGradients: Record<TimeOfDay, string> = {
  morning: 'from-[#FFE4C4] via-[#FFDAB9] to-[#FFF8DC]',
  afternoon: 'from-[#87CEEB] via-[#B0E0E6] to-[#E0F6FF]',
  evening: 'from-[#FF7F50] via-[#FFB347] to-[#FFDAB9]',
  night: 'from-[#0B1026] via-[#1a1f3a] to-[#2d3561]',
};

const Sun: React.FC = () => (
  <div className="absolute top-8 right-12 w-24 h-24 rounded-full bg-gradient-to-br from-yellow-300 to-orange-400 shadow-[0_0_60px_rgba(255,200,50,0.4)] animate-pulse-slow" />
);

const Moon: React.FC = () => (
  <div className="absolute top-8 right-12 w-20 h-20 rounded-full bg-gradient-to-br from-gray-100 to-gray-300 shadow-[0_0_40px_rgba(200,200,255,0.3)]">
    <div className="absolute top-3 left-4 w-4 h-4 rounded-full bg-gray-400/30" />
    <div className="absolute bottom-5 right-5 w-3 h-3 rounded-full bg-gray-400/20" />
    <div className="absolute top-8 left-2 w-2 h-2 rounded-full bg-gray-400/25" />
  </div>
);

const Cloud: React.FC<{ className?: string; delay?: number }> = ({ className, delay = 0 }) => (
  <div 
    className={`absolute opacity-40 animate-float ${className}`}
    style={{ animationDelay: `${delay}s` }}
  >
    <svg width="120" height="60" viewBox="0 0 120 60" fill="none">
      <ellipse cx="40" cy="35" rx="30" ry="20" fill="currentColor" opacity="0.6" />
      <ellipse cx="70" cy="30" rx="35" ry="25" fill="currentColor" opacity="0.8" />
      <ellipse cx="95" cy="38" rx="25" ry="18" fill="currentColor" opacity="0.5" />
    </svg>
  </div>
);

const Stars: React.FC = () => (
  <div className="absolute inset-0 overflow-hidden">
    {Array.from({ length: 50 }).map((_, i) => (
      <div
        key={i}
        className="absolute w-1 h-1 bg-white rounded-full animate-pulse-slow"
        style={{
          top: `${Math.random() * 60}%`,
          left: `${Math.random() * 100}%`,
          animationDelay: `${Math.random() * 5}s`,
          opacity: Math.random() * 0.8 + 0.2,
        }}
      />
    ))}
  </div>
);

const MountainSilhouette: React.FC<{ className?: string }> = ({ className }) => (
  <svg 
    className={`absolute bottom-0 left-0 w-full ${className}`} 
    viewBox="0 0 1440 200" 
    preserveAspectRatio="none"
    style={{ height: '120px' }}
  >
    <path 
      d="M0,200 L0,120 Q120,80 240,100 Q360,60 480,90 Q600,40 720,80 Q840,30 960,70 Q1080,20 1200,60 Q1320,40 1440,80 L1440,200 Z" 
      fill="currentColor" 
      opacity="0.1"
    />
    <path 
      d="M0,200 L0,150 Q180,110 360,130 Q540,90 720,120 Q900,80 1080,110 Q1260,70 1440,100 L1440,200 Z" 
      fill="currentColor" 
      opacity="0.08"
    />
  </svg>
);

export const WeatherBackground: React.FC = () => {
  const { timeOfDay } = useTheme();

  const isDark = timeOfDay === 'night';
  const textColor = isDark ? 'text-white/10' : 'text-gray-400/30';

  return (
    <div className={`fixed inset-0 bg-gradient-to-b ${skyGradients[timeOfDay]} transition-all duration-[2000ms] -z-10`}>
      {timeOfDay === 'night' && <Stars />}

      {(timeOfDay === 'morning' || timeOfDay === 'afternoon' || timeOfDay === 'evening') && (
        <>
          <Cloud className={`top-16 left-[10%] ${textColor}`} delay={0} />
          <Cloud className={`top-24 left-[60%] scale-75 ${textColor}`} delay={2} />
          <Cloud className={`top-12 left-[35%] scale-50 ${textColor}`} delay={4} />
        </>
      )}

      {timeOfDay === 'morning' && <Sun />}
      {timeOfDay === 'afternoon' && (
        <div className="absolute top-6 right-10 w-28 h-28 rounded-full bg-gradient-to-br from-yellow-200 via-yellow-400 to-orange-400 shadow-[0_0_80px_rgba(255,200,0,0.5)] animate-pulse-slow" />
      )}
      {timeOfDay === 'evening' && (
        <div className="absolute top-16 right-16 w-20 h-20 rounded-full bg-gradient-to-br from-orange-400 via-red-400 to-purple-500 shadow-[0_0_50px_rgba(255,100,50,0.4)] animate-pulse-slow" />
      )}
      {timeOfDay === 'night' && <Moon />}

      <MountainSilhouette className={textColor} />
    </div>
  );
};
