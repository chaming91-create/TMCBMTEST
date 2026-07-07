import { useEffect, useMemo, useState } from 'react';
import { Save } from 'lucide-react';
import { useApp } from '../context/AppContext';
import type { ReplacementHistory } from '../types/replacement';
import type { TmMaster } from '../types/tm';

const empty = {
  replacementDate: '',
  trainNo: '',
  carNo: '',
  position: '',
  removedSerialNo: '',
  removedStatus: '취거',
  installedSerialNo: '',
  installedStatus: '운행중',
  replacementReason: '',
  failureType: '',
  severityClass: '',
  severityScore: '',
  detail: '',
  actionTaken: '',
  note: '',
};

type SerialMode = 'existing' | 'new';
type FormKey = keyof typeof empty;

function SerialChooser({
  label,
  mode,
  serial,
  tms,
  onMode,
  onSerial,
}: {
  label: string;
  mode: SerialMode;
  serial: string;
  tms: TmMaster[];
  onMode: (mode: SerialMode) => void;
  onSerial: (serial: string) => void;
}) {
  const [query, setQuery] = useState('');
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const rows = q ? tms.filter(tm => `${tm.serialNo} ${tm.currentTrain} ${tm.currentPosition} ${tm.currentStatus}`.toLowerCase().includes(q)) : tms;
    return rows.slice(0, 80);
  }, [query, tms]);

  return <div className="serial-picker">
    <div className="serial-picker-head">
      <strong>{label}<b>*</b></strong>
      <div className="segmented">
        <button type="button" className={mode === 'existing' ? 'active' : ''} onClick={() => onMode('existing')}>기존 선택</button>
        <button type="button" className={mode === 'new' ? 'active' : ''} onClick={() => onMode('new')}>신규 입력</button>
      </div>
    </div>
    {mode === 'existing' ? <>
      <input className="serial-search" value={query} onChange={event => setQuery(event.target.value)} placeholder="시리얼, 편성, 위치 검색" />
      <div className="serial-options">
        {filtered.map(tm => <label key={tm.serialNo} className={serial === tm.serialNo ? 'checked' : ''}>
          <input type="checkbox" checked={serial === tm.serialNo} onChange={event => onSerial(event.target.checked ? tm.serialNo : '')} />
          <span>{tm.serialNo}</span>
          <small>{[tm.currentStatus, tm.currentTrain, tm.currentPosition].filter(Boolean).join(' · ') || '위치 정보 없음'}</small>
        </label>)}
        {!filtered.length && <p>검색 결과가 없습니다.</p>}
      </div>
    </> : <input value={serial} onChange={event => onSerial(event.target.value)} placeholder="신규 시리얼번호 직접 입력" />}
  </div>;
}

function AutoField({ label, value, emptyText = '자동 입력 대기' }: { label: string; value: string; emptyText?: string }) {
  return <label>{label}<div className={`readonly-field ${value ? '' : 'empty'}`} aria-readonly="true">{value || emptyText}</div></label>;
}

export default function ReplacementInputForm({ onSaved }: { onSaved: () => void }) {
  const { tms, severities, addReplacement } = useApp();
  const [form, setForm] = useState(empty);
  const [removedMode, setRemovedMode] = useState<SerialMode>('existing');
  const [installedMode, setInstalledMode] = useState<SerialMode>('existing');
  const [autoLocation, setAutoLocation] = useState(false);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const set = (key: FormKey, value: string) => setForm(current => ({ ...current, [key]: value }));
  const removedTm = useMemo(() => tms.find(tm => tm.serialNo === form.removedSerialNo), [tms, form.removedSerialNo]);

  useEffect(() => {
    if (removedMode !== 'existing' || !removedTm) {
      setAutoLocation(false);
      return;
    }
    setForm(current => ({
      ...current,
      trainNo: removedTm.currentTrain || '',
      carNo: removedTm.currentCar || removedTm.currentUnit || '',
      position: removedTm.currentPosition || '',
    }));
    setAutoLocation(true);
  }, [removedMode, removedTm]);

  const chooseFailureType = (value: string) => {
    const severity = severities.find(item => item.failureType === value);
    setForm(current => ({
      ...current,
      failureType: value,
      severityClass: severity?.severityClass || '',
      severityScore: severity ? String(severity.severityScore) : '',
    }));
  };

  const updateSerialMode = (target: 'removed' | 'installed', mode: SerialMode) => {
    if (target === 'removed') {
      setRemovedMode(mode);
      set('removedSerialNo', '');
      if (mode === 'new') setAutoLocation(false);
    } else {
      setInstalledMode(mode);
      set('installedSerialNo', '');
    }
  };

  return <section className="panel form-panel">
    <div className="form-title">
      <div><h2>신규 교체정보 등록</h2><p>기존 부품은 체크박스로 선택하고, 신규 부품은 시리얼번호를 직접 입력합니다.</p></div>
      <span>필수 항목 *</span>
    </div>
    <form onSubmit={async event => {
      event.preventDefault();
      if (!form.replacementDate || (!form.removedSerialNo && !form.installedSerialNo)) {
        setError('교체일자와 취거/취부 시리얼번호 중 하나 이상을 입력하세요.');
        return;
      }
      if (!form.trainNo || !form.position) {
        setError('편성과 위치를 확인하세요. 기존 시리얼 선택 시 자동 입력되며, 신규 입력 시 직접 입력해야 합니다.');
        return;
      }
      setSaving(true);
      setError('');
      const now = new Date().toISOString();
      const severity = severities.find(item => item.failureType === form.failureType);
      const item: ReplacementHistory = {
        ...form,
        replacementId: crypto.randomUUID(),
        failureCode: severity?.failureCode || '',
        severityScore: form.severityScore ? Number(form.severityScore) : severity?.severityScore ?? null,
        inputSource: 'manual',
        createdAt: now,
        updatedAt: now,
      };
      await addReplacement(item);
      setSaving(false);
      onSaved();
    }}>
      <div className="form-grid">
        <label>교체일자<b>*</b><input type="date" value={form.replacementDate} onChange={event => set('replacementDate', event.target.value)} /></label>
        {autoLocation ? <>
          <AutoField label="편성" value={form.trainNo} />
          <AutoField label="호차" value={form.carNo} emptyText="자동 입력값 없음" />
          <AutoField label="위치" value={form.position} />
        </> : <>
          <label>편성<b>*</b><input value={form.trainNo} onChange={event => set('trainNo', event.target.value)} /></label>
          <label>호차<input value={form.carNo} onChange={event => set('carNo', event.target.value)} /></label>
          <label>위치<b>*</b><input value={form.position} onChange={event => set('position', event.target.value)} /></label>
        </>}
      </div>
      {autoLocation && <div className="auto-note">편성/호차/위치는 선택한 취거 시리얼의 현재 위치에서 자동 입력되었습니다.</div>}
      <div className="serial-grid">
        <SerialChooser label="취거 TM Serial No." mode={removedMode} serial={form.removedSerialNo} tms={tms} onMode={mode => updateSerialMode('removed', mode)} onSerial={value => set('removedSerialNo', value)} />
        <SerialChooser label="취부 TM Serial No." mode={installedMode} serial={form.installedSerialNo} tms={tms} onMode={mode => updateSerialMode('installed', mode)} onSerial={value => set('installedSerialNo', value)} />
      </div>
      <div className="form-grid">
        <label>취거품 상태<input value={form.removedStatus} onChange={event => set('removedStatus', event.target.value)} /></label>
        <label>취부품 상태<input value={form.installedStatus} onChange={event => set('installedStatus', event.target.value)} /></label>
        <label>교체사유<input value={form.replacementReason} onChange={event => set('replacementReason', event.target.value)} /></label>
        <label>고장유형<select value={form.failureType} onChange={event => chooseFailureType(event.target.value)}><option value="">선택</option>{severities.filter(item => item.isActive).map(item => <option key={item.failureType}>{item.failureType}</option>)}</select></label>
        <AutoField label="고장심각도" value={form.severityClass} />
        <AutoField label="심각도 점수" value={form.severityScore} />
      </div>
      {([['detail', '세부 고장내용'], ['actionTaken', '조치내용'], ['note', '비고']] as const).map(([key, label]) => <label className="textarea-label" key={key}>{label}<textarea rows={3} value={form[key]} onChange={event => set(key, event.target.value)} /></label>)}
      {error && <div className="form-error">{error}</div>}
      <div className="form-actions"><button type="button" onClick={() => { setForm(empty); setAutoLocation(false); }}>입력 초기화</button><button className="primary" disabled={saving}><Save />{saving ? '저장 중...' : '교체정보 저장'}</button></div>
    </form>
  </section>;
}
