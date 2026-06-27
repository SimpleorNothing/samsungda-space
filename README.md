# DA Space — HTML 공유 보드

부서원이 빈방(A-1 ~ A-6)을 골라 자신의 HTML을 게시·공유하는 공간.
Cloudflare Pages + Pages Functions + R2. GreenNote와 동일 아키텍처.
디자인은 `space-prototype.html` 프로토타입을 그대로 따른다.

> 🧭 **기획 도구 모음**(`samsungda.net`) 생태계의 일부입니다 — 허브 레포: [`samsungda-portal`](https://github.com/SimpleorNothing/samsungda-portal)

| 도구 | 진입 | 레포 |
|------|------|------|
| 클로드로 워드보고서 작성하기 | `samsungda.net/agent-guide` | `report-site` |
| 보고서 자판기 | `report.samsungda.net` | `report-site` |
| Market Insight | `mi.samsungda.net` | `market-insight` |
| 2030 미래 트렌드 | `2030.samsungda.net` | `2030-insight` |
| Quick Share | `quickshare.samsungda.net` | `QuickShare` |
| My Space | `space.samsungda.net` | `samsungda-space` ◀ **현재 레포** |

## URL 구조

| 경로 | 내용 |
|---|---|
| `space.samsungda.net/` | 로비 — 방 목록 (사용중/빈방 배지, 제목, 업데이트 날짜) |
| `space.samsungda.net/A-1` | 빈방: 사용법+업로드 / 잠김: 비밀번호 입력 / 사용중: 뷰어+교체·삭제 |
| `space.samsungda.net/A-1/view` | 업로드된 HTML 원본 (뷰어 iframe 소스 · 전체화면 링크) |
| `/api/rooms` | GET 점유 현황 JSON (표시 순서·구분선 위치 포함) · PUT 로비 정렬·구분선 저장 |
| `/api/room/A-1` | POST 업로드 · PUT 교체 · DELETE 삭제 |
| `/api/room/A-1/auth` | POST 열람 비밀번호 검증 → 인증 쿠키(12시간) |

## 비밀번호 모델 (프로토타입 기준)

- 업로드 시 **열람 비밀번호** 설정 선택 가능 — 설정하면 방문자는 비밀번호 입력 후에만 열람
- 검증 성공 시 `space_auth_{방}` HttpOnly 쿠키에 SHA-256 해시 저장 (12시간 유효)
- **교체·삭제도 같은 비밀번호 권한**으로 동작 (인증 쿠키 또는 `x-room-password` 헤더)
- 비밀번호 없는 방은 누구나 열람·교체·삭제 가능 (부서 내부용 전제)
- 평문 비밀번호는 어디에도 저장하지 않음 (해시만 R2에 보관)

## 디렉토리 구조

```
samsungda-space/
├── public/
│   └── index.html                    # 로비
├── functions/
│   ├── _lib.js                       # ROOMS·해시·인증·페이지 템플릿
│   ├── [room]/
│   │   ├── index.js                  # /A-1 (3상태 분기)
│   │   └── view.js                   # /A-1/view (원본 HTML)
│   └── api/
│       ├── rooms.js                  # GET /api/rooms · PUT 정렬·구분선
│       └── room/[room]/
│           ├── index.js              # POST/PUT/DELETE
│           └── auth.js               # POST 열람 인증
└── wrangler.toml
```

## R2 저장 구조

```
index.json              # { rooms: {...}, order: [...id], dividerPos: N, created: [...], removed: [...] }
                        #   order/dividerPos: 로비 표시 순서와 구분선 위치 (정렬 모드에서 저장)
rooms/A-1/page.html     # 게시된 HTML 원본
```

## 운영 규칙

- 한 방 = HTML 1개. 빈방에만 신규 업로드 가능 (409로 선점 충돌 방지)
- 교체는 데이터 수정이 아니라 완성된 HTML 파일 통째 교체
- 업로드 한도 5MB (`functions/api/room/[room]/index.js`의 `MAX_HTML_BYTES`)
- 방 구성 변경: `functions/_lib.js` 상단 `ROOMS` 배열만 수정
- 사내 한정 공개가 필요하면 Cloudflare Zero Trust Access를 `space.samsungda.net`에 적용

## 개발·배포 안전장치 (CI)

`main`은 곧 production(`space.samsungda.net`) 입니다. Cloudflare Pages의 "배포 성공(초록 체크)"은
**파일 업로드 성공**일 뿐 JS가 실제로 동작하는지는 검사하지 않습니다. 그래서 한 번,
서로 다른 갈래가 같은 기능을 다르게 구현한 것이 자동병합으로 **충돌 없이 뒤섞여**
존재하지 않는 변수를 참조하는 코드가 만들어졌고(인라인 스크립트가 통째로 중단되어
방 목록이 "불러오는 중…"에서 멈춤), 그대로 배포된 사고가 있었습니다.

이를 막기 위해 **PR 단계 자동 검증 게이트**(`.github/workflows/ci.yml`)를 둡니다:

- **ESLint `no-undef`/`no-redeclare`** — `public/**/*.html`의 인라인 스크립트까지 검사해
  *선언 없이 쓰는 변수*(위 사고의 직접 원인)·*중복 선언*을 차단 (`eslint.config.js`)
- **`node --check`** — 모든 Pages Functions 모듈 문법 검사
- **병합 충돌 마커 검사** — `<<<<<<<` 등이 남은 채 머지되는 것 차단

> ⚠️ **권장:** GitHub → Settings → Branches에서 `main`에 **Branch protection**을 걸고
> `CI / verify` 통과를 머지 필수 조건으로 지정하세요. 그래야 검사가 빨간 PR이
> production으로 머지되는 것을 *강제로* 막을 수 있습니다.

### 기여 규칙 — 사고 재발 방지

- **한 기능 = 한 구현.** 같은 기능(예: 로비 구분선/정렬)을 여러 갈래에서 다르게
  재구현하지 마세요. 자동병합이 둘을 뒤섞는 사고의 근원입니다.
- 작업 전 `main`에서 분기하고, 머지 전 `main`을 다시 반영(rebase/merge)해 **로컬에서
  `npx eslint public functions` 가 통과하는지** 확인하세요.
- 다 쓴 기능 브랜치는 머지 후 삭제해, 다음 머지 때 옛 코드가 섞이지 않게 합니다.
