import type { TmMaster } from '../types/tm';
import type { ReplacementHistory } from '../types/replacement';
import { applyManualReplacementToTmState, isReplacementNewerThanCurrent } from './tmState';
import { normalizeCarNumber, normalizeTmUnit } from './locationNormalizer';

export function applyReplacement(tms: TmMaster[], item: ReplacementHistory) {
  const removed = tms.find(x => x.serialNo === item.removedSerialNo), installed = tms.find(x => x.serialNo === item.installedSerialNo);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(item.replacementDate) || !Number.isFinite(Date.parse(item.replacementDate)) || new Date(item.replacementDate).toISOString().slice(0,10) !== item.replacementDate) throw new Error('교체일자를 확인하세요.');
  if (!item.removedSerialNo && !item.installedSerialNo) throw new Error('취거 또는 취부 부품을 선택하세요.');
  if (item.removedSerialNo && item.removedSerialNo === item.installedSerialNo) throw new Error('취거품과 취부품은 서로 달라야 합니다.');
  if (item.removedSerialNo && !removed) throw new Error('취거품이 등록되어 있지 않습니다. 기존자료 이관 또는 부품등록 후 선택하세요.');
  if (removed && !item.replacementReason.trim()) throw new Error('취거품의 교체사유를 입력하세요.');
  if ([removed, installed].some(x => x && !isReplacementNewerThanCurrent(x, item.replacementDate))) throw new Error('최신 부품 상태보다 이전 날짜입니다. 과거 이력은 교체현황 업로드에서 등록하세요.');
  if (removed?.currentStatus === '불용') throw new Error('이미 불용 처리된 부품입니다.');
  if (removed?.isSpare && item.removedStatus !== '불용') throw new Error('선택한 취거품은 이미 예비품입니다.');
  if (installed && !installed.isSpare) throw new Error('취부품은 예비품 상태여야 합니다.');
  if (installed?.condition === 'disposed' || installed?.currentStatus === '불용') throw new Error('불용 부품은 취부할 수 없습니다.');
  if (item.installedSerialNo && (!item.trainNo || !item.position)) throw new Error('취부 편성과 위치가 필요합니다.');
  const slot = (train: string, car: string, position: string) => [train.trim(), normalizeCarNumber(train, car), normalizeTmUnit(position)].join('|');
  const target = slot(item.trainNo, item.carNo, item.position);
  if (removed && !removed.isSpare && item.removedStatus !== '불용' && slot(removed.currentTrain, removed.currentCar, removed.currentPosition) !== target) throw new Error('취거품의 현재 취부 위치와 입력 위치가 다릅니다.');
  if (item.installedSerialNo && tms.some(x => !x.isSpare && x.currentStatus !== '불용' && x.serialNo !== item.removedSerialNo && slot(x.currentTrain, x.currentCar, x.currentPosition) === target)) throw new Error('해당 위치에 다른 부품이 취부되어 있습니다.');
  return applyManualReplacementToTmState(tms, item, new Date().toISOString());
}
