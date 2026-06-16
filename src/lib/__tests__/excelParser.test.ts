import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { autoMapColumns, scoreAutoMap } from '../columnMapper';
import { mapReplacementRows, parseWorkbook } from '../excelParser';

const filePath = new URL('../../../0. data2(TM_교체현황_고장심각도).xlsx', import.meta.url);

describe('excelParser replacement workbook import', () => {
  it('selects and maps the data2 replacement sheet shape', async () => {
    const file = new File([readFileSync(filePath)], '0. data2(TM_교체현황_고장심각도).xlsx');
    const first = await parseWorkbook(file);
    const sheets = await Promise.all(first.sheetNames.map(name => parseWorkbook(file, name)));
    const best = sheets.sort((a, b) => scoreAutoMap(b.headers, 'replacement') - scoreAutoMap(a.headers, 'replacement'))[0];
    const mapping = autoMapColumns(best.headers, 'replacement');
    const rows = mapReplacementRows(best.rows, mapping);

    expect(best.selectedSheet).toBe('교체현황_DB');
    expect(rows).toHaveLength(128);
    expect(mapping).toMatchObject({
      replacementId: '교체ID',
      replacementDate: '교체일자',
      carNo: '차호',
      removedSerialNo: '취거TM_시리얼',
      installedSerialNo: '부착TM_시리얼',
      severityScore: '위험점수(자동)',
    });
    expect(rows[0]).toMatchObject({
      replacementId: 'RP-0001',
      replacementDate: '2021-02-04',
      removedSerialNo: '88TWDH073',
      installedSerialNo: '88091-48',
      severityScore: 100,
    });
  });
});
