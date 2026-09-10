import { describe,expect,it } from 'vitest';
import { mergeHistoryImports,mergeTmImports } from '../importMerge';
import type { TmMaster } from '../../types/tm';import type { ReplacementHistory } from '../../types/replacement';
const tm=(tmId:string,serialNo:string)=>({tmId,serialNo,manufacturer:'',manufactureYear:null,ageYear:0,currentStatus:'운영중',isSpare:false,currentTrain:'111',currentCar:'1111',currentPosition:'M01',installDate:'2026-08-12',sourceType:'current_excel',createdAt:'',updatedAt:''}) as TmMaster;
const history=(replacementId:string,detail:string)=>({replacementId,replacementDate:'2026-01-01',trainNo:'111',carNo:'1111',position:'M01',removedSerialNo:'OLD',removedManufactureYear:null,removedManufacturer:'',removedStatus:'',installedSerialNo:'NEW',installedManufactureYear:null,installedManufacturer:'',installedStatus:'',replacementReason:'',failureType:'',failureCode:'',severityClass:'',severityScore:null,failureReplacement:'',detail,actionTaken:'',note:'',inputSource:'history_excel',createdAt:'',updatedAt:''}) as ReplacementHistory;
describe('incremental imports',()=>{it('preserves physical serials when a legacy TM slot ID is reused',()=>{expect(mergeTmImports([tm('A','OLD'),tm('B','KEEP')],[tm('A','NEW')]).map(x=>x.serialNo).sort()).toEqual(['KEEP','NEW','OLD'])});it('updates matching replacement IDs without duplication',()=>{const rows=mergeHistoryImports([history('R1','old')],[history('R1','new'),history('R2','added')]);expect(rows).toHaveLength(2);expect(rows.find(x=>x.replacementId==='R1')?.detail).toBe('new')})});

it('does not remount a removed part from an older workbook or change its identity',()=>{
  const removed={...tm('ID-A','A'),isSpare:true,currentStatus:'예비품 · ⚠ 고장 취거 / 점검 필요',currentTrain:'예비품',currentCar:'',currentPosition:'',condition:'inspection_required' as const,stateChangedAt:'2026-09-10',lastRemovalReason:'고장',createdAt:'2020-01-01'};
  const imported={...tm('OTHER-ID','A'),confirmedAt:'2026-08-12'};
  expect(mergeTmImports([removed],[imported])[0]).toMatchObject({tmId:'ID-A',isSpare:true,currentTrain:'예비품',condition:'inspection_required',stateChangedAt:'2026-09-10',createdAt:'2020-01-01'});
});
