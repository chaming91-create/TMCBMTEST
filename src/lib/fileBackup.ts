import type { AppData } from './firestoreService';
import type { DataSnapshot } from '../types/snapshot';
import { cleanData, dataVersion, stableData, validateAppData } from './dataRecovery';

export type FileBackupProof = { readonly method: 'verified-file' };
export type FileBackupRequest = { text: string; filename: string; version: string };
const proofs = new WeakMap<FileBackupProof, DataSnapshot>();
export function createFileBackup(data: AppData, label: string): FileBackupRequest {
  validateAppData(data);
  const snapshot: DataSnapshot = cleanData({ tms: data.tms, history: data.history, risks: data.risks, severities: data.severities, settings: data.settings, snapshotId: crypto.randomUUID(), name: `${label} 전 파일 백업`, createdAt: new Date().toISOString(), tmCount: data.tms.length, historyCount: data.history.length });
  return { text: JSON.stringify({ format: 'tm-recovery-backup-v1', snapshot }, null, 2), filename: `TM_backup_${snapshot.createdAt.replace(/[:.]/g, '-')}_${snapshot.snapshotId}.json`, version: dataVersion(data) };
}
export function verifyFileBackup(text: string, request: FileBackupRequest): FileBackupProof {
  const actual = JSON.parse(text);
  const expected = JSON.parse(request.text);
  if (stableData(actual) !== stableData(expected)) throw new Error('선택한 파일이 이번에 다운로드 요청한 전체 백업과 일치하지 않습니다. 데이터는 변경하지 않았습니다.');
  validateAppData(actual.snapshot);
  const proof: FileBackupProof = Object.freeze({ method: 'verified-file' });
  proofs.set(proof, cleanData(actual.snapshot));
  return proof;
}
export function verifiedBackupSnapshot(proof: FileBackupProof, current: AppData): DataSnapshot {
  const snapshot = proofs.get(proof);
  if (!snapshot || dataVersion(snapshot) !== dataVersion(current)) throw new Error('파일 백업이 확인되지 않았거나 확인 후 현재 데이터가 변경됐습니다. 새 파일로 다시 확인해 주세요.');
  return cleanData(snapshot);
}
export function requestBackupDownload(request: FileBackupRequest) {
  const url = URL.createObjectURL(new Blob([request.text], { type: 'application/json;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url; link.download = request.filename;
  document.body.appendChild(link);
  try { link.click(); } finally { link.remove(); window.setTimeout(() => URL.revokeObjectURL(url), 60_000); }
}
