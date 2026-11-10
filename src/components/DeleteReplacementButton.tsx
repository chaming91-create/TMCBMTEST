import { useState } from 'react';
import { useApp } from '../context/AppContext';
import { dataVersion, planReplacementDeletion } from '../lib/dataRecovery';
import DataChangeConfirmation from './DataChangeConfirmation';
import TmChangeList from './TmChangeList';

export default function DeleteReplacementButton({ replacementId }: { replacementId: string }) {
  const app = useApp();
  const [confirmation, setConfirmation] = useState<ReturnType<typeof planReplacementDeletion> & { version: string } | null>(null);
  const [error, setError] = useState('');
  const item = app.history.find(row => row.replacementId === replacementId);
  return <>
    <button type="button" className="delete-button" title="교체이력 삭제" onClick={() => {
      setError('');
      try { setConfirmation({ ...planReplacementDeletion(app, replacementId), version: dataVersion(app) }); }
      catch (error) { setError(error instanceof Error ? error.message : '삭제 영향을 확인하지 못했습니다.'); }
    }}>삭제</button>
    {error && <span role="alert" className="form-error">{error}</span>}
    {confirmation && item && <DataChangeConfirmation title="교체이력 삭제 최종 확인" action="백업 후 이력 삭제 승인" onCancel={() => setConfirmation(null)} onConfirm={async fileBackup => { await app.deleteReplacement(replacementId, confirmation.version, fileBackup); window.alert('교체이력이 삭제되었습니다. 관련 화면도 같은 데이터로 갱신됩니다.'); }}>
      <dl><div><dt>교체일자 / 위치</dt><dd>{item.replacementDate || '날짜 미상'} · {item.trainNo || '-'}편성 / {item.carNo || '-'}호차 / {item.position || '-'}위수</dd></div><div className="removed-serial"><dt>취거 TM</dt><dd>{item.removedSerialNo || '정보 없음'}</dd></div><div className="installed-serial"><dt>취부 TM</dt><dd>{item.installedSerialNo || '정보 없음'}</dd></div><div><dt>교체사유</dt><dd>{item.replacementReason || '정보 없음'}</dd></div></dl>
      <div className="change-counts"><span>교체 {app.history.length} → {confirmation.data.history.length}건</span><span>TM {app.tms.length} → {confirmation.data.tms.length}대</span><span>예비품 {app.tms.filter(tm => tm.isSpare).length} → {confirmation.data.tms.filter(tm => tm.isSpare).length}대</span></div>
      <p>{confirmation.warning}</p><p>남은 전체 이력을 기준으로 위험도를 다시 계산합니다. 산출식과 기준은 유지합니다.</p>
      <TmChangeList before={app.tms} after={confirmation.data.tms}/>
    </DataChangeConfirmation>}
  </>;
}
