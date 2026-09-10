# AI 주요부품 관리 프로그램

견인전동기 취부현황, 교체이력, 고장심각도, MKBF 기반 위험도를 통합 관리하는 React + TypeScript + Firebase 웹앱입니다. 화면과 다운로드 컬럼은 한글로 제공됩니다.

## 주요 기능

- 취부현황/교체현황 엑셀 업로드, 시트 선택, 제목행 자동 감지, 컬럼 자동·수동 매핑
- 업로드 미리보기 및 중복 시리얼, 중복 위치, 연도, 날짜, 심각도 등 데이터 검증
- Firestore 반영 전 자동 백업, 원본 엑셀 Firebase Storage 보관, 변경이력 저장
- 신규 교체 입력 시 취거/취부 TM 상태와 위치 동시 갱신
- Weibull 노후도, Empirical-Bayes 고장빈도, 심각도 누적, MKBF 기반 위험도 자동 계산
- 9개 한글 화면, 대시보드 차트, 상세이력, 설정값 변경 및 전체 재계산
- TM 현황, 교체현황, 위험도, 검증결과 및 통합 엑셀 다운로드

## 빠른 실행

필요 환경은 Node.js 20 이상입니다.

```bash
npm install
npm run dev
```

터미널에 표시되는 로컬 주소를 브라우저에서 엽니다. 기존 Firebase 프로젝트의 환경변수와 이메일/비밀번호 계정이 필요합니다. Firebase 미설정 시 운영자료 입력을 차단하며 브라우저 데모 자료로 대체하지 않습니다. 검증용 빌드는 `npm run build:verify`로 실행할 수 있지만 운영 배포용으로 사용하면 안 됩니다.

프로덕션 빌드 확인:

```bash
npm run build
npm run preview
```

## Cloudflare Pages 배포

Cloudflare Pages에서 GitHub 저장소를 연결한 뒤 빌드 설정을 다음처럼 지정합니다.

- Build command: `npm run build`
- Build output directory: `dist`
- Root directory: 비워 둠

배포된 HTML에 `/src/main.tsx`가 보이면 루트 디렉터리를 잘못 배포한 것입니다. Pages 설정에서 Output directory를 `dist`로 다시 지정하고 재배포하세요. 저장소에는 루트 배포 fallback도 포함되어 있어 잘못된 루트 배포에서도 앱 파일을 불러오도록 보강되어 있습니다.

Firebase 실사용 모드가 필요하면 Cloudflare Pages의 Settings > Environment variables에 `.env.example`의 `VITE_FIREBASE_*` 값을 추가한 뒤 다시 배포합니다. 값이 없으면 운영 빌드가 실패하여 배포를 차단합니다.

## Firebase 설정

1. Firebase Console에서 **현재 사용 중인 기존 프로젝트**를 선택합니다. 새 프로젝트를 임의로 만들지 않습니다.
2. Authentication에서 이메일/비밀번호 로그인을 활성화하고 사용자를 추가합니다.
3. Firestore Database와 Storage를 생성합니다.
4. 프로젝트 설정에서 웹 앱을 추가하고 Firebase 구성값을 확인합니다.
5. `.env.example`을 참고해 프로젝트 루트에 `.env.local`을 만들고 실제 값을 입력합니다.
6. `.firebaserc.example`을 `.firebaserc`로 만들고 프로젝트 ID를 입력합니다.

```bash
npm install -g firebase-tools
firebase login
firebase use --add
npm run build
firebase deploy
```

`firebase deploy`는 Hosting, Firestore 규칙, Storage 규칙을 함께 배포합니다. 운영자료 변경에는 `system/state` 리비전을 함께 갱신하는 트랜잭션이 필요합니다. 전체 복구·초기화·기존 PC 자료 이관에는 Firebase Custom Claim `admin: true`가 필요합니다. 이전 클라이언트의 전체 덮어쓰기는 차단됩니다. 규칙 배포와 웹앱 전환은 동일한 유지보수 창에서 수행하세요.

## Firestore 컬렉션

| 컬렉션 | 문서 ID | 용도 |
|---|---|---|
| `tm_master` | `serialNo` | TM 기본정보와 현재상태 |
| `replacement_history` | `replacementId` | 교체·고장이력 |
| `severity_master` | `failureType` | 고장유형별 심각도 기준 |
| `risk_score` | `serialNo` | 기존 계산 결과 보존용 (새 화면의 기준으로 읽거나 덮어쓰지 않음) |
| `system/state` | 고정 문서 | 공용 리비전, 스키마 버전, 작업 종류 |
| `data_snapshots` | UUID | 백업 메타데이터 및 `chunks` 하위 문서 |
| `audit_log` | `logId` | 입력·업로드·설정 변경이력 |
| `backups` | 타임스탬프 | DB 반영 전 데이터 스냅샷 |
| `settings/risk` | 고정 문서 | 위험도 계산 설정 |

원본 엑셀은 Storage의 `excel-original/` 경로에 저장됩니다.

## 위험도 계산

기본 산식은 다음과 같습니다.

```text
Risk Score = 0.38 × A + 0.34 × F + 0.18 × T + 0.10 × M
```

- A: `100 × [1 - exp(-((age / eta) ^ beta))]`
- F: 제조사·제작연대 그룹별 Empirical-Bayes 보정률을 최댓값 기준 정규화
- T: 시리얼별 심각도 누적합을 최댓값 기준 정규화
- M: `100 × [1 - exp(-(10000 / MKBF))]`

기본값은 기준년도 2026년, beta 3.696, eta 54.58, MKBF 38,533 km/건입니다. 모든 값은 설정 화면에서 수정 후 재계산할 수 있습니다.

## 엑셀 작성 기준

- 첫 번째 시트를 기본 선택하며, 업로드 후 다른 시트로 변경할 수 있습니다.
- 상위 15행 중 값이 가장 많은 행을 컬럼 제목행으로 자동 탐지합니다.
- `Serial No.`, `시리얼번호`, `SERIAL`, `TM번호` 같은 동의어를 자동 인식합니다.
- 자동 매핑이 맞지 않으면 DB 반영 전에 각 컬럼을 직접 변경합니다.
- 날짜는 엑셀 날짜값과 `YYYY-MM-DD`, `YYYY.MM.DD`, `YYYY/MM/DD` 형식을 처리합니다.

## 코드 구조

```text
src/components/       9개 업무 화면과 공통 UI
src/context/          앱 데이터 상태 및 업무 처리 흐름
src/lib/firebase.ts   Firebase 초기화
src/lib/excelParser.ts 엑셀 읽기/변환/내보내기
src/lib/riskCalculator.ts 위험도 계산
src/lib/validators.ts 데이터 정합성 검증
src/lib/firestoreService.ts Firestore/Storage 저장
src/lib/columnMapper.ts 컬럼 동의어와 자동 매핑
src/types/            TM, 교체, 위험도 타입
```

## 유지보수

- 고장유형과 심각도는 설정 화면에서 관리합니다.
- 산식 변경 시 `src/lib/riskCalculator.ts`와 `formulaVersion`을 함께 변경합니다.
- 개별 운행거리 데이터가 추가되면 `calculateMkbfScore()`에 TM별 MKBF를 전달하도록 확장합니다.
- 컬럼 동의어는 `src/lib/columnMapper.ts`의 별칭 목록에 추가합니다.
- 운영 전 Firestore 복합 인덱스와 역할별 보안 규칙을 실제 조회 패턴에 맞춰 보강합니다.
- 정기적으로 `backups`, `audit_log`, Storage 원본 파일의 보존기간과 비용을 점검합니다.

## 업로드 보안 주의

현재 npm의 `xlsx` 0.18.5에는 수정 버전이 없는 알려진 Prototype Pollution/ReDoS 경고가 있습니다. 앱은 파일 크기를 20MB로 제한하지만, 운영 환경에서는 로그인한 내부 사용자의 신뢰할 수 있는 엑셀만 업로드하도록 제한하세요. 외부 불특정 사용자의 파일을 받는 서비스로 확장할 때는 서버 격리 파싱 또는 보안 패치가 유지되는 대체 파서를 검토해야 합니다.


## 공용 저장 및 교체 처리 (스키마 2)

- `tm_master/{serialNo}`를 유지합니다. `serialNo`는 물리 부품의 식별자이며 기존 `tmId`, 제조정보, 생성일을 교체 시 보존합니다. 동일한 위치 또는 과거 TM_ID를 사용했다는 이유로 다른 시리얼을 제거하지 않습니다.
- A 취거 시 위치를 해제하고 예비품으로 전환합니다. 취거사유·취거일·점검 상태를 A에 저장하며 불용도 객체를 삭제하지 않고 상태로 보존합니다. B에는 새 취부 위치·일자만 적용하고 자체 이력·점검 상태는 유지합니다.
- 양쪽 시리얼이 연결된 `replacement_history/{replacementId}`와 변경 부품, 감사기록, 공용 리비전을 하나의 트랜잭션으로 저장합니다. 같은 부품 또는 위치를 동시에 교체하려는 입력은 거절합니다. 서로 다른 부품 변경은 서버 최신 상태에서 재시도합니다.
- 전체 컬렉션 삭제 후 재작성하는 저장은 제거했습니다. 업로드도 변경된 문서만 원자적으로 반영합니다. 트랜잭션 제한을 초과하는 입력은 분할 저장하지 않고 실패시켜 부분 반영을 방지합니다.
- `onSnapshot(system/state)` 변경 후 서버에서 전체 일관된 리비전을 조회합니다. 미확정 로컬 쓰기나 오프라인 캐시를 저장 성공으로 표시하지 않습니다.
- 위험도는 Firebase에 저장된 부품·교체이력·설정·심각도에서 계산합니다. 개인 고장이력/T점수/고장자료 불확실성은 취거 시리얼에만 연결합니다. 기존 제조군별 F점수 통계 산식은 유지하므로 같은 제조군의 통계적 위험도는 그룹 자료 변경에 따라 재계산될 수 있습니다.
- 빈 DB 접속 시 TM 샘플을 자동 생성하지 않습니다. 기본 계산설정은 최초 저장 시 문서가 없을 때만 기록합니다. 이후에는 서버 자료만 사용합니다.

## 기존 운영자료 보존과 이관

1. 기존 Firebase 운영자료를 먼저 백업하고 컬렉션과 문서 ID가 위 구조와 일치하는지 확인합니다.
2. 기존 DB가 있으면 바로 서버 자료를 읽습니다. 원본 엑셀과 기존 Firestore 문서를 삭제하지 않습니다.
3. 이전 버전에서 PC에만 저장한 자료는 해당 PC의 브라우저에 남겨 둡니다. 관리자가 데이터 세이브/로드 화면의 **기존 PC 자료 이관**을 실행하면 백업 후 빈 공용 DB에만 원자적으로 이관합니다. 공용 DB에 자료가 있으면 거절하며 자동 병합하지 않습니다.
4. 여러 PC의 로컬 자료가 다르면 각각 백업하여 비교한 후 이관해야 합니다. 과거 버전에서 이미 삭제된 부품의 고유 ID는 원본 자료 없이 추측하여 생성하지 않습니다.
5. 기존 상태 오류의 자동 소급 정정은 하지 않습니다. 기존 교체이력과 현황을 비교하여 확인된 행만 정정·업로드합니다. 이력이 불명확한 부품을 임의로 정상 예비품으로 바꾸지 않습니다.
6. Save는 전체 공용자료의 백업입니다. Load는 관리자 전용이며 확인창, 복구 전 백업, 리비전 검사를 거칩니다. 백업은 문서 크기 제한을 피하도록 조각으로 저장하고 완료 메타데이터가 있는 자료만 복구합니다.

## 자동 검증

```bash
npm test
npm run build:verify
# 별도 터미널, 운영 Firebase 프로젝트와 분리된 로컬 에뮬레이터
firebase emulators:start --project demo-tm-regression --only auth,firestore
npm run test:rules
npm run test:integration
npx playwright install chromium
npm run test:e2e
```

에뮬레이터는 Java 21이 필요합니다. 테스트의 이메일/비밀번호와 Firebase 설정은 로컬 에뮬레이터 전용 더미 값이며 운영 인증정보가 아닙니다. 규칙 테스트와 브라우저 테스트는 같은 에뮬레이터 DB를 초기화하므로 병렬 실행하지 않습니다. `npm test`는 SDK 모사 단위 테스트, `test:rules`는 실제 규칙 검증, `test:e2e`는 실제 Chromium과 에뮬레이터 통합 검증입니다.

정상 운영 빌드에는 기존 `VITE_FIREBASE_*` 값이 필요합니다. Cloudflare Pages의 기존 프로젝트에서 Build command `npm run build`, Output directory `dist`를 사용하고, 배포 후 `/deployment.json`의 커밋이 배포 대상과 일치하는지 확인합니다. 저장소 루트 fallback 자산은 운영 Firebase 설정을 포함한 정상 빌드에서만 갱신하여 사용합니다.
