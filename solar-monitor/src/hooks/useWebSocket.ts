import { useEffect, useRef, useState, useCallback } from 'react';
import { save as cacheSave, load as cacheLoad } from '../services/offlineStorage';

export interface TelemetryData {
  time: string;
  pv1_voltage: number;
  pv1_current: number;
  pv1_power: number;
  pv2_voltage: number;
  pv2_current: number;
  pv2_power: number;
  grid_voltage_r: number;
  grid_voltage_s: number;
  grid_voltage_t: number;
  grid_current_r: number;
  grid_current_s: number;
  grid_current_t: number;
  grid_frequency: number;
  load_power: number;
  inverter_power: number;
  daily_production: number;
  total_production: number;
  daily_grid_export: number;
  daily_grid_import: number;
  daily_savings: number;
  total_savings: number;
  grid_export_power?: number;
  grid_import_power?: number;
  grid_power?: number;
  battery_soc?: number;
  battery_power?: number;
  inverter_temperature?: number;
  fault_code?: number;
  warning_code?: number;
  working_mode?: number;
  inverter_status?: number;
}

export interface AlertData {
  id: number;
  created_at: string;
  inverter_sn: string;
  alert_type: string;
  severity: string;
  message: string;
  value?: number;
  threshold?: number;
  acknowledged: boolean;
}

export function useWebSocket() {
  const [telemetry, setTelemetry] = useState<TelemetryData | null>(null);
  const [alerts, setAlerts] = useState<AlertData[]>([]);
  const [connected, setConnected] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout>>();

  const connect = useCallback(() => {
    const wsUrl = `${window.location.protocol === 'https:' ? 'wss:' : 'ws:'}//${window.location.host}/api/ws/telemetry`;

    try {
      const ws = new WebSocket(wsUrl);

      ws.onopen = () => {
        setConnected(true);
        console.log('WebSocket connected');
      };

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          if (data.type === 'telemetry') {
            setTelemetry(data.payload);
            cacheSave('telemetry', data.payload);
          } else if (data.type === 'alert') {
            setAlerts((prev) => [data.payload, ...prev].slice(0, 50));
          } else {
            setTelemetry(data);
            cacheSave('telemetry', data);
          }
        } catch {
          // Raw telemetry data
        }
      };

      ws.onclose = () => {
        setConnected(false);
        reconnectTimeoutRef.current = setTimeout(connect, 5000);
      };

      ws.onerror = () => {
        ws.close();
      };

      wsRef.current = ws;
    } catch {
      reconnectTimeoutRef.current = setTimeout(connect, 5000);
    }
  }, []);

  useEffect(() => {
    connect();
    return () => {
      wsRef.current?.close();
      if (reconnectTimeoutRef.current) clearTimeout(reconnectTimeoutRef.current);
    };
  }, [connect]);

  // Fallback: poll API if WebSocket not available
  useEffect(() => {
    if (connected) return;

    const poll = async () => {
      try {
        const res = await fetch('/api/telemetry/realtime');
        if (res.ok) {
          const data = await res.json();
          setTelemetry(data);
          cacheSave('telemetry', data);
          return;
        }
      } catch {
        // Silently fail
      }
      const cached = await cacheLoad<any>('telemetry');
      if (cached) setTelemetry(cached);
    };

    poll();
    const interval = setInterval(poll, 5000);
    return () => clearInterval(interval);
  }, [connected]);

  return { telemetry, alerts, connected };
}
