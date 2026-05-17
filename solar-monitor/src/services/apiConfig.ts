const STORAGE_KEY = 'solar:api_base_url';
const DEFAULT_URL = 'https://solar-z.onrender.com';

export function getApiBaseUrl(): string {
  if (typeof window === 'undefined') return DEFAULT_URL;
  return localStorage.getItem(STORAGE_KEY) || DEFAULT_URL;
}

export function setApiBaseUrl(url: string): void {
  if (url === DEFAULT_URL) {
    localStorage.removeItem(STORAGE_KEY);
  } else {
    localStorage.setItem(STORAGE_KEY, url);
  }
}

export function apiFetch(path: string, options?: RequestInit): Promise<Response> {
  const base = getApiBaseUrl();
  return fetch(`${base}${path}`, options);
}

export function apiWsUrl(): string {
  const base = getApiBaseUrl();
  const protocol = base.startsWith('https') ? 'wss' : 'ws';
  const host = base.replace(/^https?:\/\//, '');
  return `${protocol}://${host}/api/ws/telemetry`;
}
