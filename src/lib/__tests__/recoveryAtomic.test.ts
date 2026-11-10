import { beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanData, dataDocuments, stableData } from '../dataRecovery';
import { DEFAULT_SETTINGS } from '../defaults';
import type { AppData } from '../firestoreService';
import type { DataSnapshot } from '../../types/snapshot';
const mock = vi.hoisted(() => ({ server: new Map<string, object>(), failCommit: false, race: false, readCount: 0, transactions: 0, authenticated: true }));
vi.mock('../firebase', () => ({ db: {}, storage: null, auth: { get currentUser() { return mock.authenticated ? { uid: 'test' } : null; } } }));
vi.mock('firebase/storage', () => ({ getDownloadURL: vi.fn(), ref: vi.fn(), uploadBytes: vi.fn() }));
vi.mock('firebase/firestore', () => ({
  collection: (_db: unknown, name: string) => name,
  doc: (_db: unknown, ...parts: string[]) => { const path = parts.join('/'); if (path.split('/').length !== 2) throw Error('invalid document path'); return path; },
  getDocsFromServer: async (name: string) => ({ docs: [...mock.server].filter(([path]) => path.startsWith(name + '/')).map(([path, value]) => ({ id: path.split('/')[1], data: () => value })) }),
  runTransaction: async (_db: unknown, fn: (tx: object) => Promise<void>) => {
    mock.transactions++;
    if (mock.race) mock.server.set('replacement_history/R-0', { changed: true });
    const operations: Array<[string, object | undefined]> = [];
    await fn({ get: async (path: string) => ({ exists: () => mock.server.has(path), data: () => mock.server.get(path) }), set: (path: string, value: object) => operations.push([path, value]), delete: (path: string) => operations.push([path, undefined]) });
    if (mock.failCommit) throw Error('simulated commit failure');
    for (const [path, value] of operations) { if (value) mock.server.set(path, value); else mock.server.delete(path); }
  },
  deleteDoc: vi.fn(), getDocs: vi.fn(), onSnapshot: vi.fn(), setDoc: vi.fn(), writeBatch: vi.fn(),
}));
import { applyRecoveryAtomic } from '../firestoreService';
const data = (count: number): AppData => ({ tms: [], history: Array.from({ length: count }, (_, i) => ({ replacementId: `R-${i}`, removedSerialNo: `TM-${i}` })) as AppData['history'], risks: [], severities: [{ failureType: 'F/O', severityScore: 100, severityClass: 'A', description: '', isActive: true }], settings: DEFAULT_SETTINGS });
const backup = (value: AppData): DataSnapshot => ({ ...value, snapshotId: 'new-automatic-backup', name: '복원 전 자동 백업', createdAt: '2026-11-10T00:00:00Z', tmCount: value.tms.length, historyCount: value.history.length });
beforeEach(() => { mock.server = dataDocuments(data(133)); mock.server.set('data_snapshots/existing-protected', { name: '10월 정기 점검 완료' }); mock.failCommit = false; mock.race = false; mock.transactions = 0; mock.authenticated = true; });
describe('atomic server recovery with in-memory Firebase mock', () => {
  it('restores 133 to 128 exactly and preserves the original snapshot while saving a separate 133 backup', async () => {
    const before = data(133); await applyRecoveryAtomic(before, data(128), backup(before));
    expect([...mock.server.keys()].filter(key => key.startsWith('replacement_history/'))).toHaveLength(128);
    expect(mock.server.get('data_snapshots/existing-protected')).toEqual({ name: '10월 정기 점검 완료' });
    expect((mock.server.get('data_snapshots/new-automatic-backup') as DataSnapshot).history).toHaveLength(133);
    expect(mock.transactions).toBe(1);
  });
  it('does not partially alter any document when the commit fails', async () => {
    const original = stableData([...mock.server]); mock.failCommit = true;
    await expect(applyRecoveryAtomic(data(133), data(128), backup(data(133)))).rejects.toThrow('commit failure');
    expect(stableData([...mock.server])).toBe(original);
  });
  it('rejects stale browser data before starting a transaction', async () => {
    await expect(applyRecoveryAtomic(data(132), data(128), backup(data(132)))).rejects.toThrow('일치하지');
    expect(mock.transactions).toBe(0);
  });
  it('rejects a document changed between the server check and transaction', async () => {
    mock.race = true;
    await expect(applyRecoveryAtomic(data(133), data(128), backup(data(133)))).rejects.toThrow('서버 데이터가 변경');
    expect(mock.server.has('replacement_history/R-132')).toBe(true);
    expect(mock.server.has('data_snapshots/new-automatic-backup')).toBe(false);
  });
  it('deletes obsolete TM and risk documents in the same commit', async () => {
    const before = data(1); before.tms = [{ serialNo: 'NEW-TM' }] as AppData['tms']; before.risks = [{ serialNo: 'NEW-TM' }] as AppData['risks']; mock.server = dataDocuments(before);
    await applyRecoveryAtomic(before, data(0), backup(before));
    expect(mock.server.has('tm_master/NEW-TM')).toBe(false); expect(mock.server.has('risk_score/NEW-TM')).toBe(false); expect(mock.server.has('replacement_history/R-0')).toBe(false);
  });
  it('requires Firebase authentication and refuses oversize operations before writes', async () => {
    mock.authenticated = false;
    await expect(applyRecoveryAtomic(data(133), data(128), backup(data(133)))).rejects.toThrow('Firebase 로그인');
    expect(mock.transactions).toBe(0); mock.authenticated = true;
    const next = data(133); next.tms = Array.from({ length: 501 }, (_, i) => ({ serialNo: `NEW-${i}` })) as AppData['tms'];
    await expect(applyRecoveryAtomic(data(133), next, backup(data(133)))).rejects.toThrow('안전 한도');
    expect(mock.transactions).toBe(0);
  });
});
