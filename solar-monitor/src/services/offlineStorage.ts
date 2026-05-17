import { Capacitor } from '@capacitor/core';

type StoreValue = object | object[] | number | string | boolean | null;

const STORE_PREFIX = 'solar_cache_';

function isNative(): boolean {
  return Capacitor.isNativePlatform();
}

function memoryFallback(): Storage {
  const store = new Map<string, string>();
  return {
    get length() { return store.size; },
    key: (i: number) => [...store.keys()][i] ?? null,
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => { store.set(k, v); },
    removeItem: (k: string) => { store.delete(k); },
    clear: () => store.clear(),
  };
}

function getStore(): Storage {
  if (isNative()) return memoryFallback();
  return window.localStorage;
}

function keyFor(name: string): string {
  return STORE_PREFIX + name;
}

export async function save(name: string, data: StoreValue): Promise<void> {
  try {
    const entry = { data, cachedAt: Date.now() };
    getStore().setItem(keyFor(name), JSON.stringify(entry));
  } catch { }
}

export async function load<T = StoreValue>(name: string): Promise<T | null> {
  try {
    const raw = getStore().getItem(keyFor(name));
    if (!raw) return null;
    const entry = JSON.parse(raw);
    return entry.data as T;
  } catch {
    return null;
  }
}

export async function remove(name: string): Promise<void> {
  try {
    getStore().removeItem(keyFor(name));
  } catch { }
}

export async function clearAll(): Promise<void> {
  try {
    const store = getStore();
    const keys: string[] = [];
    for (let i = 0; i < store.length; i++) {
      const k = store.key(i);
      if (k?.startsWith(STORE_PREFIX)) keys.push(k);
    }
    keys.forEach(k => store.removeItem(k));
  } catch { }
}
