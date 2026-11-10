import { useMemo } from 'react';
import { useApp } from '../context/AppContext';
import { recentHistory } from '../lib/recentHistory';
import './RecentReplacementHistory.css';

export default function RecentReplacementHistory({ onHistory }: { onHistory: (replacementId?: string) => void }) {
  const { history, historyError } = useApp();
  const rows = useMemo(() => recentHistory(history), [history]);
  return <section className="panel table-panel recent-replacements" aria-labelledby="recent-replacements-title">
    <div className="panel-heading"><h3 id="recent-replacements-title">최근 TM 교체이력</h3><button type="button" onClick={() => onHistory()}>전체보기</button></div>
    {historyError && <p className="form-error" role="alert">{historyError}</p>}
    {!rows.length ? <p className="recent-history-empty">{historyError ? '현재 표시할 교체이력이 없습니다.' : '저장된 교체이력이 없습니다.'}</p> : <div className="table-wrap"><table>
      <thead><tr>{['교체일자', '편성번호 및 호차', '교체위치(위수)', '취거 TM 시리얼번호', '교체사유'].map(label => <th key={label}>{label}</th>)}</tr></thead>
      <tbody>{rows.map((item, index) => <tr key={item.replacementId || index}>
        <td>{item.replacementDate || '날짜 미상'}</td>
        <td>{[item.trainNo && `${item.trainNo}편성`, item.carNo && `${item.carNo}호차`].filter(Boolean).join(' · ') || '정보 없음'}</td>
        <td>{item.position || '정보 없음'}</td>
        <td><button type="button" className="link" disabled={!item.replacementId} aria-label={`교체정보 보기: 취거 TM ${item.removedSerialNo || '정보 없음'}`} onClick={() => onHistory(item.replacementId)}>{item.removedSerialNo || '정보 없음'}</button></td>
        <td>{item.replacementReason ? <details className="recent-history-reason"><summary title={item.replacementReason}>{item.replacementReason}</summary><p>{item.replacementReason}</p></details> : '정보 없음'}</td>
      </tr>)}</tbody>
    </table></div>}
  </section>;
}
