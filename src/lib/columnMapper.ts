export type ImportType='tm'|'replacement';
export const TM_FIELDS={tmId:'TM_ID',serialNo:'시리얼번호',manufacturer:'제조사',manufactureYear:'제작년도',currentStatus:'현재상태',isSpare:'예비품 여부',currentTrain:'편성',currentCar:'차호',currentUnit:'위수',currentPosition:'위치',installDate:'교환일자',note:'현황비고'} as const;
export const REPLACEMENT_FIELDS={replacementId:'교체 ID',replacementDate:'교체일자',trainNo:'편성',carNo:'호차',position:'위치',removedSerialNo:'취거 TM 시리얼번호',removedManufactureYear:'취거 TM 제작년도',removedManufacturer:'취거 TM 제조사',removedStatus:'취거품 상태',installedSerialNo:'취부 TM 시리얼번호',installedManufactureYear:'취부 TM 제작년도',installedManufacturer:'취부 TM 제조사',installedStatus:'취부품 상태',replacementReason:'교체사유',failureType:'고장유형',severityClass:'고장심각도',severityScore:'심각도/위험 점수',failureReplacement:'고장성교체여부',detail:'세부 고장내용',actionTaken:'조치내용',note:'비고'} as const;
const aliases:Record<string,string[]>={
  tmId:['tmid','tm_id','tm번호','tmno'],
  serialNo:['serialno','serial','시리얼번호','시리얼','tm시리얼','tmserialno','제조번호'],
  manufacturer:['제조사','제작사','maker','manufacturer'],
  manufactureYear:['제작년도','제조년도','제작연도','생산년도','manufactureyear'],
  currentStatus:['현재상태','상태','운영상태','status'],
  isSpare:['예비품여부','예비품','spare'],
  currentTrain:['편성','편성번호','train','trainno'],
  currentCar:['호차','차량','차호','car','carno'],
  currentUnit:['위수','unit','currentunit'],
  currentPosition:['위치','취부위치','장착위치','position'],
  installDate:['교환일자','취부일자','장착일자','설치일자','installdate'],
  note:['비고','현황비고','note','remark','취거품상태조치비고'],
  replacementId:['교체id','교체아이디','replacementid','id'],
  replacementDate:['교체일자','교환일자','교체일','replacementdate'],
  trainNo:['편성','편성번호','train','trainno'],
  carNo:['호차','차량','차호','car','carno'],
  position:['위치','취부위치','장착위치','position'],
  removedSerialNo:['취거tmserialno','취거tm시리얼','취거tm시리얼번호','취거tm','철거tm','탈거tm','취거시리얼번호','removedserialno'],
  removedManufactureYear:['취거tm제작년도','취거tm제조년도','취거tm제작연도','removedmanufactureyear'],
  removedManufacturer:['취거tm제조사','취거tm제작사','removedmanufacturer'],
  removedStatus:['취거품상태','취거품상태선택','취거상태','removedstatus'],
  installedSerialNo:['취부tmserialno','취부tm시리얼','취부tm시리얼번호','부착tm시리얼','부착tm시리얼번호','부착tm','장착tm','취부tm','취부시리얼번호','installedserialno'],
  installedManufactureYear:['취부tm제작년도','취부tm제조년도','취부tm제작연도','부착tm제작년도','부착tm제조년도','installedmanufactureyear'],
  installedManufacturer:['취부tm제조사','취부tm제작사','부착tm제조사','부착tm제작사','installedmanufacturer'],
  installedStatus:['취부품상태','취부상태','부착상태','installedstatus'],
  replacementReason:['교체사유','교환사유','교체원인','replacementreason'],
  failureType:['고장유형','고장유형선택','고장종류','불량유형','failuretype'],
  severityClass:['고장심각도','심각도','severityclass'],
  severityScore:['심각도점수','위험점수','severityscore'],
  failureReplacement:['고장성교체여부','고장성교체여부자동','failurereplacement','isfailure'],
  detail:['세부고장내용','고장내용','상세내용','detail'],
  actionTaken:['조치내용','정비내용','처리내용','actiontaken']
};
export const normalizeHeader=(v:string)=>v.toLowerCase().replace(/[\s._\-()[\]/\\:·,]+/g,'').replace(/[（）]/g,'');
export function autoMapColumns(headers:string[],type:ImportType){const f=type==='tm'?TM_FIELDS:REPLACEMENT_FIELDS;return Object.keys(f).reduce<Record<string,string>>((o,k)=>{const list=aliases[k]??[k];o[k]=headers.find(h=>list.includes(normalizeHeader(h)))??'';return o;},{});}
export function scoreAutoMap(headers:string[],type:ImportType){const mapping=autoMapColumns(headers,type);const mapped=Object.values(mapping).filter(Boolean).length;const required=type==='tm'?['serialNo']:['replacementDate'];const requiredScore=required.filter(k=>mapping[k]).length*10;const serialScore=type==='replacement'&&mapping.removedSerialNo?6:0;const installedScore=type==='replacement'&&mapping.installedSerialNo?6:0;return mapped+requiredScore+serialScore+installedScore;}
