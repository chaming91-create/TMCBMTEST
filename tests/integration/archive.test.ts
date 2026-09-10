import { afterAll, expect, it, vi } from 'vitest';
const resources=vi.hoisted(()=>({env:null as any}));
vi.mock('../../src/lib/firebase',async()=>{
  const {initializeTestEnvironment}=await import('@firebase/rules-unit-testing');
  const {readFileSync}=await import('node:fs');
  resources.env=await initializeTestEnvironment({projectId:'demo-tm-regression',firestore:{host:'127.0.0.1',port:8080,rules:readFileSync('firestore.rules','utf8')}});
  return{db:resources.env.authenticatedContext('archive-admin',{admin:true}).firestore(),auth:{currentUser:{uid:'archive-admin',getIdTokenResult:async()=>({claims:{admin:true}})}},storage:null};
});
import { readDataSnapshot, saveDataSnapshot, deleteDataSnapshot } from '../../src/lib/firestoreService';
import { emptyData, mutateSharedData, readSharedData } from '../../src/lib/sharedStore';
import { getDoc,doc } from 'firebase/firestore';
import { db } from '../../src/lib/firebase';
afterAll(async()=>{await resources.env?.cleanup();});
it('round-trips a >1 MiB Unicode snapshot and restores all documents atomically as admin',async()=>{
  const data=emptyData();
  // Each operational document fits the service limit, while the combined backup does not.
  data.tms=Array.from({length:12},(_,i)=>({serialNo:'ARCHIVE-'+i,tmId:'ID-'+i,manufacturer:'Maker',manufactureYear:2020,ageYear:6,currentStatus:'예비품',isSpare:true,currentTrain:'예비품',currentCar:'',currentPosition:'',installDate:'',sourceType:'manual_added' as const,createdAt:'2026-01-01',updatedAt:'2026-01-01',note:'한글🔧'.repeat(20000)}));
  const snapshot={...data,snapshotId:'large-unicode-backup-'+crypto.randomUUID(),name:'Unicode backup',createdAt:'2026-09-10',tmCount:12,historyCount:0};
  await saveDataSnapshot(snapshot);
  const manifest=(await getDoc(doc(db!,'data_snapshots',snapshot.snapshotId))).data()!;
  expect(manifest.chunkCount).toBeGreaterThan(1);expect(manifest.tms).toBeUndefined();
  const recovered=await readDataSnapshot(snapshot.snapshotId);expect(recovered.tms).toEqual(data.tms);
  const before=await readSharedData();await mutateSharedData(()=>recovered,'ADMIN_RESTORE',{admin:true,expectedRevision:before.revision});
  expect((await readSharedData()).tms.sort((a,b)=>a.serialNo.localeCompare(b.serialNo))).toEqual([...data.tms].sort((a,b)=>a.serialNo.localeCompare(b.serialNo)));
  await deleteDataSnapshot(snapshot.snapshotId);await expect(readDataSnapshot(snapshot.snapshotId)).rejects.toThrow('존재하지');
});
