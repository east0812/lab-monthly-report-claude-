# 연구소 월차보고 관리 사이트

직원이 월별 업무를 기록·제출하고, 관리자가 연구소 전체 현황을 검토·취합해 회의 자료(Excel / A4 인쇄·PDF / 오프라인 HTML)를 만드는 사내용 웹 앱입니다.

- **구성**: Next.js 16 (App Router) · TypeScript · Supabase Auth · PostgreSQL(RLS)
- **실행 위치**: 사내 Windows 서버 PC 1대 (`next start`). 같은 사내망의 직원은 브라우저로 접속합니다.
- **통신 구조**: 직원 브라우저 → (사내망) → 이 서버 → Supabase. 브라우저는 Supabase 와 직접 통신하지 않으므로 **서버 PC 만 Supabase 에 접속할 수 있으면** 됩니다. 키는 모두 서버 환경변수로만 사용합니다.
- **시간 기준**: 보고 연월·날짜는 한국시간(Asia/Seoul).

---

## 1. 빠르게 살펴보기 (로컬 검증 모드, Supabase 계정 불필요)

Docker 없이 이 PC 에서 전체 기능을 눌러 볼 수 있는 검증용 스택입니다. 실제 PostgreSQL 바이너리(내장형)와 Supabase Auth 호환 서버를 띄웁니다. **운영용이 아닙니다.**

```bash
npm install
```

```bash
npm run local:stack
```

(다른 터미널에서)

```bash
npm run local:seed
```

```bash
npm run dev
```

- `local:stack` 은 `.env.local` 이 없을 때만 검증용 값으로 만들어 줍니다. (데이터·키: `.local-stack/`)
- 접속: <http://localhost:3000> — 가상 계정(관리자 1, 직원 3, 비활성 1)은 `dev/demo-accounts.json` 에 있습니다.
- 가져오기 검증용 판매 Excel: `dev/sample/판매내역_샘플.xlsx`, `.xls`
- 전체 흐름 자동 검증: `npm run local:verify` (추가로 `node dev/verify/dev-transfers.mjs`, `node dev/verify/admin-misc.mjs`)
- 초기화: 스택을 끄고 `.local-stack` 폴더 삭제. 가상 데이터만 다시 만들려면 `npm run local:seed -- --reset`
- 3000번 포트가 사용 중이면 `PORT=3100` 처럼 포트를 지정하고 `.env.local` 의 `APP_BASE_URL` 도 맞춰 주세요.

## 2. 운영 설치 (Windows 서버 PC)

### 2-1. 준비물
- Node.js 20 이상 (검증: v24)
- Supabase 프로젝트 1개 (클라우드 또는 자체 호스팅)

### 2-2. Supabase 설정
1. 프로젝트 생성 후 **Project Settings → API** 에서 URL, anon(publishable) 키, service_role(secret) 키를 확인합니다.
2. **Project Settings → Database → Connection string** 에서 연결 문자열을 확인합니다. IPv4 사내망이면 **Session pooler** 주소를 쓰세요.
3. **Authentication → Sign In / Providers**
   - Email 로그인 사용, **Allow new users to sign up 끄기** (계정은 관리자가 만듭니다)
   - **Minimum password length 는 6 이하로 유지**: 관리자가 발급·재설정하는 비밀번호는 6자 이상, 직원이 직접 바꾸는 비밀번호는 앱에서 12자 이상으로 검증합니다. Supabase 의 계정 보안 정책(최소 길이·필수 문자·유출 비밀번호 차단)을 더 엄격하게 두면 그 정책도 함께 적용되고, 거부되면 화면에 안내가 나옵니다.
4. (권장) 이 앱은 Supabase Data API(PostgREST)를 쓰지 않습니다. **Project Settings → API → Data API** 를 꺼 두면 노출면이 줄어듭니다. 켜 두어도 모든 테이블에 RLS 가 적용되어 있습니다.

### 2-3. 환경변수
`.env.local.example` 을 `.env.local` 로 복사해 값을 채웁니다. (`.env.local` 은 공유·커밋 금지)

| 이름 | 설명 |
|---|---|
| `SUPABASE_URL` | Supabase 프로젝트 URL |
| `SUPABASE_ANON_KEY` | anon(publishable) 키 |
| `SUPABASE_SERVICE_ROLE_KEY` | service_role(secret) 키. 직원 계정 생성·비밀번호 재설정·사용 중지에만 서버에서 사용 |
| `DATABASE_URL` | PostgreSQL 연결 문자열 (비밀번호의 특수문자는 URL 인코딩) |
| `APP_BASE_URL` | 직원이 접속하는 주소. 예: `http://192.168.0.10:3000` |
| `ATTACHMENT_DIR` | 첨부 원본 저장 폴더. 비우면 `./data/attachments` |
| `PASSWORD_RESET_EMAIL_ENABLED` | 이메일 재설정 사용 여부 (3장 설정 후 `true`) |
| `COOKIE_SECURE` | HTTPS 로 서비스할 때만 `true` |
| `ALLOW_DEMO_SEED` | 가상 데이터 스크립트 허용. **운영에서는 반드시 `false`** |

### 2-4. DB 마이그레이션
`supabase/migrations/20261111000000_init.sql` 을 Supabase **SQL Editor** 에 붙여 실행하거나:

```bash
npm run db:migrate
```

### 2-5. 첫 관리자 계정

```bash
npm run admin:create
```

이메일·이름·비밀번호를 묻습니다(비밀번호는 화면에 표시되지 않음). 이후 직원 계정은 사이트의 **추가 메뉴 → 직원 관리** 에서 만듭니다.

### 2-6. 실행

```bash
npm install
```

```bash
npm run build
```

```bash
npm run start
```

- 또는 `scripts\windows\start-server.bat` 더블클릭 (설치·빌드·실행을 순서대로 수행, 포트는 `PORT` 환경변수 / 기본 3000)
- **Windows 방화벽**: 인바운드 규칙에 해당 TCP 포트를 "개인/도메인 네트워크"로 허용해야 다른 PC 에서 접속됩니다. (시스템 설정이므로 서버 관리자가 직접 설정)
- PC 재시작 후 자동 실행: 작업 스케줄러에 `start-server.bat` 을 "시작 시 실행"으로 등록
- 소스를 수정했으면 `npm run build` 후 다시 시작

## 3. 직원 이메일 비밀번호 재설정 (선택)

기본값은 꺼짐이며, 로그인 화면의 **비밀번호를 잊으셨나요?** 에는 관리자 문의 방법(시스템 설정에서 수정)이 표시됩니다. 켜려면:

1. Supabase **Authentication → Emails → SMTP Settings** 에 Custom SMTP 등록
2. **Authentication → URL Configuration**: Site URL = `APP_BASE_URL`, **Redirect URLs** 에 `<APP_BASE_URL>/auth/confirm` 추가
3. **Emails → Templates → Reset Password** 의 링크를 아래처럼 변경 (서버가 일회용 토큰을 직접 검증하는 방식)

   ```html
   <a href="{{ .RedirectTo }}?token_hash={{ .TokenHash }}&type=recovery">비밀번호 재설정</a>
   ```
4. `.env.local` 에 `PASSWORD_RESET_EMAIL_ENABLED=true` 후 재시작

동작: 링크는 Supabase 설정의 만료 시간 안에서 **한 번만** 유효합니다. 링크를 열면 일반 로그인과 분리된 **재설정 전용 세션(10분)** 만 만들어지고, 새 비밀번호(12자 이상) 저장 후 그 계정의 모든 세션이 종료됩니다.

## 4. 첨부파일 저장 위치와 백업

- **원본**: 서버 PC 의 `ATTACHMENT_DIR/<보고서ID>/<무작위 파일명>` (기본 `data/attachments`)
- **목록**(파일명·크기·올린 사람): DB 테이블 `report_attachments`
- 허용 형식: Excel(.xlsx/.xls), CSV, PowerPoint(.pptx/.ppt), PDF. 최대 크기는 **시스템 설정** 에서 변경(기본 30MB)
- **백업은 두 가지를 함께** 받아야 복원됩니다.
  1. 첨부 원본 폴더: `scripts\windows\backup.bat D:\backup\labreport` (robocopy, 작업 스케줄러에 매일 등록 권장)
  2. DB: Supabase 대시보드 **Database → Backups**, 또는 `pg_dump "<DATABASE_URL>" -Fc -f db.dump`
- 복원: DB 를 먼저 복원한 뒤 첨부 폴더를 같은 경로(또는 `ATTACHMENT_DIR`)에 되돌립니다.

## 5. 권한 구조 요약

- 메뉴 표시와 별개로 **API(역할·활성 상태·소유권 검사)** 와 **DB(RLS·트리거·함수)** 에서 다시 검사합니다. 모든 요청은 로그인 사용자의 권한(`authenticated` 역할 + `auth.uid()`)으로 실행되어 RLS 가 적용됩니다.
- 보고서 상태(작성중 → 제출완료 → 관리자 확인 → 최종확정, 반려)는 DB 함수 `report_transition` 으로만 바뀌며 이력·알림을 함께 남깁니다.
- 제출 이후(제출완료·관리자 확인·최종확정)에는 작성자가 보고서와 그 달의 개발현황·생산이관을 수정할 수 없습니다. 제출 취소(검토 전) 또는 반려 후 수정합니다.
- 다른 직원의 기록은 **제출 이후 공개된 것만** 전체 검색·제품 개발이력에 보입니다. 매출은 관리자 전용입니다.
- 비활성 계정은 로그인과 모든 API·DB 접근이 차단됩니다.

## 6. 검증한 범위와 추가 설정이 필요한 범위

**로컬 검증 스택에서 실제로 실행해 확인한 것** (`npm run local:verify` 외 2개 스크립트, 브라우저 확인)
- 직원·관리자 로그인, 로그인 유지/해제, 비활성 계정 차단, 교차 출처 요청 차단
- 월차보고 작성 → 제출 → 반려(사유) → 수정·재제출 → 관리자 확인 → 최종확정, 제출 취소, 상태별 수정 제한(API·DB 양쪽), 이력·알림, 첨부 추가·삭제·다운로드 권한
- 개발현황 자동저장용 버전 충돌 방지, 전월 이월(중복 이월 방지), 완료 시 진행률 100%, 생산이관 편집
- 관리자의 월별 상태 직접 수정(다른 월·담당자·상세·이관일 보존, 한 칸 여러 기록 중 선택)
- 판매 Excel(.xlsx/.xls) 미리보기 → 선택 월 저장, 소계·합계·빈 행 제외, 반품 차감, 운임·기타자재, 오류 행의 시트명·행 번호, 재업로드 중복 방지·수정값 보존·삭제 후 재등록, 일괄 삭제 원자성, 미등록/0원 구분, 증감률 규칙
- 관리자 비밀번호 재설정(6자 이상, 응답에 비밀번호 없음), 직원 본인 변경(12자 이상), 이메일 재설정 링크 흐름(로컬 메일함 폴더로 대체)
- Excel / A4 인쇄용 / HTML(회의·발표용, 자료 열람용) 출력: 외부 자원 미참조, 계정·키·경로 미포함, 입력값 이스케이프, 네트워크를 차단한 브라우저에서 파일 열람

**실제 환경에서 추가 설정·확인이 필요한 것**
- 실제 Supabase 프로젝트 연결(키·연결 문자열 입력 후 마이그레이션, 첫 관리자 생성). 로컬 검증은 Supabase Auth **호환 서버**로 했으므로, 실제 프로젝트에서 로그인·계정 생성·비밀번호 재설정을 한 번씩 확인해 주세요.
- Custom SMTP·Redirect URL·메일 템플릿(3장): 실제 메일 발송은 검증하지 못했습니다.
- Windows 방화벽 인바운드 규칙, 서버 자동 시작, 백업 작업 스케줄 등록
- HTTPS 를 쓸 경우 리버스 프록시 구성과 `COOKIE_SECURE=true`

## 7. 폴더 안내

```
supabase/migrations/   DB 스키마·RLS·함수 (운영 공통)
src/app/               화면과 API (Next.js App Router)
src/lib/               DB·인증·검증·출력(Excel/HTML)·매출 가져오기
src/components/        화면 부품 (표, 타임라인, 편집기 등)
scripts/               마이그레이션, 첫 관리자 생성, Windows 실행·백업
dev/                   로컬 검증 스택, 가상 데이터, 검증 스크립트 (운영에 불필요)
```
