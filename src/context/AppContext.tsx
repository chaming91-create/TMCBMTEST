import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { onAuthStateChanged } from 'firebase/auth';
import type { TmMaster, SeverityMaster } from '../types/tm';
import type { ReplacementHistory } from '../types/replacement';
import type { RiskScore, RiskSettings, ValidationIssue, AuditLog } from '../types/risk';
import type { DataSnapshot } from '../types/snapshot';
import { DEFAULT_SETTINGS, DEFAULT_SEVERITIES } from '../lib/defaults';
import { calculateAllRisks } from '../lib/riskCalculator';
import { applyHistoryImportToTmState, enrichTmLocationsFromReplacementHistory } from '../lib/tmState';
import { applyReplacement } from '../lib/replacementOperation';
import { mergeHistoryImports, mergeTmImports } from '../lib/importMerge';
import { validateData } from '../lib/validators';
import { addAudit, backupDatabase, deleteDataSnapshot, readDataSnapshot, saveDataSnapshot, subscribeCollection, type AppData } from '../lib/firestoreService';
import { canonical, emptyData, mutateSharedData, readSharedData, requireAdmin, subscribeSharedData, type SharedData } from '../lib/sharedStore';
import { auth, firebaseConfigured } from '../lib/firebase';

interface State { tms: TmMaster[]; history: ReplacementHistory[]; risks: RiskScore[]; severities: SeverityMaster[]; settings: RiskSettings; issues: ValidationIssue[]; snapshots:DataSnapshot[]; ready:boolean; busy:boolean; error:string; isAdmin:boolean; refresh:()=>Promise<void>; migrateLegacy:()=>Promise<void>; saveSnapshot:(name:string)=>Promise<void>; loadSnapshot:(snapshot:DataSnapshot)=>Promise<void>; removeSnapshot:(snapshotId:string)=>Promise<void>; setTmImport: (v: TmMaster[], note?: string) => Promise<number>; setHistoryImport: (v: ReplacementHistory[], note?: string, severityOverride?: SeverityMaster[]) => Promise<number>; resetAllData: () => Promise<void>; addReplacement: (v: ReplacementHistory) => Promise<void>; updateSettings: (s: RiskSettings, sm: SeverityMaster[]) => Promise<void>; log: (eventType: string, targetTable: string, serialNo: string, beforeValue: unknown, afterValue: unknown, note: string) => Promise<void>; }
const C = createContext<State | null>(null);
function unchanged<T>(expected:T[], actual:T[], incoming:T[], key:(x:T)=>string) {
  for (const item of incoming) if (canonical(expected.find(x=>key(x)===key(item))) !== canonical(actual.find(x=>key(x)===key(item)))) throw new Error('수정 대상이 다른 사용자에 의해 변경되었습니다. 최신 자료를 확인하고 다시 시도하세요.');
}
export function AppProvider({ children }: { children: ReactNode }) {
  const [data,setData]=useState<SharedData>(emptyData),[snapshots,setSnapshots]=useState<DataSnapshot[]>([]),[ready,setReady]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState(''),[isAdmin,setIsAdmin]=useState(false);
  const locked=useRef(false);
  const accept=(next:SharedData)=>setData(old=>next.revision>=old.revision?next:old);
  const report=(e:unknown)=>{console.error('Firebase operation failed',e);setError(e instanceof Error?e.message:'Firebase 저장/조회에 실패했습니다.');};
  const refresh=async()=>{try{accept(await readSharedData());setReady(true);setError('');}catch(e){setReady(false);report(e);throw e;}};
  useEffect(()=>{
    if(!auth){setError('Firebase 환경설정이 없어 공용 운영 DB에 연결할 수 없습니다.');return;}
    let stop=()=>{},stopSnapshots=()=>{},generation=0;
    const stopAuth=onAuthStateChanged(auth,user=>{
      const token=++generation;stop();stopSnapshots();setReady(false);setData(emptyData());setSnapshots([]);setIsAdmin(false);
      if(!user)return;
      void user.getIdTokenResult().then(result=>{if(token===generation)setIsAdmin(result.claims.admin===true);}).catch(report);
      stop=subscribeSharedData(next=>{if(token===generation){accept(next);setReady(true);setError('');}},e=>{if(token===generation){report(e);setReady(false);}});
      stopSnapshots=subscribeCollection<DataSnapshot>('data_snapshots',items=>{if(token===generation)setSnapshots(items.sort((a,b)=>b.createdAt.localeCompare(a.createdAt)));},report);
    });
    const offline=()=>{setReady(false);setError('네트워크 연결이 끊겼습니다. 저장할 수 없습니다. 연결 후 다시 조회하세요.');};
    const online=()=>{if(auth?.currentUser)void refresh().catch(()=>{});};
    window.addEventListener('offline',offline);window.addEventListener('online',online);
    return()=>{generation++;stopAuth();stop();stopSnapshots();window.removeEventListener('offline',offline);window.removeEventListener('online',online);};
  },[]);
  const {tms,history,severities,settings}=data;
  const risks=useMemo(()=>calculateAllRisks(tms,history,severities,settings),[tms,history,severities,settings]);
  const issues=useMemo(()=>validateData(tms,history,severities,settings),[tms,history,severities,settings]);
  const perform=async<T,>(work:()=>Promise<T>):Promise<T>=>{
    if(!ready||!firebaseConfigured)throw new Error('공용 데이터 연결을 확인한 후 다시 시도하세요.');
    if(locked.current)throw new Error('저장 중입니다. 잠시 기다려 주세요.');
    locked.current=true;setBusy(true);setError('');
    try{return await work();}catch(e){report(e);throw e;}finally{locked.current=false;setBusy(false);}
  };
  const commit=async(transform:(latest:SharedData)=>AppData,event:string,options?:{admin?:boolean;expectedRevision?:number})=>{const result=await mutateSharedData(transform,event,options);accept(result);return result;};
  const log=async(eventType:string,targetTable:string,targetSerialNo:string,beforeValue:unknown,afterValue:unknown,userNote:string)=>{const entry:AuditLog={logId:crypto.randomUUID(),eventTime:new Date().toISOString(),eventType,targetTable,targetSerialNo,beforeValue,afterValue,userNote};await addAudit(entry);};
  const setTmImport=async(value:TmMaster[],_note?:string)=>perform(async()=>{
    const expected=data;await backupDatabase({...data,risks});
    const result=await commit(latest=>{unchanged(expected.tms,latest.tms,value,x=>x.serialNo);return{...latest,tms:enrichTmLocationsFromReplacementHistory(mergeTmImports(latest.tms,value),latest.history)};},'TM_IMPORT');return result.tms.length;
  });
  const setHistoryImport=async(value:ReplacementHistory[],_note?:string,severityOverride?:SeverityMaster[])=>perform(async()=>{
    const expected=data;await backupDatabase({...data,risks});
    const result=await commit(latest=>{unchanged(expected.history,latest.history,value,x=>x.replacementId);if(severityOverride&&canonical(expected.severities)!==canonical(latest.severities))throw new Error('심각도 설정이 변경되었습니다. 다시 조회하세요.');const merged=mergeHistoryImports(latest.history,value);return{...latest,history:merged,tms:enrichTmLocationsFromReplacementHistory(applyHistoryImportToTmState(latest.tms,merged,latest.settings.referenceYear,new Date().toISOString()),merged),severities:severityOverride?.length?severityOverride:latest.severities};},'HISTORY_IMPORT');return result.history.length;
  });
  const addReplacement=async(value:ReplacementHistory)=>perform(async()=>{
    const expected=data;
    await commit(latest=>{
      const existing=latest.history.find(x=>x.replacementId===value.replacementId);
      if(existing){if(canonical(existing)!==canonical(value))throw new Error('이미 사용된 교체작업 ID입니다.');return latest;}
      for(const serial of [value.removedSerialNo,value.installedSerialNo].filter(Boolean))if(canonical(expected.tms.find(x=>x.serialNo===serial))!==canonical(latest.tms.find(x=>x.serialNo===serial)))throw new Error('선택한 부품이 다른 사용자에 의해 변경되었습니다. 다시 선택하세요.');
      return{...latest,tms:applyReplacement(latest.tms,value),history:[value,...latest.history]};
    },'MANUAL_REPLACEMENT');
  });
  const updateSettings=async(value:RiskSettings,masters:SeverityMaster[])=>perform(async()=>{const expected=data;await commit(latest=>{if(canonical(expected.settings)!==canonical(latest.settings)||canonical(expected.severities)!==canonical(latest.severities))throw new Error('다른 사용자가 설정을 변경했습니다. 다시 조회하세요.');return{...latest,settings:value,severities:masters};},'SETTINGS_UPDATE');});
  const saveSnapshot=async(name:string)=>perform(async()=>{const latest=await readSharedData();const snapshot:DataSnapshot={...latest,risks:calculateAllRisks(latest.tms,latest.history,latest.severities,latest.settings),snapshotId:crypto.randomUUID(),name:name.trim(),createdAt:new Date().toISOString(),tmCount:latest.tms.length,historyCount:latest.history.length};await saveDataSnapshot(snapshot);});
  const loadSnapshot=async(snapshot:DataSnapshot)=>perform(async()=>{await requireAdmin();const expected=await readSharedData(),archive=await readDataSnapshot(snapshot.snapshotId);await backupDatabase(expected);await commit(()=>archive,'ADMIN_RESTORE',{admin:true,expectedRevision:expected.revision});});
  const removeSnapshot=async(id:string)=>perform(async()=>{await deleteDataSnapshot(id);});
  const resetAllData=async()=>perform(async()=>{await requireAdmin();const expected=await readSharedData();await backupDatabase(expected);await commit(()=>({...emptyData(),settings:DEFAULT_SETTINGS,severities:DEFAULT_SEVERITIES}),'ADMIN_RESET',{admin:true,expectedRevision:expected.revision});});
  const migrateLegacy=async()=>perform(async()=>{
    await requireAdmin();
    const read=<T,>(key:string,fallback:T):T=>{const raw=localStorage.getItem(`ai_parts_${key}`)||localStorage.getItem(`cbm_${key}`);return raw?JSON.parse(raw) as T:fallback;};
    const legacy:AppData={tms:read('tms',[]),history:read('history',[]),settings:read('settings',DEFAULT_SETTINGS),severities:read('severities',DEFAULT_SEVERITIES),risks:[]};
    if(!legacy.tms.length&&!legacy.history.length)throw new Error('이 브라우저에 이관할 기존자료가 없습니다. 기존 입력 PC에서 실행하세요.');
    await backupDatabase(legacy);
    await commit(latest=>{if(latest.tms.length||latest.history.length)throw new Error('공용 DB에 자료가 있어 자동 병합하지 않았습니다. 백업 비교 후 관리자가 이관해야 합니다.');return legacy;},'LEGACY_MIGRATION',{admin:true});
  });
  return <C.Provider value={{tms,history,risks,severities,settings,issues,snapshots,ready,busy,error,isAdmin,refresh,migrateLegacy,saveSnapshot,loadSnapshot,removeSnapshot,setTmImport,setHistoryImport,resetAllData,addReplacement,updateSettings,log}}>{children}</C.Provider>;
}
export const useApp=()=>{const value=useContext(C);if(!value)throw new Error('AppProvider가 필요합니다.');return value;};
