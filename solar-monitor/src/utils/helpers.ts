import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatNumber(value: number | undefined, decimals: number = 1): string {
  if (value === undefined || value === null || isNaN(value)) return '—';
  return value.toFixed(decimals);
}

export function formatCurrency(value: number | undefined, currency: string = 'INR'): string {
  if (value === undefined || value === null || isNaN(value)) return '—';
  const symbol = currency === 'INR' ? '₹' : currency === 'USD' ? '$' : currency;
  return `${symbol}${value.toFixed(2)}`;
}

export function formatTime(date: Date): string {
  return date.toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  });
}

export function formatDate(date: Date): string {
  return date.toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });
}

export function getGreeting(hour: number): string {
  if (hour >= 5 && hour < 12) return 'Good Morning';
  if (hour >= 12 && hour < 17) return 'Good Afternoon';
  if (hour >= 17 && hour < 20) return 'Good Evening';
  return 'Good Night';
}

export function getWeatherIcon(timeOfDay: string): string {
  switch (timeOfDay) {
    case 'morning': return 'sunrise';
    case 'afternoon': return 'sun';
    case 'evening': return 'sunset';
    case 'night': return 'moon';
    default: return 'sun';
  }
}

export function calculateEfficiency(pvPower: number, inverterPower: number): number {
  if (!pvPower || pvPower === 0) return 0;
  return Math.min(100, (inverterPower / pvPower) * 100);
}
