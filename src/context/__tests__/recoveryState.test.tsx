import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS } from '../../lib/defaults';
import { dataVersion, RECOVERY_JOURNAL_KEY } from '../../lib/dataRecovery';
import type { DataSnapshot } from '../../types/snapshot';
import type { ReplacementHistory } from '../../types/replacement';
import type { TmMaster } from '../../types/tm';

const h = vi.hoisted(() => ({ cursor: 0, slots: [] as unknown[], effects: [] as Array<() => void>, subscriptions: new Map<string, (items: unknown[]) => void>(), apply: vi.fn(), save: vi.fn(), initial: {} as object }));
vi.mock('react', () => ({
  createContext: () => ({ Provider: 'test-provider' }), useContext: vi.fn(),
  useState: (initial: unknown) => { const i = h.cursor++; if (!(i in h.slots)) h.slots[i] = typeof initial === 'function' ? initial() : initial; return [h.slots[i], (value: unknown) => { h.slots[i] = typeof value === 'function' ? value(h.slots[i]) : value; }]; },
  useRef: (initial: unknown) => { const i = h.cursor++; return h.slots[i] ?? (h.slots[i] = { current: initial }); },
  useMemo: (fn: () => unknown) => fn(), useEffect: (fn: () => void) => { h.effects.push(fn); },
}));
vi.mock('../../lib/initialData', () => ({ EMPTY_DATA_KEY: 'empty-test', loadInitialData: () => h.initial }));
vi.mock('../../lib/firebase', () => ({ auth: {} }));
vi.mock('firebase/auth', () => ({ onAuthStateChanged: (_auth: object, cb: (user: object) => void) => { cb({ uid: 'test' }); return () => {}; } }));
vi.mock('../../lib/firestoreService', () => ({
  applyRecoveryAtomic: (...args: unknown[]) => h.apply(...args), saveReplacementAtomic: (...args: unknown[]) => h.save(...args),
  subscribeCollection: (name: string, cb: (items: unknown[]) => void) => { h.subscriptions.set(name, cb); return () => {}; },
  addAudit: vi.fn(async () => {}), backupDatabase: vi.fn(async () => {}), deleteDataSnapshot: vi.fn(async () => {}), replaceHistoryData: vi.fn(async () => {}), replaceTmData: vi.fn(async () => {}), resetDatabase: vi.fn(async () => {}), saveDataSnapshot: vi.fn(async () => {}), saveSettings: vi.fn(async () => {}),
}));
import { AppProvider } from '../AppContext';
const row = (id: string): ReplacementHistory => ({ replacementId: id, replacementDate: '2026-10-29', trainNo: '111', carNo: '1', position: '1', removedSerialNo: 'A', removedStatus: '취거', installedSerialNo: 'B', installedStatus: '운행중', replacementReason: '', failureType: '', severityClass: '', severityScore: null, detail: '', actionTaken: '', note: '', inputSource: 'history_excel', createdAt: '', updatedAt: '' });
const master: TmMaster = { serialNo: 'A', manufacturer: 'M', manufactureYear: 2020, ageYear: 6, currentStatus: '운행중', isSpare: false, currentTrain: '111', currentCar: '1', currentPosition: '1', installDate: '', sourceType: 'current_excel', createdAt: '', updatedAt: '' };
const render = () => { h.cursor = 0; h.effects = []; return AppProvider({ children: null }).props.value; };
const saved = (): DataSnapshot => ({ snapshotId: 'existing-protected', name: '10월 정기 점검 완료', createdAt: '2026-10-29T00:00:00Z', tmCount: 1, historyCount: 128, tms: [master], history: Array.from({ length: 128 }, (_, i) => row(`R-${i}`)), risks: [], severities: [], settings: DEFAULT_SETTINGS });
beforeEach(() => {
  h.cursor = 0; h.slots = []; h.effects = []; h.subscriptions.clear(); h.apply.mockReset(); h.apply.mockResolvedValue(undefined); h.save.mockReset(); h.save.mockResolvedValue(undefined);
  h.initial = { tms: [master], history: Array.from({ length: 133 }, (_, i) => row(`R-${i}`)), severities: [], settings: DEFAULT_SETTINGS };
  const storage = new Map<string, string>();
  vi.stubGlobal('localStorage', { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => storage.set(key, value), removeItem: (key: string) => storage.delete(key) });
});
describe('restore/delete browser state and subscription coordination', () => {
  it('blocks stale callbacks during and after recovery and applies the complete restored state once', async () => {
    let context = render(); h.effects.forEach(effect => effect());
    const old = h.subscriptions.get('replacement_history')!;
    let finish!: () => void; h.apply.mockImplementation(() => new Promise<void>(resolve => { finish = resolve; }));
    const operation = context.loadSnapshot(saved(), dataVersion(context));
    old(Array.from({ length: 133 }, (_, i) => row(`OLD-${i}`)));
    expect(render().history).toHaveLength(133);
    finish(); await operation;
    old(Array.from({ length: 133 }, (_, i) => row(`STALE-${i}`)));
    context = render(); expect(context.history).toHaveLength(128); expect(context.tms).toEqual(saved().tms);
    expect(h.apply).toHaveBeenCalledTimes(1);
    expect(JSON.parse(localStorage.getItem(RECOVERY_JOURNAL_KEY)!).committed).toBe(true);
    expect(context.snapshots.some((item: DataSnapshot) => item.name.includes('자동 백업') && item.history.length === 133)).toBe(true);
  });
  it('does not change current data on a failed transaction', async () => {
    const context = render(); h.apply.mockRejectedValue(new Error('mock network failure'));
    await expect(context.loadSnapshot(saved())).rejects.toThrow('network failure');
    expect(render().history).toHaveLength(133); expect(localStorage.getItem(RECOVERY_JOURNAL_KEY)).toBe(null);
  });
  it('accepts an empty remote collection so the last deleted item does not reappear', () => {
    render(); h.effects.forEach(effect => effect()); h.subscriptions.get('replacement_history')!([]);
    expect(render().history).toEqual([]);
  });
  it('requires renewed approval if data changed after opening a confirmation', async () => {
    const original = render(); const version = dataVersion(original);
    h.effects.forEach(effect => effect()); h.subscriptions.get('replacement_history')!([row('REMOTE-NEW')]);
    await expect(render().loadSnapshot(saved(), version)).rejects.toThrow('다시 확인');
    expect(h.apply).not.toHaveBeenCalled();
  });
  it('deletes a single record through the same atomic path and blocks a concurrent operation', async () => {
    const context = render(); let finish!: () => void; h.apply.mockImplementation(() => new Promise<void>(resolve => { finish = resolve; }));
    const operation = context.deleteReplacement('R-0', dataVersion(context));
    await expect(context.deleteReplacement('R-1')).rejects.toThrow('진행 중');
    finish(); await operation;
    expect(render().history).toHaveLength(132); expect(render().history.some((item: ReplacementHistory) => item.replacementId === 'R-0')).toBe(false);
    expect(h.apply).toHaveBeenCalledTimes(1);
  });
  it('does not create phantom browser history when saving fails', async () => {
    const context = render(); h.save.mockRejectedValue(new Error('mock permission denied'));
    await expect(context.addReplacement({ ...row('NEW'), inputSource: 'manual' })).rejects.toThrow('permission denied');
    expect(render().history).toHaveLength(133); expect(render().tms).toEqual([master]);
  });
});
