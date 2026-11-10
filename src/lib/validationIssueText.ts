import type { ValidationIssue } from '../types/risk';

const known = (value?: string) => value?.trim() ? value : '확인 불가';

export function validationIssueText(issue: ValidationIssue): string {
  const location = Number.isInteger(issue.row) && (issue.row ?? 0) > 0
    ? `원본 엑셀 행번호 확인 불가 (내부 검증 위치값: ${issue.row})`
    : '원본 엑셀 행번호 및 오류 위치 확인 불가';
  return [
    '[TM 데이터 오류정보]',
    `오류유형: ${known(issue.category)}`,
    `오류내용: ${known(issue.message)}`,
    '편성번호: 확인 불가',
    '호차: 확인 불가',
    `시리얼번호: ${known(issue.serialNo)}`,
    `원본자료: ${issue.sheetName?.trim() ? `${issue.sheetName} (데이터 구분; 원본 파일명 확인 불가)` : '확인 불가'}`,
    `오류위치: ${location}`,
  ].join('\n');
}
