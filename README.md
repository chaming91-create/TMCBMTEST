# 철도차량 TM 상태기반 모니터링(CBM)

견인전동기 취부현황, 교체이력, 고장심각도, MKBF 기반 위험도를 통합 관리하는 React + TypeScript + Firebase 웹앱입니다. 화면과 다운로드 컬럼은 한글로 제공됩니다.

## 주요 기능

- 취부현황/교체현황 엑셀 업로드, 시트 선택, 제목행 자동 감지, 컬럼 자동·수동 매핑
- 업로드 미리보기 및 중복 시리얼, 중복 위치, 연도, 날짜, 심각도 등 데이터 검증
- Firestore 반영 전 자동 백업, 원본 엑셀 Firebase Storage 보관, 변경이력 저장
- 신규 교체 입력 시 취거/취부 TM 상태와 위치 동시 갱신
- Weibull 노후도, Empirical-Bayes 고장빈도, 심각도 누적, MKBF 기반 리스크 자동 계산
- 9개 한글 화면, 대시보드 차트, 상세이력, 설정값 변경 및 전체 재계산
- TM 현황, 교체현황, 리스크, 검증결과 및 통합 엑셀 다운로드

## 빠른 실행

필요 환경은 Node.js 20 이상입니다.

```bash
npm install
npm run dev
```

터미널에 표시되는 로컬 주소를 브라우저에서 엽니다. Firebase 환경변수가 없으면 브라우저 `localStorage`를 사용하는 데모 모드로 실행됩니다. 먼저 샘플 파일 `0. data1(TM 취부 현황).xlsx`를 엑셀 업로드 화면에서 시험할 수 있습니다.

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

저장소에는 `wrangler.toml`도 포함되어 있어 Cloudflare가 빌드 산출물 `dist`를 배포 대상으로 인식할 수 있습니다. 배포된 HTML에 `/src/main.tsx`가 보이면 루트 디렉터리를 잘못 배포한 것이므로 Pages 설정에서 Output directory를 `dist`로 다시 지정하고 재배포하세요.

Firebase 실사용 모드가 필요하면 Cloudflare Pages의 Settings > Environment variables에 `.env.example`의 `VITE_FIREBASE_*` 값을 추가한 뒤 다시 배포합니다. 값을 넣지 않으면 앱은 브라우저 `localStorage`를 쓰는 데모 모드로 실행됩니다.

## Firebase 설정

1. Firebase Console에서 프로젝트를 생성합니다.
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

`firebase deploy`는 Hosting, Firestore 규칙, Storage 규칙을 함께 배포합니다. 현재 규칙은 로그인 사용자에게 읽기/쓰기를 허용하는 초기 운영용입니다. 실제 운영에서는 Firebase Custom Claims를 사용해 관리자·입력자·조회자 권한을 분리하세요.

## Firestore 컬렉션

| 컬렉션 | 문서 ID | 용도 |
|---|---|---|
| `tm_master` | `serialNo` | TM 기본정보와 현재상태 |
| `replacement_history` | `replacementId` | 교체·고장이력 |
| `severity_master` | `failureType` | 고장유형별 심각도 기준 |
| `risk_score` | `serialNo` | A/F/T/M 및 최종 위험도 |
| `audit_log` | `logId` | 입력·업로드·설정 변경이력 |
| `backups` | 타임스탬프 | DB 반영 전 데이터 스냅샷 |
| `settings/risk` | 고정 문서 | 리스크 계산 설정 |

원본 엑셀은 Storage의 `excel-original/` 경로에 저장됩니다.

## 리스크 계산

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
src/lib/riskCalculator.ts 리스크 계산
src/lib/validators.ts 데이터 정합성 검증
src/lib/firestoreService.ts Firestore/Storage 저장
src/lib/columnMapper.ts 컬럼 동의어와 자동 매핑
src/types/            TM, 교체, 리스크 타입
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
