import * as XLSX from 'xlsx';
import type { TmMaster, SeverityMaster } from '../types/tm';
import type { ReplacementHistory } from '../types/replacement';
import type { RiskSettings } from '../types/risk';
import { DEFAULT_SETTINGS, DEFAULT_SEVERITIES } from './defaults';
import { parseReplacementHistorySheet, parseSeverityClassificationSheet, parseTMInstallationSheet, toSeverityMap } from './excelParser';
import { mergeHistoryImports, mergeTmImports } from './importMerge';
import { applyHistoryImportToTmState, enrichTmLocationsFromReplacementHistory } from './tmState';
import tmWorkbookData from '../../0. data1(TM 취부 현황) v2.xlsx?base64';
import historyWorkbookData from '../../0. data2(TM_교체현황_고장심각도) v2.xlsx?base64';

export const EMPTY_DATA_KEY = 'ai_parts_intentionally_empty';
type SavedData = Pick<Storage, 'getItem'>;

function readSaved<T>(storage: SavedData, key: string, fallback: T): T {
  try {
    const raw = storage.getItem(`ai_parts_${key}`) ?? storage.getItem(`cbm_${key}`);
    return raw ? JSON.parse(raw) as T : fallback;
  } catch { return fallback; }
}

export function loadInitialData(storage: SavedData) {
  const settings = readSaved<RiskSettings>(storage, 'settings', DEFAULT_SETTINGS);
  const tms = readSaved<TmMaster[]>(storage, 'tms', []);
  const history = readSaved<ReplacementHistory[]>(storage, 'history', []);
  if (tms.length || history.length || storage.getItem(EMPTY_DATA_KEY) === 'Y') {
    return { tms, history, settings, severities: readSaved<SeverityMaster[]>(storage, 'severities', DEFAULT_SEVERITIES) };
  }

  // Bundle the original workbooks so first render never depends on a network or Firebase login.
  const tmWorkbook = XLSX.read(tmWorkbookData, { type: 'base64', cellDates: true });
  const historyWorkbook = XLSX.read(historyWorkbookData, { type: 'base64', cellDates: true });
  const parsedSeverities = parseSeverityClassificationSheet(historyWorkbook);
  const severities = parsedSeverities.length ? parsedSeverities : DEFAULT_SEVERITIES;
  const seededHistory = mergeHistoryImports([], parseReplacementHistorySheet(historyWorkbook, toSeverityMap(severities)));
  const importedTms = mergeTmImports([], parseTMInstallationSheet(tmWorkbook, settings.referenceYear));
  const seededTms = enrichTmLocationsFromReplacementHistory(
    applyHistoryImportToTmState(importedTms, seededHistory, settings.referenceYear, new Date().toISOString()), seededHistory,
  );
  return { tms: seededTms, history: seededHistory, severities, settings };
}
