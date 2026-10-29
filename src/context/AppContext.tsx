import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { TmMaster, SeverityMaster } from '../types/tm';
import type { ReplacementHistory } from '../types/replacement';
import type { RiskScore, RiskSettings, ValidationIssue, AuditLog } from '../types/risk';
import type { DataSnapshot } from '../types/snapshot';
import { DEFAULT_SETTINGS, DEFAULT_SEVERITIES } from '../lib/defaults';
import { calculateAllRisks } from '../lib/riskCalculator';
import { applyHistoryImportToTmState, enrichTmLocationsFromReplacementHistory, isReplacementNewerThanCurrent } from '../lib/tmState';
import { validateData } from '../lib/validators';
import { replaceTmImports, replaceHistoryImports } from '../lib/importMerge';
import { addAudit, backupDatabase, deleteDataSnapshot, deleteReplacementHistory, rollbackReplacementAtomic, replaceHistoryData, replaceTmData, resetDatabase, restoreDatabase, saveDataSnapshot, saveReplacementAtomic, saveSettings as saveRemoteSettings, subscribeCollection } from '../lib/firestoreService';
import { auth } from '../lib/firebase';
import { onAuthStateChanged } from 'firebase/auth';
import { EMPTY_DATA_KEY, loadInitialData } from '../lib/initialData';

interface State { tms: TmMaster[]; history: ReplacementHistory[]; risks: RiskScore[]; severities: SeverityMaster[]; settings: RiskSettings; issues: ValidationIssue[]; snapshots:DataSnapshot[]; saveSnapshot:(name:string)=>Promise<void>; loadSnapshot:(snapshot:DataSnapshot)=>Promise<void>; removeSnapshot:(snapshotId:string)=>Promise<void>; deleteReplacement:(replacementId:string)=>Promise<void>; setTmImport: (v: TmMaster[], note?: string) => Promise<number>; setHistoryImport: (v: ReplacementHistory[], note?: string, severityOverride?: SeverityMaster[]) => Promise<number>; resetAllData: () => Promise<void>; addReplacement: (v: ReplacementHistory) => Promise<void>; updateSettings: (s: RiskSettings, sm: SeverityMaster[]) => Promise<void>; log: (eventType: string, targetTable: string, serialNo: string, beforeValue: unknown, afterValue: unknown, note: string) => Promise<void>; }
const C = createContext<State | null>(null);
const legacyKeys: Record<string, string> = { ai_parts_tms: 'cbm_tms', ai_parts_history: 'cbm_history', ai_parts_severities: 'cbm_severities', ai_parts_settings: 'cbm_settings', ai_parts_audit: 'cbm_audit' };
const load = <T,>(key: string, fallback: T): T => { try { return JSON.parse(localStorage.getItem(key) || localStorage.getItem(legacyKeys[key] || '') || '') as T; } catch { return fallback; } };

export function AppProvider({ children }: { children: ReactNode }) {
  const [initialData] = useState(() => loadInitialData(localStorage));
  const [tms, setTms] = useState<TmMaster[]>(initialData.tms);
  const [history, setHistory] = useState<ReplacementHistory[]>(initialData.history);
  const [severities, setSeverities] = useState<SeverityMaster[]>(initialData.severities);
  const [settings, setSettings] = useState<RiskSettings>(initialData.settings);
  const [snapshots,setSnapshots]=useState<DataSnapshot[]>(()=>load('ai_parts_snapshots',[]));
  const risks = useMemo(() => calculateAllRisks(tms, history, severities, settings), [tms, history, severities, settings]);
  const issues = useMemo(() => validateData(tms, history, severities, settings), [tms, history, severities, settings]);

  useEffect(() => {
    if (!auth) return;
    let stops: (() => void)[] = [];
    const stopAuth = onAuthStateChanged(auth, user => {
      stops.forEach(stop => stop());
      stops = [];
      if (!user) return;
      stops = [
        subscribeCollection<TmMaster>('tm_master', items => { if (items.length) setTms(items); }),
        subscribeCollection<ReplacementHistory>('replacement_history', items => { if (items.length) setHistory(items); }),
        subscribeCollection<SeverityMaster>('severity_master', items => { if (items.length) setSeverities(items); }),
        subscribeCollection<RiskSettings>('settings', items => { if (items.length) setSettings(items[0]); }),
        subscribeCollection<DataSnapshot>('data_snapshots', items => setSnapshots(items.sort((a,b)=>b.createdAt.localeCompare(a.createdAt)))),
      ];
    });
    return () => { stopAuth(); stops.forEach(stop => stop()); };
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
    const nextTms = replaceTmImports(value).map(tm => ({ ...tm, updatedAt: new Date().toISOString() }));
    const nextRisks = calculateAllRisks(nextTms, history, severities, settings);
    setTms(nextTms); await replaceTmData(nextTms, nextRisks); await log('EXCEL_IMPORT_REPLACE', 'tm_master', '', tms, nextTms, note); return nextTms.length;
  };
  const setHistoryImport = async (value: ReplacementHistory[], note = '교체현황 엑셀 업로드', severityOverride?: SeverityMaster[]) => {
    await backupDatabase({ tms, history, risks, severities, settings });
    const effectiveSeverities = severityOverride?.length ? severityOverride : severities;
    if (severityOverride?.length) setSeverities(severityOverride);
    const now = new Date().toISOString(), nextHistory = replaceHistoryImports(value);
    const withHistoryOnly = applyHistoryImportToTmState(tms, nextHistory, settings.referenceYear, now), nextTms = enrichTmLocationsFromReplacementHistory(withHistoryOnly, nextHistory), nextRisks = calculateAllRisks(nextTms, nextHistory, effectiveSeverities, settings);
    setTms(nextTms); setHistory(nextHistory); await replaceTmData(nextTms, nextRisks); await replaceHistoryData(nextHistory, nextRisks); await log('EXCEL_IMPORT_REPLACE', 'replacement_history', '', history, nextHistory, note); return nextHistory.length;
  };
  const resetAllData = async () => { await backupDatabase({ tms, history, risks, severities, settings }); await resetDatabase(); localStorage.setItem(EMPTY_DATA_KEY, 'Y'); setTms([]); setHistory([]); setSeverities(DEFAULT_SEVERITIES); setSettings(DEFAULT_SETTINGS); await log('DATABASE_RESET','all','',{tms:tms.length,history:history.length},{tms:0,history:0},'새 파일 업로드를 위한 전체 초기화'); };
  const saveSnapshot = async (name:string) => { const snapshot:DataSnapshot={snapshotId:crypto.randomUUID(),name:name.trim(),createdAt:new Date().toISOString(),tmCount:tms.length,historyCount:history.length,tms,history,risks,severities,settings}; setSnapshots(current=>[snapshot,...current]); await saveDataSnapshot(snapshot); await log('SNAPSHOT_SAVE','data_snapshots','',null,{snapshotId:snapshot.snapshotId,name:snapshot.name},'데이터 시점 저장'); };
  const loadSnapshot = async (snapshot:DataSnapshot) => { await backupDatabase({tms,history,risks,severities,settings}); await restoreDatabase(snapshot); setTms(snapshot.tms);setHistory(snapshot.history);setSeverities(snapshot.severities);setSettings(snapshot.settings);await log('SNAPSHOT_LOAD','data_snapshots','',{tms:tms.length,history:history.length},{snapshotId:snapshot.snapshotId,name:snapshot.name},'저장 시점 불러오기'); };
  const removeSnapshot = async (snapshotId:string) => { setSnapshots(current=>current.filter(item=>item.snapshotId!==snapshotId)); await deleteDataSnapshot(snapshotId); };
  const deleteReplacement = async (replacementId:string) => {
    const target = history.find(item => item.replacementId === replacementId);
    if (!target) return;
    const nextHistory = history.filter(item => item.replacementId !== replacementId);
    let nextTms = tms;
    const snapshot = target.inputSource === 'manual' ? target.rollbackSnapshot : undefined;
    if (snapshot) {
      nextTms = tms.map(tm => {
        const restore = tm.serialNo === target.removedSerialNo ? snapshot.removed : tm.serialNo === target.installedSerialNo ? snapshot.installed : undefined;
        if (!restore) return tm;
        if (!restore.exists) return tm;
        return { ...tm, currentTrain: restore.currentTrain, currentCar: restore.currentCar, currentPosition: restore.currentPosition, currentUnit: restore.currentUnit, currentStatus: restore.currentStatus, isSpare: restore.isSpare, installDate: restore.installDate, updatedAt: new Date().toISOString() };
      });
      nextTms = snapshot.installed && snapshot.installed.exists === false ? nextTms.filter(tm => tm.serialNo !== target.installedSerialNo) : nextTms;
    }
    const nextRisks = calculateAllRisks(nextTms, nextHistory, severities, settings);
    if (snapshot) await rollbackReplacementAtomic(replacementId, nextTms, nextRisks);
    else await deleteReplacementHistory(replacementId, nextRisks);
    setTms(nextTms); setHistory(nextHistory);
  };
  const addReplacement = async (value: ReplacementHistory) => {
    const now = new Date().toISOString();
    let foundInstalled = false;
    const removedBefore = tms.find(tm => tm.serialNo === value.removedSerialNo);
    const installedBefore = tms.find(tm => tm.serialNo === value.installedSerialNo);
    const removedLocation = { train: removedBefore?.currentTrain || value.trainNo, car: removedBefore?.currentCar || value.carNo, position: removedBefore?.currentPosition || value.position, unit: removedBefore?.currentUnit || removedBefore?.currentPosition || value.position };
    const installedLocation = { train: installedBefore?.currentTrain || '예비품', car: installedBefore?.currentCar || '예비품', position: installedBefore?.currentPosition || '예비-001', unit: installedBefore?.currentUnit || installedBefore?.currentPosition || '예비-001' };
    const disposedSerialNo = value.removedStatus === '불용' ? value.removedSerialNo : '';
    const next = tms.flatMap(tm => {
      if (disposedSerialNo && tm.serialNo === disposedSerialNo) return [];
      const updated = (() => {
      if (tm.serialNo === value.removedSerialNo) {
        if (!isReplacementNewerThanCurrent(tm, value.replacementDate)) return tm;
        const removedStatus = value.removedStatus === '불용' ? '불용' : (value.failureType || value.replacementReason === '고장' || value.replacementReason === '이상' ? '점검필요' : '예비품');
        return { ...tm, currentStatus: removedStatus, isSpare: value.removedStatus !== '불용', currentTrain: installedLocation.train, currentCar: installedLocation.car, currentPosition: installedLocation.position, currentUnit: installedLocation.unit, locationSource: '웹앱 신규 입력' as const, inferredFromReplacement: false, inferredReplacementDate: '', sourceType: 'manual_added' as const, updatedAt: now };
      }
      if (tm.serialNo === value.installedSerialNo) {
        foundInstalled = true;
        if (!isReplacementNewerThanCurrent(tm, value.replacementDate)) return tm;
        return { ...tm, currentStatus: value.installedStatus || '운행중', isSpare: false, currentTrain: removedLocation.train, currentCar: removedLocation.car, currentPosition: removedLocation.position, currentUnit: removedLocation.unit, installDate: value.replacementDate, locationSource: '웹앱 신규 입력' as const, inferredFromReplacement: false, inferredReplacementDate: '', sourceType: 'manual_added' as const, updatedAt: now };
      }
      return tm;
      })();
      return [updated];
    });
    if (value.installedSerialNo && !foundInstalled) next.push({ serialNo: value.installedSerialNo, manufacturer: '', manufactureYear: null, ageYear: 0, currentStatus: value.installedStatus || '운행중', isSpare: false, currentTrain: value.trainNo, currentCar: value.carNo, currentPosition: value.position, installDate: value.replacementDate, sourceType: 'manual_added', locationSource: '웹앱 신규 입력', inferredFromReplacement: false, inferredReplacementDate: '', createdAt: now, updatedAt: now });
    const occupied = new Map<string, string>();
    next.filter(tm => !tm.isSpare && tm.sourceType !== 'history_only' && tm.currentTrain && tm.currentPosition).forEach(tm => { const key = `${tm.currentTrain}|${tm.currentCar}|${tm.currentPosition}`; if (occupied.has(key) && occupied.get(key) !== tm.serialNo) throw new Error(`취부 위치가 중복됩니다: ${key}`); occupied.set(key, tm.serialNo); });
    const snapshot = {
      removed: removedBefore ? { exists: true, currentTrain: removedBefore.currentTrain, currentCar: removedBefore.currentCar, currentPosition: removedBefore.currentPosition, currentUnit: removedBefore.currentUnit, currentStatus: removedBefore.currentStatus, isSpare: removedBefore.isSpare, installDate: removedBefore.installDate } : { exists: false, currentTrain: '', currentCar: '', currentPosition: '', currentStatus: '', isSpare: false, installDate: '' },
      installed: installedBefore ? { exists: true, currentTrain: installedBefore.currentTrain, currentCar: installedBefore.currentCar, currentPosition: installedBefore.currentPosition, currentUnit: installedBefore.currentUnit, currentStatus: installedBefore.currentStatus, isSpare: installedBefore.isSpare, installDate: installedBefore.installDate } : { exists: false, currentTrain: '', currentCar: '', currentPosition: '', currentStatus: '', isSpare: false, installDate: '' },
    };
    const savedValue = { ...value, ...(value.installedSerialNo ? { rollbackSnapshot: snapshot } : {}) };
    const nextHistory = [savedValue, ...history], nextRisks = calculateAllRisks(next, nextHistory, severities, settings);
    setTms(next); setHistory(nextHistory); await saveReplacementAtomic(savedValue, next, nextRisks, disposedSerialNo); await log('MANUAL_REPLACEMENT', 'replacement_history', value.removedSerialNo, null, value, '신규 교체정보 입력');
  };
  const updateSettings = async (value: RiskSettings, masters: SeverityMaster[]) => { setSettings(value); setSeverities(masters); const next = calculateAllRisks(tms, history, masters, value); await saveRemoteSettings(value, masters, next); await log('SETTINGS_UPDATE', 'settings', '', settings, value, '위험도 설정 변경 및 재계산'); };
  return <C.Provider value={{ tms, history, risks, severities, settings, issues, snapshots, saveSnapshot, loadSnapshot, removeSnapshot, deleteReplacement, setTmImport, setHistoryImport, resetAllData, addReplacement, updateSettings, log }}>{children}</C.Provider>;
}
export const useApp = () => { const value = useContext(C); if (!value) throw new Error('AppProvider가 필요합니다.'); return value; };
