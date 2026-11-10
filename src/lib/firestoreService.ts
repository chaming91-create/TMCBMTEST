import { cleanData, dataDocuments, stableData } from './dataRecovery';
import { collection, deleteDoc, doc, getDocs, getDocsFromServer, onSnapshot, runTransaction, setDoc, writeBatch } from 'firebase/firestore';
import { getDownloadURL, ref, uploadBytes } from 'firebase/storage';
import { auth, db, storage } from './firebase';
import type { TmMaster, SeverityMaster } from '../types/tm';
import type { ReplacementHistory } from '../types/replacement';
import type { RiskScore, RiskSettings, AuditLog } from '../types/risk';
import type { DataSnapshot } from '../types/snapshot';
import type { UploadedFile } from '../types/uploadedFile';

export type AppData = { tms: TmMaster[]; history: ReplacementHistory[]; risks: RiskScore[]; severities: SeverityMaster[]; settings: RiskSettings };

const clearCollection = async (name: string) => {
  const database = db;
  if (!database) return;
  const snapshot = await getDocs(collection(database, name));
  for (let i = 0; i < snapshot.docs.length; i += 400) {
    const batch = writeBatch(database);
    snapshot.docs.slice(i, i + 400).forEach(item => batch.delete(item.ref));
    await batch.commit();
  }
};

const putMany = async (name: string, items: object[], id: (value: any) => string) => {
  const database = db;
  if (!database) return;
  for (let i = 0; i < items.length; i += 400) {
    const batch = writeBatch(database);
    items.slice(i, i + 400).forEach((value) => batch.set(doc(database, name, name === 'severity_master' && id(value).includes('/') ? encodeURIComponent(id(value)) : id(value)), cleanData(value)));
    await batch.commit();
  }
};
export async function backupDatabase(data: AppData) { if (db) await setDoc(doc(db, 'backups', `${Date.now()}`), cleanData({ ...data, createdAt: new Date().toISOString() })); }
export async function replaceTmData(data: TmMaster[], risks: RiskScore[]) { await clearCollection('tm_master'); await putMany('tm_master', data, v => v.serialNo); await putMany('risk_score', risks, v => v.serialNo); }
export async function replaceHistoryData(data: ReplacementHistory[], risks: RiskScore[]) { await clearCollection('replacement_history'); await putMany('replacement_history', data, v => v.replacementId); await putMany('risk_score', risks, v => v.serialNo); }
export async function resetDatabase() { await Promise.all(['tm_master','replacement_history','risk_score','severity_master'].map(clearCollection)); if (db) await clearCollection('settings'); }
export async function saveDataSnapshot(snapshot: DataSnapshot) { if (db) await setDoc(doc(db,'data_snapshots',snapshot.snapshotId),cleanData(snapshot)); }
export async function deleteDataSnapshot(snapshotId:string) { if (db) await deleteDoc(doc(db,'data_snapshots',snapshotId)); }
export async function saveSettings(settings: RiskSettings, severities: SeverityMaster[], risks: RiskScore[]) { if (!db) return; await setDoc(doc(db, 'settings', 'risk'), settings); await putMany('severity_master', severities, v => v.failureType); await putMany('risk_score', risks, v => v.serialNo); }
export async function addAudit(log: AuditLog) { if (db) await setDoc(doc(db, 'audit_log', log.logId), log); }
export async function uploadOriginal(file: File, type: UploadedFile['type'], uploadedBy = '') {
  if (!storage || !db) return null;
  const fileId = crypto.randomUUID();
  const safeName = file.name.replace(/[\\/#?%]/g, '_');
  const storagePath = `excel-original/${fileId}_${safeName}`;
  await uploadBytes(ref(storage, storagePath), file, { contentType: file.type || 'application/octet-stream' });
  const metadata: UploadedFile = { fileId, name: file.name, storagePath, type, size: file.size, contentType: file.type || 'application/octet-stream', uploadedAt: new Date().toISOString(), uploadedBy };
  await setDoc(doc(db, 'uploaded_files', fileId), metadata);
  return metadata;
}
export async function getUploadedFileUrl(storagePath: string) {
  if (!storage) throw new Error('파일 저장소가 연결되지 않았습니다.');
  return getDownloadURL(ref(storage, storagePath));
}
export async function saveReplacementAtomic(item: ReplacementHistory, tms: TmMaster[], risks: RiskScore[], disposedSerialNo = '') {
  const database = db;
  if (!database) return;
  await runTransaction(database, async tx => {
    tx.set(doc(database, 'replacement_history', item.replacementId), cleanData(item));
    if (disposedSerialNo) {
      tx.delete(doc(database, 'tm_master', disposedSerialNo));
      tx.delete(doc(database, 'risk_score', disposedSerialNo));
    }
    const removed = tms.find(t => t.serialNo === item.removedSerialNo);
    const installed = tms.find(t => t.serialNo === item.installedSerialNo);
    if (removed) tx.set(doc(database, 'tm_master', removed.serialNo), removed);
    if (installed) tx.set(doc(database, 'tm_master', installed.serialNo), installed);
    risks.forEach(r => tx.set(doc(database, 'risk_score', r.serialNo), r));
  });
}
export function subscribeCollection<T>(name: string, cb: (items: T[]) => void, onError?: (error: Error) => void) { if (!db) return () => {}; return onSnapshot(collection(db, name), snap => cb(snap.docs.map(d => d.data() as T)), onError); }
export async function readCollection<T>(name: string) { if (!db) return []; return (await getDocs(collection(db, name))).docs.map(d => d.data() as T); }

// No destructive clear/repopulate sequence: backup and the entire change commit together.
export async function applyRecoveryAtomic(expected: AppData, next: AppData, backup: DataSnapshot) {
  const database = db;
  if (!database) return;
  if (!auth?.currentUser) throw new Error('Firebase 로그인이 확인되지 않아 서버 데이터를 변경하지 않았습니다. 화면 접근 비밀번호와 Firebase 인증은 별개입니다.');
  const collections = ['tm_master', 'replacement_history', 'risk_score', 'severity_master', 'settings'];
  const snapshots = await Promise.all(collections.map(name => getDocsFromServer(collection(database, name))));
  const server = new Map<string, object>();
  snapshots.forEach((snapshot, index) => snapshot.docs.forEach(item => {
    if (collections[index] !== 'settings' || item.id === 'risk') server.set(`${collections[index]}/${item.id}`, item.data());
  }));
  const expectedDocs = dataDocuments(expected);
  const comparable = (docs: Map<string, object>, prefix: string) => [...docs].filter(([path]) => path.startsWith(prefix + '/')).map(([, value]) => stableData(value)).sort();
  for (const name of ['tm_master', 'replacement_history', 'severity_master', 'settings']) {
    if (stableData(comparable(server, name)) !== stableData(comparable(expectedDocs, name))) throw new Error('화면과 Firebase 데이터가 일치하지 않습니다. 다른 사용자의 변경 또는 동기화 실패가 있을 수 있어 처리하지 않았습니다. 최신 데이터를 확인한 후 다시 승인해 주세요.');
  }
  const desired = dataDocuments(next);
  const paths = [...new Set([...server.keys(), ...desired.keys()])];
  const changes = paths.filter(path => stableData(server.get(path) ?? null) !== stableData(desired.get(path) ?? null));
  // Conservative limit: never split an all-or-nothing recovery into multiple commits.
  if (changes.length + 1 > 500) throw new Error('원자적 처리의 안전 한도를 초과했습니다. 일부만 처리하지 않고 전체 작업을 중단합니다.');
  const backupData = cleanData(backup);
  if (new TextEncoder().encode(JSON.stringify(backupData)).length > 900_000) throw new Error('백업 문서가 안전 크기 한도를 초과했습니다. 데이터는 변경하지 않았습니다.');
  await runTransaction(database, async tx => {
    const refs = paths.map(path => doc(database, path));
    const current = await Promise.all(refs.map(reference => tx.get(reference)));
    current.forEach((item, index) => {
      if (stableData(item.exists() ? item.data() : null) !== stableData(server.get(paths[index]) ?? null)) throw new Error('확인 후 서버 데이터가 변경되어 작업을 중단했습니다. 최신 상태를 다시 확인하세요.');
    });
    const backupRef = doc(database, 'data_snapshots', backup.snapshotId);
    if ((await tx.get(backupRef)).exists()) throw new Error('자동 백업 식별자가 중복되어 중단했습니다.');
    tx.set(backupRef, backupData);
    changes.forEach(path => {
      const value = desired.get(path);
      if (value) tx.set(doc(database, path), value);
      else tx.delete(doc(database, path));
    });
  });
}
