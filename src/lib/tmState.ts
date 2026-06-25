import type { ReplacementHistory } from '../types/replacement';
import type { TmMaster } from '../types/tm';

const isHistoryOnly = (tm: TmMaster) => tm.sourceType === 'history_only';
const comparableDate = (value: string) => value || '0000-00-00';
const hasKnownValue = (value: string) => value.trim() && value.trim() !== '모름';

export function isReplacementNewerThanCurrent(tm: TmMaster, replacementDate: string): boolean {
  if (!replacementDate || !tm.installDate) return true;
  return comparableDate(replacementDate) >= comparableDate(tm.installDate);
}

export function keepLatestTmByCurrentLocation(rows: TmMaster[]): TmMaster[] {
  const byLocation = new Map<string, TmMaster>();
  const noLocation: TmMaster[] = [];

  rows.forEach((row) => {
    const hasLocation = hasKnownValue(row.currentTrain) && hasKnownValue(row.currentPosition) && !row.isSpare;
    if (!hasLocation) {
      noLocation.push(row);
      return;
    }

    const key = [row.currentTrain, row.currentCar, row.currentPosition].map(value => value.trim()).join('|');
    const existing = byLocation.get(key);
    if (!existing || comparableDate(row.installDate) >= comparableDate(existing.installDate)) {
      byLocation.set(key, row);
    }
  });

  return [...noLocation, ...byLocation.values()];
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
      installed.updatedAt = now;
    }
  });

  return Array.from(bySerial.values());
}
