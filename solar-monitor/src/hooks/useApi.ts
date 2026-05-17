import { useEffect, useState } from 'react';
import { save as localStorageSave, load as localStorageLoad } from '../services/offlineStorage';
import { idbSave, idbLoad } from '../services/offlineDB';
import { getApiBaseUrl } from '../services/apiConfig';

const CACHE_STORE: Record<string, string> = {
  overview: 'overview',
  financial: 'financial',
  tariff_config: 'overview',
  billing_cycles: 'billing_cycles',
  monthly_stats: 'billing_cycles',
  history: 'daily_history',
  hourly_history: 'hourly_history',
  daily_aggregates: 'daily_history',
  cycle_status: 'overview',
  billing_reports: 'billing_cycles',
  telemetry_history: 'telemetry',
};

export interface HistoryPoint {
  time: string;
  avg_pv_power?: number;
  peak_pv_power?: number;
  avg_inverter_power?: number;
  peak_inverter_power?: number;
  max_temperature?: number;
  avg_frequency?: number;
  daily_production_kwh?: number;
  daily_savings?: number;
  sample_count?: number;
}

export interface OverviewData {
  inverter_sn?: string;
  status: string;
  pv_power: number;
  grid_power: number;
  load_power: number;
  battery_soc?: number;
  temperature?: number;
  daily_production: number;
  total_production: number;
  daily_savings: number;
  total_savings: number;
  fault_active: boolean;
  uptime_samples: number;
  inverter_status?: number;
  working_mode?: number;
}

export interface FinancialData {
  total_production_kwh: number;
  total_export_kwh: number;
  total_import_kwh: number;
  total_savings: number;
  today_production_kwh: number;
  today_savings: number;
  feed_in_tariff: number;
  grid_import_tariff: number;
  currency: string;
  co2_avoided_tonnes: number;
}

async function fetchWithCache<T>(url: string, cacheKey: string, fallback: T): Promise<T> {
  try {
    const res = await fetch(`${getApiBaseUrl()}${url}`);
    if (res.ok) {
      const json = await res.json();
      const store = CACHE_STORE[cacheKey] || 'telemetry';
      await Promise.all([
        localStorageSave(cacheKey, json),
        idbSave(store, cacheKey, json),
      ]);
      return json;
    }
  } catch {
    const store = CACHE_STORE[cacheKey] || 'telemetry';
    const idbCached = await idbLoad<T>(store, cacheKey);
    if (idbCached) return idbCached;
    const localCached = await localStorageLoad<T>(cacheKey);
    if (localCached) return localCached;
  }
  return fallback;
}

export function useOverview() {
  const [data, setData] = useState<OverviewData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchData = async () => {
      setLoading(true);
      const result = await fetchWithCache<OverviewData | null>(
        '/api/analytics/overview', 'overview', null
      );
      if (result) {
        setData(result);
      } else {
        setData({
          status: 'online',
          pv_power: 2640, grid_power: 1200, load_power: 1800, battery_soc: 78,
          temperature: 42.5, daily_production: 26.4, total_production: 18450,
          daily_savings: 92.4, total_savings: 64500, fault_active: false, uptime_samples: 1440,
        });
      }
      setLoading(false);
    };
    fetchData();
    const interval = setInterval(fetchData, 30000);
    return () => clearInterval(interval);
  }, []);

  return { data, loading };
}

export function useFinancial() {
  const [data, setData] = useState<FinancialData | null>(null);

  useEffect(() => {
    const fetchData = async () => {
      const result = await fetchWithCache<FinancialData | null>(
        '/api/analytics/financial', 'financial', null
      );
      if (result) {
        setData(result);
      } else {
        setData({
          total_production_kwh: 18450, total_export_kwh: 5200, total_import_kwh: 1800,
          total_savings: 64500, today_production_kwh: 26.4, today_savings: 92.4,
          feed_in_tariff: 0, grid_import_tariff: 0, currency: 'INR', co2_avoided_tonnes: 7.75,
        });
      }
    };
    fetchData();
    const interval = setInterval(fetchData, 60000);
    return () => clearInterval(interval);
  }, []);

  return data;
}

export interface TariffSlab {
  upper_kwh: number;
  rate: number;
}

export interface TariffConfig {
  mode: string;
  slabs: TariffSlab[];
  non_telescopic_slabs: TariffSlab[];
  billing_days: number;
  billing_cycle_start_day: number;
  cycle_end_date: string | null;
  feed_in_tariff: number;
  grid_import_tariff: number;
  currency: string;
  billing_kwh: number;
  cycle_start: string | null;
  active_rate: number;
}

export function useTariffConfig() {
  const [data, setData] = useState<TariffConfig | null>(null);

  useEffect(() => {
    const fetchData = async () => {
      const result = await fetchWithCache<TariffConfig | null>(
        '/api/config/tariff', 'tariff_config', null
      );
      if (result) {
        setData(result);
      } else {
        setData({
          mode: 'telescopic',
          slabs: [
            { upper_kwh: 50, rate: 3.35 }, { upper_kwh: 100, rate: 4.25 },
            { upper_kwh: 150, rate: 5.35 }, { upper_kwh: 200, rate: 7.20 },
            { upper_kwh: 250, rate: 8.50 },
          ],
          non_telescopic_slabs: [
            { upper_kwh: 300, rate: 6.75 }, { upper_kwh: 350, rate: 7.60 },
            { upper_kwh: 400, rate: 7.95 }, { upper_kwh: 500, rate: 8.25 },
            { upper_kwh: 999999, rate: 9.20 },
          ],
          billing_days: 60, billing_cycle_start_day: 1, cycle_end_date: null,
          feed_in_tariff: 3.50, grid_import_tariff: 6.00, currency: 'INR',
          billing_kwh: 0, cycle_start: null, active_rate: 3.35,
        });
      }
    };
    fetchData();
    const interval = setInterval(fetchData, 60000);
    return () => clearInterval(interval);
  }, []);

  return data;
}

export interface BillingCycle {
  cycle_start: string;
  cycle_end: string | null;
  total_production_kwh: number;
  total_savings: number;
  total_grid_export_kwh: number;
  total_grid_import_kwh: number;
  total_load_kwh: number;
  avg_daily_production: number;
  avg_daily_savings: number;
  day_count: number;
  is_current: boolean;
}

export function useBillingCycles(months: number = 6) {
  const [data, setData] = useState<BillingCycle[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchData = async () => {
      setLoading(true);
      const result = await fetchWithCache<BillingCycle[]>(
        `/api/analytics/billing-cycles?months=${months}`, 'billing_cycles', []
      );
      setData(result);
      setLoading(false);
    };
    fetchData();
    const interval = setInterval(fetchData, 60000);
    return () => clearInterval(interval);
  }, [months]);

  return { data, loading };
}

export interface MonthlyStats {
  month: string;
  monthly_production_kwh: number;
  monthly_savings: number;
  total_grid_export_kwh: number;
  total_grid_import_kwh: number;
  total_load_kwh: number;
  avg_inverter_power: number | null;
  peak_inverter_power: number | null;
  max_temperature: number | null;
  sample_count: number | null;
  self_consumption_pct: number;
}

export function useMonthlyStats(months: number = 3) {
  const [data, setData] = useState<MonthlyStats[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchData = async () => {
      setLoading(true);
      const result = await fetchWithCache<MonthlyStats[]>(
        `/api/analytics/monthly?months=${months}`, 'monthly_stats', []
      );
      setData(result);
      setLoading(false);
    };
    fetchData();
  }, [months]);

  return { data, loading };
}

export function useHistory(days: number = 7) {
  const [data, setData] = useState<HistoryPoint[]>([]);

  useEffect(() => {
    const fetchData = async () => {
      const result = await fetchWithCache<HistoryPoint[]>(
        `/api/telemetry/daily?days=${days}`, 'history', []
      );
      if (result.length > 0) {
        setData(result.reverse());
      } else {
        const mock: HistoryPoint[] = Array.from({ length: days }, (_, i) => {
          const date = new Date();
          date.setDate(date.getDate() - (days - 1 - i));
          return {
            time: date.toISOString().split('T')[0],
            avg_pv_power: 1500 + Math.random() * 2000,
            peak_pv_power: 2800 + Math.random() * 1200,
            avg_inverter_power: 1200 + Math.random() * 1800,
            peak_inverter_power: 2500 + Math.random() * 1500,
            max_temperature: 35 + Math.random() * 20,
            avg_frequency: 49.8 + Math.random() * 0.4,
            daily_production_kwh: 15 + Math.random() * 20,
            daily_savings: 50 + Math.random() * 80,
            sample_count: 1440,
          };
        });
        setData(mock);
      }
    };
    fetchData();
  }, [days]);

  return data;
}

export function useHourlyHistory() {
  const [data, setData] = useState<HistoryPoint[]>([]);

  useEffect(() => {
    const fetchData = async () => {
      const result = await fetchWithCache<HistoryPoint[]>(
        '/api/telemetry/history?interval=1+hour&limit=24', 'hourly_history', []
      );
      if (result.length > 0) {
        setData(result.reverse());
      } else {
        const mock: HistoryPoint[] = Array.from({ length: 24 }, (_, i) => ({
          time: `${String(i).padStart(2, '0')}:00`,
          avg_pv_power: Math.max(0, Math.sin((i - 6) * Math.PI / 12) * 2500 + Math.random() * 500),
          peak_pv_power: Math.max(0, Math.sin((i - 6) * Math.PI / 12) * 3000 + Math.random() * 800),
          avg_inverter_power: Math.max(0, Math.sin((i - 6) * Math.PI / 12) * 2200 + Math.random() * 400),
          peak_inverter_power: Math.max(0, Math.sin((i - 6) * Math.PI / 12) * 2800 + Math.random() * 600),
          max_temperature: 30 + Math.random() * 15,
          avg_frequency: 49.9 + Math.random() * 0.2,
          daily_production_kwh: 1 + Math.random() * 3,
          daily_savings: 3 + Math.random() * 8,
          sample_count: 60,
        }));
        setData(mock);
      }
    };
    fetchData();
    const interval = setInterval(fetchData, 300000);
    return () => clearInterval(interval);
  }, []);

  return data;
}

export function useTelemetryHistory(interval: string, limit: number) {
  const [data, setData] = useState<HistoryPoint[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    const fetchData = async () => {
      setLoading(true);
      const intervalParam = interval.replace(' ', '+');
      const result = await fetchWithCache<HistoryPoint[]>(
        `/api/telemetry/history?interval=${intervalParam}&limit=${limit}`,
        `telemetry_history_${interval}_${limit}`, []
      );
      if (!cancelled) {
        if (result.length > 0) {
          setData(result.reverse());
        } else {
          setData([]);
        }
        setLoading(false);
      }
    };
    fetchData();
    const pollMs = interval.includes('second') ? 5000 : interval.includes('minute') ? 30000 : 300000;
    const timer = setInterval(fetchData, pollMs);
    return () => { cancelled = true; clearInterval(timer); };
  }, [interval, limit]);

  return { data, loading };
}

export function useDailyAggregates(days: number) {
  const [data, setData] = useState<HistoryPoint[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    const fetchData = async () => {
      setLoading(true);
      const result = await fetchWithCache<HistoryPoint[]>(
        `/api/telemetry/daily?days=${days}`, 'daily_aggregates', []
      );
      if (!cancelled) {
        if (result.length > 0) {
          setData(result.reverse());
        } else {
          setData([]);
        }
        setLoading(false);
      }
    };
    fetchData();
    const timer = setInterval(fetchData, 300000);
    return () => { cancelled = true; clearInterval(timer); };
  }, [days]);

  return { data, loading };
}

export interface CycleStatus {
  has_end_date: boolean;
  end_date: string | null;
  days_remaining: number | null;
  is_past_end: boolean;
  current_cycle: BillingCycle | null;
}

export function useCycleStatus() {
  const [data, setData] = useState<CycleStatus | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    const fetchData = async () => {
      const result = await fetchWithCache<CycleStatus | null>(
        '/api/analytics/billing-cycle/status', 'cycle_status', null
      );
      if (!cancelled) {
        setData(result);
        setLoading(false);
      }
    };
    fetchData();
    const timer = setInterval(fetchData, 60000);
    return () => { cancelled = true; clearInterval(timer); };
  }, []);

  return { data, loading };
}

export interface BillingReport {
  id: number;
  cycle_start: string;
  cycle_end: string;
  total_production_kwh: number;
  total_savings: number;
  total_grid_export_kwh: number;
  total_grid_import_kwh: number;
  total_load_kwh: number;
  avg_daily_production: number;
  avg_daily_savings: number;
  day_count: number;
  finalized_at: string;
  notes: string;
}

export function useBillingReports(limit: number = 12) {
  const [data, setData] = useState<BillingReport[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    const fetchData = async () => {
      const result = await fetchWithCache<BillingReport[]>(
        `/api/analytics/billing-reports?limit=${limit}`, 'billing_reports', []
      );
      if (!cancelled) {
        setData(result);
        setLoading(false);
      }
    };
    fetchData();
    const timer = setInterval(fetchData, 120000);
    return () => { cancelled = true; clearInterval(timer); };
  }, [limit]);

  return { data, loading };
}
