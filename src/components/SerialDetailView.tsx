import { useMemo,useState } from 'react';
import { Search,TrainFront } from 'lucide-react';
import { Line,LineChart,CartesianGrid,ResponsiveContainer,Tooltip,XAxis,YAxis } from 'recharts';
import { useApp } from '../context/AppContext';
import EmptyState from './EmptyState';
import RiskBadge from './RiskBadge';
import type { ReplacementHistory } from '../types/replacement';

const isFailureEvent=(x:ReplacementHistory)=>['Y','y','예','1','true'].includes(String(x.failureReplacement??''))||((x.severityScore??0)>0&&x.failureCode!=='FC00');

export default function SerialDetailView(){
  const {tms,history,risks}=useApp();
  const [serial,setSerial]=useState(sessionStorage.getItem('selectedSerial')||'');
  const tm=tms.find(x=>x.serialNo===serial),risk=risks.find(x=>x.serialNo===serial);
  const events=useMemo(()=>history.filter(x=>x.removedSerialNo===serial||x.installedSerialNo===serial).sort((a,b)=>a.replacementDate.localeCompare(b.replacementDate)),[history,serial]);
  const lifecycle=useMemo(()=>{
    if(!tm)return [] as Array<{id:string;date:string;kind:string;title:string;body:string;source:string}>;
    const rows:Array<{id:string;date:string;kind:string;title:string;body:string;source:string}>=[{id:'current-'+tm.serialNo,date:tm.installDate||'',kind:'현재장착',title:`${tm.currentTrain||'-'}편성 ${tm.currentCar||'-'}호차 ${tm.currentPosition||'-'}`,body:tm.inferredFromReplacement?'현재 위치는 교체현황의 최신 부착이력을 기준으로 보완되었습니다.':tm.currentStatus,source:tm.locationSource||'현황파일'}];
    events.forEach(x=>{
      const installed=x.installedSerialNo===serial;
      const basis=installed&&tm.inferredFromReplacement&&tm.inferredReplacementDate===x.replacementDate;
      const kind=basis?'위치보완 기준이력':installed?'부착':isFailureEvent(x)?'고장발생':x.failureType?'취거':'정기교체';
      rows.push({id:x.replacementId+(installed?'-in':'-out'),date:x.replacementDate,kind,title:`${x.trainNo||'-'}편성 ${x.carNo||'-'}호차 ${x.position||'-'}`,body:[x.failureType,x.replacementReason,x.detail].filter(Boolean).join(' · ')||'교체 이력',source:x.inputSource==='manual'?'웹앱 신규 입력':'교체현황'});
    });
    return rows.sort((a,b)=>(b.date||'').localeCompare(a.date||''));
  },[events,serial,tm]);
  const trend=events.map((x,i)=>({날짜:x.replacementDate,점수:Math.min(100,(risk?.AScore??0)+(i+1)*((risk?.TScore??0)/Math.max(events.length,1))*.3)}));
  return <div className="stack"><section className="filter-panel"><div className="search wide"><Search/><input list="serial-search" placeholder="Serial No. 검색" value={serial} onChange={e=>{setSerial(e.target.value);sessionStorage.setItem('selectedSerial',e.target.value)}}/></div><datalist id="serial-search">{tms.map(x=><option key={x.serialNo} value={x.serialNo}/>)}</datalist></section>{!tm?<EmptyState text="조회할 Serial No.를 선택하세요."/>:<><section className="detail-hero"><div className="detail-icon"><TrainFront/></div><div><span>TRACTION MOTOR</span><h2>{tm.serialNo}</h2><p>{tm.manufacturer||'제조사 미상'} · {tm.manufactureYear??'제작년도 미상'}년 제작 · 사용연수 {tm.ageYear}년</p></div><div className="detail-risk"><strong>{risk?.riskScore??0}</strong><RiskBadge grade={risk?.riskGrade??'안전'}/></div></section>{tm.inferredFromReplacement&&<section className="panel"><p>현재 위치는 교체현황의 최신 부착이력을 기준으로 보완되었습니다.</p></section>}<section className="detail-grid"><article className="panel"><h3>현재 상태</h3><dl><div><dt>현재상태</dt><dd>{tm.currentStatus}</dd></div><div><dt>현재 취부 위치</dt><dd>{tm.currentTrain||'-'}편성 {tm.currentCar||'-'}호차 {tm.currentPosition||'-'}</dd></div><div><dt>취부일자</dt><dd>{tm.installDate||'-'}</dd></div><div><dt>위치정보 출처</dt><dd>{tm.locationSource||'현황파일'}</dd></div><div><dt>보완 기준 교체일자</dt><dd>{tm.inferredReplacementDate||'-'}</dd></div></dl></article><article className="panel"><h3>위험도 구성</h3><div className="score-bars">{[['노후도 A',risk?.AScore],['고장빈도 F',risk?.FScore],['심각도 T',risk?.TScore],['MKBF M',risk?.MScore]].map(([l,v])=><div key={l as string}><span>{l}</span><i><b style={{width:`${v??0}%`}}/></i><strong>{v??0}</strong></div>)}</div></article></section><section className="chart-grid"><article className="panel"><h3>위험도 변화 추이</h3><div className="chart"><ResponsiveContainer><LineChart data={trend}><CartesianGrid strokeDasharray="3 3"/><XAxis dataKey="날짜"/><YAxis domain={[0,100]}/><Tooltip/><Line dataKey="점수" stroke="#e63946" strokeWidth={4}/></LineChart></ResponsiveContainer></div></article><article className="panel"><h3>Serial No. 상세이력</h3><div className="timeline">{lifecycle.length?lifecycle.map(x=><div key={x.id}><time>{x.date||'-'}</time><b>{x.kind} · {x.title}</b><p>{x.body}</p><small>{x.source}</small></div>):<p>등록된 이력이 없습니다.</p>}</div></article></section></>}</div>;
}
