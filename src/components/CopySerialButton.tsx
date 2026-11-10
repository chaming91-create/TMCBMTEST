import { useEffect, useState } from 'react';
import { Copy } from 'lucide-react';
import './CopySerialButton.css';

type Props = { serial?: string };

export default function CopySerialButton({ serial }: Props) {
  const [message, setMessage] = useState('');
  const [copying, setCopying] = useState(false);
  useEffect(() => {
    if (!message) return;
    const timer = window.setTimeout(() => setMessage(''), 2500);
    return () => window.clearTimeout(timer);
  }, [message]);

  if (!serial || /^(?:모름|미상|정보 없음|없음|unknown|null|undefined|n\/a|[-?]+)$/i.test(serial.trim()) || !serial.trim()) return null;

  return <>
    <button type="button" className="copy-serial-button" title="시리얼번호 복사" aria-label="시리얼번호 복사" disabled={copying} onClick={async event => {
      event.stopPropagation();
      setMessage('');
      setCopying(true);
      try {
        await navigator.clipboard.writeText(serial);
        setMessage('복사되었습니다');
      } catch {
        setMessage('복사하지 못했습니다. 시리얼번호를 직접 선택해 복사해 주세요.');
      } finally {
        setCopying(false);
      }
    }}><Copy size={16} aria-hidden="true" /></button>
    {message && <span className="copy-serial-message" role="status" aria-live="polite">{message}</span>}
  </>;
}
