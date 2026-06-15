export type TmSourceType = 'current_excel' | 'history_only' | 'manual_added';
export type RiskGrade = '정상' | '관찰' | '주의' | '위험';
export interface TmMaster { serialNo:string; manufacturer:string; manufactureYear:number|null; ageYear:number; currentStatus:string; isSpare:boolean; currentTrain:string; currentCar:string; currentPosition:string; installDate:string; sourceType:TmSourceType; note?:string; createdAt:string; updatedAt:string; }
export interface SeverityMaster { failureType:string; severityClass:string; severityScore:number; description:string; isActive:boolean; }
