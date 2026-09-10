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
  filter,
}: {
  label: string;
  mode: SerialMode;
  serial: string;
  tms: TmMaster[];
  onMode: (mode: SerialMode) => void;
  onSerial: (serial: string) => void;
  filter?: (tm: TmMaster) => boolean;
}) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const selected = tms.find(tm => tm.serialNo === serial);
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const source = filter ? tms.filter(filter) : tms;
    const rows = q ? source.filter(tm => `${tm.serialNo} ${tm.currentTrain} ${tm.currentCar} ${tm.currentPosition} ${tm.currentStatus}`.toLowerCase().includes(q)) : source;
    return rows.slice(0, 80);
  }, [query, tms, filter]);
  useEffect(() => { if (serial) setOpen(false); }, [serial]);

  return <div className="serial-picker">
    <div className="serial-picker-head">
      <strong>{label}<b>*</b></strong>
      <div className="segmented">
        <button type="button" className={mode === 'existing' ? 'active' : ''} onClick={() => onMode('existing')}>기존 선택</button>
        <button type="button" className={mode === 'new' ? 'active' : ''} onClick={() => onMode('new')}>신규 입력</button>
      </div>
    </div>
    {mode === 'existing' ? selected && !open ? <div className="selected-serial-card"><div><strong>{selected.serialNo}</strong><span>{selected.isSpare ? '예비품' : `${selected.currentTrain || '-'}편성 · ${selected.currentCar || '-'}호차 · ${selected.currentPosition || '-'}위`}</span><small>현재상태: {selected.currentStatus || '-'}</small></div><button type="button" onClick={() => setOpen(true)}>변경</button></div> : <>
      <input className="serial-search" value={query} onChange={event => setQuery(event.target.value)} placeholder="시리얼, 편성, 차호, 위치 검색" />
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
  const [disposal, setDisposal] = useState(false);
  const set = (key: FormKey, value: string) => setForm(current => ({ ...current, [key]: value }));
  const removedTm = useMemo(() => tms.find(tm => tm.serialNo === form.removedSerialNo), [tms, form.removedSerialNo]);
  const hasSelection = disposal ? Boolean(form.removedSerialNo) : Boolean(form.removedSerialNo && form.installedSerialNo);

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
      <div><span className="step-label">STEP 1 · TM 선택</span><h2>신규 교체정보 등록</h2><p>기존 부품은 체크박스로 선택하고, 신규 부품은 시리얼번호를 직접 입력합니다.</p></div>
      <span>필수 항목 *</span>
    </div>
    <form onSubmit={async event => {
      event.preventDefault();
      if (!form.replacementDate || (!form.removedSerialNo && !form.installedSerialNo)) {
        setError('교체일자와 취거/취부 시리얼번호 중 하나 이상을 입력하세요.');
        return;
      }
      if (!disposal && (!form.trainNo || !form.position)) {
        setError('편성과 위치를 확인하세요. 기존 시리얼 선택 시 자동 입력되며, 신규 입력 시 직접 입력해야 합니다.');
        return;
      }
      setSaving(true);
      setError('');
      const now = new Date().toISOString();
      const severity = severities.find(item => item.failureType === form.failureType);
      const item: ReplacementHistory = {
        ...form,
        removedStatus: disposal ? '불용' : form.removedStatus,
        installedSerialNo: disposal ? '' : form.installedSerialNo,
        installedStatus: disposal ? '' : form.installedStatus,
        replacementReason: disposal && !form.replacementReason ? '불용 처리' : form.replacementReason,
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
      <div className="step-block"><h3>STEP 1 · TM 선택</h3><p>취거 TM과 취부 TM을 먼저 선택하세요.</p><div className="serial-grid">
        <SerialChooser label="취거 TM Serial No." mode={removedMode} serial={form.removedSerialNo} tms={tms} onMode={mode => updateSerialMode('removed', mode)} onSerial={value => set('removedSerialNo', value)} filter={tm => tm.isSpare === false && (tm.currentStatus.includes('운') || tm.currentStatus.includes('운영'))} />
        {!disposal&&<SerialChooser label="취부 TM Serial No." mode={installedMode} serial={form.installedSerialNo} tms={tms} onMode={mode => updateSerialMode('installed', mode)} onSerial={value => set('installedSerialNo', value)} filter={tm => tm.isSpare} />}
      </div></div>
      <div className="step-block step-two"><h3>STEP 2 · 교체·고장정보 입력</h3><p className="auto-note">먼저 취거·취부 부품을 선택하세요. 선택 후 상세 입력란이 활성화됩니다.</p>
      <fieldset disabled={!hasSelection} style={{border: 0, padding: 0, margin: 0, minWidth: 0}}>
      <div className="form-grid">
        <label>{disposal?'불용일자':'교체일자'}<b>*</b><input type="date" value={form.replacementDate} onChange={event => set('replacementDate', event.target.value)} /></label>
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
      <div className="form-grid">
        <label>취거품 상태<input readOnly disabled={disposal} value={disposal?'불용':form.removedStatus} onChange={event => set('removedStatus', event.target.value)} /></label>
        {!disposal&&<label>취부품 상태<input readOnly value={form.installedStatus} onChange={event => set('installedStatus', event.target.value)} /></label>}
        <label>교체사유<input value={form.replacementReason} onChange={event => set('replacementReason', event.target.value)} /></label>
        <label>고장유형<select value={form.failureType} onChange={event => chooseFailureType(event.target.value)}><option value="">선택</option>{severities.filter(item => item.isActive).map(item => <option key={item.failureType}>{item.failureType}</option>)}</select></label>
        <AutoField label="고장심각도" value={form.severityClass} />
        <AutoField label="심각도 점수" value={form.severityScore} />
      </div>
      {([['detail', '세부 고장내용'], ['actionTaken', '조치내용'], ['note', '비고']] as const).map(([key, label]) => <label className="textarea-label" key={key}>{label}<textarea rows={3} value={form[key]} onChange={event => set(key, event.target.value)} /></label>)}
<label className="disposal-toggle"><input type="checkbox" checked={disposal} onChange={event=>{const checked=event.target.checked;setDisposal(checked);if(checked){setInstalledMode('existing');setForm(current=>({...current,installedSerialNo:'',installedStatus:'',removedStatus:'불용',replacementReason:current.replacementReason||'불용 처리'}));}}}/><span><b>불용 처리</b><small>선택한 취거품을 활성 TM 및 위험도 목록에서 삭제하고 이력만 보존합니다.</small></span></label>
            </fieldset></div>
      <div className="step-block step-three"><h3>STEP 3 · 입력내용 확인 및 저장</h3><div className="replacement-summary">취거 <b>{form.removedSerialNo || '-'}</b> → 취부 <b>{form.installedSerialNo || (disposal ? '불용' : '-')}</b><small>{form.replacementDate || '교체일자 미입력'} · {form.failureType || '고장유형 미선택'}</small></div>
      {error && <div className="form-error">{error}</div>}
      <div className="form-actions"><button type="button" onClick={() => { setForm(empty); setAutoLocation(false); setDisposal(false); }}>입력 초기화</button><button className="primary" disabled={saving}><Save />{saving ? '저장 중...' : disposal ? '불용 처리 저장' : '교체정보 저장'}</button></div></div>
    </form>
  </section>;
}
