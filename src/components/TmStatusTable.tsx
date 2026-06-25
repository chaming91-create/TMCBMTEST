import { useMemo,useState } from 'react';
import { Download,RotateCcw,Search } from 'lucide-react';
import { useApp } from '../context/AppContext';
import { downloadWorkbook,exportTm } from '../lib/excelParser';
import EmptyState from './EmptyState';
import RiskBadge from './RiskBadge';

export default function TmStatusTable({onSerial}:{onSerial:()=>void}){
  const {tms,risks}=useApp();
  const [q,setQ]=useState(''),[maker,setMaker]=useState(''),[grade,setGrade]=useState(''),[spare,setSpare]=useState(false),[historyOnly,setHistoryOnly]=useState(false);
  const rows=useMemo(()=>tms.filter(tm=>{
    const r=risks.find(x=>x.serialNo===tm.serialNo);
    const text=`${tm.tmId??''} ${tm.serialNo} ${tm.currentTrain} ${tm.currentCar} ${tm.currentPosition}`.toLowerCase();
    return(!q||text.includes(q.toLowerCase()))&&(!maker||tm.manufacturer===maker)&&(!grade||r?.riskGrade===grade)&&(!spare||tm.isSpare)&&(historyOnly?tm.sourceType==='history_only':tm.sourceType!=='history_only');
  }),[tms,risks,q,maker,grade,spare,historyOnly]);
  const reset=()=>{setQ('');setMaker('');setGrade('');setSpare(false);setHistoryOnly(false)};
  const headers=['TM_ID','편성','차호','위치','교환일자','시리얼번호','제작년도','제조사','사용연수','현재상태','위치정보 출처','위치보완 여부','보완 기준 교체일자','현황비고','A_score','F_score','T_score','M_score','Risk_Score','위험등급'];
  return <div className="stack"><section className="filter-panel"><div className="search"><Search/><input placeholder="TM_ID·시리얼번호·편성·위치 검색" value={q} onChange={e=>setQ(e.target.value)}/></div><select value={maker} onChange={e=>setMaker(e.target.value)}><option value="">전체 제조사</option>{[...new Set(tms.map(x=>x.manufacturer).filter(Boolean))].map(x=><option key={x}>{x}</option>)}</select><select value={grade} onChange={e=>setGrade(e.target.value)}><option value="">전체 위험등급</option>{['정상','관찰','주의','위험'].map(x=><option key={x}>{x}</option>)}</select><label className="check"><input type="checkbox" checked={spare} onChange={e=>setSpare(e.target.checked)}/>예비품만</label><label className="check"><input type="checkbox" checked={historyOnly} onChange={e=>setHistoryOnly(e.target.checked)}/>이력만 존재</label><button onClick={reset}><RotateCcw/>초기화</button><button className="primary" onClick={()=>downloadWorkbook('TM_현황',[{name:'TM 현황',data:exportTm(rows,risks)}])}><Download/>엑셀 다운로드</button></section><section className="panel table-panel"><div className="panel-heading"><h3>TM 현황 <span>{rows.length.toLocaleString()}대</span></h3></div>{!rows.length?<EmptyState/>:<div className="table-wrap"><table><thead><tr>{headers.map(x=><th key={x}>{x}</th>)}</tr></thead><tbody>{rows.map(tm=>{const r=risks.find(x=>x.serialNo===tm.serialNo);return <tr key={tm.serialNo} className={r?.riskGrade==='위험'?'danger-row':''}><td>{tm.tmId||'-'}</td><td>{tm.currentTrain||'-'}</td><td>{tm.currentCar||'-'}</td><td>{tm.currentPosition||'-'}</td><td>{tm.installDate||'-'}</td><td><button className="link" onClick={()=>{sessionStorage.setItem('selectedSerial',tm.serialNo);onSerial()}}>{tm.serialNo}</button></td><td>{tm.manufactureYear??'-'}</td><td>{tm.manufacturer||'-'}</td><td>{tm.ageYear}</td><td>{tm.currentStatus}</td><td>{tm.locationSource||'현황파일'}</td><td>{tm.inferredFromReplacement?'Y':'N'}</td><td>{tm.inferredReplacementDate||'-'}</td><td>{tm.note||'-'}</td><td>{r?.AScore??0}</td><td>{r?.FScore??0}</td><td>{r?.TScore??0}</td><td>{r?.MScore??0}</td><td><strong>{r?.riskScore??0}</strong></td><td>{r&&<RiskBadge grade={r.riskGrade}/>}</td></tr>})}</tbody></table></div>}</section></div>;
}
