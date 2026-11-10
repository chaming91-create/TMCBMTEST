import type { AppData } from './firestoreService';
import type { DataSnapshot } from '../types/snapshot';
import type { TmMaster } from '../types/tm';

export const APP_STATE_KEY = 'ai_parts_state_v1';
export const RECOVERY_JOURNAL_KEY = 'ai_parts_recovery_journal';
export const RECOVERY_BACKUPS_KEY = 'ai_parts_recovery_backups';

// Omit optional object properties only; invalid numeric/array data must fail before writes.
export function cleanData<T>(value: T): T {
  if (typeof value === 'number' && !Number.isFinite(value)) throw new Error('저장할 데이터에 유효하지 않은 숫자가 있습니다.');
  if (Array.isArray(value)) return value.map(item => {
    if (item === undefined) throw new Error('배열에 비어 있는 데이터가 있습니다.');
    return cleanData(item);
  }) as T;
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined).map(([k, v]) => [k, cleanData(v)])) as T;
  return value;
}
export function stableData(value: unknown): string {
  const sort = (v: unknown): unknown => Array.isArray(v) ? v.map(sort) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b)).map(([k, x]) => [k, sort(x)])) : v;
  return JSON.stringify(sort(cleanData(value)));
}
function ids(items: object[], key: string, allowSlash = false) {
  const seen = new Set<string>();
  for (const item of items) {
    const id = (item as Record<string, unknown>)[key];
    if (typeof id !== 'string' || !id || (!allowSlash && id.includes('/')) || seen.has(id)) throw new Error(`${key} 식별자가 없거나 중복되어 안전하게 처리할 수 없습니다.`);
    seen.add(id);
  }
}
export function validateAppData(data: AppData) {
  if (!data || !Array.isArray(data.tms) || !Array.isArray(data.history) || !Array.isArray(data.risks) || !Array.isArray(data.severities) || !data.settings || !data.settings.weights) throw new Error('저장본의 전체 데이터가 없거나 손상되었습니다. 복원을 중단합니다.');
  ids(data.tms, 'serialNo'); ids(data.history, 'replacementId'); ids(data.risks, 'serialNo'); ids(data.severities, 'failureType', true);
  cleanData(data);
}
export function restoreTarget(snapshot: DataSnapshot): AppData {
  validateAppData(snapshot);
  if (snapshot.tmCount !== snapshot.tms.length || snapshot.historyCount !== snapshot.history.length) throw new Error(`저장본 표시 건수와 실제 데이터가 다릅니다. TM ${snapshot.tmCount}/${snapshot.tms.length}, 교체 ${snapshot.historyCount}/${snapshot.history.length}. 저장본은 변경하지 않고 복원을 중단합니다.`);
  return cleanData({ tms: snapshot.tms, history: snapshot.history, risks: snapshot.risks, severities: snapshot.severities, settings: snapshot.settings });
}
export function planReplacementDeletion(data: AppData, id: string): { data: AppData; warning: string } {
  const target = data.history.find(item => item.replacementId === id);
  if (!target) throw new Error('삭제할 교체이력이 없습니다. 최신 목록을 확인하세요.');
  const rollback = target.inputSource === 'manual' ? target.rollbackSnapshot : undefined;
  let tms = data.tms;
  if (rollback) {
    const serials = [target.removedSerialNo, target.installedSerialNo].filter(Boolean);
    const targetIndex = data.history.indexOf(target);
    const newer = data.history.some((item, index) => {
      if (item === target) return false;
      const relevant = serials.includes(item.removedSerialNo) || serials.includes(item.installedSerialNo) || (target.trainNo && target.position && item.trainNo === target.trainNo && item.carNo === target.carNo && item.position === target.position);
      const date = (item.replacementDate || '').localeCompare(target.replacementDate || '');
      const created = (item.createdAt || '').localeCompare(target.createdAt || '');
      return relevant && (date > 0 || (date === 0 && (created > 0 || (created === 0 && index < targetIndex))));
    });
    if (newer) throw new Error('관련 TM 또는 취부 위치에 더 최근 교체이력이 있습니다. 상태가 잘못 복구되지 않도록 삭제를 중단합니다. 최신 이력을 먼저 확인하세요.');
    const map = new Map(tms.map(tm => [tm.serialNo, tm]));
    for (const [serial, before] of [[target.removedSerialNo, rollback.removed], [target.installedSerialNo, rollback.installed]] as const) {
      if (!serial || !before) continue;
      if (!before.exists) { map.delete(serial); continue; }
      if (before.original) { if (before.original.serialNo !== serial) throw new Error('이전 TM 식별자가 일치하지 않아 삭제를 중단합니다.'); map.set(serial, cleanData(before.original)); continue; }
      const current = map.get(serial);
      if (!current) throw new Error(`${serial}: 삭제 전 TM 전체 정보가 없어 안전하게 복구할 수 없습니다.`);
      const { exists: _exists, original: _original, ...fields } = before;
      map.set(serial, cleanData({ ...current, ...fields }));
    }
    tms = [...map.values()];
    const positions = new Set<string>();
    for (const tm of tms.filter(item => !item.isSpare && item.sourceType !== 'history_only' && item.currentTrain && item.currentPosition)) {
      const position = `${tm.currentTrain}|${tm.currentCar}|${tm.currentPosition}`;
      if (positions.has(position)) throw new Error('삭제 후 취부 위치가 중복될 수 있어 중단합니다.');
      positions.add(position);
    }
  }
  return { data: { ...data, tms, history: data.history.filter(item => item.replacementId !== id) }, warning: rollback ? '교체 직전 기록이 있는 TM은 해당 상태로 복구하며 신규 생성된 TM은 제거합니다. 과거 이력에 전체 원본이 없으면 기록된 위치·상태·예비품·취부일자만 복구합니다.' : '교체 직전 상태 기록이 없어 TM 취부·예비품 상태는 변경하지 않고 교체이력만 삭제합니다.' };
}
export function tmChanges(before: TmMaster[], after: TmMaster[]) {
  const a = new Map(before.map(tm => [tm.serialNo, tm]));
  const b = new Map(after.map(tm => [tm.serialNo, tm]));
  return [...new Set([...a.keys(), ...b.keys()])].filter(id => stableData(a.get(id) ?? null) !== stableData(b.get(id) ?? null)).map(id => ({ serial: id, before: a.get(id), after: b.get(id) }));
}
export function dataDocuments(data: AppData) {
  validateAppData(data);
  const docs = new Map<string, object>();
  data.tms.forEach(x => docs.set(`tm_master/${x.serialNo}`, cleanData(x)));
  data.history.forEach(x => docs.set(`replacement_history/${x.replacementId}`, cleanData(x)));
  data.risks.forEach(x => docs.set(`risk_score/${x.serialNo}`, cleanData(x)));
  data.severities.forEach(x => docs.set(`severity_master/${x.failureType.includes('/') ? encodeURIComponent(x.failureType) : x.failureType}`, cleanData(x)));
  if (docs.size !== data.tms.length + data.history.length + data.risks.length + data.severities.length) throw new Error('문서 식별자가 충돌하여 중단합니다.');
  docs.set('settings/risk', cleanData(data.settings));
  return docs;
}

export const dataVersion = (data: Pick<AppData, 'tms' | 'history' | 'severities' | 'settings'>) => stableData({ tms: data.tms, history: data.history, severities: data.severities, settings: data.settings });
