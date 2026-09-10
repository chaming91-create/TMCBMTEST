import type { TmMaster } from '../types/tm';
import type { ReplacementHistory } from '../types/replacement';

const tmKey = (tm: TmMaster) => tm.tmId?.trim() ? `id:${tm.tmId.trim()}` : `serial:${tm.serialNo.trim()}`;
const historyKey = (row: ReplacementHistory) => row.replacementId?.trim() || [row.replacementDate,row.trainNo,row.carNo,row.position,row.removedSerialNo,row.installedSerialNo].join('|');

export function mergeTmImports(current: TmMaster[], incoming: TmMaster[]) {
  const incomingSerials = new Set(incoming.map(row => row.serialNo));
  const merged = new Map(current.filter(row => !incomingSerials.has(row.serialNo)).map(row => [tmKey(row), row]));
  incoming.forEach(row => merged.set(tmKey(row), row));
  return [...merged.values()];
}

export function mergeHistoryImports(current: ReplacementHistory[], incoming: ReplacementHistory[]) {
  const merged = new Map(current.map(row => [historyKey(row), row]));
  incoming.forEach(row => merged.set(historyKey(row), row));
  return [...merged.values()].sort((a,b)=>(b.replacementDate||'').localeCompare(a.replacementDate||''));
}
