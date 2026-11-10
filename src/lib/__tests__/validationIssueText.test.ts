import { describe, expect, it } from 'vitest';
import { validationIssueText } from '../validationIssueText';
import type { ValidationIssue } from '../../types/risk';

const issue: ValidationIssue = { id: 'test-only', level: '오류', category: '중복 Serial No.', message: 'AbC-001-xYz가 중복되었습니다.', serialNo: 'AbC-001-xYz', sheetName: '01_TM_취부현황', row: 35 };

describe('validation issue clipboard text', () => {
  it('copies actual issue fields and preserves the full serial', () => {
    expect(validationIssueText(issue)).toBe('[TM 데이터 오류정보]\n오류유형: 중복 Serial No.\n오류내용: AbC-001-xYz가 중복되었습니다.\n편성번호: 확인 불가\n호차: 확인 불가\n시리얼번호: AbC-001-xYz\n원본자료: 01_TM_취부현황 (데이터 구분; 원본 파일명 확인 불가)\n오류위치: 원본 엑셀 행번호 확인 불가 (내부 검증 위치값: 35)');
  });
  it('does not invent missing serials, filenames or row numbers', () => {
    const text = validationIssueText({ id: 'missing', level: '오류', category: '시리얼번호 누락', message: '취거/취부 TM 시리얼번호가 모두 없습니다.' });
    expect(text).toContain('시리얼번호: 확인 불가');
    expect(text).toContain('원본자료: 확인 불가');
    expect(text).toContain('오류위치: 원본 엑셀 행번호 및 오류 위치 확인 불가');
    expect(text).not.toContain('내부 검증 위치값:');
  });
  it('distinguishes internal location values from original Excel rows', () => {
    expect(validationIssueText(issue)).not.toContain('35행');
    for (const row of [undefined, 0, -1, NaN, 1.5]) expect(validationIssueText({ ...issue, row })).not.toContain('내부 검증 위치값:');
  });
  it('preserves multi-line messages and does not mutate source issues', () => {
    const source = { ...issue, message: '첫 줄\n둘째 줄', serialNo: 'Ab-00-01' };
    const original = { ...source };
    expect(validationIssueText(source)).toContain('오류내용: 첫 줄\n둘째 줄');
    expect(source).toEqual(original);
  });
});
