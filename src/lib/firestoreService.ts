import { collection, doc, getDocFromServer, getDocsFromServer, onSnapshot, runTransaction, writeBatch } from 'firebase/firestore';
import { getDownloadURL, ref, uploadBytes } from 'firebase/storage';
import { storage } from './firebase';
import { requireAdmin, requireDatabase } from './sharedStore';
import type { TmMaster, SeverityMaster } from '../types/tm';
import type { ReplacementHistory } from '../types/replacement';
import type { RiskScore, RiskSettings, AuditLog } from '../types/risk';
import type { DataSnapshot } from '../types/snapshot';
import type { UploadedFile } from '../types/uploadedFile';
export type AppData = { tms: TmMaster[]; history: ReplacementHistory[]; risks: RiskScore[]; severities: SeverityMaster[]; settings: RiskSettings };

// Split backup payloads below Firestore's 1 MiB document limit. A manifest is
// published only after every chunk succeeds; interrupted backups cannot be loaded.
async function writeArchive(name: string, id: string, data: AppData, metadata: object) {
  const database = requireDatabase(), payload = JSON.stringify(data), chunks = payload.match(/[\s\S]{1,150000}/gu) || [];
  for (let i = 0; i < chunks.length; i += 100) {
    const batch = writeBatch(database);
    chunks.slice(i, i + 100).forEach((payload, offset) => batch.set(doc(database, name, id, 'chunks', String(i + offset).padStart(6, '0')), { payload }));
    await batch.commit();
  }
  await runTransaction(database, async tx => { tx.set(doc(database, name, id), { ...metadata, formatVersion: 2, chunkCount: chunks.length, complete: true }); });
}
export async function backupDatabase(data: AppData) { const id = crypto.randomUUID(); await writeArchive('backups', id, data, { createdAt: new Date().toISOString() }); return id; }
export async function saveDataSnapshot(snapshot: DataSnapshot) {
  const { snapshotId, name, createdAt, tmCount, historyCount } = snapshot;
  await writeArchive('data_snapshots', snapshotId, snapshot, { snapshotId, name, createdAt, tmCount, historyCount });
}
export async function readDataSnapshot(snapshotId: string): Promise<AppData> {
  await requireAdmin();
  const database = requireDatabase(), header = await getDocFromServer(doc(database, 'data_snapshots', snapshotId));
  if (!header.exists()) throw new Error('백업이 존재하지 않습니다.');
  const value = header.data();
  if (value.formatVersion !== 2) return value as AppData; // Existing inline backups are preserved.
  const chunks = await getDocsFromServer(collection(database, 'data_snapshots', snapshotId, 'chunks'));
  if (!value.complete || chunks.size !== value.chunkCount) throw new Error('백업이 불완전합니다. 운영자료는 변경되지 않았습니다.');
  return JSON.parse(chunks.docs.sort((a,b) => a.id.localeCompare(b.id)).map(x => x.data().payload).join('')) as AppData;
}
export async function deleteDataSnapshot(snapshotId: string) {
  await requireAdmin();
  const database = requireDatabase();
  // Retain chunks for recovery; deleting the manifest removes this archive from the UI.
  await runTransaction(database, async tx => { tx.delete(doc(database, 'data_snapshots', snapshotId)); });
}
export async function addAudit(log: AuditLog) { const database = requireDatabase(); await runTransaction(database, async tx => { tx.set(doc(database, 'audit_log', log.logId), log); }); }
export async function uploadOriginal(file: File, type: UploadedFile['type'], uploadedBy = '') {
  const database = requireDatabase();
  if (!storage) throw new Error('원본 파일 저장소가 연결되지 않았습니다.');
  const fileId = crypto.randomUUID(), safeName = file.name.replace(/[\\/#?%]/g, '_'), storagePath = `excel-original/${fileId}_${safeName}`;
  await uploadBytes(ref(storage, storagePath), file, { contentType: file.type || 'application/octet-stream' });
  const metadata: UploadedFile = { fileId, name: file.name, storagePath, type, size: file.size, contentType: file.type || 'application/octet-stream', uploadedAt: new Date().toISOString(), uploadedBy };
  await runTransaction(database, async tx => { tx.set(doc(database, 'uploaded_files', fileId), metadata); });
  return metadata;
}
export async function getUploadedFileUrl(storagePath: string) { if (!storage) throw new Error('파일 저장소가 연결되지 않았습니다.'); return getDownloadURL(ref(storage, storagePath)); }
export function subscribeCollection<T>(name: string, cb: (items: T[]) => void, error: (e: unknown) => void = console.error) {
  return onSnapshot(collection(requireDatabase(), name), { includeMetadataChanges: true }, snap => {
    if (!snap.metadata.hasPendingWrites && !snap.metadata.fromCache) cb(snap.docs.map(d => d.data() as T));
  }, error);
}
export async function readCollection<T>(name: string) { return (await getDocsFromServer(collection(requireDatabase(), name))).docs.map(d => d.data() as T); }
