import { collection, deleteDoc, doc, getDocs, onSnapshot, runTransaction, setDoc, writeBatch } from 'firebase/firestore';
import { getDownloadURL, ref, uploadBytes } from 'firebase/storage';
import { db, storage } from './firebase';
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
    items.slice(i, i + 400).forEach((value) => batch.set(doc(database, name, id(value)), value));
    await batch.commit();
  }
};
export async function backupDatabase(data: AppData) { if (db) await setDoc(doc(db, 'backups', `${Date.now()}`), { ...data, createdAt: new Date().toISOString() }); }
export async function replaceTmData(data: TmMaster[], risks: RiskScore[]) { await clearCollection('tm_master'); await putMany('tm_master', data, v => v.serialNo); await putMany('risk_score', risks, v => v.serialNo); }
export async function replaceHistoryData(data: ReplacementHistory[], risks: RiskScore[]) { await clearCollection('replacement_history'); await putMany('replacement_history', data, v => v.replacementId); await putMany('risk_score', risks, v => v.serialNo); }
export async function resetDatabase() { await Promise.all(['tm_master','replacement_history','risk_score','severity_master'].map(clearCollection)); if (db) await clearCollection('settings'); }
export async function saveDataSnapshot(snapshot: DataSnapshot) { if (db) await setDoc(doc(db,'data_snapshots',snapshot.snapshotId),snapshot); }
export async function deleteDataSnapshot(snapshotId:string) { if (db) await deleteDoc(doc(db,'data_snapshots',snapshotId)); }
export async function restoreDatabase(data:AppData) { await resetDatabase(); await replaceTmData(data.tms,data.risks); await replaceHistoryData(data.history,data.risks); await saveSettings(data.settings,data.severities,data.risks); }
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
    tx.set(doc(database, 'replacement_history', item.replacementId), item);
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
export function subscribeCollection<T>(name: string, cb: (items: T[]) => void) { if (!db) return () => {}; return onSnapshot(collection(db, name), snap => cb(snap.docs.map(d => d.data() as T))); }
export async function readCollection<T>(name: string) { if (!db) return []; return (await getDocs(collection(db, name))).docs.map(d => d.data() as T); }
