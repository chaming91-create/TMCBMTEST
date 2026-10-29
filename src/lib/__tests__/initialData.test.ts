import { describe, expect, it } from 'vitest';
import { EMPTY_DATA_KEY, loadInitialData } from '../initialData';

const storage = (values: Record<string, string> = {}) => ({ getItem: (key: string) => values[key] ?? null });

describe('first visit workbook data', () => {
  it('provides original workbook data synchronously on a new computer', () => {
    const data = loadInitialData(storage());
    const current = data.tms.filter(tm => tm.sourceType !== 'history_only');
    expect(current).toHaveLength(171);
    expect(current.filter(tm => tm.isSpare)).toHaveLength(27);
    const installed = current.filter(tm => !tm.isSpare);
    expect([...new Set(installed.map(tm => tm.currentTrain))].sort()).toEqual(['111', '112', '113', '114', '115', '116']);
    expect(installed).toHaveLength(144);
    expect(data.history.length).toBeGreaterThan(0);
    expect(data.history.find(row => row.failureType === '절연파괴·소손·F/O')).toMatchObject({ failureCode: 'FC05', severityScore: 100 });
    expect(data.severities.length).toBeGreaterThan(0);
  });

  it('recovers an empty cache left by an earlier initialization', () => {
    const data = loadInitialData(storage({ ai_parts_tms: '[]', ai_parts_history: '[]', ai_parts_default_workbooks_v2: 'done' }));
    expect(data.tms.length).toBeGreaterThan(0);
    expect(data.history.length).toBeGreaterThan(0);
  });

  it('preserves saved work instead of reimporting the original files', () => {
    const tms = [{ serialNo: 'USER-EDIT' }];
    const data = loadInitialData(storage({ ai_parts_tms: JSON.stringify(tms), ai_parts_history: '[]' }));
    expect(data.tms).toEqual(tms);
    expect(data.history).toEqual([]);
  });

  it('preserves saved replacement data even when the master is empty', () => {
    const history = [{ replacementId: 'USER-HISTORY' }];
    const data = loadInitialData(storage({ ai_parts_history: JSON.stringify(history) }));
    expect(data.tms).toEqual([]);
    expect(data.history).toEqual(history);
  });

  it('respects an intentional reset on subsequent visits', () => {
    const data = loadInitialData(storage({ ai_parts_tms: '[]', ai_parts_history: '[]', [EMPTY_DATA_KEY]: 'Y' }));
    expect(data.tms).toEqual([]);
    expect(data.history).toEqual([]);
  });

  it('retains data stored under legacy keys', () => {
    expect(loadInitialData(storage({ cbm_tms: '[{"serialNo":"LEGACY"}]' })).tms).toEqual([{ serialNo: 'LEGACY' }]);
  });
});
