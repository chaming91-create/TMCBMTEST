import { useApp } from '../context/AppContext';
import { dataVersion } from '../lib/dataRecovery';
import { createFileBackup, requestBackupDownload, verifyFileBackup, type FileBackupProof, type FileBackupRequest } from '../lib/fileBackup';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { firebaseConfigured } from '../lib/firebase';
import './ReplacementConfirmation.css';
import './DataChangeConfirmation.css';

export default function DataChangeConfirmation({ title, action, onCancel, onConfirm, children }: { title: string; action: string; onCancel: () => void; onConfirm: (fileBackup?: FileBackupProof) => Promise<void>; children: ReactNode }) {
  const app = useApp();
  const version = dataVersion(app);
  const [fileRequest, setFileRequest] = useState<FileBackupRequest | null>(null);
  const [fileProof, setFileProof] = useState<FileBackupProof | null>(null);
  const [fileMessage, setFileMessage] = useState('');
  const [checkingFile, setCheckingFile] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const locked = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => { dialog.current?.showModal(); }, []);
  useEffect(() => { setFileProof(null); setFileRequest(null); setFileMessage(''); }, [version]);
  const cancel = () => { if (!locked.current) onCancel(); };
  return <dialog ref={dialog} className="replacement-confirmation data-change-confirmation" aria-label={title} onCancel={event => { event.preventDefault(); cancel(); }}>
    <h2>{title}</h2>
    <p>{firebaseConfigured ? '대상은 연결된 Firebase 공유 데이터입니다. 다른 접속자에게도 반영됩니다.' : '대상은 이 브라우저의 데이터입니다.'}</p>
    {children}
    <p>실행 전 현재 전체 상태를 IndexedDB에 별도 자동 백업하고 저장 내용을 다시 읽어 확인합니다. 저장된 기존 시점과 원본 Storage 파일은 변경하지 않습니다.</p>
    <p>다른 사용자의 입력이 없는 상태에서 진행해 주세요. 승인 전에는 데이터가 변경되지 않습니다.</p>
    <details className="file-backup-alternative" open={Boolean(error)}>
      <summary>저장공간 부족 시 JSON 파일로 대체 백업</summary>
      <p>다운로드 요청만으로는 백업 완료로 인정하지 않습니다. 보관한 JSON 파일을 아래에서 다시 선택해 전체 내용이 일치하는지 확인해야 합니다.</p>
      <button type="button" disabled={busy || checkingFile} onClick={() => {
        setFileProof(null); setFileRequest(null); setFileMessage('');
        try {
          const request = createFileBackup(app, title);
          requestBackupDownload(request);
          setFileRequest(request);
          setFileMessage('다운로드 요청됨 — 아직 백업 미확인. 보관된 JSON 파일을 다시 선택해 주세요.');
        } catch (error) { setFileMessage(error instanceof Error ? error.message : '백업 파일 다운로드를 요청하지 못했습니다.'); }
      }}>현재 데이터 JSON 다운로드</button>
      {fileRequest && <label>보관한 JSON 파일 확인<input type="file" accept=".json,application/json" disabled={busy || checkingFile} onChange={async event => {
        const file = event.target.files?.[0];
        event.target.value = '';
        setFileProof(null);
        if (!file) return;
        setCheckingFile(true); setFileMessage('선택한 백업 파일을 검증하고 있습니다…');
        try {
          if (file.size > new Blob([fileRequest.text]).size + 1024 * 1024) throw new Error('선택한 파일의 크기가 이번 백업과 다릅니다.');
          const proof = verifyFileBackup(await file.text(), fileRequest);
          setFileProof(proof); setFileMessage('파일 백업 확인 완료 — 전체 내용이 일치합니다. 아래 승인 버튼을 눌러야 작업이 실행됩니다.');
        } catch (error) { setFileMessage(error instanceof Error ? error.message : '파일 백업을 확인하지 못했습니다.'); }
        finally { setCheckingFile(false); }
      }}/></label>}
      {fileMessage && <p role="status">{fileMessage}</p>}
      <p>파일 확인 후에도 처리 결과를 보존할 저장공간이 없으면 데이터 변경을 중단합니다. 기존 백업이나 브라우저 데이터를 임의로 지우지 마세요.</p>
    </details>
    {error && <p className="form-error" role="alert">{error}</p>}
    <p role="status">{busy ? '백업 및 데이터 처리 중입니다. 창을 닫거나 새로고침하지 마세요.' : ''}</p>
    <div className="form-actions"><button type="button" autoFocus disabled={busy || checkingFile} onClick={cancel}>취소</button><button type="button" className="primary" disabled={busy || checkingFile || Boolean(fileRequest && !fileProof)} onClick={async () => {
      if (locked.current || checkingFile || (fileRequest && !fileProof)) return;
      locked.current = true; setBusy(true); setError('');
      try { await onConfirm(fileProof || undefined); onCancel(); }
      catch (error) { setError(error instanceof Error ? error.message : '처리하지 못했습니다. 현재 데이터와 자동 백업을 확인하세요.'); }
      finally { locked.current = false; setBusy(false); }
    }}>{busy ? '처리 중...' : action}</button></div>
  </dialog>;
}
