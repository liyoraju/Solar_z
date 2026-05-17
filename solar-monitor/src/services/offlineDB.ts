const DB_NAME = 'solar_offline';
const DB_VERSION = 1;

let _db: Promise<IDBDatabase> | null = null;

function openDB(): Promise<IDBDatabase> {
  if (_db) return _db;
  _db = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('daily_history'))
        db.createObjectStore('daily_history', { keyPath: 'key' });
      if (!db.objectStoreNames.contains('hourly_history'))
        db.createObjectStore('hourly_history', { keyPath: 'key' });
      if (!db.objectStoreNames.contains('billing_cycles'))
        db.createObjectStore('billing_cycles', { keyPath: 'key' });
      if (!db.objectStoreNames.contains('overview'))
        db.createObjectStore('overview', { keyPath: 'key' });
      if (!db.objectStoreNames.contains('financial'))
        db.createObjectStore('financial', { keyPath: 'key' });
      if (!db.objectStoreNames.contains('telemetry'))
        db.createObjectStore('telemetry', { keyPath: 'key' });
      if (!db.objectStoreNames.contains('cache_meta'))
        db.createObjectStore('cache_meta', { keyPath: 'key' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return _db;
}

function storeTx(storeName: string, mode: IDBTransactionMode) {
  return openDB().then(db => {
    const tx = db.transaction(storeName, mode);
    return tx.objectStore(storeName);
  });
}

export async function idbSave<T>(store: string, key: string, data: T): Promise<void> {
  try {
    const obj = await storeTx(store, 'readwrite');
    obj.put({ key, data, updatedAt: Date.now() });
  } catch {}
}

export async function idbLoad<T>(store: string, key: string): Promise<T | null> {
  try {
    const obj = await storeTx(store, 'readonly');
    return new Promise(resolve => {
      const req = obj.get(key);
      req.onsuccess = () => {
        if (!req.result) return resolve(null);
        resolve(req.result.data as T);
      };
      req.onerror = () => resolve(null);
    });
  } catch {
    return null;
  }
}

export async function idbRemove(store: string, key: string): Promise<void> {
  try {
    const obj = await storeTx(store, 'readwrite');
    obj.delete(key);
  } catch {}
}

export async function idbClear(store: string): Promise<void> {
  try {
    const obj = await storeTx(store, 'readwrite');
    obj.clear();
  } catch {}
}
