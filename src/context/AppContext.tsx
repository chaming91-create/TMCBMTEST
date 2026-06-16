import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { TmMaster, SeverityMaster } from '../types/tm';
import type { ReplacementHistory } from '../types/replacement';
import type { RiskScore, RiskSettings, ValidationIssue, AuditLog } from '../types/risk';
import { DEFAULT_SETTINGS, DEFAULT_SEVERITIES } from '../lib/defaults';
import { calculateAllRisks } from '../lib/riskCalculator';
import { validateData } from '../lib/validators';
import { addAudit, backupDatabase, replaceHistoryData, replaceTmData, saveReplacementAtomic, saveSettings as saveRemoteSettings, subscribeCollection } from '../lib/firestoreService';
import { firebaseConfigured } from '../lib/firebase';

interface State { tms: TmMaster[]; history: ReplacementHistory[]; risks: RiskScore[]; severities: SeverityMaster[]; settings: RiskSettings; issues: ValidationIssue[]; setTmImport: (v: TmMaster[], note?: string) => Promise<void>; setHistoryImport: (v: ReplacementHistory[], note?: string, severityOverride?: SeverityMaster[]) => Promise<void>; addReplacement: (v: ReplacementHistory) => Promise<void>; updateSettings: (s: RiskSettings, sm: SeverityMaster[]) => Promise<void>; log: (eventType: string, targetTable: string, serialNo: string, beforeValue: unknown, afterValue: unknown, note: string) => Promise<void>; }
const C = createContext<State | null>(null);
const load = <T,>(key: string, fallback: T): T => { try { return JSON.parse(localStorage.getItem(key) || '') as T; } catch { return fallback; } };

export function AppProvider({ children }: { children: ReactNode }) {
  const [tms, setTms] = useState<TmMaster[]>(() => load('cbm_tms', []));
  const [history, setHistory] = useState<ReplacementHistory[]>(() => load('cbm_history', []));
  const [severities, setSeverities] = useState<SeverityMaster[]>(() => load('cbm_severities', DEFAULT_SEVERITIES));
  const [settings, setSettings] = useState<RiskSettings>(() => load('cbm_settings', DEFAULT_SETTINGS));
  const risks = useMemo(() => calculateAllRisks(tms, history, severities, settings), [tms, history, severities, settings]);
  const issues = useMemo(() => validateData(tms, history, severities, settings), [tms, history, severities, settings]);

  useEffect(() => {
    if (!firebaseConfigured) return;
    const stops = [
      subscribeCollection<TmMaster>('tm_master', setTms),
      subscribeCollection<ReplacementHistory>('replacement_history', setHistory),
      subscribeCollection<SeverityMaster>('severity_master', (items) => { if (items.length) setSeverities(items); }),
      subscribeCollection<RiskSettings>('settings', (items) => { if (items.length) setSettings(items[0]); }),
    ];
    return () => stops.forEach(stop => stop());
  }, []);
  useEffect(() => localStorage.setItem('cbm_tms', JSON.stringify(tms)), [tms]);
  useEffect(() => localStorage.setItem('cbm_history', JSON.stringify(history)), [history]);
  useEffect(() => localStorage.setItem('cbm_settings', JSON.stringify(settings)), [settings]);
  useEffect(() => localStorage.setItem('cbm_severities', JSON.stringify(severities)), [severities]);

  const log = async (eventType: string, targetTable: string, targetSerialNo: string, beforeValue: unknown, afterValue: unknown, userNote: string) => {
    const entry: AuditLog = { logId: crypto.randomUUID(), eventTime: new Date().toISOString(), eventType, targetTable, targetSerialNo, beforeValue, afterValue, userNote };
    const logs = load<AuditLog[]>('cbm_audit', []);
    localStorage.setItem('cbm_audit', JSON.stringify([entry, ...logs].slice(0, 1000)));
    await addAudit(entry);
  };
  const setTmImport = async (value: TmMaster[], note = '취부현황 엑셀 업로드') => {
    await backupDatabase({ tms, history, risks, severities, settings });
    const nextRisks = calculateAllRisks(value, history, severities, settings);
    setTms(value); await replaceTmData(value, nextRisks); await log('EXCEL_IMPORT', 'tm_master', '', tms, value, note);
  };
  const setHistoryImport = async (value: ReplacementHistory[], note = '교체현황 엑셀 업로드', severityOverride?: SeverityMaster[]) => {
    await backupDatabase({ tms, history, risks, severities, settings });
    const effectiveSeverities = severityOverride?.length ? severityOverride : severities;
    if (severityOverride?.length) setSeverities(severityOverride);
    const now = new Date().toISOString();
    const bySerial = new Map(tms.map(tm => [tm.serialNo, { ...tm }]));
    const ensureTm = (serialNo: string, manufacturer = '', manufactureYear: number | null = null) => {
      const serial = serialNo.trim();
      if (!serial || serial === '-') return null;
      const found = bySerial.get(serial);
      if (found) {
        if (!found.manufacturer && manufacturer) found.manufacturer = manufacturer;
        if (!found.manufactureYear && manufactureYear) {
          found.manufactureYear = manufactureYear;
          found.ageYear = Math.max(0, settings.referenceYear - manufactureYear);
        }
        found.updatedAt = now;
        return found;
      }
      const tm: TmMaster = { serialNo: serial, manufacturer, manufactureYear, ageYear: manufactureYear ? Math.max(0, settings.referenceYear - manufactureYear) : 0, currentStatus: '이력만 존재', isSpare: false, currentTrain: '', currentCar: '', currentPosition: '', installDate: '', sourceType: 'history_only', createdAt: now, updatedAt: now };
      bySerial.set(serial, tm);
      return tm;
    };
    [...value].sort((a, b) => (a.replacementDate || '').localeCompare(b.replacementDate || '')).forEach(row => {
      const removed = ensureTm(row.removedSerialNo, row.removedManufacturer || '', row.removedManufactureYear ?? null);
      if (removed) {
        removed.currentStatus = row.removedStatus || '취거';
        removed.isSpare = false;
        removed.currentTrain = '';
        removed.currentCar = '';
        removed.currentPosition = '';
        removed.updatedAt = now;
      }
      const installed = ensureTm(row.installedSerialNo, row.installedManufacturer || '', row.installedManufactureYear ?? null);
      if (installed) {
        installed.currentStatus = row.installedStatus || '운행중';
        installed.isSpare = false;
        installed.currentTrain = row.trainNo;
        installed.currentCar = row.carNo;
        installed.currentPosition = row.position;
        installed.installDate = row.replacementDate;
        installed.updatedAt = now;
      }
    });
    const nextTms = Array.from(bySerial.values()), nextRisks = calculateAllRisks(nextTms, value, effectiveSeverities, settings);
    setTms(nextTms); setHistory(value); await replaceTmData(nextTms, nextRisks); await replaceHistoryData(value, nextRisks); await log('EXCEL_IMPORT', 'replacement_history', '', history, value, note);
  };
  const addReplacement = async (value: ReplacementHistory) => {
    const now = new Date().toISOString();
    let foundInstalled = false;
    const next = tms.map(tm => { if (tm.serialNo === value.removedSerialNo) return { ...tm, currentStatus: value.removedStatus || '취거', currentTrain: '', currentCar: '', currentPosition: '', updatedAt: now }; if (tm.serialNo === value.installedSerialNo) { foundInstalled = true; return { ...tm, currentStatus: value.installedStatus || '운행중', isSpare: false, currentTrain: value.trainNo, currentCar: value.carNo, currentPosition: value.position, installDate: value.replacementDate, updatedAt: now }; } return tm; });
    if (value.installedSerialNo && !foundInstalled) next.push({ serialNo: value.installedSerialNo, manufacturer: '', manufactureYear: null, ageYear: 0, currentStatus: value.installedStatus || '운행중', isSpare: false, currentTrain: value.trainNo, currentCar: value.carNo, currentPosition: value.position, installDate: value.replacementDate, sourceType: 'manual_added', createdAt: now, updatedAt: now });
    const nextHistory = [value, ...history], nextRisks = calculateAllRisks(next, nextHistory, severities, settings);
    setTms(next); setHistory(nextHistory); await saveReplacementAtomic(value, next, nextRisks); await log('MANUAL_REPLACEMENT', 'replacement_history', value.removedSerialNo, null, value, '신규 교체정보 입력');
  };
  const updateSettings = async (value: RiskSettings, masters: SeverityMaster[]) => { setSettings(value); setSeverities(masters); const next = calculateAllRisks(tms, history, masters, value); await saveRemoteSettings(value, masters, next); await log('SETTINGS_UPDATE', 'settings', '', settings, value, '리스크 설정 변경 및 재계산'); };
  return <C.Provider value={{ tms, history, risks, severities, settings, issues, setTmImport, setHistoryImport, addReplacement, updateSettings, log }}>{children}</C.Provider>;
}
export const useApp = () => { const value = useContext(C); if (!value) throw new Error('AppProvider가 필요합니다.'); return value; };
