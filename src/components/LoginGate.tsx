import { useEffect, useState, type ReactNode } from 'react';
import { onAuthStateChanged, signInWithEmailAndPassword, signOut, type User } from 'firebase/auth';
import { LockKeyhole, TrainFront } from 'lucide-react';
import { auth, firebaseConfigured } from '../lib/firebase';

const APP_PASSCODE = '6241';
const PASSCODE_KEY = 'ai_parts_passcode_ok';

export default function LoginGate({ children }: { children: ReactNode }) {
  const [passcodeOk, setPasscodeOk] = useState(() => sessionStorage.getItem(PASSCODE_KEY) === 'Y');
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(Boolean(auth));
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [passcode, setPasscode] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    if (!auth) return;
    return onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser);
      setLoading(false);
    });
  }, []);

  const logout = () => {
    sessionStorage.removeItem(PASSCODE_KEY);
    setPasscodeOk(false);
    setPasscode('');
    if (auth && user) void signOut(auth);
  };

  if (!passcodeOk) {
    return <div className="login-page">
      <form className="login-card" onSubmit={(event) => {
        event.preventDefault();
        setError('');
        if (passcode === APP_PASSCODE) {
          sessionStorage.setItem(PASSCODE_KEY, 'Y');
          setPasscodeOk(true);
          return;
        }
        setError('비밀번호를 확인하세요.');
      }}>
        <div className="login-logo"><TrainFront /></div>
        <h1>AI 주요부품 관리 프로그램 접근 확인</h1>
        <p>비밀번호를 아는 사용자만 접근할 수 있습니다.</p>
        <label>비밀번호<input type="password" inputMode="numeric" autoComplete="current-password" value={passcode} onChange={(event) => setPasscode(event.target.value)} required autoFocus /></label>
        {error && <div className="form-error">{error}</div>}
        <button className="primary wide"><LockKeyhole />입장</button>
      </form>
    </div>;
  }

  if (loading) return <div className="splash">로그인 상태 확인 중...</div>;
  if (firebaseConfigured && !user) {
    return <div className="login-page">
      <form className="login-card" onSubmit={async (event) => {
        event.preventDefault();
        setError('');
        try {
          await signInWithEmailAndPassword(auth!, email, password);
        } catch {
          setError('이메일 또는 비밀번호를 확인하세요.');
        }
      }}>
        <div className="login-logo"><TrainFront /></div>
        <h1>AI 주요부품 관리 프로그램 로그인</h1>
        <p>승인된 사용자만 접근할 수 있습니다.</p>
        <label>이메일<input type="email" value={email} onChange={(event) => setEmail(event.target.value)} required /></label>
        <label>비밀번호<input type="password" value={password} onChange={(event) => setPassword(event.target.value)} required /></label>
        {error && <div className="form-error">{error}</div>}
        <button className="primary wide"><LockKeyhole />로그인</button>
      </form>
    </div>;
  }

  return <><button className="logout" onClick={logout}>{firebaseConfigured && user ? `${user.email} · ` : ''}로그아웃</button>{children}{!firebaseConfigured && <div className="demo-banner">Firebase 환경변수가 없어 로컬 데모 모드로 실행 중입니다.</div>}</>;
}
