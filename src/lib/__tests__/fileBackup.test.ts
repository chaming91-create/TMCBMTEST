import { describe, expect, it, vi } from 'vitest';
import { createFileBackup, requestBackupDownload, verifiedBackupSnapshot, verifyFileBackup } from '../fileBackup';
import { DEFAULT_SETTINGS } from '../defaults';
import type { AppData } from '../firestoreService';
const current: AppData = { tms: [], history: [], risks: [], severities: [], settings: DEFAULT_SETTINGS };
describe('readable file backup proof', () => {
  it('does not mint verified proof when merely requesting a download', () => {
    const request = createFileBackup(current, '삭제');
    expect(() => verifiedBackupSnapshot({ method: 'verified-file' }, current)).toThrow('확인되지');
    expect(request.text).toContain('tm-recovery-backup-v1');
  });
  it('accepts only a reread file with the complete matching contents', () => {
    const request = createFileBackup(current, '복원');
    const proof = verifyFileBackup(request.text, request);
    const actual = verifiedBackupSnapshot(proof, current);
    expect(actual.history).toEqual(current.history); expect(actual.name).toContain('복원');
    const modified = JSON.parse(request.text); modified.snapshot.name = '다른 백업';
    expect(() => verifyFileBackup(JSON.stringify(modified), request)).toThrow('일치하지');
    expect(() => verifyFileBackup('bad json', request)).toThrow();
  });
  it('rejects a previously verified file after the current dataset changes', () => {
    const request = createFileBackup(current, '삭제'); const proof = verifyFileBackup(request.text, request);
    const changed = { ...current, history: [{ replacementId: 'changed' }] } as AppData;
    expect(() => verifiedBackupSnapshot(proof, changed)).toThrow('변경');
  });
});

it('does not embed application callbacks or the entire snapshot list into every JSON backup', () => {
  const request = createFileBackup({ ...current, snapshots: [{ name: 'SHOULD-NOT-BE-DUPLICATED' }], deleteReplacement() {} } as AppData, '삭제');
  expect(request.text).not.toContain('SHOULD-NOT-BE-DUPLICATED');
  expect(request.text).not.toContain('deleteReplacement');
});
