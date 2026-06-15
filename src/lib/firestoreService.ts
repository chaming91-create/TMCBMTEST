import { collection, doc, getDocs, onSnapshot, runTransaction, setDoc, writeBatch } from 'firebase/firestore';
import { ref, uploadBytes } from 'firebase/storage';
import { db, storage } from './firebase';
import type { TmMaster, SeverityMaster } from '../types/tm';
import type { ReplacementHistory } from '../types/replacement';
import type { RiskScore, RiskSettings, AuditLog } from '../types/risk';

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
export async function saveSettings(settings: RiskSettings, severities: SeverityMaster[], risks: RiskScore[]) { if (!db) return; await setDoc(doc(db, 'settings', 'risk'), settings); await putMany('severity_master', severities, v => v.failureType); await putMany('risk_score', risks, v => v.serialNo); }
export async function addAudit(log: AuditLog) { if (db) await setDoc(doc(db, 'audit_log', log.logId), log); }
export async function uploadOriginal(file: File, type: string) { if (storage) await uploadBytes(ref(storage, `excel-original/${Date.now()}_${type}_${file.name}`), file); }
export async function saveReplacementAtomic(item: ReplacementHistory, tms: TmMaster[], risks: RiskScore[]) {
  const database = db;
  if (!database) return;
  await runTransaction(database, async tx => {
    tx.set(doc(database, 'replacement_history', item.replacementId), item);
    const removed = tms.find(t => t.serialNo === item.removedSerialNo);
    const installed = tms.find(t => t.serialNo === item.installedSerialNo);
    if (removed) tx.set(doc(database, 'tm_master', removed.serialNo), removed);
    if (installed) tx.set(doc(database, 'tm_master', installed.serialNo), installed);
    risks.forEach(r => tx.set(doc(database, 'risk_score', r.serialNo), r));
  });
}
export function subscribeCollection<T>(name: string, cb: (items: T[]) => void) { if (!db) return () => {}; return onSnapshot(collection(db, name), snap => cb(snap.docs.map(d => d.data() as T))); }
export async function readCollection<T>(name: string) { if (!db) return []; return (await getDocs(collection(db, name))).docs.map(d => d.data() as T); }
