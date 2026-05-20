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
  const token = localStorage.getItem('solar:auth_token');
  const headers: Record<string, string> = {
    ...(options?.headers as Record<string, string> || {}),
  };
  if (token && !path.startsWith('/api/auth/')) {
    headers['Authorization'] = `Bearer ${token}`;
  }
  return fetch(`${base}${path}`, { ...options, headers });
}

export function apiWsUrl(): string {
  const base = getApiBaseUrl();
  const protocol = base.startsWith('https') ? 'wss' : 'ws';
  const host = base.replace(/^https?:\/\//, '');
  const token = localStorage.getItem('solar:auth_token');
  return `${protocol}://${host}/api/ws/telemetry${token ? `?token=${token}` : ''}`;
}
