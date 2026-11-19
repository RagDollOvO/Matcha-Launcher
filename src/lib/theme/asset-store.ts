/** A single local asset. Resolve writes on commit so a second window can open it immediately. */
export function assetStore<T>(database: string, store: string) {
  async function run<R>(mode: IDBTransactionMode, op: (s: IDBObjectStore) => IDBRequest<R>): Promise<R> {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open(database, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(store);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    try {
      return await new Promise<R>((resolve, reject) => {
        const tx = db.transaction(store, mode);
        const req = op(tx.objectStore(store));
        tx.oncomplete = () => resolve(req.result);
        tx.onabort = () => reject(tx.error ?? req.error);
      });
    } finally { db.close(); }
  }
  return {
    load: () => run<T | undefined>('readonly', s => s.get('current')),
    save: (value: T) => run('readwrite', s => s.put(value, 'current')),
    clear: () => run('readwrite', s => s.delete('current')),
  };
}
