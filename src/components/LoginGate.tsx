import { useEffect, useState, type ReactNode } from 'react';
import { onAuthStateChanged, signInWithEmailAndPassword, signOut, type User } from 'firebase/auth';
import { LockKeyhole, TrainFront } from 'lucide-react';
import { auth, firebaseConfigured } from '../lib/firebase';

export default function LoginGate({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(Boolean(auth));
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    if (!auth) return;
    return onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser);
      setLoading(false);
    });
  }, []);

  if (loading) return <div className="splash">로그인 상태 확인 중...</div>;
  if (!firebaseConfigured) {
    return <>{children}<div className="demo-banner">Firebase 환경변수가 없어 로컬 데모 모드로 실행 중입니다.</div></>;
  }
  if (!user) {
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
        <h1>TM-CBM 로그인</h1>
        <p>승인된 사용자만 접근할 수 있습니다.</p>
        <label>이메일<input type="email" value={email} onChange={(event) => setEmail(event.target.value)} required /></label>
        <label>비밀번호<input type="password" value={password} onChange={(event) => setPassword(event.target.value)} required /></label>
        {error && <div className="form-error">{error}</div>}
        <button className="primary wide"><LockKeyhole />로그인</button>
      </form>
    </div>;
  }
  return <><button className="logout" onClick={() => signOut(auth!)}>{user.email} · 로그아웃</button>{children}</>;
}
