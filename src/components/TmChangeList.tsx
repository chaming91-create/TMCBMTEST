import type { TmMaster } from '../types/tm';
import { tmChanges } from '../lib/dataRecovery';
const describe = (tm?: TmMaster) => tm ? `${tm.currentTrain || '-'}편성 / ${tm.currentCar || '-'}호차 / ${tm.currentPosition || '-'}위수 · ${tm.currentStatus} · ${tm.isSpare ? '예비품' : '비예비품'}` : 'TM 목록에 없음';
export default function TmChangeList({ before, after }: { before: TmMaster[]; after: TmMaster[] }) {
  const changes = tmChanges(before, after);
  return <details><summary>변경되는 TM {changes.length}대 — 상세 확인</summary><div className="change-list">{changes.length ? changes.map(item => <article key={item.serial}><b>{item.serial}</b><p>현재: {describe(item.before)}</p><p>변경 후: {describe(item.after)}</p></article>) : <p>TM 취부·예비품 정보 변경 없음</p>}</div></details>;
}
