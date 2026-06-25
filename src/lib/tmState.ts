import type { ReplacementHistory } from '../types/replacement';
import type { TmMaster } from '../types/tm';

const UNKNOWN = '모름';
const NEEDS_LOCATION = '위치확인필요';
const isHistoryOnly = (tm: TmMaster) => tm.sourceType === 'history_only';
const comparableDate = (value: string) => value || '0000-00-00';
const hasKnownValue = (value?: string) => !!value?.trim() && value.trim() !== UNKNOWN && value.trim() !== NEEDS_LOCATION;
const isUnknownStatus = (value?: string) => !value?.trim() || value.trim() === UNKNOWN;
const isSpareLike = (value?: string) => ['예비품', '예비', 'spare'].some(token => (value || '').toLowerCase().includes(token.toLowerCase()));
const validDateValue = (value?: string) => !!value && !Number.isNaN(new Date(value).getTime());

export function isReplacementNewerThanCurrent(tm: TmMaster, replacementDate: string): boolean {
  if (!replacementDate || !tm.installDate) return true;
  return comparableDate(replacementDate) >= comparableDate(tm.installDate);
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
  const byTmId = new Map<string, TmMaster>();
  const byLocation = new Map<string, TmMaster>();
  const noLocation: TmMaster[] = [];

  rows.forEach((row) => {
    const tmId = row.tmId?.trim();
    if (tmId) {
      const existing = byTmId.get(tmId);
      if (!existing || comparableDate(row.installDate) >= comparableDate(existing.installDate)) byTmId.set(tmId, row);
      return;
    }

    const hasLocation = hasKnownValue(row.currentTrain) && hasKnownValue(row.currentPosition) && !row.isSpare;
    if (!hasLocation) {
      noLocation.push(row);
      return;
    }

    const key = [row.currentTrain, row.currentCar, row.currentPosition].map(value => value.trim()).join('|');
    const existing = byLocation.get(key);
    if (!existing || comparableDate(row.installDate) >= comparableDate(existing.installDate)) byLocation.set(key, row);
  });

  return [...byTmId.values(), ...noLocation, ...byLocation.values()];
}

export function enrichTmLocationsFromReplacementHistory(currentRows: TmMaster[], replacementRows: ReplacementHistory[]): TmMaster[] {
  const latestInstalled = buildLatestInstalledReplacementIndex(replacementRows);

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

    if (isSpareLike(next.currentStatus) || next.isSpare) {
      next.isSpare = true;
      next.locationSource = next.locationSource || '현황파일';
      return next;
    }

    const missingTrain = !hasKnownValue(next.currentTrain);
    const missingCar = !hasKnownValue(next.currentCar);
    const missingPosition = !hasKnownValue(next.currentPosition);
    const needsLocationSupplement = missingTrain || missingCar || missingPosition;

    if (installed && needsLocationSupplement) {
      if (missingTrain && hasKnownValue(installed.trainNo)) next.currentTrain = installed.trainNo;
      if (missingCar && hasKnownValue(installed.carNo)) {
        next.currentCar = installed.carNo;
        next.currentUnit = installed.carNo;
      }
      if (missingPosition && hasKnownValue(installed.position)) next.currentPosition = installed.position;
      next.locationSource = '교체현황 최신 부착이력';
      next.inferredFromReplacement = true;
      next.inferredReplacementDate = installed.replacementDate;

      if (!validDateValue(next.installDate) || !validDateValue(installed.replacementDate)) {
        next.locationDateMismatch = true;
        next.locationDateWarning = '날짜 비교 불가, 교체파일 부착이력 기준 위치 보완';
      } else if (next.installDate !== installed.replacementDate) {
        next.locationDateMismatch = true;
        next.locationDateWarning = comparableDate(installed.replacementDate) > comparableDate(next.installDate)
          ? '교체파일 최신 부착이력이 현황파일보다 최신입니다.'
          : '현황파일 교환일자가 교체현황 최신 부착일자보다 최신입니다.';
      }
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
      removed.currentStatus = row.removedStatus || '취거';
      removed.isSpare = false;
      removed.currentTrain = '';
      removed.currentCar = '';
      removed.currentPosition = '';
      removed.updatedAt = now;
    }

    const installed = ensureHistoryOnlyTm(row.installedSerialNo, row.installedManufacturer || '', row.installedManufactureYear ?? null);
    if (installed) {
      installed.currentStatus = row.installedStatus || '운행중';
      installed.isSpare = false;
      installed.currentTrain = row.trainNo;
      installed.currentCar = row.carNo;
      installed.currentPosition = row.position;
      installed.installDate = row.replacementDate;
      installed.locationSource = '교체현황 최신 부착이력';
      installed.inferredFromReplacement = true;
      installed.inferredReplacementDate = row.replacementDate;
      installed.updatedAt = now;
    }
  });

  return Array.from(bySerial.values());
}
