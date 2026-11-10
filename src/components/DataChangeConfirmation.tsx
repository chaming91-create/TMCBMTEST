import { useEffect, useRef, useState, type ReactNode } from 'react';
import { firebaseConfigured } from '../lib/firebase';
import './ReplacementConfirmation.css';
import './DataChangeConfirmation.css';

export default function DataChangeConfirmation({ title, action, onCancel, onConfirm, children }: { title: string; action: string; onCancel: () => void; onConfirm: () => Promise<void>; children: ReactNode }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const locked = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => { dialog.current?.showModal(); }, []);
  const cancel = () => { if (!locked.current) onCancel(); };
  return <dialog ref={dialog} className="replacement-confirmation data-change-confirmation" aria-label={title} onCancel={event => { event.preventDefault(); cancel(); }}>
    <h2>{title}</h2>
    <p>{firebaseConfigured ? '대상은 연결된 Firebase 공유 데이터입니다. 다른 접속자에게도 반영됩니다.' : '대상은 이 브라우저의 데이터입니다.'}</p>
    {children}
    <p>실행 전 현재 전체 상태를 별도 자동 백업합니다. 저장된 기존 시점과 원본 Storage 파일은 변경하지 않습니다.</p>
    <p>다른 사용자의 입력이 없는 상태에서 진행해 주세요. 승인 전에는 데이터가 변경되지 않습니다.</p>
    {error && <p className="form-error" role="alert">{error}</p>}
    <p role="status">{busy ? '백업 및 데이터 처리 중입니다. 창을 닫거나 새로고침하지 마세요.' : ''}</p>
    <div className="form-actions"><button type="button" autoFocus disabled={busy} onClick={cancel}>취소</button><button type="button" className="primary" disabled={busy} onClick={async () => {
      if (locked.current) return;
      locked.current = true; setBusy(true); setError('');
      try { await onConfirm(); onCancel(); }
      catch (error) { setError(error instanceof Error ? error.message : '처리하지 못했습니다. 현재 데이터와 자동 백업을 확인하세요.'); }
      finally { locked.current = false; setBusy(false); }
    }}>{busy ? '처리 중...' : action}</button></div>
  </dialog>;
}
