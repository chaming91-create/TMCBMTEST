import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { TmMaster } from '../../types/tm';
import type { ReplacementHistory } from '../../types/replacement';

// A server-backed SDK double: separate reads, atomic commits, revision conflicts,
// rejected commits and listeners. These tests are not production/emulator tests.
const server = vi.hoisted(() => ({ rows: new Map<string, any>(), listeners: new Set<()=>void>(), fail: false, commits: [] as string[][], admin: true }));
vi.mock('../firebase', () => ({ db: {}, auth: { currentUser: { uid: 'test-user', getIdTokenResult: async () => ({ claims: { admin: server.admin } }) } } }));
vi.mock('firebase/firestore', () => {
  const snap = (path: string) => { const value = structuredClone(server.rows.get(path));return { exists: () => value !== undefined, data: () => value, metadata: { fromCache: false, hasPendingWrites: false } }; };
  return {
    doc: (_db: unknown, ...path: string[]) => path.join('/'), collection: (_db:unknown,path:string)=>path,
    getDocFromServer: async (path:string)=>snap(path),
    getDocsFromServer: async (path:string)=>{const docs=[...server.rows].filter(([key])=>key.startsWith(path+'/')&&key.split('/').length===2).map(([key,value])=>({id:key.split('/')[1],data:()=>structuredClone(value)}));return{docs,empty:!docs.length};},
    runTransaction: async (_db:unknown,fn:any)=>{
      const reads=new Map<string,string>(),writes=new Map<string,any>();
      await fn({get:async(path:string)=>{reads.set(path,JSON.stringify(server.rows.get(path)));return snap(path);},set:(path:string,value:any)=>writes.set(path,value),delete:(path:string)=>writes.set(path,undefined)});
      if(server.fail)throw new Error('unavailable: simulated network failure');
      for(const [path,expected] of reads)if(JSON.stringify(server.rows.get(path))!==expected)throw new Error('공용 데이터가 변경되었습니다. 최신 데이터로 다시 시도하세요.');
      for(const [path,value] of writes)value===undefined?server.rows.delete(path):server.rows.set(path,structuredClone(value));
      server.commits.push([...writes.keys()]);server.listeners.forEach(fn=>fn());
    },
    onSnapshot: (_path:unknown,_options:unknown,next:any)=>{const notify=()=>next(snap('system/state'));server.listeners.add(notify);notify();return()=>server.listeners.delete(notify);},
  };
});
import { emptyData, mutateSharedData, readSharedData, subscribeSharedData } from '../sharedStore';
import { applyReplacement } from '../replacementOperation';
import { calculateAllRisks } from '../riskCalculator';

const part=(serialNo:string,spare=false):TmMaster=>({serialNo,tmId:`ID-${serialNo}`,manufacturer:'Maker',manufactureYear:2020,ageYear:6,currentStatus:spare?'예비품':'운행중',isSpare:spare,currentTrain:spare?'예비품':'101',currentCar:spare?'':'1',currentPosition:spare?'':'1',installDate:'2026-01-10',sourceType:'current_excel',createdAt:'2026-01-01',updatedAt:'2026-01-10'});
const event=(overrides:Partial<ReplacementHistory>={}):ReplacementHistory=>({replacementId:'R1',replacementDate:'2026-09-10',trainNo:'101',carNo:'1',position:'1',removedSerialNo:'A',installedSerialNo:'B',removedStatus:'취거',installedStatus:'운행중',replacementReason:'고장',failureType:'베어링 고장',severityClass:'A',severityScore:80,detail:'고장 취거',actionTaken:'',note:'',inputSource:'manual',createdAt:'2026-09-10',updatedAt:'2026-09-10',...overrides});
async function replace(item:ReplacementHistory){return mutateSharedData(latest=>({...latest,tms:applyReplacement(latest.tms,item),history:[item,...latest.history]}),'MANUAL_REPLACEMENT');}
beforeEach(()=>{server.rows.clear();server.listeners.clear();server.fail=false;server.commits=[];server.admin=true;for(const tm of [part('A'),part('B',true),part('C',true)])server.rows.set('tm_master/'+tm.serialNo,tm);});

describe('shared replacement persistence',()=>{
  it('keeps A as warned spare with its ID and records no A failure against B',async()=>{
    const data=await replace(event()),a=data.tms.find(x=>x.serialNo==='A')!,b=data.tms.find(x=>x.serialNo==='B')!;
    expect(a).toMatchObject({tmId:'ID-A',isSpare:true,condition:'inspection_required',lastRemovalReason:'고장',currentPosition:'',installDate:'2026-01-10'});
    expect(b).toMatchObject({tmId:'ID-B',isSpare:false,currentTrain:'101',currentPosition:'1',installDate:'2026-09-10'});
    expect(b.currentStatus).not.toContain('고장');expect(b.lastRemovalReason).toBeUndefined();
    expect(data.history.filter(x=>x.removedSerialNo==='B')).toHaveLength(0);
    const scores=calculateAllRisks(data.tms,data.history,data.severities,data.settings);
    expect(scores.find(x=>x.serialNo==='A')!.TScore).toBe(100);expect(scores.find(x=>x.serialNo==='B')!.TScore).toBe(0);
    expect(server.commits.at(-1)).toContain('replacement_history/R1');expect(server.commits.at(-1)).not.toContain('tm_master/C');
    expect(server.commits.at(-1)!.some(x=>x.startsWith('risk_score/'))).toBe(false);
  });
  it('preserves prevention as A history without warnings on either part',async()=>{
    const data=await replace(event({replacementReason:'예방교체',failureType:'',severityScore:0}));
    expect(data.tms.find(x=>x.serialNo==='A')).toMatchObject({isSpare:true,currentStatus:'예비품'});
    expect(data.tms.find(x=>x.serialNo==='B')!.currentStatus).not.toContain('⚠');
    expect(data.history[0]).toMatchObject({removedSerialNo:'A',replacementReason:'예방교체'});
  });
  it('accumulates A→B→C lifecycles without replacing any physical object',async()=>{
    await replace(event());const data=await replace(event({replacementId:'R2',replacementDate:'2026-10-03',removedSerialNo:'B',installedSerialNo:'C',replacementReason:'예방교체',failureType:'',severityScore:0}));
    expect(data.tms.map(x=>x.tmId).sort()).toEqual(['ID-A','ID-B','ID-C']);expect(data.history).toHaveLength(2);
    expect(data.tms.filter(x=>x.isSpare).map(x=>x.serialNo).sort()).toEqual(['A','B']);expect(data.tms.find(x=>x.serialNo==='C')!.isSpare).toBe(false);
    expect(data.history.filter(x=>x.removedSerialNo==='B')).toHaveLength(1);expect(data.history.filter(x=>x.installedSerialNo==='B')).toHaveLength(1);
  });
  it('fresh clients and reloads always read server data without browser storage',async()=>{
    await replace(event());const pcB=await readSharedData(),refresh=await readSharedData(),incognito=await readSharedData();
    expect(pcB.tms).toEqual(refresh.tms);expect(incognito.history).toEqual(pcB.history);expect(pcB.tms.find(x=>x.serialNo==='A')!.isSpare).toBe(true);
  });
  it('synchronizes another subscribed client after the complete atomic commit',async()=>{
    const observed:any[]=[];const stop=subscribeSharedData(data=>observed.push(data),e=>{throw e;});await replace(event());
    await vi.waitFor(()=>expect(observed.at(-1)?.history).toHaveLength(1));
    for(const state of observed)if(state.history.length)expect(state.tms.find((x:TmMaster)=>x.serialNo==='A')!.isSpare).toBe(true);
    stop();
  });
  it('concurrent changes to different parts both survive revision retries',async()=>{
    await Promise.all(['B','C'].map(serial=>mutateSharedData(latest=>({...latest,tms:latest.tms.map(x=>x.serialNo===serial?{...x,note:'updated-'+serial}:x)}),'PART_EDIT')));
    const data=await readSharedData();expect(data.tms.find(x=>x.serialNo==='B')!.note).toBe('updated-B');expect(data.tms.find(x=>x.serialNo==='C')!.note).toBe('updated-C');expect(data.revision).toBe(2);
  });
  it('rejects competing replacements instead of mounting two parts in one slot',async()=>{
    const results=await Promise.allSettled([replace(event()),replace(event({replacementId:'R2',installedSerialNo:'C'}))]);
    expect(results.filter(x=>x.status==='fulfilled')).toHaveLength(1);const data=await readSharedData();expect(data.history).toHaveLength(1);expect(data.tms.filter(x=>!x.isSpare)).toHaveLength(1);
  });
  it('failed commit leaves A, B, history and revision completely unchanged',async()=>{
    const before=await readSharedData();server.fail=true;await expect(replace(event())).rejects.toThrow('unavailable');expect(await readSharedData()).toEqual(before);expect(server.commits).toHaveLength(0);
  });
  it('never seeds operational sample data into an empty database',async()=>{
    server.rows.clear();expect(await readSharedData()).toEqual(emptyData());expect(server.rows.size).toBe(0);
  });
  it('blocks stale full restores and non-admin resets',async()=>{
    const before=await readSharedData();await replace(event());
    await expect(mutateSharedData(()=>before,'ADMIN_RESTORE',{admin:true,expectedRevision:before.revision})).rejects.toThrow('변경');
    server.admin=false;await expect(mutateSharedData(()=>emptyData(),'ADMIN_RESET',{admin:true})).rejects.toThrow('관리자');expect((await readSharedData()).history).toHaveLength(1);
  });
  it('rejects identical serials, unknown removals, occupied incoming parts and old dates',async()=>{
    for(const value of [event({installedSerialNo:'A'}),event({removedSerialNo:'UNKNOWN'}),event({replacementDate:'2025-01-01'})])await expect(replace(value)).rejects.toThrow();
    expect(server.commits).toHaveLength(0);
  });
  it('retains disposed physical parts and all old history',async()=>{
    await replace(event());const data=await replace(event({replacementId:'D1',removedSerialNo:'A',installedSerialNo:'',removedStatus:'불용',replacementReason:'수리불가',replacementDate:'2026-10-10'}));
    expect(data.tms.find(x=>x.serialNo==='A')).toMatchObject({tmId:'ID-A',currentStatus:'불용',condition:'disposed',isSpare:false});expect(data.history).toHaveLength(2);
  });
});


it('does not re-seed deliberately empty severity settings after initialization',async()=>{
  await mutateSharedData(latest=>({...latest,severities:[]}),'SETTINGS_UPDATE');
  expect((await readSharedData()).severities).toEqual([]);
});
