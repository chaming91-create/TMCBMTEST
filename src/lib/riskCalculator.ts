import type { ReplacementHistory } from '../types/replacement';
import type { RiskScore,RiskSettings } from '../types/risk';
import type { SeverityMaster,TmMaster,RiskGrade } from '../types/tm';
const round=(v:number)=>Math.round(v*100)/100;
export function calculateAgeScore(year:number|null,s:RiskSettings){if(!year||year>s.referenceYear)return 0;const age=Math.max(0,s.referenceYear-year);return round(100*(1-Math.exp(-Math.pow(age/s.weibullEta,s.weibullBeta))));}
export function calculateMkbfScore(mkbf:number){return mkbf>0?round(100*(1-Math.exp(-(10000/mkbf)))):0;}
export function getRiskGrade(score:number,s:RiskSettings):RiskGrade{if(score>=s.thresholds.danger)return'위험';if(score>=s.thresholds.caution)return'주의';if(score>=s.thresholds.observation)return'관찰';return'정상';}
const isFailure=(r:ReplacementHistory,s:RiskSettings)=>Boolean(r.failureType)||s.failureKeywords.some(k=>`${r.replacementReason} ${r.failureType} ${r.removedStatus}`.includes(k));
const severity=(r:ReplacementHistory,sm:SeverityMaster[])=>typeof r.severityScore==='number'?r.severityScore:sm.find(v=>v.isActive&&v.failureType===r.failureType)?.severityScore??0;
export function calculateAllRisks(tms:TmMaster[],history:ReplacementHistory[],sm:SeverityMaster[],s:RiskSettings):RiskScore[]{
 if(!tms.length)return[];const failures=history.filter(r=>isFailure(r,s));const globalRate=failures.length/tms.length;const groups=new Map<string,{tmCount:number;failureCount:number}>();
 const keyOf=(tm:TmMaster)=>`${tm.manufacturer||'제조사미상'}|${tm.manufactureYear?Math.floor(tm.manufactureYear/10)*10:'연도미상'}`;
 tms.forEach(tm=>{const k=keyOf(tm),g=groups.get(k)??{tmCount:0,failureCount:0};g.tmCount++;groups.set(k,g);});
 failures.forEach(r=>{const tm=tms.find(t=>t.serialNo===r.removedSerialNo);if(tm){const g=groups.get(keyOf(tm));if(g)g.failureCount++;}});
 const eb=new Map<string,number>();groups.forEach((g,k)=>eb.set(k,(g.failureCount+s.alpha*globalRate)/(g.tmCount+s.alpha)));const maxEb=Math.max(...eb.values(),0);
 const totals=new Map<string,number>();history.forEach(r=>{if(r.removedSerialNo)totals.set(r.removedSerialNo,(totals.get(r.removedSerialNo)??0)+severity(r,sm));});const maxT=Math.max(...totals.values(),0);const m=calculateMkbfScore(s.mkbf),now=new Date().toISOString();
 return tms.map(tm=>{const AScore=calculateAgeScore(tm.manufactureYear,s),FScore=maxEb?round(100*(eb.get(keyOf(tm))??0)/maxEb):0,TScore=maxT?round(100*(totals.get(tm.serialNo)??0)/maxT):0,riskScore=round(s.weights.A*AScore+s.weights.F*FScore+s.weights.T*TScore+s.weights.M*m);return{serialNo:tm.serialNo,AScore,FScore,TScore,MScore:m,riskScore,riskGrade:getRiskGrade(riskScore,s),calculatedAt:now,formulaVersion:s.formulaVersion};});
}
