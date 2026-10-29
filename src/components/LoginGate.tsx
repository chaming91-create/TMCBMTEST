import { useState,type FormEvent,type ReactNode } from 'react';import { Activity,Eye,EyeOff,LockKeyhole,ShieldCheck,TrainFront } from 'lucide-react';import { firebaseConfigured } from '../lib/firebase';import './LoginGate.css';
const APP_PASSCODE='6241',PASSCODE_KEY='ai_parts_passcode_ok';
type LoginFormProps={password:string;error:string;busy:boolean;showPassword:boolean;onPassword:(value:string)=>void;onToggle:()=>void;onSubmit:(event:FormEvent<HTMLFormElement>)=>void};
function LoginForm({password,error,busy,showPassword,onPassword,onToggle,onSubmit}:LoginFormProps){return <div className="access-shell"><section className="access-visual"><div className="access-orb orb-one"/><div className="access-orb orb-two"/><div className="access-brand"><span><TrainFront/></span><div><b>AI 주요부품 관리</b><small>RAILWAY ASSET INTELLIGENCE</small></div></div><div className="access-message"><span className="access-kicker"><Activity/>SMART MAINTENANCE</span><h1>철도 주요부품의<br/>현재와 이력을 한눈에.</h1><p>취부현황, 교체이력, 위험도 분석을 하나의 안전한 업무 공간에서 관리합니다.</p><div className="access-features"><span><ShieldCheck/>승인된 사용자 전용</span><span><Activity/>실시간 데이터 관리</span></div></div><div className="rail-lines"><i/><i/><i/></div></section><section className="access-form-side"><form className="access-card" onSubmit={onSubmit}><div className="access-card-icon"><LockKeyhole/></div><span className="access-overline">SECURE ACCESS</span><h2>시스템 접근 확인</h2><p>계속하려면 접근 비밀번호를 입력해 주세요.</p><label className="access-field"><span>비밀번호</span><div className="password-field"><input type={showPassword?'text':'password'} inputMode="numeric" autoComplete="current-password" placeholder="••••" value={password} onChange={e=>onPassword(e.target.value)} required autoFocus/><button type="button" onClick={onToggle} aria-label={showPassword?'비밀번호 숨기기':'비밀번호 보기'}>{showPassword?<EyeOff/>:<Eye/>}</button></div></label>{error&&<div className="access-error"><span>!</span>{error}</div>}<button className="access-submit" disabled={busy}><LockKeyhole/>{busy?'확인 중...':'프로그램 입장'}</button><div className="access-security"><ShieldCheck/><span>인증 정보는 안전하게 보호됩니다.</span></div></form><p className="access-footer">AI 주요부품 관리 시스템 · Authorized personnel only</p></section></div>}
export default function LoginGate({children}:{children:ReactNode}) {
  const [passcodeOk,setPasscodeOk]=useState(()=>sessionStorage.getItem(PASSCODE_KEY)==='Y');
  const [passcode,setPasscode]=useState('');
  const [error,setError]=useState('');
  const [showPassword,setShowPassword]=useState(false);
  const logout=()=>{
    sessionStorage.removeItem(PASSCODE_KEY);
    setPasscodeOk(false);
    setPasscode('');
    setError('');
    setShowPassword(false);
  };
  if(!passcodeOk)return <LoginForm password={passcode} error={error} busy={false} showPassword={showPassword} onPassword={value=>{setPasscode(value);setError('')}} onToggle={()=>setShowPassword(value=>!value)} onSubmit={event=>{
    event.preventDefault();
    if(passcode!==APP_PASSCODE){
      setError('비밀번호가 올바르지 않습니다. 다시 확인해 주세요.');
      return;
    }
    sessionStorage.setItem(PASSCODE_KEY,'Y');
    setPasscodeOk(true);
    setPasscode('');
    setShowPassword(false);
  }}/>;
  return <><button className="logout" onClick={logout}>로그아웃</button>{children}{!firebaseConfigured&&<div className="demo-banner">Firebase 환경변수가 없어 로컬 데모 모드로 실행 중입니다.</div>}</>;
}
