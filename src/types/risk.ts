import type { RiskGrade } from './tm';
export interface RiskScore { serialNo:string; AScore:number; FScore:number; TScore:number; MScore:number; riskScore:number; riskGrade:RiskGrade; calculatedAt:string; formulaVersion:string; }
export interface RiskSettings { referenceYear:number; weibullBeta:number; weibullEta:number; mkbf:number; alpha:number; weights:{A:number;F:number;T:number;M:number}; thresholds:{observation:number;caution:number;danger:number}; failureKeywords:string[]; formulaVersion:string; }
export interface AuditLog { logId:string; eventTime:string; eventType:string; targetTable:string; targetSerialNo:string; beforeValue:unknown; afterValue:unknown; userNote:string; }
export interface ValidationIssue { id:string; level:'오류'|'경고'|'안내'; category:string; sheetName?:string; row?:number; serialNo?:string; message:string; recommendation?:string; }
