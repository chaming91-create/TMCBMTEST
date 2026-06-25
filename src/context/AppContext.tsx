import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { TmMaster, SeverityMaster } from '../types/tm';
import type { ReplacementHistory } from '../types/replacement';
import type { RiskScore, RiskSettings, ValidationIssue, AuditLog } from '../types/risk';
import { DEFAULT_SETTINGS, DEFAULT_SEVERITIES } from '../lib/defaults';
import { calculateAllRisks } from '../lib/riskCalculator';
import { applyHistoryImportToTmState, isReplacementNewerThanCurrent } from '../lib/tmState';
import { validateData } from '../lib/validators';
import { addAudit, backupDatabase, replaceHistoryData, replaceTmData, saveReplacementAtomic, saveSettings as saveRemoteSettings, subscribeCollection } from '../lib/firestoreService';
import { firebaseConfigured } from '../lib/firebase';

interface State { tms: TmMaster[]; history: ReplacementHistory[]; risks: RiskScore[]; severities: SeverityMaster[]; settings: RiskSettings; issues: ValidationIssue[]; setTmImport: (v: TmMaster[], note?: string) => Promise<void>; setHistoryImport: (v: ReplacementHistory[], note?: string, severityOverride?: SeverityMaster[]) => Promise<void>; addReplacement: (v: ReplacementHistory) => Promise<void>; updateSettings: (s: RiskSettings, sm: SeverityMaster[]) => Promise<void>; log: (eventType: string, targetTable: string, serialNo: string, beforeValue: unknown, afterValue: unknown, note: string) => Promise<void>; }
const C = createContext<State | null>(null);
const load = <T,>(key: string, fallback: T): T => { try { return JSON.parse(localStorage.getItem(key) || '') as T; } catch { return fallback; } };

export function AppProvider({ children }: { children: ReactNode }) {
  const [tms, setTms] = useState<TmMaster[]>(() => load('cbm_tms', []));
  const [history, setHistory] = useState<ReplacementHistory[]>(() => load('cbm_history', []));
  const [severities, setSeverities] = useState<SeverityMaster[]>(() => load('cbm_severities', DEFAULT_SEVERITIES));
  const [settings, setSettings] = useState<RiskSettings>(() => load('cbm_settings', DEFAULT_SETTINGS));
  const risks = useMemo(() => calculateAllRisks(tms, history, severities, settings), [tms, history, severities, settings]);
  const issues = useMemo(() => validateData(tms, history, severities, settings), [tms, history, severities, settings]);

  useEffect(() => {
    if (!firebaseConfigured) return;
    const stops = [
      subscribeCollection<TmMaster>('tm_master', setTms),
      subscribeCollection<ReplacementHistory>('replacement_history', setHistory),
      subscribeCollection<SeverityMaster>('severity_master', (items) => { if (items.length) setSeverities(items); }),
      subscribeCollection<RiskSettings>('settings', (items) => { if (items.length) setSettings(items[0]); }),
    ];
    return () => stops.forEach(stop => stop());
  }, []);
  useEffect(() => localStorage.setItem('cbm_tms', JSON.stringify(tms)), [tms]);
  useEffect(() => localStorage.setItem('cbm_history', JSON.stringify(history)), [history]);
  useEffect(() => localStorage.setItem('cbm_settings', JSON.stringify(settings)), [settings]);
  useEffect(() => localStorage.setItem('cbm_severities', JSON.stringify(severities)), [severities]);

  const log = async (eventType: string, targetTable: string, targetSerialNo: string, beforeValue: unknown, afterValue: unknown, userNote: string) => {
    const entry: AuditLog = { logId: crypto.randomUUID(), eventTime: new Date().toISOString(), eventType, targetTable, targetSerialNo, beforeValue, afterValue, userNote };
    const logs = load<AuditLog[]>('cbm_audit', []);
    localStorage.setItem('cbm_audit', JSON.stringify([entry, ...logs].slice(0, 1000)));
    await addAudit(entry);
  };
  const setTmImport = async (value: TmMaster[], note = '취부현황 엑셀 업로드') => {
    await backupDatabase({ tms, history, risks, severities, settings });
    const nextRisks = calculateAllRisks(value, history, severities, settings);
    setTms(value); await replaceTmData(value, nextRisks); await log('EXCEL_IMPORT', 'tm_master', '', tms, value, note);
  };
  const setHistoryImport = async (value: ReplacementHistory[], note = '교체현황 엑셀 업로드', severityOverride?: SeverityMaster[]) => {
    await backupDatabase({ tms, history, risks, severities, settings });
    const effectiveSeverities = severityOverride?.length ? severityOverride : severities;
    if (severityOverride?.length) setSeverities(severityOverride);
    const now = new Date().toISOString();
    const nextTms = applyHistoryImportToTmState(tms, value, settings.referenceYear, now), nextRisks = calculateAllRisks(nextTms, value, effectiveSeverities, settings);
    setTms(nextTms); setHistory(value); await replaceTmData(nextTms, nextRisks); await replaceHistoryData(value, nextRisks); await log('EXCEL_IMPORT', 'replacement_history', '', history, value, note);
  };
  const addReplacement = async (value: ReplacementHistory) => {
    const now = new Date().toISOString();
    let foundInstalled = false;
    const next = tms.map(tm => {
      if (tm.serialNo === value.removedSerialNo) {
        if (!isReplacementNewerThanCurrent(tm, value.replacementDate)) return tm;
        return { ...tm, currentStatus: value.removedStatus || '취거', isSpare: false, currentTrain: '', currentCar: '', currentPosition: '', sourceType: 'manual_added' as const, updatedAt: now };
      }
      if (tm.serialNo === value.installedSerialNo) {
        foundInstalled = true;
        if (!isReplacementNewerThanCurrent(tm, value.replacementDate)) return tm;
        return { ...tm, currentStatus: value.installedStatus || '운행중', isSpare: false, currentTrain: value.trainNo, currentCar: value.carNo, currentPosition: value.position, installDate: value.replacementDate, sourceType: 'manual_added' as const, updatedAt: now };
      }
      return tm;
    });
    if (value.installedSerialNo && !foundInstalled) next.push({ serialNo: value.installedSerialNo, manufacturer: '', manufactureYear: null, ageYear: 0, currentStatus: value.installedStatus || '운행중', isSpare: false, currentTrain: value.trainNo, currentCar: value.carNo, currentPosition: value.position, installDate: value.replacementDate, sourceType: 'manual_added', createdAt: now, updatedAt: now });
    const nextHistory = [value, ...history], nextRisks = calculateAllRisks(next, nextHistory, severities, settings);
    setTms(next); setHistory(nextHistory); await saveReplacementAtomic(value, next, nextRisks); await log('MANUAL_REPLACEMENT', 'replacement_history', value.removedSerialNo, null, value, '신규 교체정보 입력');
  };
  const updateSettings = async (value: RiskSettings, masters: SeverityMaster[]) => { setSettings(value); setSeverities(masters); const next = calculateAllRisks(tms, history, masters, value); await saveRemoteSettings(value, masters, next); await log('SETTINGS_UPDATE', 'settings', '', settings, value, '리스크 설정 변경 및 재계산'); };
  return <C.Provider value={{ tms, history, risks, severities, settings, issues, setTmImport, setHistoryImport, addReplacement, updateSettings, log }}>{children}</C.Provider>;
}
export const useApp = () => { const value = useContext(C); if (!value) throw new Error('AppProvider가 필요합니다.'); return value; };
