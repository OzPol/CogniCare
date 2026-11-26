import type { Round } from "@/shared/domain";
import { api, RequestError } from "./http";

const lifetime = 2 * 86_400_000;
const maxQueued = 80;
type Pending = { key: string; owner: string; round: Round; expires: number };
type Mode = "readonly" | "readwrite";

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open("cognicare-device", 1);
    request.onupgradeneeded = () => request.result.createObjectStore("rounds", { keyPath: "key" });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error("Device storage is busy."));
  });
}

async function withStore<T>(mode: Mode, work: (store: IDBObjectStore, done: (value: T) => void) => void) {
  const database = await open();
  try {
    return await new Promise<T>((resolve, reject) => {
      const tx = database.transaction("rounds", mode);
      let result: T;
      tx.oncomplete = () => resolve(result);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error ?? new Error("Device storage was cancelled."));
      work(tx.objectStore("rounds"), (value) => { result = value; });
    });
  } finally {
    database.close();
  }
}

export function purgeOffline(owner: string | null, all = false) {
  return withStore<void>("readwrite", (store, done) => {
    const next = store.openCursor();
    next.onsuccess = () => {
      const item = next.result;
      if (!item) return done();
      const record = item.value as Pending;
      if (record.expires <= Date.now() || (all && (owner === null || record.owner === owner))) item.delete();
      item.continue();
    };
  });
}

export async function enqueueOffline(owner: string, key: string, round: Round) {
  await purgeOffline(null);
  const stored = await withStore<boolean>("readwrite", (store, done) => {
    const count = store.count();
    count.onsuccess = () => {
      if (count.result >= maxQueued) return done(false);
      store.put({ key, owner, round, expires: Date.now() + lifetime } satisfies Pending);
      done(true);
    };
  });
  if (!stored) throw new Error("Offline queue full.");
}

let pendingSync: { owner: string; promise: Promise<number> } | undefined;
export async function syncOffline(owner: string, signal: AbortSignal) {
  if (pendingSync) return pendingSync.owner === owner ? pendingSync.promise : 0;
  const work = flushOffline(owner, signal).finally(() => { pendingSync = undefined; });
  pendingSync = { owner, promise: work };
  return work;
}

async function flushOffline(owner: string, signal: AbortSignal) {
  await purgeOffline(null);
  const rows = await withStore<Pending[]>("readonly", (store, done) => {
    const request = store.getAll();
    request.onsuccess = () => done((request.result as Pending[]).filter((entry) => entry.owner === owner));
  });
  rows.sort((first, second) => first.round.playedAt.localeCompare(second.round.playedAt));
  let synced = 0;
  for (const row of rows) {
    if (signal.aborted) break;
    try {
      await api("/api/rounds", { data: row.round, key: row.key, owner }, signal);
      synced++;
    } catch (error) {
      if (!(error instanceof RequestError) || ![400, 422].includes(error.status)) break;
    }
    await withStore<void>("readwrite", (store, done) => { store.delete(row.key); done(); });
  }
  return synced;
}
