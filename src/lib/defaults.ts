import type { SeverityMaster } from '../types/tm';
import type { RiskSettings } from '../types/risk';
export const DEFAULT_SETTINGS:RiskSettings={referenceYear:2026,weibullBeta:3.696,weibullEta:54.58,mkbf:38533,alpha:5,weights:{A:.38,F:.34,T:.18,M:.1},thresholds:{observation:40,caution:60,danger:80},failureKeywords:['고장','소손','단락','절연','베어링','진동','이상','파손'],formulaVersion:'1.0'};
export const DEFAULT_SEVERITIES:SeverityMaster[]=[
{failureType:'베어링 이상',severityClass:'B',severityScore:60,description:'베어링 소음, 진동 또는 손상',isActive:true},
{failureType:'절연 불량',severityClass:'A',severityScore:90,description:'권선 또는 절연 성능 저하',isActive:true},
{failureType:'권선 소손',severityClass:'A',severityScore:100,description:'권선 소손 및 단락',isActive:true},
{failureType:'진동 과다',severityClass:'B',severityScore:55,description:'허용 기준 초과 진동',isActive:true},
{failureType:'일반 정비',severityClass:'C',severityScore:20,description:'예방 또는 일반 정비',isActive:true}];
