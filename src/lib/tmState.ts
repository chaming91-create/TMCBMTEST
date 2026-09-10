import type { ReplacementHistory } from '../types/replacement';
import type { TmMaster } from '../types/tm';
import { normalizeCarNumber,normalizeTmUnit } from './locationNormalizer';

const UNKNOWN = '모름';
const NEEDS_LOCATION = '위치확인필요';
const isHistoryOnly = (tm: TmMaster) => tm.sourceType === 'history_only';
const comparableDate = (value: string) => value || '0000-00-00';
const hasKnownValue = (value?: string) => !!value?.trim() && value.trim() !== UNKNOWN && value.trim() !== NEEDS_LOCATION;
const isUnknownStatus = (value?: string) => !value?.trim() || value.trim() === UNKNOWN;
const isSpareLike = (value?: string) => ['예비품', '예비', 'spare'].some(token => (value || '').toLowerCase().includes(token.toLowerCase()));

const NEEDS_INSPECTION_KEYWORDS = ['고장', '이상', '성능저하'];

export function getRemovedSpareStatus(replacement: Pick<ReplacementHistory, 'replacementReason' | 'failureType' | 'removedStatus'> & Partial<Pick<ReplacementHistory, 'severityScore' | 'failureCode' | 'failureReplacement'>>): string {
  if (replacement.removedStatus === '불용') return '불용';
  const cause = `${replacement.replacementReason || ''} ${replacement.failureType || ''}`;
  if (NEEDS_INSPECTION_KEYWORDS.some(keyword => cause.includes(keyword)) || ((replacement.severityScore ?? 0) > 0 && replacement.failureCode !== 'FC00') || replacement.failureReplacement === 'Y') {
    const reason = NEEDS_INSPECTION_KEYWORDS.find(keyword => cause.includes(keyword)) || '고장';
    return `예비품 · ⚠ ${reason} 취거 / 점검 필요`;
  }
  return '예비품';
}

export function applyManualReplacementToTmState(currentTms: TmMaster[], replacement: ReplacementHistory, now: string): TmMaster[] {
  let foundInstalled = false;
  const next: TmMaster[] = currentTms.map(tm => {
    if (tm.serialNo === replacement.removedSerialNo) {
      if (!isReplacementNewerThanCurrent(tm, replacement.replacementDate)) return tm;
      const removalStatus = getRemovedSpareStatus(replacement);
      const status = removalStatus === '예비품' && (tm.condition === 'inspection_required' || tm.condition === 'awaiting_repair') ? '예비품 · ⚠ 자체 이력 점검 필요' : removalStatus;
      return { ...tm, currentStatus: status, condition: status === '불용' ? 'disposed' : status.includes('⚠') ? 'inspection_required' : (tm.condition || 'normal'), lastRemovalReason: replacement.replacementReason, lastRemovedAt: replacement.replacementDate, isSpare: status !== '불용', currentTrain: status === '불용' ? '' : '예비품', currentCar: '', currentUnit: '', currentPosition: '', stateChangedAt: replacement.replacementDate, locationSource: '웹앱 신규 입력', inferredFromReplacement: false, inferredReplacementDate: '', sourceType: 'manual_added', updatedAt: now };
    }
    if (tm.serialNo === replacement.installedSerialNo) {
      foundInstalled = true;
      if (!isReplacementNewerThanCurrent(tm, replacement.replacementDate)) return tm;
      return { ...tm, currentStatus: tm.condition === 'inspection_required' || tm.condition === 'awaiting_repair' || tm.currentStatus.includes('⚠') ? '운행중 · ⚠ 자체 이력 점검 필요' : replacement.installedStatus || '운행중', stateChangedAt: replacement.replacementDate, isSpare: false, currentTrain: replacement.trainNo, currentCar: replacement.carNo, currentUnit: normalizeTmUnit(replacement.position), currentPosition: normalizeTmUnit(replacement.position), installDate: replacement.replacementDate, locationSource: '웹앱 신규 입력', inferredFromReplacement: false, inferredReplacementDate: '', sourceType: 'manual_added', updatedAt: now };
    }
    return tm;
  });
  if (replacement.installedSerialNo && !foundInstalled) next.push({ serialNo: replacement.installedSerialNo, manufacturer: replacement.installedManufacturer || '', manufactureYear: replacement.installedManufactureYear ?? null, ageYear: replacement.installedManufactureYear ? Math.max(0, new Date(now).getUTCFullYear() - replacement.installedManufactureYear) : 0, currentStatus: replacement.installedStatus || '운행중', stateChangedAt: replacement.replacementDate, isSpare: false, currentTrain: replacement.trainNo, currentCar: replacement.carNo, currentUnit: normalizeTmUnit(replacement.position), currentPosition: normalizeTmUnit(replacement.position), installDate: replacement.replacementDate, sourceType: 'manual_added', locationSource: '웹앱 신규 입력', inferredFromReplacement: false, inferredReplacementDate: '', createdAt: now, updatedAt: now });
  return next;
}

export function isReplacementNewerThanCurrent(tm: TmMaster, replacementDate: string): boolean {
  const stateDate=[tm.stateChangedAt,tm.confirmedAt,tm.installDate].filter(Boolean).sort().at(-1)||'';
  if (!replacementDate || !stateDate) return true;
  return comparableDate(replacementDate) >= comparableDate(stateDate);
}

function latest<T extends { date: string }>(a: T | undefined, b: T): T {
  if (!a) return b;
  return comparableDate(b.date) >= comparableDate(a.date) ? b : a;
}

export function buildLatestInstalledReplacementIndex(replacementRows: ReplacementHistory[]) {
  const bySerial = new Map<string, ReplacementHistory>();
  replacementRows.forEach((row) => {
    const serial = row.installedSerialNo?.trim();
    if (!serial || serial === '-' || !row.replacementDate) return;
    const current = bySerial.get(serial);
    if (!current || comparableDate(row.replacementDate) >= comparableDate(current.replacementDate)) {
      bySerial.set(serial, row);
    }
  });
  return bySerial;
}

export function keepLatestTmByCurrentLocation(rows: TmMaster[]): TmMaster[] {
  const bySerial = new Map<string, TmMaster>();
  rows.forEach(row => {
    const current = bySerial.get(row.serialNo);
    if (!current || comparableDate(row.confirmedAt || row.installDate) >= comparableDate(current.confirmedAt || current.installDate)) bySerial.set(row.serialNo, row);
  });
  return [...bySerial.values()];
}

export function enrichTmLocationsFromReplacementHistory(currentRows: TmMaster[], replacementRows: ReplacementHistory[]): TmMaster[] {
  const latestInstalled = buildLatestInstalledReplacementIndex(replacementRows);
  const latestEvent = new Map<string, { row: ReplacementHistory; kind: "installed" | "removed" }>();
  replacementRows.forEach(row => {
    if (!row.replacementDate) return;
    ([["removed", row.removedSerialNo], ["installed", row.installedSerialNo]] as const).forEach(([kind, rawSerial]) => {
      const serial = rawSerial?.trim();
      if (!serial || serial === "-") return;
      const current = latestEvent.get(serial);
      if (!current || comparableDate(row.replacementDate) >= comparableDate(current.row.replacementDate)) latestEvent.set(serial, { row, kind });
    });
  });

  return currentRows.map((tm) => {
    if (isHistoryOnly(tm)) return tm;

    const installed = latestInstalled.get(tm.serialNo);
    const next: TmMaster = {
      ...tm,
      locationSource: tm.locationSource || (tm.sourceType === 'manual_added' ? '웹앱 신규 입력' : '현황파일'),
      inferredFromReplacement: tm.inferredFromReplacement ?? false,
      inferredReplacementDate: tm.inferredReplacementDate || '',
      locationDateMismatch: false,
      locationDateWarning: '',
    };

    const event = latestEvent.get(tm.serialNo);
    if (event && comparableDate(event.row.replacementDate) > comparableDate([next.stateChangedAt,next.confirmedAt,next.installDate].filter(Boolean).sort().at(-1)||'')) {
      next.installDate = event.row.replacementDate;
      next.locationSource = "교체현황 최신 부착이력";
      next.inferredFromReplacement = true;
      next.inferredReplacementDate = event.row.replacementDate;
      if (event.kind === "installed") {
        next.currentStatus = event.row.installedStatus || "운행중"; next.isSpare = false;
        next.currentTrain = event.row.trainNo; next.currentCar = normalizeCarNumber(event.row.trainNo,event.row.carNo); next.currentUnit = normalizeTmUnit(event.row.position); next.currentPosition = normalizeTmUnit(event.row.position);
      } else {
        next.currentStatus = getRemovedSpareStatus(event.row); next.isSpare = next.currentStatus !== '불용';
        next.currentTrain = next.isSpare ? "예비품" : ""; next.currentCar = ""; next.currentUnit = ""; next.currentPosition = "";
      }
    }

    if (isSpareLike(next.currentStatus) || next.isSpare) {
      next.isSpare = true;
      next.locationSource = next.locationSource || '현황파일';
      return next;
    }

    const missingTrain = !hasKnownValue(next.currentTrain);
    const missingCar = !hasKnownValue(next.currentCar);
    const missingPosition = !hasKnownValue(next.currentPosition);
    const needsLocationSupplement = missingTrain || missingCar || missingPosition;

    if (installed && needsLocationSupplement && event?.kind !== "removed") {
      if (missingTrain && hasKnownValue(installed.trainNo)) next.currentTrain = installed.trainNo;
      if (missingCar && hasKnownValue(installed.carNo)) {
        next.currentCar = normalizeCarNumber(installed.trainNo,installed.carNo);
        next.currentUnit = normalizeTmUnit(installed.position);
      }
      if (missingPosition && hasKnownValue(installed.position)) next.currentPosition = normalizeTmUnit(installed.position);
      next.locationSource = '교체현황 최신 부착이력';
      next.inferredFromReplacement = true;
      next.inferredReplacementDate = installed.replacementDate;

    }

    if (!hasKnownValue(next.currentPosition)) {
      next.currentPosition = NEEDS_LOCATION;
      next.locationSource = '확인필요';
    }
    if (!hasKnownValue(next.currentCar)) next.currentCar = '';
    if (!hasKnownValue(next.currentTrain)) next.currentTrain = '';

    const hasLocation = hasKnownValue(next.currentTrain) || hasKnownValue(next.currentPosition) || !!installed;
    if (isUnknownStatus(next.currentStatus)) {
      next.currentStatus = hasLocation ? '운영중' : '상태확인필요';
    }

    return next;
  });
}

export function applyHistoryImportToTmState(
  currentTms: TmMaster[],
  replacementRows: ReplacementHistory[],
  referenceYear: number,
  now: string,
): TmMaster[] {
  const bySerial = new Map(currentTms.map(tm => [tm.serialNo, { ...tm }]));

  const ensureHistoryOnlyTm = (serialNo: string, manufacturer = '', manufactureYear: number | null = null) => {
    const serial = serialNo.trim();
    if (!serial || serial === '-') return null;
    const found = bySerial.get(serial);
    if (found) {
      if (!isHistoryOnly(found)) return null;
      if (!found.manufacturer && manufacturer) found.manufacturer = manufacturer;
      if (!found.manufactureYear && manufactureYear) {
        found.manufactureYear = manufactureYear;
        found.ageYear = Math.max(0, referenceYear - manufactureYear);
      }
      found.updatedAt = now;
      return found;
    }

    const tm: TmMaster = {
      serialNo: serial,
      manufacturer,
      manufactureYear,
      ageYear: manufactureYear ? Math.max(0, referenceYear - manufactureYear) : 0,
      currentStatus: '이력만 존재',
      isSpare: false,
      currentTrain: '',
      currentCar: '',
      currentPosition: '',
      installDate: '',
      sourceType: 'history_only',
      locationSource: '확인필요',
      inferredFromReplacement: false,
      inferredReplacementDate: '',
      createdAt: now,
      updatedAt: now,
    };
    bySerial.set(serial, tm);
    return tm;
  };

  [...replacementRows].sort((a, b) => (a.replacementDate || '').localeCompare(b.replacementDate || '')).forEach(row => {
    const removed = ensureHistoryOnlyTm(row.removedSerialNo, row.removedManufacturer || '', row.removedManufactureYear ?? null);
    if (removed) {
      removed.currentStatus = getRemovedSpareStatus(row);
      removed.isSpare = removed.currentStatus !== '불용';
      removed.currentTrain = removed.isSpare ? '예비품' : '';
      removed.currentCar = '';
      removed.currentPosition = '';
      removed.updatedAt = now;
    }

    const installed = ensureHistoryOnlyTm(row.installedSerialNo, row.installedManufacturer || '', row.installedManufactureYear ?? null);
    if (installed) {
      installed.currentStatus = row.installedStatus || '운행중';
      installed.isSpare = false;
      installed.currentTrain = row.trainNo;
      installed.currentCar = normalizeCarNumber(row.trainNo,row.carNo);
      installed.currentPosition = normalizeTmUnit(row.position);
      installed.currentUnit = normalizeTmUnit(row.position);
      installed.installDate = row.replacementDate;
      installed.locationSource = '교체현황 최신 부착이력';
      installed.inferredFromReplacement = true;
      installed.inferredReplacementDate = row.replacementDate;
      installed.updatedAt = now;
    }
  });

  return Array.from(bySerial.values());
}
