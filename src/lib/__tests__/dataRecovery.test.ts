import { describe, expect, it } from 'vitest';
import { cleanData, dataDocuments, planReplacementDeletion, restoreTarget, tmChanges } from '../dataRecovery';
import { DEFAULT_SETTINGS } from '../defaults';
import type { AppData } from '../firestoreService';
import type { DataSnapshot } from '../../types/snapshot';
import type { TmMaster } from '../../types/tm';
import type { ReplacementHistory } from '../../types/replacement';
export const tm = (serialNo: string, isSpare = true): TmMaster => ({ serialNo, manufacturer: 'M', manufactureYear: 2020, ageYear: 6, currentStatus: isSpare ? '예비품' : '운행중', isSpare, currentTrain: isSpare ? '예비품' : '111', currentCar: '1', currentPosition: '1', installDate: '2026-01-01', sourceType: 'current_excel', createdAt: '', updatedAt: '' });
export const historyRow = (replacementId: string): ReplacementHistory => ({ replacementId, replacementDate: '2026-10-29', trainNo: '111', carNo: '1', position: '1', removedSerialNo: 'A', installedSerialNo: 'B', removedStatus: '취거', installedStatus: '운행중', replacementReason: '', failureType: '', severityClass: '', severityScore: null, detail: '', actionTaken: '', note: '', inputSource: 'history_excel', createdAt: '', updatedAt: '' });
export const data = (count = 133): AppData => ({ tms: Array.from({ length: 171 }, (_, i) => tm(`TM-${i}`)), history: Array.from({ length: count }, (_, i) => historyRow(`R-${i}`)), risks: [], severities: [{ failureType: '절연파괴·소손·F/O', severityScore: 100, severityClass: 'A', description: '', isActive: true }], settings: DEFAULT_SETTINGS });
export const snapshot = (value = data(128)): DataSnapshot => ({ ...value, snapshotId: 'existing-protected', name: '10월 정기 점검 완료', createdAt: '2026-10-29T00:00:00Z', tmCount: value.tms.length, historyCount: value.history.length });

describe('safe restore and deletion planning', () => {
  it('replaces 133 histories with exactly 128 and restores all TM/spare/settings data without mutating the snapshot', () => {
    const current = data(); const saved = snapshot(); const original = JSON.stringify(saved);
    const next = restoreTarget(saved);
    expect(next.history).toHaveLength(128); expect(next.tms).toHaveLength(171);
    expect(next.tms.filter(tm => tm.isSpare)).toEqual(saved.tms.filter(tm => tm.isSpare));
    expect(next.settings).toEqual(saved.settings); expect(current.history).toHaveLength(133);
    expect(JSON.stringify(saved)).toBe(original);
  });
  it('rejects snapshot count mismatch and malformed/duplicate identities before mutation', () => {
    expect(() => restoreTarget({ ...snapshot(), historyCount: 127 })).toThrow('표시 건수');
    expect(() => restoreTarget({ ...snapshot(), tms: undefined } as unknown as DataSnapshot)).toThrow('전체 데이터');
    const saved = snapshot(); saved.history[1].replacementId = saved.history[0].replacementId;
    expect(() => restoreTarget(saved)).toThrow('중복');
  });
  it('handles slash-containing severity names and strips optional undefined without losing valid values', () => {
    const docs = dataDocuments(data(0));
    expect([...docs.keys()].some(key => key.startsWith('severity_master/') && key.includes('%2F'))).toBe(true);
    expect([...docs.keys()].every(key => key.split('/').length === 2)).toBe(true);
    expect(cleanData({ x: undefined, nested: { y: undefined, z: 0 }, text: 'Ab-01', flag: false })).toEqual({ nested: { z: 0 }, text: 'Ab-01', flag: false });
    expect(() => cleanData({ n: NaN })).toThrow();
  });
  it('deletes history-only records without inventing rollback TM data', () => {
    const current = data(1); const planned = planReplacementDeletion(current, 'R-0');
    expect(planned.data.history).toEqual([]); expect(planned.data.tms).toEqual(current.tms);
    expect(planned.warning).toContain('교체이력만'); expect(current.history).toHaveLength(1);
  });
  it('restores previous installed/spare states and removes newly created installed TM and its future document', () => {
    const before = tm('A', false); const currentA = tm('A', true); const currentB = tm('B', false);
    const entry = { ...historyRow('manual'), inputSource: 'manual' as const, rollbackSnapshot: { removed: { ...before, exists: true, original: before }, installed: { ...currentB, exists: false } } };
    const current = { ...data(0), tms: [currentA, currentB], history: [entry] };
    const next = planReplacementDeletion(current, 'manual').data;
    expect(next.tms).toEqual([before]); expect(next.history).toEqual([]);
    expect(tmChanges(current.tms, next.tms)).toHaveLength(2);
    expect(dataDocuments(next).has('tm_master/B')).toBe(false);
  });
  it('restores a disposed TM when its full original record is available', () => {
    const before = tm('A', false); const entry = { ...historyRow('disposed'), inputSource: 'manual' as const, removedStatus: '불용', installedSerialNo: '', rollbackSnapshot: { removed: { ...before, exists: true, original: before } } };
    expect(planReplacementDeletion({ ...data(0), tms: [], history: [entry] }, 'disposed').data.tms).toEqual([before]);
  });
  it('blocks unsafe rollback when a related newer history exists or a legacy original record is missing', () => {
    const before = tm('A', false); const old = { ...historyRow('old'), inputSource: 'manual' as const, rollbackSnapshot: { removed: { ...before, exists: true } } };
    expect(() => planReplacementDeletion({ ...data(0), tms: [before], history: [{ ...historyRow('new'), replacementDate: '2026-11-10' }, old] }, 'old')).toThrow('더 최근');
    expect(() => planReplacementDeletion({ ...data(0), tms: [], history: [old] }, 'old')).toThrow('전체 정보');
  });
});
