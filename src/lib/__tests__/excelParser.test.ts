import { readFileSync } from 'node:fs';
import * as XLSX from 'xlsx';
import { describe, expect, it } from 'vitest';
import { autoMapColumns, scoreAutoMap } from '../columnMapper';
import { mapReplacementRows, parseReplacementHistorySheet, parseSeverityClassificationSheet, parseTMInstallationSheet, parseWorkbook, toSeverityMap, validateMasterRows, validateReplacementRows } from '../excelParser';

const replacementFilePath = new URL('../../../0. data2(TM_교체현황_고장심각도).xlsx', import.meta.url);
const tmFilePath = new URL('../../../0. data1(TM 취부 현황).xlsx', import.meta.url);

describe('excelParser workbook import', () => {
  it('selects the data2 replacement sheet without relying on automatic formula columns', async () => {
    const file = new File([readFileSync(replacementFilePath)], '0. data2(TM_교체현황_고장심각도).xlsx');
    const first = await parseWorkbook(file);
    const sheets = await Promise.all(first.sheetNames.map(name => parseWorkbook(file, name)));
    const best = sheets.sort((a, b) => scoreAutoMap(b.headers, 'replacement') - scoreAutoMap(a.headers, 'replacement'))[0];
    const mapping = autoMapColumns(best.headers, 'replacement');

    expect(best.selectedSheet).toBe('교체현황_DB');
    expect(mapping).toMatchObject({
      replacementId: '교체ID',
      replacementDate: '교체일자',
      carNo: '차호',
      removedSerialNo: '취거TM_시리얼',
      installedSerialNo: '부착TM_시리얼',
    });
    expect(mapping.severityScore).toBe('');
  });


  it('maps TM installation 교환일자 as the current install date', () => {
    const mapping = autoMapColumns(['시리얼번호', '교환일자', '편성', '위치'], 'tm');

    expect(mapping.installDate).toBe('교환일자');
  });

  it('keeps replacement rows when installed position is missing and marks it unknown', () => {
    const rows = mapReplacementRows([
      { 교체일자: '2024-01-02', 편성: '111', 취거TM: 'OLD-1', 취부TM: 'NEW-1' },
      { 교체일자: '2024-01-03', 편성: '112', 취거TM: 'OLD-2', 취부TM: 'NEW-2', 위치: '' },
    ], { replacementDate: '교체일자', trainNo: '편성', removedSerialNo: '취거TM', installedSerialNo: '취부TM', position: '위치' });

    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ replacementDate: '2024-01-02', trainNo: '111', position: '모름', installedSerialNo: 'NEW-1' });
    expect(rows[1].position).toBe('모름');
  });

  it('normalizes missing Excel info to 모름 without creating noisy validation items', () => {
    const rows = mapReplacementRows([
      { 교체일자: '2024-01-02', 취거TM: 'OLD-1', 취부TM: 'NEW-1' },
    ], { replacementDate: '교체일자', trainNo: '편성', removedSerialNo: '취거TM', installedSerialNo: '취부TM', position: '위치', failureType: '고장유형', removedStatus: '취거품상태' });
    const issues = validateReplacementRows(rows, [], new Map());

    expect(rows[0]).toMatchObject({ trainNo: '모름', position: '모름', failureType: '모름', removedStatus: '모름' });
    expect(issues.some(issue => issue.category === '편성 불분명')).toBe(false);
    expect(issues.some(issue => issue.level === '오류')).toBe(false);
  });

  it('treats replacement-only serials as valid past history without master-registration notices', () => {
    const rows = mapReplacementRows([
      { 교체일자: '2024-01-02', 취거TM: 'PAST-ONLY-1', 취부TM: 'PAST-ONLY-2' },
    ], { replacementDate: '교체일자', removedSerialNo: '취거TM', installedSerialNo: '취부TM' });
    const issues = validateReplacementRows(rows, [], new Map());

    expect(issues.some(issue => issue.category === '마스터 미등록 부품')).toBe(false);
    expect(issues.some(issue => issue.message.includes('취부현황 마스터에 없습니다'))).toBe(false);
  });

  it('does not flag spare storage locations as position errors', () => {
    const wb = XLSX.read(readFileSync(tmFilePath), { type: 'buffer', cellDates: true });
    const rows = parseTMInstallationSheet(wb, 2026);
    const issues = validateMasterRows(rows);
    const spares = rows.filter(row => row.currentStatus === '예비품');

    expect(spares).toHaveLength(27);
    expect(spares[0]).toMatchObject({ currentTrain: '예비품', currentPosition: '예비-001', isSpare: true });
    expect(issues.some(issue => issue.category === '예비품 위치 오류')).toBe(false);
  });

  it('recalculates failure code, severity, and risk score from severity classification sheet', () => {
    const wb = XLSX.read(readFileSync(replacementFilePath), { type: 'buffer', cellDates: true });
    const severities = parseSeverityClassificationSheet(wb);
    const rows = parseReplacementHistorySheet(wb, toSeverityMap(severities));
    const insulation = rows.find(row => row.failureType === '절연파괴·소손·F/O');
    const brushHolder = rows.find(row => row.failureType === '브러쉬홀더 열화·계자코일 단락');

    expect(insulation).toMatchObject({ failureCode: 'FC05', severityClass: '7', severityScore: 100 });
    expect(brushHolder).toMatchObject({ failureCode: 'FC03', severityClass: '5', severityScore: 45 });
    expect(rows.some(row => row.failureCode === '#NAME?' || row.severityClass === '#NAME?')).toBe(false);
  });

  it('does not create noisy validation items for optional removed status', () => {
    const wb = XLSX.read(readFileSync(replacementFilePath), { type: 'buffer', cellDates: true });
    const masterRows = parseTMInstallationSheet(XLSX.read(readFileSync(tmFilePath), { type: 'buffer', cellDates: true }), 2026);
    const severities = parseSeverityClassificationSheet(wb);
    const rows = parseReplacementHistorySheet(wb, toSeverityMap(severities));
    const issues = validateReplacementRows(rows, masterRows, toSeverityMap(severities));

    expect(issues.some(issue => issue.category === '취거품 상태 불분명')).toBe(false);
    expect(issues.some(issue => issue.category === '취거품 상태 불분명' && issue.level === '오류')).toBe(false);
  });
});
