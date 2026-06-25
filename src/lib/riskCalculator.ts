import type { ReplacementHistory } from '../types/replacement';
import type { RiskScore,RiskSettings } from '../types/risk';
import type { SeverityMaster,TmMaster,RiskGrade } from '../types/tm';
const UNKNOWN_VALUE='모름';
const round=(v:number)=>Math.round(v*100)/100;
const unknown=(v:unknown)=>!String(v??'').trim()||String(v).trim()===UNKNOWN_VALUE;
export function calculateAgeScore(year:number|null,s:RiskSettings){if(!year||year>s.referenceYear)return 0;const age=Math.max(0,s.referenceYear-year);return round(100*(1-Math.exp(-Math.pow(age/s.weibullEta,s.weibullBeta))));}
export function calculateMkbfScore(mkbf:number){return mkbf>0?round(100*(1-Math.exp(-(10000/mkbf)))):0;}
export function getRiskGrade(score:number,s:RiskSettings):RiskGrade{if(score>=s.thresholds.danger)return'위험';if(score>=s.thresholds.caution)return'주의';if(score>=s.thresholds.observation)return'관찰';return'정상';}
const isY=(v:unknown)=>['y','yes','true','1','예','고장성'].includes(String(v??'').trim().toLowerCase());
const isFailure=(r:ReplacementHistory,s:RiskSettings)=>isY(r.failureReplacement)||((r.severityScore??0)>0&&r.failureCode!=='FC00')||s.failureKeywords.some(k=>`${r.replacementReason} ${r.failureType} ${r.removedStatus}`.includes(k));
const severity=(r:ReplacementHistory,sm:SeverityMaster[])=>typeof r.severityScore==='number'?r.severityScore:sm.find(v=>v.isActive&&v.failureType===r.failureType)?.severityScore??0;
const uncertaintyReasons=(tm:TmMaster,history:ReplacementHistory[])=>{const reasons:string[]=[];if(unknown(tm.manufacturer))reasons.push('제조사 모름');if(!tm.manufactureYear)reasons.push('제작년도 모름');if(unknown(tm.currentStatus))reasons.push('현재상태 모름');if(!tm.isSpare&&tm.sourceType!=='history_only'){if(unknown(tm.currentTrain))reasons.push('편성 모름');if(unknown(tm.currentPosition))reasons.push('위치 모름');}history.filter(r=>r.removedSerialNo===tm.serialNo||r.installedSerialNo===tm.serialNo).forEach(r=>{if(unknown(r.failureType))reasons.push('고장유형 모름');if(r.severityScore==null)reasons.push('고장심각도 모름');if(!r.replacementDate)reasons.push('교체일자 모름');});return Array.from(new Set(reasons));};
export function calculateAllRisks(tms:TmMaster[],history:ReplacementHistory[],sm:SeverityMaster[],s:RiskSettings):RiskScore[]{
 if(!tms.length)return[];const failures=history.filter(r=>isFailure(r,s));const globalRate=failures.length/tms.length;const groups=new Map<string,{tmCount:number;failureCount:number}>();
 const keyOf=(tm:TmMaster)=>`${tm.manufacturer||'제조사미상'}|${tm.manufactureYear?Math.floor(tm.manufactureYear/10)*10:'연도미상'}`;
 tms.forEach(tm=>{const k=keyOf(tm),g=groups.get(k)??{tmCount:0,failureCount:0};g.tmCount++;groups.set(k,g);});
 failures.forEach(r=>{const tm=tms.find(t=>t.serialNo===r.removedSerialNo);if(tm){const g=groups.get(keyOf(tm));if(g)g.failureCount++;}});
 const eb=new Map<string,number>();groups.forEach((g,k)=>eb.set(k,(g.failureCount+s.alpha*globalRate)/(g.tmCount+s.alpha)));const maxEb=Math.max(...eb.values(),0);
 const totals=new Map<string,number>();failures.forEach(r=>{if(r.removedSerialNo)totals.set(r.removedSerialNo,(totals.get(r.removedSerialNo)??0)+severity(r,sm));});const maxT=Math.max(...totals.values(),0);const m=calculateMkbfScore(s.mkbf),now=new Date().toISOString();
 return tms.map(tm=>{const AScore=calculateAgeScore(tm.manufactureYear,s),FScore=maxEb?round(100*(eb.get(keyOf(tm))??0)/maxEb):0,TScore=maxT?round(100*(totals.get(tm.serialNo)??0)/maxT):0,riskScore=round(s.weights.A*AScore+s.weights.F*FScore+s.weights.T*TScore+s.weights.M*m),reasons=uncertaintyReasons(tm,history);return{serialNo:tm.serialNo,AScore,FScore,TScore,MScore:m,riskScore,riskGrade:getRiskGrade(riskScore,s),isUncertain:reasons.length>0,uncertaintyReasons:reasons,calculatedAt:now,formulaVersion:s.formulaVersion};});
}
