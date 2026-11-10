import { beforeEach, describe, expect, it, vi } from 'vitest';
import { IDBFactory, IDBObjectStore, IDBTransaction } from 'fake-indexeddb';
import { APP_STATE_KEY, RECOVERY_BACKUPS_KEY, RECOVERY_JOURNAL_KEY, stableData } from '../dataRecovery';
import { DEFAULT_SETTINGS } from '../defaults';
import { hideBrowserSnapshot, commitBrowserRecovery, initializeBrowserStorage, listBrowserSnapshots, migrateLegacyBackups, prepareBrowserRecovery, readBrowserState, saveBrowserSnapshot, saveBrowserState } from '../browserBackupStore';
import type { DataSnapshot } from '../../types/snapshot';
import type { AppData } from '../firestoreService';
const current: AppData = { tms: [], history: [], risks: [], severities: [], settings: DEFAULT_SETTINGS };
const snapshot = (snapshotId: string, name = '자동 백업'): DataSnapshot => ({ ...current, snapshotId, name, createdAt: '2026-10-29T00:00:00Z', tmCount: 0, historyCount: 0 });
beforeEach(() => { vi.restoreAllMocks(); vi.stubGlobal('indexedDB', new IDBFactory()); });
describe('verified IndexedDB backup and migration', () => {
  it('stores and rereads individual backups even when every localStorage write exceeds quota', async () => {
    const local = { getItem: () => null, setItem: vi.fn(() => { throw new DOMException('full', 'QuotaExceededError'); }) };
    vi.stubGlobal('localStorage', local);
    await saveBrowserSnapshot(snapshot('first'));
    await saveBrowserSnapshot(snapshot('second'));
    expect(await listBrowserSnapshots()).toHaveLength(2);
    expect(local.setItem).not.toHaveBeenCalled();
  });
  it('copies all legacy snapshots with readback verification, preserving source strings and the protected snapshot', async () => {
    const original = snapshot('protected', '10월 정기 점검 완료');
    const auto = snapshot('auto');
    const values = new Map([[RECOVERY_BACKUPS_KEY, JSON.stringify([auto])], ['ai_parts_snapshots', JSON.stringify([original, auto])]]);
    const sourcesBefore = stableData([...values]);
    const local = { getItem: (key: string) => values.get(key) ?? null, removeItem: vi.fn(), setItem: vi.fn() };
    await migrateLegacyBackups(local); await migrateLegacyBackups(local);
    expect(await listBrowserSnapshots()).toHaveLength(2);
    expect((await listBrowserSnapshots()).find(x => x.snapshotId === 'protected')).toEqual(original);
    expect(stableData([...values])).toBe(sourcesBefore); expect(local.removeItem).not.toHaveBeenCalled(); expect(local.setItem).not.toHaveBeenCalled();
  });
  it('does not overwrite a conflicting existing snapshot during migration', async () => {
    await saveBrowserSnapshot(snapshot('protected', '10월 정기 점검 완료'));
    await expect(migrateLegacyBackups({ getItem: key => key === RECOVERY_BACKUPS_KEY ? JSON.stringify([snapshot('protected', '변경된 이름')]) : null })).rejects.toThrow('덮어쓰지');
    expect((await listBrowserSnapshots())[0].name).toBe('10월 정기 점검 완료');
  });
  it('does not report a successful backup when IndexedDB aborts due to quota', async () => {
    await saveBrowserSnapshot(snapshot('protected', '10월 정기 점검 완료'));
    const original = IDBObjectStore.prototype.put;
    vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function(this: IDBObjectStore, value: unknown, key?: IDBValidKey) {
      if (key === 'snapshot/full') throw new DOMException('full', 'QuotaExceededError');
      return original.call(this, value, key);
    });
    await expect(saveBrowserSnapshot(snapshot('full'))).rejects.toThrow('저장공간');
    expect(await listBrowserSnapshots()).toEqual([snapshot('protected', '10월 정기 점검 완료')]);
  });
  it('rejects transaction abort even after a put request was accepted', async () => {
    const original = IDBObjectStore.prototype.put;
    vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function(this: IDBObjectStore, value: unknown, key?: IDBValidKey) {
      const request = original.call(this, value, key);
      if (key === 'snapshot/abort') this.transaction.abort();
      return request;
    });
    await expect(saveBrowserSnapshot(snapshot('abort'))).rejects.toThrow('자동 백업을 확인하지');
    expect(await listBrowserSnapshots()).toEqual([]);
  });
  it('keeps active state unchanged while a recovery is only prepared and persists the exact committed state', async () => {
    await saveBrowserState(current);
    const next = { ...current, history: [{ replacementId: 'RESTORED' }] } as AppData;
    await prepareBrowserRecovery('operation', next);
    expect(await readBrowserState()).toEqual(current);
    await commitBrowserRecovery('operation', next);
    expect(await readBrowserState()).toEqual(next);
    await expect(commitBrowserRecovery('other-id', current)).rejects.toThrow('식별자');
  });
  it('does not resurrect legacy 133-state over a newer IndexedDB state on reload', async () => {
    const next = { ...current, history: [{ replacementId: 'RESTORED-128' }] } as AppData;
    await saveBrowserState(next);
    const legacy = { ...current, history: [{ replacementId: 'OLD-133' }] };
    const result = await initializeBrowserStorage({ getItem: key => key === APP_STATE_KEY || key === RECOVERY_JOURNAL_KEY ? JSON.stringify(legacy) : null }, current);
    expect(result.current).toEqual(next);
  });
});

it('hides an explicitly removed saved point without physically deleting its backup payload', async () => {
  await saveBrowserSnapshot(snapshot('user-removed'));
  await hideBrowserSnapshot('user-removed');
  expect(await listBrowserSnapshots()).toEqual([]);
  await expect(saveBrowserSnapshot(snapshot('user-removed', 'different'))).rejects.toThrow();
});
