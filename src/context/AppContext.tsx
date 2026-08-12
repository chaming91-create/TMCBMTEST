import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { TmMaster, SeverityMaster } from '../types/tm';
import type { ReplacementHistory } from '../types/replacement';
import type { RiskScore, RiskSettings, ValidationIssue, AuditLog } from '../types/risk';
import type { DataSnapshot } from '../types/snapshot';
import { DEFAULT_SETTINGS, DEFAULT_SEVERITIES } from '../lib/defaults';
import { calculateAllRisks } from '../lib/riskCalculator';
import { applyHistoryImportToTmState, enrichTmLocationsFromReplacementHistory, isReplacementNewerThanCurrent } from '../lib/tmState';
import { mergeHistoryImports, mergeTmImports } from '../lib/importMerge';
import { validateData } from '../lib/validators';
import { addAudit, backupDatabase, deleteDataSnapshot, replaceHistoryData, replaceTmData, resetDatabase, restoreDatabase, saveDataSnapshot, saveReplacementAtomic, saveSettings as saveRemoteSettings, subscribeCollection } from '../lib/firestoreService';
import { firebaseConfigured } from '../lib/firebase';

interface State { tms: TmMaster[]; history: ReplacementHistory[]; risks: RiskScore[]; severities: SeverityMaster[]; settings: RiskSettings; issues: ValidationIssue[]; snapshots:DataSnapshot[]; saveSnapshot:(name:string)=>Promise<void>; loadSnapshot:(snapshot:DataSnapshot)=>Promise<void>; removeSnapshot:(snapshotId:string)=>Promise<void>; setTmImport: (v: TmMaster[], note?: string) => Promise<number>; setHistoryImport: (v: ReplacementHistory[], note?: string, severityOverride?: SeverityMaster[]) => Promise<number>; resetAllData: () => Promise<void>; addReplacement: (v: ReplacementHistory) => Promise<void>; updateSettings: (s: RiskSettings, sm: SeverityMaster[]) => Promise<void>; log: (eventType: string, targetTable: string, serialNo: string, beforeValue: unknown, afterValue: unknown, note: string) => Promise<void>; }
const C = createContext<State | null>(null);
const legacyKeys: Record<string, string> = { ai_parts_tms: 'cbm_tms', ai_parts_history: 'cbm_history', ai_parts_severities: 'cbm_severities', ai_parts_settings: 'cbm_settings', ai_parts_audit: 'cbm_audit' };
const load = <T,>(key: string, fallback: T): T => { try { return JSON.parse(localStorage.getItem(key) || localStorage.getItem(legacyKeys[key] || '') || '') as T; } catch { return fallback; } };

export function AppProvider({ children }: { children: ReactNode }) {
  const [tms, setTms] = useState<TmMaster[]>(() => load('ai_parts_tms', []));
  const [history, setHistory] = useState<ReplacementHistory[]>(() => load('ai_parts_history', []));
  const [severities, setSeverities] = useState<SeverityMaster[]>(() => load('ai_parts_severities', DEFAULT_SEVERITIES));
  const [settings, setSettings] = useState<RiskSettings>(() => load('ai_parts_settings', DEFAULT_SETTINGS));
  const [snapshots,setSnapshots]=useState<DataSnapshot[]>(()=>load('ai_parts_snapshots',[]));
  const risks = useMemo(() => calculateAllRisks(tms, history, severities, settings), [tms, history, severities, settings]);
  const issues = useMemo(() => validateData(tms, history, severities, settings), [tms, history, severities, settings]);

  useEffect(() => {
    if (!firebaseConfigured) return;
    const stops = [
      subscribeCollection<TmMaster>('tm_master', setTms),
      subscribeCollection<ReplacementHistory>('replacement_history', setHistory),
      subscribeCollection<SeverityMaster>('severity_master', (items) => { if (items.length) setSeverities(items); }),
      subscribeCollection<RiskSettings>('settings', (items) => { if (items.length) setSettings(items[0]); }),
      subscribeCollection<DataSnapshot>('data_snapshots', items => setSnapshots(items.sort((a,b)=>b.createdAt.localeCompare(a.createdAt)))),
    ];
    return () => stops.forEach(stop => stop());
  }, []);
  useEffect(() => localStorage.setItem('ai_parts_tms', JSON.stringify(tms)), [tms]);
  useEffect(() => localStorage.setItem('ai_parts_history', JSON.stringify(history)), [history]);
  useEffect(() => localStorage.setItem('ai_parts_settings', JSON.stringify(settings)), [settings]);
  useEffect(() => localStorage.setItem('ai_parts_severities', JSON.stringify(severities)), [severities]);
  useEffect(() => localStorage.setItem('ai_parts_snapshots', JSON.stringify(snapshots)), [snapshots]);

  const log = async (eventType: string, targetTable: string, targetSerialNo: string, beforeValue: unknown, afterValue: unknown, userNote: string) => {
    const entry: AuditLog = { logId: crypto.randomUUID(), eventTime: new Date().toISOString(), eventType, targetTable, targetSerialNo, beforeValue, afterValue, userNote };
    const logs = load<AuditLog[]>('ai_parts_audit', []);
    localStorage.setItem('ai_parts_audit', JSON.stringify([entry, ...logs].slice(0, 1000)));
    await addAudit(entry);
  };
  const setTmImport = async (value: TmMaster[], note = '취부현황 엑셀 업로드') => {
    await backupDatabase({ tms, history, risks, severities, settings });
    const merged = mergeTmImports(tms, value);
    const enriched = enrichTmLocationsFromReplacementHistory(merged, history);
    const nextRisks = calculateAllRisks(enriched, history, severities, settings);
    setTms(enriched); await replaceTmData(enriched, nextRisks); await log('EXCEL_IMPORT_MERGE', 'tm_master', '', tms, enriched, note); return enriched.length;
  };
  const setHistoryImport = async (value: ReplacementHistory[], note = '교체현황 엑셀 업로드', severityOverride?: SeverityMaster[]) => {
    await backupDatabase({ tms, history, risks, severities, settings });
    const effectiveSeverities = severityOverride?.length ? severityOverride : severities;
    if (severityOverride?.length) setSeverities(severityOverride);
    const now = new Date().toISOString(), mergedHistory = mergeHistoryImports(history, value);
    const withHistoryOnly = applyHistoryImportToTmState(tms, mergedHistory, settings.referenceYear, now), nextTms = enrichTmLocationsFromReplacementHistory(withHistoryOnly, mergedHistory), nextRisks = calculateAllRisks(nextTms, mergedHistory, effectiveSeverities, settings);
    setTms(nextTms); setHistory(mergedHistory); await replaceTmData(nextTms, nextRisks); await replaceHistoryData(mergedHistory, nextRisks); await log('EXCEL_IMPORT_MERGE', 'replacement_history', '', history, mergedHistory, note); return mergedHistory.length;
  };
  const resetAllData = async () => { await backupDatabase({ tms, history, risks, severities, settings }); await resetDatabase(); setTms([]); setHistory([]); setSeverities(DEFAULT_SEVERITIES); setSettings(DEFAULT_SETTINGS); await log('DATABASE_RESET','all','',{tms:tms.length,history:history.length},{tms:0,history:0},'새 파일 업로드를 위한 전체 초기화'); };
  const saveSnapshot = async (name:string) => { const snapshot:DataSnapshot={snapshotId:crypto.randomUUID(),name:name.trim(),createdAt:new Date().toISOString(),tmCount:tms.length,historyCount:history.length,tms,history,risks,severities,settings}; setSnapshots(current=>[snapshot,...current]); await saveDataSnapshot(snapshot); await log('SNAPSHOT_SAVE','data_snapshots','',null,{snapshotId:snapshot.snapshotId,name:snapshot.name},'데이터 시점 저장'); };
  const loadSnapshot = async (snapshot:DataSnapshot) => { await backupDatabase({tms,history,risks,severities,settings}); await restoreDatabase(snapshot); setTms(snapshot.tms);setHistory(snapshot.history);setSeverities(snapshot.severities);setSettings(snapshot.settings);await log('SNAPSHOT_LOAD','data_snapshots','',{tms:tms.length,history:history.length},{snapshotId:snapshot.snapshotId,name:snapshot.name},'저장 시점 불러오기'); };
  const removeSnapshot = async (snapshotId:string) => { setSnapshots(current=>current.filter(item=>item.snapshotId!==snapshotId)); await deleteDataSnapshot(snapshotId); };
  const addReplacement = async (value: ReplacementHistory) => {
    const now = new Date().toISOString();
    let foundInstalled = false;
    const next = tms.map(tm => {
      if (tm.serialNo === value.removedSerialNo) {
        if (!isReplacementNewerThanCurrent(tm, value.replacementDate)) return tm;
        return { ...tm, currentStatus: value.removedStatus || '취거', isSpare: false, currentTrain: '', currentCar: '', currentPosition: '', locationSource: '웹앱 신규 입력' as const, inferredFromReplacement: false, inferredReplacementDate: '', sourceType: 'manual_added' as const, updatedAt: now };
      }
      if (tm.serialNo === value.installedSerialNo) {
        foundInstalled = true;
        if (!isReplacementNewerThanCurrent(tm, value.replacementDate)) return tm;
        return { ...tm, currentStatus: value.installedStatus || '운행중', isSpare: false, currentTrain: value.trainNo, currentCar: value.carNo, currentPosition: value.position, installDate: value.replacementDate, locationSource: '웹앱 신규 입력' as const, inferredFromReplacement: false, inferredReplacementDate: '', sourceType: 'manual_added' as const, updatedAt: now };
      }
      return tm;
    });
    if (value.installedSerialNo && !foundInstalled) next.push({ serialNo: value.installedSerialNo, manufacturer: '', manufactureYear: null, ageYear: 0, currentStatus: value.installedStatus || '운행중', isSpare: false, currentTrain: value.trainNo, currentCar: value.carNo, currentPosition: value.position, installDate: value.replacementDate, sourceType: 'manual_added', locationSource: '웹앱 신규 입력', inferredFromReplacement: false, inferredReplacementDate: '', createdAt: now, updatedAt: now });
    const nextHistory = [value, ...history], nextRisks = calculateAllRisks(next, nextHistory, severities, settings);
    setTms(next); setHistory(nextHistory); await saveReplacementAtomic(value, next, nextRisks); await log('MANUAL_REPLACEMENT', 'replacement_history', value.removedSerialNo, null, value, '신규 교체정보 입력');
  };
  const updateSettings = async (value: RiskSettings, masters: SeverityMaster[]) => { setSettings(value); setSeverities(masters); const next = calculateAllRisks(tms, history, masters, value); await saveRemoteSettings(value, masters, next); await log('SETTINGS_UPDATE', 'settings', '', settings, value, '위험도 설정 변경 및 재계산'); };
  return <C.Provider value={{ tms, history, risks, severities, settings, issues, snapshots, saveSnapshot, loadSnapshot, removeSnapshot, setTmImport, setHistoryImport, resetAllData, addReplacement, updateSettings, log }}>{children}</C.Provider>;
}
export const useApp = () => { const value = useContext(C); if (!value) throw new Error('AppProvider가 필요합니다.'); return value; };
