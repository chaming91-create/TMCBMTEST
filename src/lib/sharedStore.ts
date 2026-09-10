import { collection, doc, getDocFromServer, getDocsFromServer, onSnapshot, runTransaction } from 'firebase/firestore';
import { auth, db } from './firebase';
import { DEFAULT_SETTINGS, DEFAULT_SEVERITIES } from './defaults';
import type { AppData } from './firestoreService';
import type { TmMaster, SeverityMaster } from '../types/tm';
import type { ReplacementHistory } from '../types/replacement';
import type { RiskSettings } from '../types/risk';

export type SharedData = AppData & { revision: number };
export const emptyData = (): SharedData => ({ tms: [], history: [], risks: [], settings: DEFAULT_SETTINGS, severities: DEFAULT_SEVERITIES, revision: 0 });
export function requireDatabase() {
  if (!db) throw new Error('Firebase 설정이 없습니다. 공용 DB 연결 후 다시 시도하세요.');
  if (!auth?.currentUser) throw new Error('Firebase 계정으로 로그인해야 합니다.');
  return db;
}
export async function requireAdmin() {
  requireDatabase();
  if ((await auth!.currentUser!.getIdTokenResult()).claims.admin !== true) throw new Error('관리자 계정만 백업 복구·초기화·기존자료 이관을 실행할 수 있습니다.');
}
export const canonical = (value: unknown): string => JSON.stringify(value, (_key, v) => v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b))) : v);
export function operationalDocuments(data: AppData) {
  if (!Array.isArray(data.tms) || !Array.isArray(data.history) || !Array.isArray(data.severities) || !data.settings) throw new Error('운영자료 또는 백업 형식이 올바르지 않습니다.');
  const entries: [string, object][] = [
    ...data.tms.map(x => [`tm_master/${x.serialNo}`, x] as [string, object]),
    ...data.history.map(x => [`replacement_history/${x.replacementId}`, x] as [string, object]),
    ...data.severities.map(x => [`severity_master/${x.failureType}`, x] as [string, object]),
    ['settings/risk', data.settings],
  ];
  for (const [path] of entries) if (path.split('/').length !== 2 || !path.split('/')[1] || path.endsWith('/.') || path.endsWith('/..')) throw new Error(`저장할 고유번호가 올바르지 않습니다: ${path}`);
  if (new Set(entries.map(([p]) => p)).size !== entries.length) throw new Error('중복 부품 또는 이력 고유번호가 있습니다. 자료를 확인하세요.');
  return new Map(entries);
}
export function documentChanges(before: AppData, after: AppData) {
  const old = operationalDocuments(before), next = operationalDocuments(after);
  return [...new Set([...old.keys(), ...next.keys()])].filter(key => canonical(old.get(key)) !== canonical(next.get(key))).map(path => ({ path, value: next.get(path) }));
}
const retryError = () => new Error('공용 데이터가 변경되었습니다. 최신 데이터로 다시 시도하세요.');

// A revision fences collection reads, so a replacement is never rendered half-applied.
export async function readSharedData(): Promise<SharedData> {
  const database = requireDatabase(), meta = doc(database, 'system', 'state');
  for (let attempt = 0; attempt < 5; attempt++) {
    const start = await getDocFromServer(meta);
    const [tms, history, severities, settings] = await Promise.all([
      getDocsFromServer(collection(database, 'tm_master')), getDocsFromServer(collection(database, 'replacement_history')),
      getDocsFromServer(collection(database, 'severity_master')), getDocFromServer(doc(database, 'settings', 'risk')),
    ]);
    const end = await getDocFromServer(meta);
    if ((start.data()?.revision ?? 0) === (end.data()?.revision ?? 0)) return {
      tms: tms.docs.map(x => x.data() as TmMaster), history: history.docs.map(x => x.data() as ReplacementHistory),
      severities: severities.empty && !end.exists() ? DEFAULT_SEVERITIES : severities.docs.map(x => x.data() as SeverityMaster),
      settings: settings.exists() ? settings.data() as RiskSettings : DEFAULT_SETTINGS, risks: [], revision: end.data()?.revision ?? 0,
    };
  }
  throw retryError();
}

export async function mutateSharedData(transform: (latest: SharedData) => AppData, eventType: string, options: { admin?: boolean; expectedRevision?: number } = {}) {
  const database = requireDatabase();
  if (options.admin) await requireAdmin();
  for (let attempt = 0; attempt < 5; attempt++) {
    const before = await readSharedData();
    if (options.expectedRevision !== undefined && before.revision !== options.expectedRevision) throw retryError();
    const after = transform(before), changes = documentChanges(before, after);
    // Do not split an operation: exceeding service limits must leave all operational data intact.
    if (new TextEncoder().encode(JSON.stringify(changes)).length > 8 * 1024 * 1024) throw new Error('한 번에 처리할 자료가 너무 큽니다. 관리자 서버 이관이 필요합니다. 운영자료는 변경되지 않았습니다.');
    try {
      await runTransaction(database, async tx => {
        const meta = doc(database, 'system', 'state'), snap = await tx.get(meta);
        const riskSettings = await tx.get(doc(database, 'settings', 'risk'));
        if ((snap.data()?.revision ?? 0) !== before.revision) throw retryError();
        if (!riskSettings.exists()) tx.set(doc(database, 'settings', 'risk'), after.settings);
        if (!snap.exists()) after.severities.forEach(x => tx.set(doc(database, 'severity_master', x.failureType), x));
        // Existing documents remain in their original collections and keep their IDs.
        changes.forEach(({ path, value }) => value ? tx.set(doc(database, path), JSON.parse(JSON.stringify(value))) : tx.delete(doc(database, path)));
        tx.set(meta, { revision: before.revision + 1, schemaVersion: 2, operation: eventType, initialized: true, updatedAt: new Date().toISOString(), updatedBy: auth!.currentUser!.uid });
        tx.set(doc(database, 'audit_log', crypto.randomUUID()), { eventType, eventTime: new Date().toISOString(), userId: auth!.currentUser!.uid, changedDocuments: changes.map(x => x.path), revision: before.revision + 1 });
      });
      return { ...after, revision: before.revision + 1 };
    } catch (error) {
      if (options.expectedRevision !== undefined || attempt === 4) throw error;
      const conflict = error instanceof Error && error.message === retryError().message;
      const code = (error as { code?: string })?.code;
      // Revision rules may reject a stale commit before its write precondition is
      // reported as aborted. Retry only when the server revision actually advanced.
      if (!conflict) {
        if (code !== 'permission-denied' && code !== 'aborted') throw error;
        const latest = await getDocFromServer(doc(database, 'system', 'state'));
        if ((latest.data()?.revision ?? 0) <= before.revision) throw error;
      }
    }
  }
  throw retryError();
}

export function subscribeSharedData(cb: (data: SharedData) => void, error: (e: unknown) => void) {
  const database = requireDatabase();
  let active = true, running = false, dirty = false;
  const refresh = async () => {
    dirty = true;
    if (running) return;
    running = true;
    try {
      while (dirty && active) {
        dirty = false;
        const data = await readSharedData();
        if (active && !dirty) cb(data);
      }
    } catch (e) { if (active) error(e); }
    finally { running = false; }
  };
  const stop = onSnapshot(doc(database, 'system', 'state'), { includeMetadataChanges: true }, snap => {
    if (!snap.metadata.hasPendingWrites && !snap.metadata.fromCache) void refresh();
  }, error);
  // Also catches legacy datasets on first connection, without seeding or overwriting them.
  void refresh();
  return () => { active = false; stop(); };
}
