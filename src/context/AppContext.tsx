import { hideBrowserSnapshot, commitBrowserRecovery, initializeBrowserStorage, prepareBrowserRecovery, saveBrowserSnapshot, saveBrowserState, saveBrowserAudit } from '../lib/browserBackupStore';
import { verifiedBackupSnapshot, type FileBackupProof } from '../lib/fileBackup';
import { cleanData, dataVersion, planReplacementDeletion, restoreTarget } from '../lib/dataRecovery';
import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { TmMaster, SeverityMaster } from '../types/tm';
import type { ReplacementHistory } from '../types/replacement';
import type { RiskScore, RiskSettings, ValidationIssue, AuditLog } from '../types/risk';
import type { DataSnapshot } from '../types/snapshot';
import { DEFAULT_SETTINGS, DEFAULT_SEVERITIES } from '../lib/defaults';
import { calculateAllRisks } from '../lib/riskCalculator';
import { applyHistoryImportToTmState, enrichTmLocationsFromReplacementHistory, isReplacementNewerThanCurrent } from '../lib/tmState';
import { validateData } from '../lib/validators';
import { replaceTmImports, replaceHistoryImports } from '../lib/importMerge';
import { applyRecoveryAtomic, addAudit, backupDatabase, deleteDataSnapshot, replaceHistoryData, replaceTmData, resetDatabase, saveDataSnapshot, saveReplacementAtomic, saveSettings as saveRemoteSettings, subscribeCollection } from '../lib/firestoreService';
import { auth, db } from '../lib/firebase';
import { onAuthStateChanged } from 'firebase/auth';
import { EMPTY_DATA_KEY, loadInitialData } from '../lib/initialData';

interface State { tms: TmMaster[]; history: ReplacementHistory[]; historyError: string; risks: RiskScore[]; severities: SeverityMaster[]; settings: RiskSettings; issues: ValidationIssue[]; snapshots:DataSnapshot[]; saveSnapshot:(name:string)=>Promise<void>; loadSnapshot:(snapshot:DataSnapshot, expectedVersion?:string, fileBackup?:FileBackupProof)=>Promise<void>; removeSnapshot:(snapshotId:string)=>Promise<void>; deleteReplacement:(replacementId:string, expectedVersion?:string, fileBackup?:FileBackupProof)=>Promise<void>; setTmImport: (v: TmMaster[], note?: string) => Promise<number>; setHistoryImport: (v: ReplacementHistory[], note?: string, severityOverride?: SeverityMaster[]) => Promise<number>; resetAllData: () => Promise<void>; addReplacement: (v: ReplacementHistory) => Promise<void>; updateSettings: (s: RiskSettings, sm: SeverityMaster[]) => Promise<void>; log: (eventType: string, targetTable: string, serialNo: string, beforeValue: unknown, afterValue: unknown, note: string) => Promise<void>; }
const C = createContext<State | null>(null);
const legacyKeys: Record<string, string> = { ai_parts_tms: 'cbm_tms', ai_parts_history: 'cbm_history', ai_parts_severities: 'cbm_severities', ai_parts_settings: 'cbm_settings', ai_parts_audit: 'cbm_audit' };
const load = <T,>(key: string, fallback: T): T => { try { return JSON.parse(localStorage.getItem(key) || localStorage.getItem(legacyKeys[key] || '') || '') as T; } catch { return fallback; } };

export function AppProvider({ children }: { children: ReactNode }) {
  const [initialData] = useState(() => loadInitialData(localStorage));
  const [data, setData] = useState(initialData);
  const { tms, history, severities, settings } = data;
  const setTms = (value: TmMaster[]) => setData(current => ({ ...current, tms: value }));
  const setHistory = (value: ReplacementHistory[]) => setData(current => ({ ...current, history: value }));
  const setSeverities = (value: SeverityMaster[]) => setData(current => ({ ...current, severities: value }));
  const setSettings = (value: RiskSettings) => setData(current => ({ ...current, settings: value }));
  const [historyError, setHistoryError] = useState('');
  const [syncEpoch, setSyncEpoch] = useState(0);
  const [storageReady, setStorageReady] = useState(false);
  const localSnapshots = useRef<DataSnapshot[]>([]);
  const hiddenSnapshots = useRef(new Set<string>());
  useEffect(() => {
    let active = true;
    void initializeBrowserStorage(localStorage, initialData).then(result => {
      if (!active) return;
      if (result.current) setData({ tms: result.current.tms, history: result.current.history, severities: result.current.severities, settings: result.current.settings });
      localSnapshots.current = result.snapshots;
      hiddenSnapshots.current = new Set(result.hidden || []);
      setSnapshots(current => [...new Map([...current, ...result.snapshots].map(item => [item.snapshotId, item])).values()].filter(item => !hiddenSnapshots.current.has(item.snapshotId)));
      if (result.warning) setHistoryError(result.warning);
      setStorageReady(true);
    }).catch(() => { if (active) { setHistoryError('브라우저 백업 저장소를 열지 못했습니다. 기존 자료는 유지됩니다. 삭제·복원 시 파일 백업 대체 기능을 사용하세요.'); setStorageReady(true); } });
    return () => { active = false; };
  }, []);
  const generation = useRef(0);
  const mutation = useRef(false);
  const [snapshots,setSnapshots]=useState<DataSnapshot[]>(()=>load('ai_parts_snapshots',[]));
  const risks = useMemo(() => calculateAllRisks(tms, history, severities, settings), [tms, history, severities, settings]);
  const issues = useMemo(() => validateData(tms, history, severities, settings), [tms, history, severities, settings]);

  useEffect(() => {
    if (!storageReady || !auth) return;
    let active = true;
    const epoch = generation.current;
    const accept = () => active && epoch === generation.current && !mutation.current;
    let stops: (() => void)[] = [];
    const stopAuth = onAuthStateChanged(auth, user => {
      if (!active || epoch !== generation.current) return;
      stops.forEach(stop => stop());
      stops = [];
      setHistoryError('');
      if (!user) return;
      stops = [
        subscribeCollection<TmMaster>('tm_master', items => { if (accept()) setTms(items); }),
        subscribeCollection<ReplacementHistory>('replacement_history', items => { if (accept()) { setHistoryError(''); setHistory(items); } }, () => accept() && setHistoryError('교체이력을 불러오지 못했습니다. 기존 표시 데이터가 최신이 아닐 수 있습니다. 연결 상태와 접근 권한을 확인해 주세요.')),
        subscribeCollection<SeverityMaster>('severity_master', items => { if (accept()) setSeverities(items); }),
        subscribeCollection<RiskSettings>('settings', items => { if (accept() && items.length) setSettings(items.find(item => 'weights' in item) || items[0]); }),
        subscribeCollection<DataSnapshot>('data_snapshots', items => { if (accept()) { const local = localSnapshots.current; const merged = new Map([...items, ...local].map(item => [item.snapshotId, item])); setSnapshots([...merged.values()].filter(item => !hiddenSnapshots.current.has(item.snapshotId)).sort((a,b)=>b.createdAt.localeCompare(a.createdAt))); } }),
      ];
    });
    return () => { active = false; stopAuth(); stops.forEach(stop => stop()); };
  }, [syncEpoch, storageReady]);
  useEffect(() => {
    if (!storageReady || mutation.current) return;
    void saveBrowserState(data).catch(() => setHistoryError('현재 상태를 IndexedDB에 보존하지 못했습니다. 화면 데이터는 유지됩니다. 새로고침 전 JSON 파일을 별도 보관하세요.'));
  }, [data, storageReady]);
  useEffect(() => {
    if (!storageReady) return;
    // Each snapshot is independently verified; never serialize the entire list into localStorage.
    void (async () => {
      for (const snapshot of snapshots) await saveBrowserSnapshot(snapshot);
      localSnapshots.current = snapshots;
    })().catch(() => setHistoryError('일부 저장본의 IndexedDB 보존에 실패했습니다. 기존 localStorage와 Firebase 저장본은 그대로 유지됩니다.'));
  }, [snapshots, storageReady]);

  const log = async (eventType: string, targetTable: string, targetSerialNo: string, beforeValue: unknown, afterValue: unknown, userNote: string) => {
    const entry: AuditLog = { logId: crypto.randomUUID(), eventTime: new Date().toISOString(), eventType, targetTable, targetSerialNo, beforeValue, afterValue, userNote };
    await saveBrowserAudit(entry);
    await addAudit(entry);
  };
  const setTmImport = async (value: TmMaster[], note = '취부현황 엑셀 업로드') => { if (mutation.current) throw new Error('데이터 처리 중입니다. 완료 후 다시 시도하세요.');
    await backupDatabase({ tms, history, risks, severities, settings });
    const nextTms = replaceTmImports(value).map(tm => ({ ...tm, updatedAt: new Date().toISOString() }));
    const nextRisks = calculateAllRisks(nextTms, history, severities, settings);
    setTms(nextTms); await replaceTmData(nextTms, nextRisks); await log('EXCEL_IMPORT_REPLACE', 'tm_master', '', tms, nextTms, note); return nextTms.length;
  };
  const setHistoryImport = async (value: ReplacementHistory[], note = '교체현황 엑셀 업로드', severityOverride?: SeverityMaster[]) => { if (mutation.current) throw new Error('데이터 처리 중입니다. 완료 후 다시 시도하세요.');
    await backupDatabase({ tms, history, risks, severities, settings });
    const effectiveSeverities = severityOverride?.length ? severityOverride : severities;
    if (severityOverride?.length) setSeverities(severityOverride);
    const now = new Date().toISOString(), nextHistory = replaceHistoryImports(value);
    const withHistoryOnly = applyHistoryImportToTmState(tms, nextHistory, settings.referenceYear, now), nextTms = enrichTmLocationsFromReplacementHistory(withHistoryOnly, nextHistory), nextRisks = calculateAllRisks(nextTms, nextHistory, effectiveSeverities, settings);
    setTms(nextTms); setHistory(nextHistory); await replaceTmData(nextTms, nextRisks); await replaceHistoryData(nextHistory, nextRisks); await log('EXCEL_IMPORT_REPLACE', 'replacement_history', '', history, nextHistory, note); return nextHistory.length;
  };
  const resetAllData = async () => { if (mutation.current) throw new Error('데이터 처리 중입니다. 완료 후 다시 시도하세요.'); await backupDatabase({ tms, history, risks, severities, settings }); await resetDatabase(); localStorage.setItem(EMPTY_DATA_KEY, 'Y'); setTms([]); setHistory([]); setSeverities(DEFAULT_SEVERITIES); setSettings(DEFAULT_SETTINGS); await log('DATABASE_RESET','all','',{tms:tms.length,history:history.length},{tms:0,history:0},'새 파일 업로드를 위한 전체 초기화'); };
  const saveSnapshot = async (name:string) => { if (mutation.current) throw new Error('데이터 처리 중입니다. 완료 후 다시 시도하세요.'); const snapshot:DataSnapshot={snapshotId:crypto.randomUUID(),name:name.trim(),createdAt:new Date().toISOString(),tmCount:tms.length,historyCount:history.length,tms,history,risks,severities,settings}; await saveBrowserSnapshot(snapshot); localSnapshots.current = [snapshot, ...localSnapshots.current]; await saveDataSnapshot(snapshot); setSnapshots(current=>[snapshot,...current]); await log('SNAPSHOT_SAVE','data_snapshots','',null,{snapshotId:snapshot.snapshotId,name:snapshot.name},'데이터 시점 저장'); };
  const recover = async (nextData: typeof data, label: string, fileBackup?: FileBackupProof) => {
    if (!storageReady) throw new Error('저장소 확인 중입니다. 잠시 후 다시 시도하세요.');
    if (mutation.current) throw new Error('다른 데이터 처리가 진행 중입니다. 완료 후 다시 시도해 주세요.');
    const before = cleanData({ tms, history, risks, severities, settings });
    const next = cleanData({ ...nextData, risks: calculateAllRisks(nextData.tms, nextData.history, nextData.severities, nextData.settings) });
    const backup: DataSnapshot = fileBackup ? verifiedBackupSnapshot(fileBackup, before) : { ...before, snapshotId: crypto.randomUUID(), name: `${label} 전 자동 백업`, createdAt: new Date().toISOString(), tmCount: before.tms.length, historyCount: before.history.length };
    mutation.current = true;
    generation.current++;
    try {
      if (!fileBackup) await saveBrowserSnapshot(backup);
      // The file proof is minted only after rereading the saved file and matching every field.
      // Reserve and verify the next state before any server change, even for a file backup.
      try { await prepareBrowserRecovery(backup.snapshotId, next); }
      catch { throw new Error('백업 후 현재 상태를 보존할 IndexedDB 공간도 확보하지 못했습니다. 일부만 처리하지 않고 삭제·복원을 중단했습니다. JSON 백업은 별도 보관해 주세요.'); }
      localSnapshots.current = [backup, ...localSnapshots.current];
      setSnapshots(current => [backup, ...current]);
      await applyRecoveryAtomic(before, next, backup);
      try { await commitBrowserRecovery(backup.snapshotId, next); }
      catch (error) { if (!db) throw new Error('브라우저 결과 저장에 실패해 데이터 변경을 중단했습니다. 기존 상태와 백업은 유지됩니다.'); setHistoryError('서버 처리는 완료됐지만 브라우저 결과 저장을 확인하지 못했습니다. 현재 화면과 별도 백업을 유지하고 서버 연결을 확인하세요.'); }
      setData({ tms: next.tms, history: next.history, severities: next.severities, settings: next.settings });
    } catch (error) {
      throw error;
    } finally {
      mutation.current = false;
      setSyncEpoch(value => value + 1);
    }
  };
  const loadSnapshot = async (snapshot: DataSnapshot, expectedVersion?: string, fileBackup?: FileBackupProof) => {
    if (expectedVersion && expectedVersion !== dataVersion(data)) throw new Error('확인창을 연 뒤 데이터가 변경됐습니다. 변경 내용을 다시 확인하고 승인해 주세요.');
    await recover(restoreTarget(snapshot), `“${snapshot.name}” 복원`, fileBackup);
  };
  const removeSnapshot = async (snapshotId:string) => { if (mutation.current) throw new Error('데이터 처리 중입니다.'); await deleteDataSnapshot(snapshotId); await hideBrowserSnapshot(snapshotId); hiddenSnapshots.current.add(snapshotId); localSnapshots.current = localSnapshots.current.filter(item => item.snapshotId !== snapshotId); setSnapshots(current=>current.filter(item=>item.snapshotId!==snapshotId)); };
  const deleteReplacement = async (replacementId: string, expectedVersion?: string, fileBackup?: FileBackupProof) => {
    if (expectedVersion && expectedVersion !== dataVersion(data)) throw new Error('확인창을 연 뒤 데이터가 변경됐습니다. 삭제 영향을 다시 확인하고 승인해 주세요.');
    const planned = planReplacementDeletion({ tms, history, risks, severities, settings }, replacementId);
    await recover(planned.data, '교체이력 삭제', fileBackup);
  };
  const addReplacement = async (value: ReplacementHistory) => {
    if (mutation.current) throw new Error('복원 또는 삭제 처리 중입니다. 완료 후 저장하세요.');
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
      removed: removedBefore ? { original: cleanData(removedBefore), exists: true, currentTrain: removedBefore.currentTrain, currentCar: removedBefore.currentCar, currentPosition: removedBefore.currentPosition, currentUnit: removedBefore.currentUnit, currentStatus: removedBefore.currentStatus, isSpare: removedBefore.isSpare, installDate: removedBefore.installDate } : { exists: false, currentTrain: '', currentCar: '', currentPosition: '', currentStatus: '', isSpare: false, installDate: '' },
      installed: installedBefore ? { original: cleanData(installedBefore), exists: true, currentTrain: installedBefore.currentTrain, currentCar: installedBefore.currentCar, currentPosition: installedBefore.currentPosition, currentUnit: installedBefore.currentUnit, currentStatus: installedBefore.currentStatus, isSpare: installedBefore.isSpare, installDate: installedBefore.installDate } : { exists: false, currentTrain: '', currentCar: '', currentPosition: '', currentStatus: '', isSpare: false, installDate: '' },
    };
    const savedValue = cleanData({ ...value, rollbackSnapshot: snapshot });
    const nextHistory = [savedValue, ...history], nextRisks = calculateAllRisks(next, nextHistory, severities, settings);
    await saveReplacementAtomic(savedValue, next, nextRisks, disposedSerialNo); setData(current => ({ ...current, tms: next, history: nextHistory })); await log('MANUAL_REPLACEMENT', 'replacement_history', value.removedSerialNo, null, value, '신규 교체정보 입력').catch(() => setHistoryError('교체정보는 저장됐으나 감사로그 기록에 실패했습니다. 같은 내용을 다시 저장하지 마세요.'));
  };
  const updateSettings = async (value: RiskSettings, masters: SeverityMaster[]) => { if (mutation.current) throw new Error('데이터 처리 중입니다. 완료 후 다시 시도하세요.'); setSettings(value); setSeverities(masters); const next = calculateAllRisks(tms, history, masters, value); await saveRemoteSettings(value, masters, next); await log('SETTINGS_UPDATE', 'settings', '', settings, value, '위험도 설정 변경 및 재계산'); };
  return <C.Provider value={{ tms, history, historyError, risks, severities, settings, issues, snapshots, saveSnapshot, loadSnapshot, removeSnapshot, deleteReplacement, setTmImport, setHistoryImport, resetAllData, addReplacement, updateSettings, log }}>{storageReady ? children : <div role="status" style={{padding:24}}>기존 데이터와 백업 저장소를 확인하고 있습니다…</div>}</C.Provider>;
}
export const useApp = () => { const value = useContext(C); if (!value) throw new Error('AppProvider가 필요합니다.'); return value; };
