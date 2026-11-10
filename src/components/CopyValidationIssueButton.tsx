import { useEffect, useState } from 'react';
import { Copy } from 'lucide-react';
import type { ValidationIssue } from '../types/risk';
import { validationIssueText } from '../lib/validationIssueText';
import './CopySerialButton.css';

export default function CopyValidationIssueButton({ issue }: { issue: ValidationIssue }) {
  const [message, setMessage] = useState('');
  const [copying, setCopying] = useState(false);
  useEffect(() => {
    if (!message) return;
    const timer = window.setTimeout(() => setMessage(''), 3000);
    return () => window.clearTimeout(timer);
  }, [message]);
  return <>
    <button type="button" className="copy-serial-button" title="오류정보 복사" aria-label="오류정보 복사" disabled={copying} onClick={async event => {
      event.stopPropagation();
      setMessage('');
      setCopying(true);
      try {
        await navigator.clipboard.writeText(validationIssueText(issue));
        setMessage('오류정보가 복사되었습니다');
      } catch {
        setMessage('오류정보를 복사하지 못했습니다. 클립보드 사용 권한을 확인해 주세요.');
      } finally {
        setCopying(false);
      }
    }}><Copy size={16} aria-hidden="true" /><span>복사</span></button>
    {message && <span className="copy-serial-message" role="status" aria-live="polite">{message}</span>}
  </>;
}
