import { describe, expect, it } from 'vitest';
import type { ReplacementHistory } from '../../types/replacement';
import type { TmMaster } from '../../types/tm';
import { applyHistoryImportToTmState, isReplacementNewerThanCurrent, keepLatestTmByCurrentLocation } from '../tmState';

const tm = (overrides: Partial<TmMaster>): TmMaster => ({
  serialNo: 'TM-1',
  manufacturer: '현대로템',
  manufactureYear: 2020,
  ageYear: 6,
  currentStatus: '운행중',
  isSpare: false,
  currentTrain: '101',
  currentCar: '',
  currentPosition: 'M01',
  installDate: '2025-01-01',
  sourceType: 'current_excel',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  ...overrides,
});

const replacement = (overrides: Partial<ReplacementHistory>): ReplacementHistory => ({
  replacementId: 'R-1',
  replacementDate: '2024-01-01',
  trainNo: '999',
  carNo: '',
  position: 'M09',
  removedSerialNo: 'TM-1',
  removedManufactureYear: 2019,
  removedManufacturer: '과거제조사',
  removedStatus: '취거',
  installedSerialNo: 'TM-2',
  installedManufactureYear: 2021,
  installedManufacturer: '교체제조사',
  installedStatus: '운행중',
  replacementReason: '',
  failureType: '모름',
  failureCode: '',
  severityClass: '',
  severityScore: null,
  detail: '모름',
  actionTaken: '',
  note: '',
  inputSource: 'history_excel',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  ...overrides,
});

describe('applyHistoryImportToTmState', () => {
  it('does not let replacement history overwrite current Excel TM state', () => {
    const current = tm({ serialNo: 'TM-1', currentTrain: '101', currentPosition: 'M01', installDate: '2026-03-01', sourceType: 'current_excel' });
    const next = applyHistoryImportToTmState([current], [replacement({ removedSerialNo: 'TM-1', installedSerialNo: 'TM-1', trainNo: '999', position: 'M09', replacementDate: '2024-01-01' })], 2026, '2026-06-24T00:00:00.000Z');

    expect(next.find(row => row.serialNo === 'TM-1')).toMatchObject({
      currentTrain: '101',
      currentPosition: 'M01',
      installDate: '2026-03-01',
      sourceType: 'current_excel',
    });
  });

  it('does not let replacement history overwrite manual replacement state', () => {
    const manual = tm({ serialNo: 'TM-1', currentTrain: '202', currentPosition: 'M02', installDate: '2026-04-01', sourceType: 'manual_added' });
    const next = applyHistoryImportToTmState([manual], [replacement({ removedSerialNo: 'TM-1', installedSerialNo: 'TM-1', trainNo: '999', position: 'M09' })], 2026, '2026-06-24T00:00:00.000Z');

    expect(next.find(row => row.serialNo === 'TM-1')).toMatchObject({
      currentTrain: '202',
      currentPosition: 'M02',
      installDate: '2026-04-01',
      sourceType: 'manual_added',
    });
  });


  it('keeps only the latest current Excel row for the same mounted location', () => {
    const rows = keepLatestTmByCurrentLocation([
      tm({ serialNo: 'OLD', currentTrain: '101', currentCar: '1', currentPosition: 'M01', installDate: '2025-01-01' }),
      tm({ serialNo: 'NEW', currentTrain: '101', currentCar: '1', currentPosition: 'M01', installDate: '2026-02-03' }),
      tm({ serialNo: 'SPARE', currentStatus: '예비품', isSpare: true, currentTrain: '예비품', currentCar: '', currentPosition: '예비-001', installDate: '' }),
      tm({ serialNo: 'UNKNOWN-1', currentTrain: '모름', currentPosition: '모름', installDate: '2025-01-01' }),
      tm({ serialNo: 'UNKNOWN-2', currentTrain: '모름', currentPosition: '모름', installDate: '2026-01-01' }),
    ]);

    expect(rows.map(row => row.serialNo)).toEqual(['SPARE', 'UNKNOWN-1', 'UNKNOWN-2', 'NEW']);
  });

  it('treats manual replacement as current-state input only when it is not older than the current install date', () => {
    const current = tm({ installDate: '2026-03-01' });

    expect(isReplacementNewerThanCurrent(current, '2026-03-01')).toBe(true);
    expect(isReplacementNewerThanCurrent(current, '2026-04-01')).toBe(true);
    expect(isReplacementNewerThanCurrent(current, '2025-12-31')).toBe(false);
  });

  it('uses replacement history only for history-only TM fallback state', () => {
    const next = applyHistoryImportToTmState([], [replacement({ installedSerialNo: 'TM-2', trainNo: '303', position: 'M03', replacementDate: '2024-05-06' })], 2026, '2026-06-24T00:00:00.000Z');

    expect(next.find(row => row.serialNo === 'TM-2')).toMatchObject({
      currentStatus: '운행중',
      currentTrain: '303',
      currentPosition: 'M03',
      installDate: '2024-05-06',
      sourceType: 'history_only',
    });
  });
});
