# My Space — 부서 공유 워크스페이스

부서원이 방을 골라 **메모·파일을 모으고, HTML/마크다운 웹페이지를 게시하고, 익명 의견(블라인드 보이스)을 나누는** 공유 공간.
Cloudflare Pages + Pages Functions + R2. GreenNote와 동일 아키텍처.

> 내부 식별자는 `DA Space`, 도메인·UI 노출명은 **My Space**. 블라인드 보이스의 내부 식별자도 `bamboo`로 유지(API 경로·전역 피드 키).

> 🧭 **기획 도구 모음**(`samsungda.net`) 생태계의 일부입니다 — 허브 레포: [`samsungda-portal`](https://github.com/SimpleorNothing/samsungda-portal)

| 도구 | 진입 | 레포 |
|------|------|------|
| 클로드로 워드보고서 작성하기 | `samsungda.net/agent-guide` | `report-site` |
| 보고서 자판기 | `samsungda.net/report` | `report-site` |
| Market Insight | `mi.samsungda.net` | `market-insight` |
| 2030 미래 트렌드 | `samsungda.net/2030` | `(외부 연동)` |
| Quick Share | `quickshare.samsungda.net` | `QuickShare` |
| My Space | `space.samsungda.net` | `samsungda-space` ◀ **현재 레포** |

---

## 방 구성

- 시드 방 **A-1 ~ A-6** + 에디터 방 **autoweb**. 방 구성 변경은 `functions/_lib.js`의 `ROOMS` 배열만 수정.
- 로비에서 **새 빈방 생성** 가능 — 방 이름이 곧 URL 경로(영문·숫자·하이픈·언더스코어 1~40자).
- 신규 생성·복구 방은 **사용기한 기본 1개월**(방 설정에서 변경).
- `autoweb`은 웹페이지 탭이 파일 업로드 대신 **마크다운 에디터(실시간 미리보기)**로 동작.

## 방 페이지 = 3탭 워크스페이스

방 상태에 따라 분기됩니다 — **빈방**(안내+게시 폼) / **잠김**(열람 비밀번호 게이트) / **사용중**(3탭 워크스페이스).

| 탭 | 내용 |
|---|---|
| 메모·파일 | 제목 + 본문 + 파일 첨부(최대 5개, 개당 10MB). 카드 목록으로 누적, 개별 삭제 |
| 웹페이지 | HTML 파일 업로드 · 소스 직접 입력 · (autoweb은) 마크다운 에디터로 게시 → 이후 교체·삭제 |
| 블라인드 보이스 | **전 방 공통 익명 피드**(최대 500자). 작성자 정보 미저장, 본인 글은 이 브라우저에서만 삭제(localStorage 토큰) |

헤더 우측에 공개/비공개 배지와 **방 설정** 버튼이 있습니다.

## 방 설정

- **공개 범위**: 공개 / 비공개(열람 비밀번호 — 설정 시 세 탭 모두 잠김)
- **사용기한**: 기한 없음 / 1일 / 1주일 / 1개월 / 달력 선택 (방 목록 표시용, 자동 삭제는 하지 않음)
- **테마 색**: 8종 — 방 화면 액센트(`--brand`)와 로비 카드 닷에 적용

## URL 구조

| 경로 | 내용 |
|---|---|
| `/` | 로비 — 방 목록(점유·공개·기한·색 배지), 새 방 만들기, 관리 모드 |
| `/A-1` | 방 페이지 — 빈방 / 잠김 / 3탭 워크스페이스 분기 |
| `/A-1/view` | 게시된 웹페이지 원본 (뷰어 iframe 소스 · 전체화면 링크) |
| `/autoweb/source` | 마크다운 소스 (에디터 방 수정용) |
| `/__site_auth` | 공동 현관 비밀번호 제출 (POST) |

## API

| 메서드 | 경로 | 동작 |
|---|---|---|
| `GET` | `/api/rooms` | 전체 방 현황(점유·공개여부·사용기한·테마 색) |
| `POST` | `/api/rooms` | 새 빈방 생성(이름=URL, 기본 1개월) · 삭제된 시드 방 복구 |
| `DELETE` | `/api/rooms` | 방 관리 `{id, mode}` — `clear` 데이터만 비움 / `delete` 목록에서 제거 |
| `POST` | `/api/room/A-1` | 웹페이지 게시 |
| `PUT` | `/api/room/A-1` | 웹페이지 교체 |
| `DELETE` | `/api/room/A-1` | 웹페이지 삭제 (메모·블라인드 보이스는 유지) |
| `POST` | `/api/room/A-1/settings` | 방 설정 (공개 범위·사용기한·테마 색) |
| `POST` | `/api/room/A-1/auth` | 열람 비밀번호 검증 → 인증 쿠키(12시간) |
| `GET·POST·DELETE` | `/api/room/A-1/notes` | 메모·파일 목록 / 저장 / 삭제 |
| `GET` | `/api/room/A-1/file/{id}` | 첨부 파일 다운로드 |
| `GET·POST·DELETE` | `/api/room/A-1/bamboo` | 블라인드 보이스 (전역 피드) |

## 접근 보호 (2단)

1. **공동 현관** (선택) — `SITE_PASSWORD`가 설정되면 사이트 전체에 게이트가 걸립니다. 통과 시 `space_site_auth` 쿠키(12시간)로 유지. **자체 열람 비밀번호가 설정된 방은 현관을 건너뛰고** 방 비밀번호만으로 직접 접근. 미설정 시 게이트는 자동 비활성화(잠금 사고 방지).
2. **방 열람 비밀번호** — 방 설정에서 비공개로 전환. `space_auth_{방}` HttpOnly 쿠키(12시간) 또는 `x-room-password` 헤더로 검증. **교체·삭제·설정 변경도 동일 권한**. 평문은 저장하지 않고 SHA-256 해시만 보관.

## R2 저장 구조

```
index.json                 # { rooms:{ id:{published,title,updatedAt,passwordHash,expiresAt,color} },
                           #   created:[동적 생성 방], removed:[삭제된 시드 방] }
rooms/{id}/page.html       # 게시된 웹페이지
rooms/{id}/source.md       # 마크다운 소스 (에디터 방)
rooms/{id}/notes.json      # 메모·파일 목록 (마지막 메모 삭제 시 파일째 삭제)
rooms/{id}/files/*         # 첨부 파일
bamboo.json                # 블라인드 보이스 전역 피드 (방 삭제와 무관)
```

방 점유(사용중) 판정 = 웹페이지 게시(`published`) **또는** `notes.json` 존재.

## 디렉토리 구조

```
samsungda-space/
├── public/
│   └── index.html                       # 로비 (방 목록·새 방 만들기·관리 모드)
├── functions/
│   ├── _middleware.js                   # 공동 현관 게이트 (SITE_PASSWORD)
│   ├── _lib.js                          # ROOMS·해시·인덱스·인증·방 페이지 템플릿(3탭)
│   ├── [room]/
│   │   ├── index.js                     # /A-1 (빈방/잠김/워크스페이스 분기)
│   │   ├── view.js                      # /A-1/view (게시 HTML 원본)
│   │   └── source.js                    # /A-1/source (마크다운 소스)
│   └── api/
│       ├── rooms.js                     # GET 현황 / POST 생성 / DELETE 관리
│       └── room/[room]/
│           ├── index.js                 # 웹페이지 POST·PUT·DELETE
│           ├── settings.js              # 방 설정 (공개·기한·색)
│           ├── auth.js                  # 열람 비밀번호 검증
│           ├── notes.js                 # 메모·파일 GET·POST·DELETE
│           ├── file/                    # 첨부 파일 다운로드
│           └── bamboo.js                # 블라인드 보이스 (전역)
└── wrangler.toml
```

## 운영 규칙

- 한 방 = 웹페이지 1개. 빈방에만 신규 게시 가능(409로 선점 충돌 방지). 교체는 데이터 수정이 아니라 완성본 통째 교체.
- 메모·파일 첨부 한도: 메모당 파일 5개, 개당 10MB.
- 방 관리(`DELETE /api/rooms`): `clear`는 방을 남기고 데이터만 비우고, `delete`는 목록에서도 제거(시드 방은 `index.removed`에 기록 → 같은 이름으로 다시 만들면 복구).
- 블라인드 보이스는 전역 피드라 특정 방을 비우거나 삭제해도 영향받지 않습니다.
- 사내 한정 공개가 필요하면 `SITE_PASSWORD`(공동 현관) 또는 Cloudflare Zero Trust Access를 `space.samsungda.net`에 적용.

## 환경 변수 / 바인딩

| 이름 | 종류 | 용도 |
|---|---|---|
| `SPACE` | R2 | 인덱스·웹페이지·메모·파일·블라인드 보이스 저장 |
| `SITE_PASSWORD` | Var/Secret | 공동 현관 비밀번호(선택) — 미설정 시 게이트 비활성화 |
