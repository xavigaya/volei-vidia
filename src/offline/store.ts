// Magatzem clau-valor persistent al dispositiu (IndexedDB, amb localStorage
// com a alternativa). S'hi guarden les dades per treballar sense connexió i
// la cua de canvis pendents d'enviar.

const DB_NAME = 'sports-vidia'; // nom antic: es manté per no perdre les dades desades
const STORE = 'kv';

let dbPromise: Promise<IDBDatabase | null> | null = null;

function openDb(): Promise<IDBDatabase | null> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve) => {
    try {
      if (typeof indexedDB === 'undefined') return resolve(null);
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
  return dbPromise;
}

const LS_PREFIX = 'svidia.kv.';

export async function kvGet<T>(key: string): Promise<T | undefined> {
  const db = await openDb();
  if (!db) {
    try {
      const v = localStorage.getItem(LS_PREFIX + key);
      return v == null ? undefined : (JSON.parse(v) as T);
    } catch {
      return undefined;
    }
  }
  return new Promise((resolve) => {
    try {
      const req = db.transaction(STORE, 'readonly').objectStore(STORE).get(key);
      req.onsuccess = () => resolve(req.result as T | undefined);
      req.onerror = () => resolve(undefined);
    } catch {
      resolve(undefined);
    }
  });
}

export async function kvSet<T>(key: string, value: T): Promise<void> {
  const db = await openDb();
  if (!db) {
    try {
      localStorage.setItem(LS_PREFIX + key, JSON.stringify(value));
    } catch {
      /* sense espai o sense emmagatzematge */
    }
    return;
  }
  await new Promise<void>((resolve) => {
    try {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(value, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
      tx.onabort = () => resolve();
    } catch {
      resolve();
    }
  });
}

// Esborra totes les dades desades al dispositiu (còpies sense connexió i cua
// de canvis). Es fa en tancar la sessió perquè la persona que faci servir el
// mateix dispositiu després no pugui llegir dades del club (hi ha menors).
// Les preferències de la interfície i l'adreça del servidor es mantenen.
export async function kvClear(): Promise<void> {
  try {
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const k = localStorage.key(i);
      if (k && (k.startsWith(LS_PREFIX) || k.startsWith('svidia.flip.') || k === 'svidia.club')) localStorage.removeItem(k);
    }
  } catch {
    /* sense emmagatzematge */
  }
  const db = await openDb();
  if (!db) return;
  await new Promise<void>((resolve) => {
    try {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).clear();
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
      tx.onabort = () => resolve();
    } catch {
      resolve();
    }
  });
}

// Error de xarxa (no hi ha connexió o el servidor no respon)
export function isNetworkError(err: { message?: string; code?: string } | null | undefined): boolean {
  if (!err) return false;
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return true;
  const msg = err.message ?? '';
  return !err.code && /fetch|network|load failed|timeout|connection/i.test(msg);
}

// Consulta amb còpia local: si no hi ha connexió, retorna l'última còpia desada
export async function cached<T>(
  key: string,
  fetcher: () => PromiseLike<{ data: T | null; error: { message: string; code?: string } | null }>,
): Promise<{ data: T | null; error: { message: string; code?: string } | null; fromCache: boolean }> {
  let res: { data: T | null; error: { message: string; code?: string } | null };
  try {
    res = await fetcher();
  } catch (e) {
    res = { data: null, error: { message: (e as Error).message } };
  }
  if (!res.error && res.data != null) {
    void kvSet(key, res.data);
    return { ...res, fromCache: false };
  }
  if (isNetworkError(res.error)) {
    const local = await kvGet<T>(key);
    if (local !== undefined) return { data: local, error: null, fromCache: true };
  }
  return { ...res, fromCache: false };
}
