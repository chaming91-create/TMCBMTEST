import { test, expect, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { doc, setDoc, getDoc, getDocs, collection } from 'firebase/firestore';
import { DEFAULT_SETTINGS, DEFAULT_SEVERITIES } from '../../src/lib/defaults';
let env: RulesTestEnvironment;
const password = 'emulator-only-password';
const passcode = readFileSync('src/components/LoginGate.tsx','utf8').match(/APP_PASSCODE='([^']+)'/)![1];
const part=(serialNo:string,spare=false,position='1')=>({serialNo,tmId:'ID-'+serialNo,manufacturer:'TestMaker',manufactureYear:2020,ageYear:6,currentStatus:spare?'예비품':'운행중',isSpare:spare,currentTrain:spare?'예비품':'101',currentCar:spare?'':'1',currentPosition:spare?'':position,installDate:'2026-01-10',sourceType:'current_excel',createdAt:'2026-01-01',updatedAt:'2026-01-10'});
async function login(page:Page){
  await page.goto('/');await page.locator('input[type=password]').fill(passcode);await page.getByRole('button',{name:'프로그램 입장'}).click();
  await page.getByLabel('이메일').fill('tm-test@example.invalid');await page.locator('input[type=password]').fill(password);await page.getByRole('button',{name:'안전하게 로그인'}).click();
  await expect(page.getByText('Firebase 공용 DB 연결',{exact:true})).toBeVisible();
}
async function fillReplacement(page:Page,removed:string,installed:string,reason:string,date='2026-09-10'){
  await page.getByRole('button',{name:'신규 교체 입력',exact:true}).click();await page.locator('input[type=date]').fill(date);
  const pickers=page.locator('.serial-picker');await pickers.nth(0).locator('label').filter({has:page.locator('span',{hasText:new RegExp('^'+removed+'$')})}).locator('input').check();
  await pickers.nth(1).locator('label').filter({has:page.locator('span',{hasText:new RegExp('^'+installed+'$')})}).locator('input').check();
  await page.getByLabel('교체사유',{exact:true}).fill(reason);
}
async function submit(page:Page){await page.getByRole('button',{name:'교체정보 저장',exact:true}).click();await expect(page.locator('header h1')).toHaveText('TM 현황');}
async function readPart(serial:string){let value:any;await env.withSecurityRulesDisabled(async context=>{value=(await getDoc(doc(context.firestore(),'tm_master',serial))).data();});return value;}
test.beforeAll(async()=>{
  env=await initializeTestEnvironment({projectId:'demo-tm-regression',firestore:{host:'127.0.0.1',port:8080,rules:readFileSync('firestore.rules','utf8')}});
  await env.clearFirestore();await env.withSecurityRulesDisabled(async context=>{const db=context.firestore();for(const row of [part('A'),part('B',true),part('C',true),part('X',false,'2'),part('Y',true)])await setDoc(doc(db,'tm_master',row.serialNo),row);await setDoc(doc(db,'settings','risk'),DEFAULT_SETTINGS);for(const row of DEFAULT_SEVERITIES)await setDoc(doc(db,'severity_master',row.failureType),row);});
  await fetch('http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signUp?key=emulator-only-key',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:'tm-test@example.invalid',password,returnSecureToken:true})});
});
test.afterAll(async()=>{await env?.cleanup();});
test('two real browsers: replacement lifecycle, realtime sync, refresh, incognito, failure and protected restore',async({browser})=>{
  const contextA=await browser.newContext(),contextB=await browser.newContext();const a=await contextA.newPage(),b=await contextB.newPage();
  const errors:string[]=[];a.on('pageerror',e=>errors.push(e.message));b.on('pageerror',e=>errors.push(e.message));
  await a.addInitScript(()=>localStorage.setItem('ai_parts_tms',JSON.stringify([{serialNo:'STALE-LOCAL'}])));
  await login(a);await login(b);await b.getByRole('button',{name:'TM 현황',exact:true}).click();
  await fillReplacement(a,'A','B','고장');await submit(a);
  await expect(b.locator('tr').filter({hasText:'ID-A'})).toContainText('점검 필요');
  expect(await readPart('A')).toMatchObject({tmId:'ID-A',isSpare:true,condition:'inspection_required',lastRemovalReason:'고장'});
  expect(await readPart('B')).toMatchObject({tmId:'ID-B',isSpare:false,currentTrain:'101',currentPosition:'1',currentStatus:'운행중'});
  await a.getByLabel('예비품만').check();await expect(a.locator('tbody')).toContainText('ID-A');await expect(a.locator('tbody')).not.toContainText('ID-B');
  await b.reload();await expect(b.getByText('Firebase 공용 DB 연결',{exact:true})).toBeVisible();
  await b.getByRole('button',{name:'TM 현황',exact:true}).click();await expect(b.locator('tr').filter({hasText:'ID-A'})).toContainText('점검 필요');
  expect(await a.evaluate(()=>JSON.parse(localStorage.getItem('ai_parts_tms')!)[0].serialNo)).toBe('STALE-LOCAL');
  // Preventive B→C and unrelated X→Y submitted concurrently from distinct clients.
  await fillReplacement(a,'B','C','예방교체','2026-10-03');await fillReplacement(b,'X','Y','예방교체','2026-10-03');
  await Promise.all([submit(a),submit(b)]);
  expect(await readPart('B')).toMatchObject({tmId:'ID-B',isSpare:true,currentStatus:'예비품',lastRemovalReason:'예방교체'});
  expect(await readPart('C')).toMatchObject({tmId:'ID-C',isSpare:false,currentPosition:'1',currentStatus:'운행중'});
  expect(await readPart('Y')).toMatchObject({isSpare:false,currentPosition:'2'});
  const freshContext=await browser.newContext(),fresh=await freshContext.newPage();await login(fresh);await fresh.getByRole('button',{name:'TM 현황',exact:true}).click();await expect(fresh.locator('tr').filter({hasText:'ID-C'})).toContainText('운행중');
  // Simulate SDK transport loss without a navigator event: the submit must fail visibly.
  await fillReplacement(a,'C','B','예방교체','2026-10-04');
  await a.evaluate(async()=>{const {db}=await import('/src/lib/firebase.ts');const source=await(await fetch('/src/lib/firebase.ts')).text();const url=source.match(/from\s+"([^"]*firebase_firestore[^"]*)"/)![1];const {disableNetwork}=await import(url);await disableNetwork(db);});
  await a.getByRole('button',{name:'교체정보 저장',exact:true}).click();await expect(a.locator('.form-panel .form-error')).toBeVisible();
  expect(await readPart('C')).toMatchObject({isSpare:false,currentPosition:'1'});expect(await readPart('B')).toMatchObject({isSpare:true});
  await a.evaluate(async()=>{const {db}=await import('/src/lib/firebase.ts');const source=await(await fetch('/src/lib/firebase.ts')).text();const url=source.match(/from\s+"([^"]*firebase_firestore[^"]*)"/)![1];const {enableNetwork}=await import(url);await enableNetwork(db);});
  await a.getByRole('button',{name:'데이터 세이브/로드',exact:true}).click();await a.getByPlaceholder('예: 8월 정기점검 반영 완료').fill('E2E backup');await a.getByRole('button',{name:'현재 데이터 저장',exact:true}).click();await expect(a.getByRole('button',{name:'불러오기',exact:true})).toBeDisabled();
  await a.getByRole('button',{name:'대시보드',exact:true}).click();await a.getByText('101 편성',{exact:true}).click();await expect(a.locator('.formation-detail').first()).toContainText('C');await expect(a.locator('.formation-detail').first()).not.toContainText('A');
  let history:any[]=[];await env.withSecurityRulesDisabled(async context=>{history=(await getDocs(collection(context.firestore(),'replacement_history'))).docs.map(x=>x.data());});expect(history).toHaveLength(3);expect(history.filter(x=>x.removedSerialNo==='A')[0].replacementReason).toBe('고장');expect(history.filter(x=>x.removedSerialNo==='B')[0].replacementReason).toBe('예방교체');
  expect(errors).toEqual([]);await Promise.all([contextA.close(),contextB.close(),freshContext.close()]);
});
