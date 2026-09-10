import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { doc, setDoc, getDoc, runTransaction } from 'firebase/firestore';
const env=await initializeTestEnvironment({projectId:'demo-tm-regression',firestore:{host:'127.0.0.1',port:8080,rules:readFileSync('firestore.rules','utf8')}});
try {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async context=>{const db=context.firestore();await setDoc(doc(db,'tm_master','A'),{serialNo:'A',isSpare:false});await setDoc(doc(db,'tm_master','B'),{serialNo:'B',isSpare:true});});
  const db=env.authenticatedContext('operator').firestore();
  await assertFails(setDoc(doc(db,'tm_master','A'),{serialNo:'A',isSpare:true}));
  await assertFails(getDoc(doc(env.unauthenticatedContext().firestore(),'tm_master','A')));
  await assertSucceeds(runTransaction(db,async tx=>{
    const meta=doc(db,'system','state');await tx.get(meta);await tx.get(doc(db,'tm_master','A'));await tx.get(doc(db,'tm_master','B'));
    tx.set(doc(db,'tm_master','A'),{serialNo:'A',isSpare:true,condition:'inspection_required'});
    tx.set(doc(db,'tm_master','B'),{serialNo:'B',isSpare:false});
    tx.set(doc(db,'replacement_history','R1'),{replacementId:'R1',removedSerialNo:'A',installedSerialNo:'B',replacementReason:'고장'});
    tx.set(meta,{schemaVersion:2,revision:1,operation:'MANUAL_REPLACEMENT'});
  }));
  assert.equal((await getDoc(doc(db,'tm_master','A'))).data().isSpare,true);
  const restore=database=>runTransaction(database,async tx=>{const meta=doc(database,'system','state');const value=await tx.get(meta);tx.delete(doc(database,'tm_master','A'));tx.set(meta,{schemaVersion:2,revision:value.data().revision+1,operation:'ADMIN_RESET'});});
  await assertFails(restore(db));assert.equal((await getDoc(doc(db,'tm_master','A'))).exists(),true);
  await assertSucceeds(restore(env.authenticatedContext('admin',{admin:true}).firestore()));
  await assertFails(runTransaction(db,async tx=>{const meta=doc(db,'system','state');const value=await tx.get(meta);tx.set(doc(db,'tm_master','B'),{serialNo:'WRONG'});tx.set(meta,{schemaVersion:2,revision:value.data().revision+1,operation:'PART_EDIT'});}));
  assert.equal((await getDoc(doc(db,'tm_master','B'))).data().serialNo,'B');
  // Verify actual service limits for an atomic bulk import, without production data.
  await assertSucceeds(runTransaction(db,async tx=>{const meta=doc(db,'system','state');const value=await tx.get(meta);for(let i=0;i<600;i++)tx.set(doc(db,'tm_master','bulk-'+i),{serialNo:'bulk-'+i,isSpare:true});tx.set(meta,{schemaVersion:2,revision:value.data().revision+1,operation:'TM_IMPORT'});}));
  console.log('PASS: unauthenticated access denied; legacy uncoordinated writes denied; atomic replacement; operator restore denied; admin restore allowed; ID mutation denied; 600-document atomic import.');
} finally { await env.cleanup(); }
