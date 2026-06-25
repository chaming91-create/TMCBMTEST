export type TmSourceType = 'current_excel' | 'history_only' | 'manual_added';
export type RiskGrade = '정상' | '관찰' | '주의' | '위험';
export type LocationSource = '현황파일' | '교체현황 최신 부착이력' | '웹앱 신규 입력' | '확인필요' | '위치확인필요';
export interface TmMaster { serialNo:string; manufacturer:string; manufactureYear:number|null; ageYear:number; currentStatus:string; isSpare:boolean; currentTrain:string; currentCar:string; currentPosition:string; installDate:string; sourceType:TmSourceType; tmId?:string; currentUnit?:string; locationSource?:LocationSource; inferredFromReplacement?:boolean; inferredReplacementDate?:string; locationDateMismatch?:boolean; locationDateWarning?:string; note?:string; createdAt:string; updatedAt:string; }
export interface SeverityMaster { failureCode?:string; failureType:string; severityClass:string; severityScore:number; description:string; isActive:boolean; }
