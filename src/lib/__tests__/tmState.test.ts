import { describe, expect, it } from 'vitest';
import type { ReplacementHistory } from '../../types/replacement';
import type { TmMaster } from '../../types/tm';
import { applyHistoryImportToTmState, applyManualReplacementToTmState, enrichTmLocationsFromReplacementHistory, isReplacementNewerThanCurrent, keepLatestTmByCurrentLocation } from '../tmState';

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


  it('preserves different physical parts even when workbook locations collide', () => {
    const rows = keepLatestTmByCurrentLocation([
      tm({ serialNo: 'OLD', currentTrain: '101', currentCar: '1', currentPosition: 'M01', installDate: '2025-01-01' }),
      tm({ serialNo: 'NEW', currentTrain: '101', currentCar: '1', currentPosition: 'M01', installDate: '2026-02-03' }),
      tm({ serialNo: 'SPARE', currentStatus: '예비품', isSpare: true, currentTrain: '예비품', currentCar: '', currentPosition: '예비-001', installDate: '' }),
      tm({ serialNo: 'UNKNOWN-1', currentTrain: '모름', currentPosition: '모름', installDate: '2025-01-01' }),
      tm({ serialNo: 'UNKNOWN-2', currentTrain: '모름', currentPosition: '모름', installDate: '2026-01-01' }),
    ]);

    expect(rows.map(row => row.serialNo)).toEqual(['OLD', 'NEW', 'SPARE', 'UNKNOWN-1', 'UNKNOWN-2']);
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
      currentPosition: '3',
      installDate: '2024-05-06',
      sourceType: 'history_only',
    });
  });
});


describe('latest-date current state reconciliation', () => {
  it('keeps the confirmed workbook location when all replacement events are older', () => {
    const next = enrichTmLocationsFromReplacementHistory(
      [tm({ confirmedAt:'2026-08-12',installDate:'',currentTrain:'111',currentCar:'1111',currentUnit:'1',currentPosition:'1' })],
      [replacement({ installedSerialNo:'TM-1',trainNo:'106',carNo:'9999',position:'M09',replacementDate:'2026-04-07' })],
    )[0];
    expect(next).toMatchObject({currentTrain:'111',currentCar:'1111',currentUnit:'1',currentPosition:'1',confirmedAt:'2026-08-12',installDate:'',locationSource:'현황파일'});
  });

  it('applies only a replacement later than the final confirmation date', () => {
    const next = enrichTmLocationsFromReplacementHistory(
      [tm({ confirmedAt:'2026-08-12',installDate:'',currentTrain:'111',currentCar:'1111',currentUnit:'1',currentPosition:'1' })],
      [replacement({ installedSerialNo:'TM-1',trainNo:'112',carNo:'1212',position:'M02',replacementDate:'2026-08-13' })],
    )[0];
    expect(next).toMatchObject({currentTrain:'112',currentCar:'2',currentUnit:'2',currentPosition:'2',confirmedAt:'2026-08-12',installDate:'2026-08-13',locationSource:'교체현황 최신 부착이력'});
  });
  it('applies a newer installed replacement without a date mismatch warning', () => {
    const next = enrichTmLocationsFromReplacementHistory(
      [tm({ currentTrain: '101', currentCar: '1', currentPosition: 'M01', installDate: '2025-01-01' })],
      [replacement({ removedSerialNo: 'OLD', installedSerialNo: 'TM-1', trainNo: '202', carNo: '2', position: 'M08', replacementDate: '2026-02-03' })],
    )[0];
    expect(next).toMatchObject({ currentTrain: '202', currentCar: '2', currentUnit:'8', currentPosition: '8', installDate: '2026-02-03', locationDateMismatch: false });
  });

  it('keeps current-file state when it has the newer date', () => {
    const next = enrichTmLocationsFromReplacementHistory(
      [tm({ currentTrain: '101', currentPosition: 'M01', installDate: '2026-05-01' })],
      [replacement({ installedSerialNo: 'TM-1', trainNo: '202', position: 'M08', replacementDate: '2025-02-03' })],
    )[0];
    expect(next).toMatchObject({ currentTrain: '101', currentPosition: 'M01', installDate: '2026-05-01', locationDateMismatch: false });
  });
});


describe('manual replacement identity and state', () => {
  it('failure replacement moves A to warned spare and mounts B without A failure state', () => {
    const event = replacement({ replacementDate:'2026-09-10', trainNo:'777', carNo:'2', position:'M04', removedSerialNo:'A', installedSerialNo:'B', replacementReason:'고장', failureType:'베어링 고장', severityScore:80 });
    const next = applyManualReplacementToTmState([
      tm({ serialNo:'A', tmId:'ID-A' }),
      tm({ serialNo:'B', tmId:'ID-B', currentStatus:'예비품', isSpare:true, currentTrain:'예비품', currentPosition:'' }),
    ], event, '2026-09-10T00:00:00.000Z');

    expect(next).toHaveLength(2);
    expect(next.find(x=>x.serialNo==='A')).toMatchObject({tmId:'ID-A',isSpare:true,currentTrain:'예비품',currentCar:'',currentPosition:'',currentStatus:'예비품 · ⚠ 고장 취거 / 점검 필요'});
    expect(next.find(x=>x.serialNo==='B')).toMatchObject({tmId:'ID-B',isSpare:false,currentTrain:'777',currentCar:'2',currentPosition:'4',currentStatus:'운행중'});
    expect(next.find(x=>x.serialNo==='B')?.currentStatus).not.toContain('고장');
  });

  it('preventive replacement returns A to a normal spare without a failure warning', () => {
    const next = applyManualReplacementToTmState([
      tm({serialNo:'A'}),
      tm({serialNo:'B',currentStatus:'예비품',isSpare:true,currentTrain:'예비품'}),
    ], replacement({replacementDate:'2026-09-10',removedSerialNo:'A',installedSerialNo:'B',replacementReason:'예방교체',failureType:'',severityScore:null}), '2026-09-10T00:00:00.000Z');

    expect(next.find(x=>x.serialNo==='A')).toMatchObject({currentStatus:'예비품',isSpare:true,currentTrain:'예비품'});
    expect(next.find(x=>x.serialNo==='B')).toMatchObject({currentStatus:'운행중',isSpare:false});
  });

  it('keeps A, B, and C independent through consecutive replacements', () => {
    const first = applyManualReplacementToTmState([
      tm({serialNo:'A'}),
      tm({serialNo:'B',currentStatus:'예비품',isSpare:true,currentTrain:'예비품'}),
      tm({serialNo:'C',currentStatus:'예비품',isSpare:true,currentTrain:'예비품'}),
    ], replacement({replacementId:'R1',replacementDate:'2026-09-10',removedSerialNo:'A',installedSerialNo:'B',replacementReason:'고장'}), '2026-09-10T00:00:00.000Z');
    const second = applyManualReplacementToTmState(first, replacement({replacementId:'R2',replacementDate:'2026-10-10',removedSerialNo:'B',installedSerialNo:'C',replacementReason:'예방교체'}), '2026-10-10T00:00:00.000Z');

    expect(second.map(x=>x.serialNo).sort()).toEqual(['A','B','C']);
    expect(second.find(x=>x.serialNo==='A')).toMatchObject({isSpare:true,currentStatus:'예비품 · ⚠ 고장 취거 / 점검 필요'});
    expect(second.find(x=>x.serialNo==='B')).toMatchObject({isSpare:true,currentStatus:'예비품'});
    expect(second.find(x=>x.serialNo==='C')).toMatchObject({isSpare:false,currentTrain:'999',currentPosition:'9'});
  });
});
