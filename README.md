# DA Space — HTML 공유 보드

부서원이 빈방(A-1 ~ A-6)을 골라 자신의 HTML을 게시·공유하는 공간.
Cloudflare Pages + Pages Functions + R2. GreenNote와 동일 아키텍처.
디자인은 `space-prototype.html` 프로토타입을 그대로 따른다.

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
│       ├── rooms.js                  # GET /api/rooms
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
