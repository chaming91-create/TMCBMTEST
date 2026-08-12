import { useEffect, useState } from 'react';
import { Download, Files, LoaderCircle } from 'lucide-react';
import { getUploadedFileUrl, subscribeCollection } from '../lib/firestoreService';
import { firebaseConfigured } from '../lib/firebase';
import type { UploadedFile } from '../types/uploadedFile';

const formatSize = (size: number) => size < 1024 * 1024 ? `${Math.max(1, Math.round(size / 1024)).toLocaleString()} KB` : `${(size / 1024 / 1024).toFixed(1)} MB`;

export default function UploadedFileLibrary() {
  const [files, setFiles] = useState<UploadedFile[]>([]);
  const [opening, setOpening] = useState('');
  const [error, setError] = useState('');
  useEffect(() => {
    if (!firebaseConfigured) return;
    return subscribeCollection<UploadedFile>('uploaded_files', items => setFiles(items.sort((a, b) => b.uploadedAt.localeCompare(a.uploadedAt))));
  }, []);
  const download = async (file: UploadedFile) => {
    setOpening(file.fileId); setError('');
    try {
      const url = await getUploadedFileUrl(file.storagePath);
      const anchor = document.createElement('a'); anchor.href = url; anchor.download = file.name; anchor.rel = 'noopener'; anchor.click();
    } catch { setError('파일을 열지 못했습니다. 로그인 상태와 저장소 권한을 확인해 주세요.'); }
    finally { setOpening(''); }
  };
  return <section className="panel upload-library"><h3><Files/>공용 업로드 자료 <span>{files.length.toLocaleString()}개</span></h3><p className="library-help">등록된 계정으로 접속한 모든 사용자가 같은 원본 자료를 볼 수 있습니다. 새 업로드는 기존 파일을 덮어쓰지 않고 계속 누적됩니다.</p>{error&&<div className="form-error">{error}</div>}{!firebaseConfigured?<div className="library-empty">Firebase 연결 후 업로드 자료가 모든 접속자에게 공유됩니다.</div>:files.length===0?<div className="library-empty">아직 보관된 원본 파일이 없습니다.</div>:<div className="table-wrap"><table><thead><tr><th>업로드 일시</th><th>자료 유형</th><th>파일명</th><th>크기</th><th>받기</th></tr></thead><tbody>{files.map(file=><tr key={file.fileId}><td>{new Date(file.uploadedAt).toLocaleString('ko-KR')}</td><td>{file.type==='tm'?'취부현황':'교체현황'}</td><td>{file.name}</td><td>{formatSize(file.size)}</td><td><button className="file-download" onClick={()=>download(file)} disabled={opening===file.fileId}>{opening===file.fileId?<LoaderCircle className="spin"/>:<Download/>}<span>다운로드</span></button></td></tr>)}</tbody></table></div>}</section>;
}
