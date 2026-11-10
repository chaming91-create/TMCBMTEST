import type { AppData } from './firestoreService';
import type { AuditLog } from '../types/risk';
import type { DataSnapshot } from '../types/snapshot';
import { APP_STATE_KEY, RECOVERY_BACKUPS_KEY, RECOVERY_JOURNAL_KEY, cleanData, stableData } from './dataRecovery';

const DATABASE = 'ai-parts-backups-v1';
const STORE = 'records';
let queue: Promise<unknown> = Promise.resolve();
const ordered = <T,>(task: () => Promise<T>): Promise<T> => {
  const result = queue.then(task, task);
  queue = result.catch(() => {});
  return result;
};
export class BackupStorageError extends Error {
  constructor(message: string) { super(message); this.name = 'BackupStorageError'; }
}
function reason(error: unknown) {
  const name = error && typeof error === 'object' && 'name' in error ? String(error.name) : '';
  return name === 'QuotaExceededError' ? '브라우저 저장공간이 부족합니다.' : 'IndexedDB에 접근하거나 저장 내용을 검증하지 못했습니다.';
}
function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') { reject(new BackupStorageError('이 브라우저에서 IndexedDB를 사용할 수 없습니다.')); return; }
    const request = indexedDB.open(DATABASE, 1);
    request.onupgradeneeded = () => { if (!request.result.objectStoreNames.contains(STORE)) request.result.createObjectStore(STORE); };
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new BackupStorageError('다른 창이 백업 저장소를 사용 중입니다. 같은 사이트의 다른 창을 닫고 다시 시도하세요.'));
    request.onsuccess = () => { const db = request.result; db.onversionchange = () => db.close(); resolve(db); };
  });
}
async function read<T>(key: string): Promise<T | undefined> {
  const db = await open();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly');
    const request = tx.objectStore(STORE).get(key);
    tx.oncomplete = () => { db.close(); resolve(request.result as T | undefined); };
    tx.onerror = tx.onabort = () => { db.close(); reject(tx.error || request.error || new Error('IndexedDB read failed')); };
  });
}
async function write(entries: Array<[string, unknown]>): Promise<void> {
  const db = await open();
  return new Promise((resolve, reject) => {
    let tx: IDBTransaction | undefined;
    try {
      tx = db.transaction(STORE, 'readwrite', { durability: 'strict' });
      for (const [key, value] of entries) tx.objectStore(STORE).put(value, key);
    } catch (error) { try { tx?.abort(); } catch { /* Already aborted. */ } db.close(); reject(error); return; }
    tx!.oncomplete = () => { db.close(); resolve(); };
    tx!.onerror = tx!.onabort = () => { db.close(); reject(tx!.error || new Error('IndexedDB write failed')); };
  });
}
async function writeVerified(key: string, value: unknown) {
  await write([[key, value]]);
  if (stableData(await read(key)) !== stableData(value)) throw new Error('IndexedDB 재읽기 검증에 실패했습니다.');
}
async function storeSnapshot(snapshot: DataSnapshot) {
  const key = `snapshot/${snapshot.snapshotId}`;
  const value = cleanData(snapshot);
  const existing = await read<DataSnapshot>(key);
  if (existing) {
    if (stableData(existing) !== stableData(value)) throw new Error('같은 식별자의 다른 저장본이 있어 기존 자료를 덮어쓰지 않았습니다.');
    return;
  }
  await writeVerified(key, value);
}
export function saveBrowserSnapshot(snapshot: DataSnapshot) {
  return ordered(async () => { try { await storeSnapshot(snapshot); } catch (error) { throw new BackupStorageError(`${reason(error)} 자동 백업을 확인하지 못해 데이터 변경을 중단했습니다. JSON 파일을 다운로드한 뒤 파일 내용을 확인해 주세요.`); } });
}
export function saveBrowserState(data: Omit<AppData, 'risks'> | AppData) {
  return ordered(() => writeVerified('state/current', cleanData(data)));
}
export function readBrowserState() { return ordered(() => read<AppData>('state/current')); }
export function listBrowserSnapshots(): Promise<DataSnapshot[]> {
  return ordered(async () => {
    const db = await open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly');
      const request = tx.objectStore(STORE).openCursor();
      const result: DataSnapshot[] = [];
      const hidden = new Set<string>();
      request.onsuccess = () => { const cursor = request.result; if (cursor) { if (String(cursor.key).startsWith('snapshot/')) result.push(cursor.value as DataSnapshot); if (String(cursor.key).startsWith('hidden-snapshot/')) hidden.add(String(cursor.key).slice('hidden-snapshot/'.length)); cursor.continue(); } };
      tx.oncomplete = () => { db.close(); resolve(result.filter(item => !hidden.has(item.snapshotId))); };
      tx.onerror = tx.onabort = () => { db.close(); reject(tx.error || request.error); };
    });
  });
}
export async function migrateLegacyBackups(storage: Pick<Storage, 'getItem'>) {
  return ordered(async () => {
    for (const key of [RECOVERY_BACKUPS_KEY, 'ai_parts_snapshots']) {
      const raw = storage.getItem(key);
      if (!raw) continue;
      // Archive the exact legacy string as well as each record. Never remove or rewrite the source.
      const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(raw));
      const hash = [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
      const archiveKey = `legacy/${key}/${hash}`;
      if (await read<string>(archiveKey) !== raw) await writeVerified(archiveKey, raw);
      const snapshots: unknown = JSON.parse(raw);
      if (!Array.isArray(snapshots)) throw new Error('기존 백업 목록 형식을 확인할 수 없습니다. 원본은 그대로 유지했습니다.');
      for (const item of snapshots) {
        if (!item || typeof item.snapshotId !== 'string') throw new Error('기존 저장본 식별자를 확인하지 못했습니다. 원본은 그대로 유지했습니다.');
        await storeSnapshot(item as DataSnapshot);
      }
    }
  });
}
export function hideBrowserSnapshot(id: string) { return ordered(() => writeVerified(`hidden-snapshot/${id}`, true)); }
export function browserSnapshotHidden(id: string) { return ordered(async () => Boolean(await read(`hidden-snapshot/${id}`))); }
export async function initializeBrowserStorage(storage: Pick<Storage, 'getItem'>, initial: Omit<AppData, 'risks'>) {
  let current: AppData | undefined;
  const warnings: string[] = [];
  try { current = await readBrowserState(); } catch (error) { warnings.push(reason(error)); }
  try { await migrateLegacyBackups(storage); } catch (error) { warnings.push(`${reason(error)} 기존 백업 원본은 localStorage에 유지됩니다.`); }
  if (!current) {
    try { await saveBrowserState(initial); current = initial as AppData; } catch (error) { warnings.push(`${reason(error)} 파일 백업 대체 기능을 사용할 수 있습니다.`); }
  }
  let snapshots: DataSnapshot[] = [];
  try { snapshots = await listBrowserSnapshots(); } catch { /* Existing legacy list remains visible. */ }
  const hidden: string[] = [];
  try {
    const legacy = JSON.parse(storage.getItem('ai_parts_snapshots') || '[]');
    for (const item of legacy) if (await browserSnapshotHidden(item.snapshotId)) hidden.push(item.snapshotId);
  } catch { /* Do not change any legacy source. */ }
  return { current, snapshots, hidden, warning: warnings.join(' ') };
}
export function prepareBrowserRecovery(id: string, next: AppData) {
  return ordered(() => writeVerified('recovery/pending', { id, next: cleanData(next), committed: false }));
}
export function commitBrowserRecovery(id: string, next: AppData) {
  return ordered(async () => {
    const pending = await read<{ id: string; next: AppData }>('recovery/pending');
    if (pending?.id !== id || stableData(pending.next) !== stableData(cleanData(next))) throw new Error('복원 작업 식별자가 변경되어 브라우저 저장을 중단합니다.');
    const value = cleanData(next);
    await write([['state/current', value], ['recovery/pending', { id, committed: true }]]);
    if (stableData(await read('state/current')) !== stableData(value)) throw new Error('복원 결과 재읽기 검증에 실패했습니다.');
  });
}
// Keep the names discoverable for migration and audits; new writes never use these large localStorage keys.
export const legacyStorageKeys = [APP_STATE_KEY, RECOVERY_BACKUPS_KEY, RECOVERY_JOURNAL_KEY, 'ai_parts_snapshots'] as const;

export function saveBrowserAudit(entry: AuditLog) { return ordered(() => writeVerified(`audit/${entry.logId}`, cleanData(entry))); }
