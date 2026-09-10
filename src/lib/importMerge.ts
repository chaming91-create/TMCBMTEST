import type { TmMaster } from '../types/tm';
import type { ReplacementHistory } from '../types/replacement';
const stateDate=(tm:TmMaster)=>[tm.stateChangedAt,tm.confirmedAt,tm.installDate].filter(Boolean).sort().at(-1)||'';
const stateFields=['currentStatus','isSpare','currentTrain','currentCar','currentPosition','currentUnit','installDate','confirmedAt','stateChangedAt','condition','lastRemovalReason','lastRemovedAt','locationSource','sourceType','inferredFromReplacement','inferredReplacementDate'] as const;
const historyKey=(row:ReplacementHistory)=>row.replacementId?.trim()||[row.replacementDate,row.trainNo,row.carNo,row.position,row.removedSerialNo,row.installedSerialNo].join('|');
export function mergeTmImports(current:TmMaster[],incoming:TmMaster[]){
  const merged=new Map(current.map(row=>[row.serialNo.trim(),row]));
  for(const row of incoming){
    const previous=merged.get(row.serialNo.trim());
    if(!previous){merged.set(row.serialNo.trim(),row);continue;}
    const next:TmMaster={...previous,...row,tmId:previous.tmId||row.tmId,createdAt:previous.createdAt};
    // An old spreadsheet must not remount a part removed by a newer operation.
    if(stateDate(row)<stateDate(previous))for(const key of stateFields)Object.assign(next,{[key]:previous[key]});
    merged.set(row.serialNo.trim(),next);
  }
  return [...merged.values()];
}
export function mergeHistoryImports(current:ReplacementHistory[],incoming:ReplacementHistory[]){
  const merged=new Map(current.map(row=>[historyKey(row),row]));
  incoming.forEach(row=>merged.set(historyKey(row),row));
  return [...merged.values()].sort((a,b)=>(b.replacementDate||'').localeCompare(a.replacementDate||''));
}
