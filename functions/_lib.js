// DA Space 공유 유틸 — 방 목록·해시·인덱스·인증·페이지 템플릿
// 방 구성을 바꾸려면 ROOMS 배열만 수정하면 됩니다.
//
// 방 페이지 구성 (2탭 워크스페이스):
//   1) 메모·파일  — 메모 작성·파일 첨부 저장/공유   (/api/room/:room/notes, /file/:id)
//   2) 웹페이지   — HTML 파일 업로드 또는 소스 입력 게시 (autoweb은 마크다운 에디터)
//                  여러 페이지 게시 지원 — 첫 페이지는 page.html(id 'main'), 추가 페이지는
//                  pages/{pid}.html. /api/room/:room/pages 로 추가·교체·삭제, 브라우저 탭처럼 전환
//
// 방 meta 모델 (index.json → rooms[id]):
//   { published, title, updatedAt, passwordHash, expiresAt, color }
//   - published: 웹페이지 게시 여부 (레거시 meta는 readIndex에서 true로 정규화)
//   - passwordHash: 비공개 방 열람 비밀번호 — 설정 시 세 기능 모두 잠금
//   - expiresAt: 사용기한 (YYYY-MM-DD, 표시용 — 자동 삭제는 하지 않음)
//   - color: 방 테마 색 (#rrggbb) — 방 페이지 액센트(--brand)와 로비 카드 닷에 적용
// 방 점유(사용중) 판정 = published 또는 notes.json 존재 (api/rooms.js 참조)

export const ROOMS = ['A-1', 'A-2', 'A-3', 'A-4', 'A-5', 'A-6', 'autoweb'];

// 에디터 방 — 웹페이지 탭이 파일 업로드 대신 마크다운 에디터로 동작
export const EDITOR_ROOMS = ['autoweb'];
export function isEditorRoom(id) {
  return EDITOR_ROOMS.indexOf(id) !== -1;
}

// 방 이름 형식: 영문·숫자·하이픈·언더스코어 1~40자 (URL·R2 키·쿠키 모두 안전)
const ROOM_ID_RE = /^[A-Za-z0-9_-]{1,40}$/;

export function isValidRoomId(raw) {
  return typeof raw === 'string' && ROOM_ID_RE.test(raw);
}

// 시드 방(ROOMS) + 동적 생성 방(index.created) 합본 목록 (중복 제거, 순서 유지)
// index.removed에 있는 시드 방은 삭제된 것으로 보고 목록에서 제외
// (같은 이름으로 빈방을 다시 추가하면 removed에서 빠지며 복구됨)
export function allRooms(index) {
  const created = (index && Array.isArray(index.created)) ? index.created : [];
  const removed = (index && Array.isArray(index.removed)) ? index.removed : [];
  const seen = Object.create(null);
  const list = [];
  ROOMS.concat(created).forEach(function (id) {
    if (seen[id] || removed.indexOf(id) !== -1) return;
    seen[id] = true;
    list.push(id);
  });
  return list;
}

export function roomExists(index, id) {
  return allRooms(index).indexOf(id) !== -1;
}

export async function sha256(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf)).map(function (b) {
    return b.toString(16).padStart(2, '0');
  }).join('');
}

export function escapeHtml(s) {
  return String(s || '').replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
}

// ---------- R2 인덱스 ----------

export async function readIndex(env) {
  const obj = await env.SPACE.get('index.json');
  let index = { rooms: {} };
  if (obj) {
    try { index = JSON.parse(await obj.text()); } catch (e) { index = { rooms: {} }; }
  }
  if (!index.rooms) index.rooms = {};
  // 레거시 meta(published 필드 없음 = 게시중이던 방) 정규화
  for (const k in index.rooms) {
    const m = index.rooms[k];
    if (m && m.published === undefined) m.published = true;
  }
  return index;
}

// 게시도, 비밀번호도, 사용기한도, 제목도 없는 meta는 인덱스에서 제거해도 됨
export function metaIsEmpty(meta) {
  return !meta || (!meta.published && !meta.passwordHash && !meta.expiresAt && !meta.color && !meta.title);
}

// KST 오늘 날짜 (YYYY-MM-DD)
export function todayKST() {
  return new Date().toLocaleString('sv-SE', { timeZone: 'Asia/Seoul' }).slice(0, 10);
}

export async function writeIndex(env, index) {
  await env.SPACE.put('index.json', JSON.stringify(index), {
    httpMetadata: { contentType: 'application/json; charset=utf-8' },
  });
}

// 게시 여부의 단일 진실 공급원(single source of truth) = page.html 객체의 실존 여부.
// index.json의 meta.published 플래그와 page.html이 어긋날 수 있어(동시 쓰기로 인한
// 인덱스 덮어쓰기, 삭제 도중 부분 실패 등) 플래그만 믿으면 "삭제한 웹페이지가 다시
// 살아나는" 불일치 상태가 생긴다. 그래서 화면 렌더·게시/교체/삭제 판정은 모두 이 함수로
// page.html 실존을 직접 확인한다. meta.published는 호환용 힌트로만 남겨둔다.
export async function pageExists(env, room) {
  if (await env.SPACE.head('rooms/' + room + '/page.html')) return true;
  const l = await env.SPACE.list({ prefix: 'rooms/' + room + '/pages/', limit: 1 });
  return !!(l && l.objects && l.objects.length);
}

// 게시된 페이지 목록 — 첫 페이지(page.html, id 'main') + 추가 페이지(pages/{pid}.html)
// 제목: main은 meta.title, 추가 페이지는 R2 customMetadata.title(URI 인코딩 저장)에서 읽는다.
// 추가 페이지 id는 시각 기반(base36)이라 R2의 키 사전순 나열 = 게시 순서가 된다.
export async function listPages(env, room, meta) {
  const pages = [];
  if (await env.SPACE.head('rooms/' + room + '/page.html')) {
    pages.push({
      id: 'main',
      title: (meta && meta.title) || '',
      updatedAt: (meta && meta.updatedAt) || '',
    });
  }
  const prefix = 'rooms/' + room + '/pages/';
  let cursor;
  do {
    const l = await env.SPACE.list({ prefix: prefix, cursor: cursor, include: ['customMetadata'] });
    (l.objects || []).forEach(function (o) {
      if (!/\.html$/.test(o.key)) return;
      const cm = o.customMetadata || {};
      let t = cm.title || '';
      try { t = decodeURIComponent(t); } catch (e) { /* 인코딩 안 된 값은 그대로 */ }
      pages.push({ id: o.key.slice(prefix.length, -5), title: t, updatedAt: cm.updatedat || '' });
    });
    cursor = l.truncated ? l.cursor : undefined;
  } while (cursor);
  return pages;
}

// 메모·파일 읽기
async function readNotes(env, room) {
  const obj = await env.SPACE.get('rooms/' + room + '/notes.json');
  if (!obj) return { items: [] };
  try { return JSON.parse(await obj.text()); } catch (e) { return { items: [] }; }
}

// 가장 최근 활동 탭 결정 — 메모/웹페이지 중 최근 업데이트가 있는 탭을 기본으로
export async function getDefaultTab(env, room, pages) {
  // 웹페이지의 최근 업데이트 — 모든 페이지 중 가장 최신 updatedAt 찾기
  let latestPageTime = '';
  if (pages && pages.length > 0) {
    pages.forEach(function(page) {
      const pageTime = page.updatedAt || '';
      if (pageTime > latestPageTime) {
        latestPageTime = pageTime;
      }
    });
  }

  // 메모의 최근 업데이트 — 첫 메모가 최신 (notes.json에 생성 역순으로 저장)
  let latestNoteTime = '';
  try {
    const notesData = await readNotes(env, room);
    if (notesData.items && notesData.items.length > 0) {
      const firstNote = notesData.items[0];
      latestNoteTime = firstNote.editedAt || firstNote.createdAt || '';
    }
  } catch (e) {
    // 메모를 읽을 수 없으면 무시하고 계속
  }

  // 최근 활동 비교 — 더 최신인 탭을 기본으로 설정
  // 둘 다 있으면 타임스탬프 비교, 웹페이지만 있으면 web, 메모만 있으면 notes
  if (latestPageTime && latestNoteTime) {
    return latestNoteTime > latestPageTime ? 'notes' : 'web';
  } else if (latestNoteTime) {
    return 'notes';
  } else if (latestPageTime) {
    return 'web';
  }
  return 'notes'; // 둘 다 없으면 기본값
}

// ---------- 인증 (열람 비밀번호) ----------
// 비밀번호 검증 성공 시 space_auth_{room} 쿠키에 해시를 저장하고,
// 이후 요청은 쿠키 해시 == 저장 해시로 판정. 교체/삭제도 동일 권한.

export function cookieName(room) {
  return 'space_auth_' + room;
}

export function getCookie(request, name) {
  const raw = request.headers.get('cookie') || '';
  const parts = raw.split(';');
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i].trim();
    if (p.indexOf(name + '=') === 0) return p.slice(name.length + 1);
  }
  return '';
}

// meta가 비밀번호 없는 방이면 항상 true.
// 있으면 쿠키 해시 일치 또는 x-room-password 헤더 평문 해시 일치.
export async function isAuthorized(request, room, meta) {
  if (!meta || !meta.passwordHash) return true;
  if (getCookie(request, cookieName(room)) === meta.passwordHash) return true;
  const pw = request.headers.get('x-room-password') || '';
  if (pw && (await sha256(pw)) === meta.passwordHash) return true;
  return false;
}

export function authCookieHeader(room, hash) {
  return cookieName(room) + '=' + hash + '; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=43200';
}

// ---------- 응답 헬퍼 ----------

export function json(data, status, extraHeaders) {
  const headers = { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' };
  if (extraHeaders) for (const k in extraHeaders) headers[k] = extraHeaders[k];
  return new Response(JSON.stringify(data), { status: status || 200, headers: headers });
}

export function html(body) {
  return new Response(body, {
    headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' },
  });
}

// ---------- 공통 스타일 (space-prototype.html 기반 + 워크스페이스 확장) ----------

export const BASE_CSS = `
:root{--bg:#EDEFEC;--surface:#FFFFFF;--text:#17222D;--muted:#5C6B79;--border:#D3D9D6;--brand:#46647E;}
*{box-sizing:border-box;margin:0;padding:0}
body{background:var(--bg);color:var(--text);padding:56px 24px;
  font-family:"Pretendard",-apple-system,BlinkMacSystemFont,"Apple SD Gothic Neo","Malgun Gothic",sans-serif;}
.wrap{max-width:860px;margin:0 auto}
h1{font-size:30px;font-weight:800;letter-spacing:-0.5px}
.sub{font-size:15px;color:var(--muted);margin-top:6px}
h2{font-size:20px;font-weight:700;letter-spacing:-0.3px}
.desc{font-size:15px;color:var(--muted);margin-top:4px}
section{margin-bottom:40px}
.section-head{margin-bottom:16px}
.back{display:inline-block;font-size:15px;color:var(--muted);text-decoration:none;margin-bottom:18px;cursor:pointer;}
.back:hover{color:var(--brand)}
.panel{background:var(--surface);border:1.5px solid var(--border);border-radius:0;padding:26px 22px;margin-top:16px;}
.panel ol{margin:10px 0 0 18px}
.panel li{font-size:15px;color:var(--muted);line-height:1.9}
.dropzone{border:1.5px dashed var(--border);border-radius:0;padding:22px;text-align:center;
  font-size:15px;color:var(--muted);margin-top:16px;transition:.15s;cursor:pointer;}
.dropzone:hover{border-color:var(--brand)}
.dropzone.is-over{border-color:var(--brand);background:rgba(70,100,126,.06)}
.fmt-row{display:flex;flex-wrap:wrap;gap:8px;margin-top:16px}
.fmt-row button{background:transparent;border-color:var(--border)}
.opt{display:flex;align-items:center;gap:8px;margin-top:14px;font-size:15px;color:var(--muted)}
.opt input{accent-color:var(--brand)}
.field{margin-top:14px}
.field label{display:block;font-size:15px;font-weight:600;margin-bottom:6px}
.field input{width:100%;font-family:inherit;font-size:15px;color:var(--text);
  background:var(--bg);border:1.5px solid var(--border);border-radius:0;padding:9px 12px;outline:none;}
.field input:focus{border-color:var(--brand)}
button{font-family:inherit;font-size:15px;font-weight:600;
  border:1.5px solid var(--border);border-radius:0;background:#E7EAE6;color:var(--text);
  padding:8px 16px;cursor:pointer;transition:.15s;}
button:hover{border-color:var(--brand);color:var(--brand)}
button.danger:hover{background:#F5E4E2;color:#B02E24;border-color:#F5E4E2}
button.primary{background:#46647E;border-color:#46647E;color:#fff}
button.primary:hover{background:#37506A;border-color:#37506A;color:#fff}
button:disabled{opacity:.5;cursor:default}
.btn-row{display:flex;gap:8px;margin-top:16px}
.btn-row-end{justify-content:flex-end}
textarea.input.is-over{border-color:var(--brand);background:rgba(70,100,126,.06)}
.viewer{border:1.5px solid var(--border);border-radius:0;margin-top:16px;overflow:hidden;background:var(--surface);}
.viewer iframe{display:block;width:100%;height:70vh;border:none;background:#fff}
.status-line{font-size:15px;color:var(--muted);margin-top:6px}
.status-msg{font-size:15px;color:var(--muted);margin-top:12px;min-height:18px}
.status-msg.err{color:#B02E24}
textarea.md{width:100%;min-height:280px;margin-top:16px;font-family:inherit;font-size:15px;line-height:1.7;
  color:var(--text);background:var(--bg);border:1.5px solid var(--border);border-radius:0;
  padding:14px 16px;outline:none;resize:vertical;}
textarea.md:focus{border-color:var(--brand)}
textarea.input{width:100%;min-height:110px;margin-top:14px;font-family:inherit;font-size:15px;line-height:1.7;
  color:var(--text);background:var(--bg);border:1.5px solid var(--border);border-radius:0;
  padding:14px 16px;outline:none;resize:vertical;}
textarea.input:focus{border-color:var(--brand)}
#nText{min-height:220px;background:#fff}
.preview-label{font-size:15px;font-weight:600;color:var(--muted);margin-top:16px}
.preview{background:#fff;border:1.5px solid var(--border);border-radius:0;padding:22px;margin-top:8px;
  min-height:100px;overflow:auto;}
.tabbar{display:flex;flex-wrap:wrap;gap:4px;border-bottom:1.5px solid var(--border);margin-top:20px}
.tabbar button{border:none;border-bottom:2px solid transparent;border-radius:0;background:none;
  color:var(--muted);font-size:15px;font-weight:600;padding:10px 14px;margin-bottom:-1.5px;}
.tabbar button:hover{color:var(--brand)}
.tabbar button.active{color:var(--brand);border-bottom-color:var(--brand)}
.tabpanel{display:none}
.tabpanel.active{display:block}
.subtabs{display:flex;flex-wrap:wrap;gap:8px;margin-top:16px}
.subtabs button.active{border-color:var(--brand);color:var(--brand);background:rgba(70,100,126,.06)}
.note{background:var(--surface);border:1.5px solid var(--border);border-radius:0;padding:18px 20px;margin-top:12px}
.note h3{font-size:15px;font-weight:700}
.note p{font-size:15px;line-height:1.75;margin-top:6px;white-space:pre-wrap;word-break:break-word}
.note p.editable{cursor:pointer}
.note p.editable:hover{background:rgba(70,100,126,.05)}
.note .cl{margin-top:6px;cursor:pointer}
.note .cl:hover{background:rgba(70,100,126,.04)}
.note .cl-row{display:flex;align-items:flex-start;gap:8px;padding:3px 0;font-size:15px;line-height:1.6}
.note .cl-row input{width:16px;height:16px;margin-top:3px;accent-color:var(--brand);cursor:pointer;flex:none}
.note .cl-row input.ghost-box{opacity:0}
.note .cl-row.done input.ghost-box{opacity:1}
.note .cl-row span{white-space:pre-wrap;word-break:break-word;cursor:pointer}
.note .cl-row.done span{color:var(--muted);text-decoration:line-through}
.note .cl-text{font-size:15px;line-height:1.75;white-space:pre-wrap;word-break:break-word;cursor:pointer}
.fmt-row button.active{border-color:#E7EAE6;color:var(--text);background:#E7EAE6}
.note .files{margin-top:10px;display:flex;flex-wrap:wrap;gap:8px}
.note .files a{font-size:15px;color:var(--brand);text-decoration:none;background:#fff;
  border:1.5px solid var(--border);border-radius:0;padding:5px 10px;transition:.15s}
.note .files a:hover{border-color:var(--brand)}
.note .imgs{margin-top:10px;display:flex;flex-wrap:wrap;gap:8px}
.note .imgs a{display:block;line-height:0}
.note .imgs img{max-width:220px;max-height:220px;border:1.5px solid var(--border);border-radius:0;
  object-fit:cover;background:#fff;transition:.15s}
.note .imgs a:hover img{border-color:var(--brand)}
.note.linked{border-color:var(--brand);box-shadow:0 0 0 2.5px var(--brand)}
.previews{display:flex;flex-wrap:wrap;gap:10px;margin-top:12px}
.previews:empty{display:none}
.thumb{position:relative;line-height:0}
.thumb img{width:96px;height:96px;object-fit:cover;border:1.5px solid var(--border);border-radius:0;background:#fff}
.thumb .rm{position:absolute;top:-7px;right:-7px;width:20px;height:20px;padding:0;border-radius:50%;
  border:1.5px solid var(--border);background:#fff;color:var(--muted);font-size:13px;font-weight:700;
  line-height:1;display:flex;align-items:center;justify-content:center;cursor:pointer}
.thumb .rm:hover{background:#F5E4E2;color:#B02E24;border-color:#F5E4E2}
.meta-line{display:flex;align-items:center;gap:8px;font-size:15px;color:var(--muted);margin-top:12px}
button.mini{font-size:15px;padding:4px 10px;margin-left:auto}
.meta-line .actions{display:flex;align-items:center;gap:8px}
.meta-line .actions button.mini{margin-left:0}
.empty-line{font-size:15px;color:var(--muted);margin-top:16px}
.count{font-size:15px;color:var(--muted);margin-top:6px;text-align:right}
.head-flex{display:flex;align-items:flex-start;justify-content:space-between;gap:12px}
.head-side{display:flex;align-items:center;gap:8px;flex:none;padding-top:4px}
.badge{display:inline-block;font-size:15px;font-weight:600;padding:3px 9px;border-radius:0}
.badge.open{background:#E7EAE6;color:var(--muted)}
.badge.lock{background:#F5E4E2;color:#B02E24}
.hint{font-weight:400;color:var(--muted)}
.swatches{display:flex;flex-wrap:wrap;gap:10px;margin-top:8px}
.swatches button{width:28px;height:28px;border-radius:50%;padding:0;border:2px solid #fff;
  box-shadow:0 0 0 1.5px var(--border);transition:.15s;}
.swatches button:hover{box-shadow:0 0 0 2.5px var(--brand);border-color:#fff;color:inherit}
.swatches button.sel{box-shadow:0 0 0 2.5px var(--text)}
/* 게시된 웹페이지들은 메인 탭바에 페이지별 탭으로 나타난다 (JS가 렌더) */
.tabbar button.webtab{flex:none;max-width:220px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.tabbar button.addpage-bar{flex:none;border:1.5px solid var(--border);border-bottom:none;border-radius:0;
  background:transparent;color:var(--muted);font-size:15px;font-weight:600;padding:8px 14px;
  margin-bottom:-1.5px}
.tabbar button.addpage-bar.active{color:var(--brand);border-color:var(--brand)}
`;

// 마크다운 본문 타이포그래피 — 미리보기(.preview)와 게시 문서가 공유
export const MD_CSS = `
.md-body{font-size:15px;line-height:1.75;color:#17222D}
.md-body h1{font-size:26px;font-weight:800;letter-spacing:-0.5px;margin:28px 0 12px}
.md-body h1:first-child{margin-top:0}
.md-body h2{font-size:20px;font-weight:700;letter-spacing:-0.3px;margin:24px 0 10px}
.md-body h3{font-size:17px;font-weight:700;margin:20px 0 8px}
.md-body p{margin:10px 0}
.md-body ul,.md-body ol{margin:10px 0 10px 22px}
.md-body li{margin:4px 0}
.md-body a{color:#46647E}
.md-body code{background:#EDEFEC;border:1px solid #D3D9D6;border-radius:0;padding:1px 5px;font-size:15px}
.md-body pre{background:#EDEFEC;border:1px solid #D3D9D6;border-radius:0;padding:14px 16px;overflow:auto;margin:12px 0}
.md-body pre code{background:none;border:none;padding:0}
.md-body blockquote{border-left:3px solid #46647E;margin:12px 0;padding:2px 0 2px 14px;color:#5C6B79}
.md-body table{border-collapse:collapse;margin:12px 0;width:100%}
.md-body th,.md-body td{border:1px solid #D3D9D6;padding:7px 10px;font-size:15px;text-align:left}
.md-body th{background:#EDEFEC;font-weight:700}
.md-body img{max-width:100%}
.md-body hr{border:none;border-top:1px solid #D3D9D6;margin:20px 0}
`;

const FONT_LINK = `<link rel="stylesheet" href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/static/pretendard.min.css">`;
const MARKED_LINK = `<script src="https://cdn.jsdelivr.net/npm/marked@12.0.2/marked.min.js"></script>`;

// 방 테마 색 팔레트 — 어스 뉴트럴 톤 (미설정 시 기본 브랜드 블루 유지)
const COLORS = [
  ['#B97A55', '클레이'],
  ['#8A8A4A', '올리브'],
  ['#6F9276', '세이지'],
  ['#C0A25E', '샌드'],
  ['#8A8078', '스톤'],
  ['#6E88A6', '더스크'],
];

// ---------- 방 페이지 ----------
// 잠김: 비밀번호 게이트 / 그 외: 2탭 워크스페이스 (메모·파일 / 웹페이지 — 여러 페이지 탭 지원)
// 헤더 우측: 공개/비공개 배지 + 방 설정(공개 범위·사용기한·테마 색) 버튼

export async function roomPage(room, meta, authorized, pages, env) {
  // 게시 여부는 R2 페이지 실존(listPages 결과)을 진실로 삼는다. index.json의 meta.published가
  // 어긋나 있어도(예: 삭제 후 플래그가 남음) 실제 파일이 없으면 빈방으로 렌더해
  // 뷰어가 방 페이지를 재귀로 끌어안는 무한 중첩을 원천 차단한다.
  pages = pages || [];
  const used = pages.length > 0;
  const first = used ? pages[0] : null;
  // 가장 최근 활동이 있는 탭을 기본 활성 탭으로 설정
  const defaultTab = (env && authorized) ? await getDefaultTab(env, room, used ? pages : []) : (used ? 'web' : 'notes');
  const priv = !!(meta && meta.passwordHash);
  const locked = priv && !authorized;
  const editor = isEditorRoom(room);
  const title = used ? escapeHtml(first.title || (meta && meta.title) || '(제목 없음)') : '';
  // 설정 패널의 제목 입력칸에는 대체 문구 없이 저장된 원래 제목만 넣는다
  const titleVal = escapeHtml((meta && meta.title) || '');
  const updated = used ? escapeHtml(String(first.updatedAt || (meta && meta.updatedAt) || '').slice(0, 10)) : '';
  const exp = (meta && meta.expiresAt) ? escapeHtml(meta.expiresAt) : '';
  const color = (meta && meta.color && /^#[0-9a-f]{6}$/i.test(meta.color)) ? meta.color : '';
  const expired = exp && exp < todayKST();
  const expLine = exp ? ' · 사용기한 ~' + exp + (expired ? ' (만료)' : '') : '';

  const visBadge = '<span class="badge ' + (priv ? 'lock">비공개' : 'open">공개') + '</span>';

  let statusLine, bodyHtml, script, headSide;

  if (locked) {
    statusLine = '비공개 방입니다 · 열람하려면 비밀번호가 필요합니다' + expLine;
    headSide = visBadge;
    bodyHtml = `
      <div class="panel">
        <h2>비밀번호 입력</h2>
        <div class="field">
          <label for="pw">열람 비밀번호</label>
          <input id="pw" type="password" autocomplete="current-password">
        </div>
        <div class="btn-row"><button id="enterBtn">열람하기</button></div>
        <div class="status-msg" id="msg"></div>
      </div>`;
    script = lockedScript(room);
  } else {
    statusLine = (used
      ? '웹페이지 ' + (pages.length > 1 ? pages.length + '개 ' : '') + '게시중 · ' + title + ' · 업데이트 ' + updated
      : '게시된 웹페이지 없음 — 메모·파일은 바로 사용할 수 있습니다') + expLine;
    headSide = visBadge + '<button id="setBtn">방 설정</button>';
    bodyHtml = `
      <div class="panel" id="setPanel" style="display:none">
        <h2>방 설정</h2>
        ${editor ? '' : `
        <div class="field">
          <label for="setName">방 이름 <span class="hint">(주소에 사용 — 변경하면 주소도 바뀜 · 영문·숫자·하이픈(-)·언더스코어(_), 최대 40자)</span></label>
          <input id="setName" type="text" maxlength="40" value="${escapeHtml(room)}">
        </div>`}
        <div class="field">
          <label for="setTitle">방 제목 <span class="hint">(방 목록에 표시 — 비우면 제목 없음)</span></label>
          <input id="setTitle" type="text" maxlength="100" value="${titleVal}">
        </div>
        <label class="opt"><input type="radio" name="vis" value="public"${priv ? '' : ' checked'}> 공개 — 누구나 열람</label>
        <label class="opt"><input type="radio" name="vis" value="private"${priv ? ' checked' : ''}> 비공개 — 비밀번호를 아는 사람만 열람 (모든 탭에 적용)</label>
        <div class="field" id="setPwField" style="display:${priv ? '' : 'none'}">
          <label for="setPw">비밀번호 ${priv ? '<span class="hint">(비워두면 기존 비밀번호 유지)</span>' : ''}</label>
          <input id="setPw" type="password" autocomplete="new-password">
        </div>
        <div class="field">
          <label>사용기한 <span class="hint">(방 목록에 표시)</span></label>
          <div class="subtabs" id="expSel">
            <button type="button" data-exp="none"${exp ? '' : ' class="active"'}>기한 없음</button>
            <button type="button" data-exp="1d">1일</button>
            <button type="button" data-exp="1w">1주일</button>
            <button type="button" data-exp="1m">1개월</button>
            <button type="button" data-exp="pick"${exp ? ' class="active"' : ''}>기한 선택 (달력)</button>
          </div>
          <div class="field" id="setExpField" style="display:${exp ? '' : 'none'}">
            <input id="setExp" type="date" value="${exp}">
          </div>
        </div>
        <div class="field">
          <label>테마 색 <span class="hint">(방 화면과 방 목록에 적용)</span></label>
          <div class="swatches" id="colorSel">${COLORS.map(function (c) {
            const sel = color === c[0] ? ' class="sel"' : '';
            return '<button type="button" data-color="' + c[0] + '" style="background:' + c[0] + '" title="' + c[1] + '"' + sel + '></button>';
          }).join('')}</div>
        </div>
        <div class="btn-row">
          <button id="setSave">저장</button>
          <button id="setCancel">닫기</button>
        </div>
        <div class="status-msg" id="msgSet"></div>
      </div>

      <div class="tabbar">
        <button data-tab="notes"${defaultTab === 'notes' ? ' class="active"' : ''}>메모·파일</button>
        ${used ? '' : '<button data-tab="web">웹페이지</button>'}
        <button id="addWebPageBtnBar" type="button" class="addpage-bar">웹페이지 +</button>
      </div>

      <div class="tabpanel${defaultTab === 'notes' ? ' active' : ''}" id="tab-notes">
        <div class="panel">
          <h2>메모·파일 저장</h2>
          <div class="fmt-row" id="fmtRow">
            <button id="nCheck" type="button" title="한 줄에 한 항목씩 — 저장 시 체크박스 목록으로 변환">☑ 체크리스트</button>
            <button id="nBullet" type="button" title="한 줄에 한 항목씩 — 저장 시 글머리 기호 목록으로 변환">• 글머리 기호</button>
            <button id="nNumber" type="button" title="한 줄에 한 항목씩 — 저장 시 번호 매기기 목록으로 변환">1. 번호 매기기</button>
          </div>
          <textarea id="nText" class="input" placeholder="내용을 입력하세요 (위 체크리스트·글머리 기호·번호 매기기 버튼으로 목록 형식을 선택할 수 있어요)"></textarea>
          <div class="dropzone" id="nDrop">이 영역 어디에나 파일을 끌어다 놓거나, 여기를 클릭해 선택하세요 · 캡처 이미지는 Ctrl/⌘+V로 바로 붙여넣기</div>
          <input id="nFiles" type="file" multiple hidden>
          <div class="previews" id="nPreview"></div>
          <div class="btn-row btn-row-end"><button id="nSave" class="primary">저장</button></div>
          <div class="status-msg" id="msgNotes"></div>
        </div>
        <div id="noteList"></div>
      </div>

      <div class="tabpanel${defaultTab === 'web' ? ' active' : ''}" id="tab-web">
        ${webTabMarkup(room, used, editor)}
        <div class="status-msg" id="msgWeb"></div>
      </div>
`;
    script = workspaceScript(room, meta, editor, used, priv, pages);
  }

  return `<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${room} · My Space</title>
${FONT_LINK}
${editor && !locked ? MARKED_LINK : ''}
<style>${BASE_CSS}${color ? ':root{--brand:' + color + ';}' : ''}${editor && !locked ? MD_CSS : ''}</style>
</head>
<body>
<div class="wrap">
  <a class="back" href="/">← 방 목록으로</a>
  <section>
    <div class="section-head head-flex">
      <div>
        <h1>${room}</h1>
        <p class="status-line">${statusLine}</p>
      </div>
      <div class="head-side">${headSide}</div>
    </div>
    ${bodyHtml}
  </section>
</div>
<script>${script}</script>
</body>
</html>`;
}

// ---------- 웹페이지 탭 마크업 (상태별) ----------

// 웹페이지 게시 폼 — 첫 게시(미게시 방)와 새 페이지 추가(게시 방)가 완전히 동일한 화면을 쓴다.
// 메모·파일 저장 폼과 같은 흰 패널 안에 파일 업로드/소스 입력 + 표시 이름 + 게시 + 미리보기.
function pubFormMarkup(hidden) {
  return `
      <div class="panel" id="pubSec"${hidden ? ' style="display:none"' : ''}>
        <h2>웹페이지 게시</h2>
        <div class="subtabs">
          <button id="modeFileBtn" type="button" class="active">파일 업로드</button>
          <button id="modeSrcBtn" type="button">소스 입력</button>
        </div>
        <div id="modeFile">
          <div class="dropzone" id="dz">HTML 파일을 여기에 끌어다 놓거나 클릭하세요</div>
          <input id="file" type="file" accept=".html,.htm,text/html" hidden>
        </div>
        <div id="modeSrc" style="display:none">
          <textarea id="srcTa" class="md" placeholder="&lt;!DOCTYPE html&gt;… HTML 소스를 붙여넣으세요"></textarea>
        </div>
        <div class="field">
          <label for="title">표시 이름 (선택 — 페이지 탭·방 목록에 노출)</label>
          <input id="title" type="text" placeholder="Time for a coffee break">
        </div>
        <div class="btn-row">
          <button id="publishBtn" disabled>게시</button>
          <button id="pubCancel" type="button" style="display:none">취소</button>
        </div>
        <div class="preview-label" id="pvLabel" style="display:none">미리보기</div>
        <div class="viewer" id="pvWrap" style="display:none"><iframe id="pvFrame" sandbox="allow-scripts" title="미리보기"></iframe></div>
      </div>`;
}

function webTabMarkup(room, used, editor) {
  if (!used && editor) {
    return `
      <div class="panel">
        <h2>마크다운으로 페이지 만들기</h2>
        <ol>
          <li>아래 입력창에 마크다운으로 내용을 작성합니다. (<code># 제목</code>, <code>- 목록</code>, <code>**굵게**</code>, <code>| 표 |</code> 등)</li>
          <li>입력하는 즉시 아래 미리보기에서 완성된 페이지 모습을 확인할 수 있습니다.</li>
          <li>게시하면 작성한 내용이 그대로 이 방의 웹페이지가 됩니다.</li>
        </ol>
      </div>
      <div class="field">
        <label for="title">표시 이름 (선택 — 방 목록에 노출)</label>
        <input id="title" type="text" placeholder="예: 주간 회의 안내">
      </div>
      <textarea id="md" class="md" placeholder="# 제목&#10;&#10;내용을 입력하세요…"></textarea>
      <div class="preview-label">미리보기</div>
      <div class="preview md-body" id="pv"></div>
      <div class="btn-row"><button id="publishBtn" disabled>게시</button></div>`;
  }
  if (!used) {
    return pubFormMarkup(false);
  }
  // 게시중 — 브라우저처럼 페이지 탭 스트립(+ 추가 버튼)으로 여러 페이지를 전환한다.
  // 탭·뷰어는 클라이언트가 PAGES(서버 주입 목록)로 렌더하고, 조작 버튼은 활성 페이지에 적용된다.
  if (editor) {
    return `
      <div class="viewer" id="viewerWrap"><iframe id="pageFrame" title="${room}"></iframe></div>
      <div class="btn-row" id="pageActions">
        <button id="openBtn">전체화면으로 열기</button>
        <button id="dlBtn">HTML 다운로드</button>
        <button id="editBtn">내용 수정</button>
        <button class="danger" id="deleteBtn">삭제</button>
      </div>
      <div id="editSec" style="display:none">
        <textarea id="md" class="md"></textarea>
        <div class="preview-label">미리보기</div>
        <div class="preview md-body" id="pv"></div>
        <div class="btn-row">
          <button id="saveBtn">수정 게시</button>
          <button id="cancelBtn">취소</button>
        </div>
      </div>
      <div id="addSec" style="display:none">
        <div class="field">
          <label for="addTitle">표시 이름 (선택 — 페이지 탭에 노출)</label>
          <input id="addTitle" type="text" placeholder="예: 주간 회의 안내">
        </div>
        <textarea id="addMd" class="md" placeholder="# 제목&#10;&#10;내용을 입력하세요…"></textarea>
        <div class="preview-label">미리보기</div>
        <div class="preview md-body" id="addPv"></div>
        <div class="btn-row">
          <button id="addGo" disabled>새 페이지 게시</button>
          <button id="addCancel">취소</button>
        </div>
      </div>`;
  }
  return `
      <div class="viewer" id="viewerWrap"><iframe id="pageFrame" title="${room}"></iframe></div>
      <div class="btn-row" id="pageActions">
        <button id="openBtn">전체화면으로 열기</button>
        <button id="dlBtn">HTML 다운로드</button>
        <button id="fileRepBtn">파일로 교체</button>
        <button id="srcRepBtn">소스로 교체</button>
        <button class="danger" id="deleteBtn">삭제</button>
      </div>
      <input id="repFile" type="file" accept=".html,.htm,text/html" hidden>
      <div id="srcRepSec" style="display:none">
        <textarea id="repSrcTa" class="md" placeholder="&lt;!DOCTYPE html&gt;… 교체할 HTML 소스를 붙여넣으세요"></textarea>
        <div class="btn-row">
          <button id="srcRepGo">교체 게시</button>
          <button id="srcRepCancel">취소</button>
        </div>
      </div>
      ${pubFormMarkup(true)}`;
}

// ---------- 클라이언트 스크립트 ----------

// 메시지 표시 + HTML 파일 리더 (웹페이지 탭 공용)
function helperSnippet() {
  return `
  function flash(el, t, err){ el.textContent = t || ''; el.className = err ? 'status-msg err' : 'status-msg'; }
  function readFile(file, cb){
    if(!file) return;
    if(!/\\.html?$/i.test(file.name)){ flash(msgWeb, 'HTML 파일(.html)만 올릴 수 있습니다.', true); return; }
    var fileSize = file.size / 1024 / 1024;
    flash(msgWeb, fileSize > 1 ? '파일 읽는 중…' : '');
    var r = new FileReader();
    r.onload = function(){ cb(r.result, file); };
    r.onerror = function(){ flash(msgWeb, '파일을 읽지 못했습니다.', true); };
    r.readAsText(file);
  }`;
}

// 마크다운 에디터 공용: 게시 문서 빌드·미리보기 렌더
function editorCoreSnippet() {
  return `
  var MD_CSS = ${JSON.stringify(MD_CSS)};
  function esc(s){
    return String(s || '').replace(/[&<>"']/g, function(c){
      return { '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c];
    });
  }
  function buildDoc(title, bodyHtml){
    return '<!DOCTYPE html><html lang="ko"><head><meta charset="UTF-8">'
      + '<meta name="viewport" content="width=device-width, initial-scale=1.0">'
      + '<title>' + esc(title) + '</title>'
      + '<link rel="stylesheet" href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/static/pretendard.min.css">'
      + '<style>body{background:#fff;margin:0;padding:48px 24px;'
      + 'font-family:"Pretendard",-apple-system,BlinkMacSystemFont,"Apple SD Gothic Neo","Malgun Gothic",sans-serif}'
      + '.wrap{max-width:860px;margin:0 auto}' + MD_CSS + '</style>'
      + '</head><body><div class="wrap md-body">' + bodyHtml + '</div></body></html>';
  }
  function render(){
    var t = md.value;
    if(t.trim()){ pv.innerHTML = marked.parse(t); }
    else { pv.innerHTML = '<p style="color:#5C6B79;font-size:15px">위 입력창에 작성하면 여기에 미리보기가 표시됩니다.</p>'; }
  }`;
}

// 메모·파일 탭
function notesSnippet() {
  return `
  var msgNotes = document.getElementById('msgNotes');
  var noteList = document.getElementById('noteList');
  var nText = document.getElementById('nText');
  var nFiles = document.getElementById('nFiles');
  var nDrop = document.getElementById('nDrop');
  var nSave = document.getElementById('nSave');
  var nPreview = document.getElementById('nPreview');
  var DROP_HINT = '이 영역 어디에나 파일을 끌어다 놓거나, 여기를 클릭해 선택하세요 · 캡처 이미지는 Ctrl/⌘+V로 바로 붙여넣기';

  // 체크리스트 문법: '[ ] 항목' / '[x] 항목' — 저장된 메모에서 체크박스로 렌더·토글
  // \\r? : 모바일(CRLF) 줄바꿈으로 저장된 경우 \\r이 줄 끝에 남아 $ 앵커 실패하는 것 방지
  // ] 뒤 구분자는 정확히 공백 1칸만 소비한다 — \\s*로 전부 삼키면 사용자가 항목을 들여쓰려고
  // ] 뒤에 넣은 추가 공백까지 파싱·토글·재저장 때마다 사라져 "편집 중엔 보이는데 저장하면
  // 없어지는" 현상이 생긴다. (span은 white-space:pre-wrap이라 남은 공백이 그대로 보인다)
  var CL_RE = /^\\s*[\\[［](\\s|x|X)?[\\]］](?: )?(.*?)\\r?$/;
  var TEXT_HINT = '내용을 입력하세요 (위 체크리스트·글머리 기호·번호 매기기 버튼으로 목록 형식을 선택할 수 있어요)';
  var CL_HINT = '한 줄에 한 항목씩 입력하세요 (저장 시 체크박스 목록으로 변환)';
  var BULLET_HINT = '한 줄에 한 항목씩 입력하세요 (저장 시 글머리 기호 목록으로 변환)';
  var NUMBER_HINT = '한 줄에 한 항목씩 입력하세요 (저장 시 번호 매기기 목록으로 변환)';
  // 서식 모드: 'none' | 'checklist' | 'bullet' | 'number' — 세 버튼은 하나만 켜진다(라디오처럼 동작)
  var fmtMode = 'none';
  var nCheck = document.getElementById('nCheck');
  var nBullet = document.getElementById('nBullet');
  var nNumber = document.getElementById('nNumber');
  var fmtBtns = [nCheck, nBullet, nNumber];

  function hasChecklistText(text){
    return (text || '').replace(/\\r\\n/g, '\\n').split('\\n').some(function(l){ return CL_RE.test(l); });
  }
  function addChecklistMarkers(text){
    return (text || '').replace(/\\r\\n/g, '\\n').split('\\n').map(function(l){
      return (l.trim() && !CL_RE.test(l)) ? '[ ] ' + l : l;
    }).join('\\n');
  }
  function attachUndoRedo(ta, onChange){
    var undo = [ta.value];
    var redo = [];
    var restoring = false;
    function commit(){
      if(restoring) return;
      var v = ta.value;
      if(undo[undo.length - 1] !== v){
        undo.push(v);
        if(undo.length > 100) undo.shift();
        redo = [];
      }
    }
    function restore(v){
      restoring = true;
      ta.value = v;
      ta.selectionStart = ta.selectionEnd = ta.value.length;
      restoring = false;
      if(onChange) onChange();
    }
    ta.addEventListener('input', commit);
    ta.addEventListener('keydown', function(e){
      var mod = e.ctrlKey || e.metaKey;
      if(!mod) return;
      var k = (e.key || '').toLowerCase();
      if(k === 'z' && !e.shiftKey){
        if(undo.length <= 1) return;
        e.preventDefault();
        redo.push(undo.pop());
        restore(undo[undo.length - 1]);
      } else if(k === 'y' || (k === 'z' && e.shiftKey)){
        if(!redo.length) return;
        e.preventDefault();
        var v = redo.pop();
        undo.push(v);
        restore(v);
      }
    });
    return { commit: commit };
  }
  function setFmtMode(mode){
    fmtMode = (fmtMode === mode) ? 'none' : mode;
    fmtBtns.forEach(function(b){ b.className = ''; });
    if(fmtMode === 'checklist'){ nCheck.className = 'active'; nText.placeholder = CL_HINT; }
    else if(fmtMode === 'bullet'){ nBullet.className = 'active'; nText.placeholder = BULLET_HINT; }
    else if(fmtMode === 'number'){ nNumber.className = 'active'; nText.placeholder = NUMBER_HINT; }
    else { nText.placeholder = TEXT_HINT; }
    nText.focus();
  }
  nCheck.addEventListener('click', function(){ setFmtMode('checklist'); });
  nBullet.addEventListener('click', function(){ setFmtMode('bullet'); });
  nNumber.addEventListener('click', function(){ setFmtMode('number'); });

  function fmtSize(b){ return b >= 1048576 ? (b/1048576).toFixed(1) + 'MB' : Math.max(1, Math.round(b/1024)) + 'KB'; }

  // 파일이 이미지인지 판정 — MIME 우선, 없으면 확장자로 (구버전 메모 대비)
  var IMG_EXT = /\\.(png|jpe?g|gif|webp|bmp|svg|avif|heic|heif)$/i;
  function isImage(f){
    if(f.type && f.type.indexOf('image/') === 0) return true;
    return !!(f.name && IMG_EXT.test(f.name));
  }

  // 메모 텍스트를 클립보드에 복사 (실패 시 execCommand 대체)
  function copyText(text, btn){
    function done(){ var old = btn.textContent; btn.textContent = '복사됨'; setTimeout(function(){ btn.textContent = old; }, 1200); }
    function fallback(){
      var ta = document.createElement('textarea'); ta.value = text;
      ta.style.position = 'fixed'; ta.style.left = '-9999px';
      document.body.appendChild(ta); ta.focus(); ta.select();
      try { document.execCommand('copy'); done(); } catch(e){ flash(msgNotes, '복사 실패', true); }
      document.body.removeChild(ta);
    }
    if(navigator.clipboard && navigator.clipboard.writeText){
      navigator.clipboard.writeText(text).then(done).catch(fallback);
    } else { fallback(); }
  }

  function clickDownload(href, name){
    var a = document.createElement('a');
    a.href = href;
    if(name) a.download = name;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
  }

  // 첨부 저장: 1개는 그대로, 여러 개는 ZIP 한 파일로 받아 모바일에서도 전부 저장되게
  function saveFiles(note){
    var files = note.files || [];
    if(files.length === 0) return;
    if(files.length === 1){ clickDownload('/api/room/' + ROOM + '/file/' + files[0].id, files[0].name); return; }
    clickDownload('/api/room/' + ROOM + '/notezip/' + note.id);
  }

  // 선택된 파일에 맞춰 드롭존 안내 문구 갱신 + 이미지 미리보기 렌더
  function updateDropLabel(){
    var n = nFiles.files ? nFiles.files.length : 0;
    if(!n){ nDrop.textContent = DROP_HINT; }
    else {
      var names = [];
      for(var i = 0; i < nFiles.files.length; i++) names.push(nFiles.files[i].name);
      nDrop.textContent = '첨부 ' + n + '개: ' + names.join(', ') + ' (클릭해 변경)';
    }
    renderPreviews();
  }

  // 첨부에서 index 파일을 제거
  function removeAttachment(index){
    var dt = new DataTransfer();
    for(var i = 0; i < nFiles.files.length; i++){ if(i !== index) dt.items.add(nFiles.files[i]); }
    nFiles.files = dt.files;
    updateDropLabel();
  }

  // 붙이거나 첨부한 이미지를 저장 전에도 썸네일로 바로 보여준다
  var previewUrls = [];
  function renderPreviews(){
    for(var k = 0; k < previewUrls.length; k++) URL.revokeObjectURL(previewUrls[k]);
    previewUrls = [];
    nPreview.innerHTML = '';
    var files = nFiles.files || [];
    for(var i = 0; i < files.length; i++){
      if(!isImage(files[i])) continue;
      (function(idx, file){
        var url = URL.createObjectURL(file);
        previewUrls.push(url);
        var wrap = document.createElement('div'); wrap.className = 'thumb';
        var img = document.createElement('img'); img.src = url; img.alt = file.name; img.title = file.name;
        var rm = document.createElement('button');
        rm.type = 'button'; rm.className = 'rm'; rm.textContent = '×';
        rm.setAttribute('aria-label', file.name + ' 첨부 제거');
        rm.addEventListener('click', function(){ removeAttachment(idx); });
        wrap.appendChild(img); wrap.appendChild(rm);
        nPreview.appendChild(wrap);
      })(i, files[i]);
    }
  }

  // 드롭존·메모장 어디에나 파일을 끌어다 놓으면 첨부에 추가
  function addDroppedFiles(list){
    if(!list || !list.length) return;
    var dt = new DataTransfer();
    if(nFiles.files){ for(var i = 0; i < nFiles.files.length; i++) dt.items.add(nFiles.files[i]); }
    for(var j = 0; j < list.length; j++) dt.items.add(list[j]);
    nFiles.files = dt.files;
    updateDropLabel();
    flash(msgNotes, list.length + '개 파일이 첨부되었습니다.');
  }

  nDrop.addEventListener('click', function(){ nFiles.click(); });
  nFiles.addEventListener('change', updateDropLabel);

  function onDragOver(el){ return function(e){ e.preventDefault(); el.classList.add('is-over'); }; }
  function onDragLeave(el){ return function(){ el.classList.remove('is-over'); }; }
  function onDrop(el){ return function(e){
    if(!e.dataTransfer || !e.dataTransfer.files || !e.dataTransfer.files.length) return;
    e.preventDefault(); el.classList.remove('is-over');
    addDroppedFiles(e.dataTransfer.files);
  }; }
  [nDrop, nText].forEach(function(el){
    el.addEventListener('dragover', onDragOver(el));
    el.addEventListener('dragleave', onDragLeave(el));
    el.addEventListener('drop', onDrop(el));
  });

  // 클립보드의 이미지(캡처·스크린샷 등)를 붙여넣기(Ctrl/⌘+V)로 바로 첨부
  function pastedImageFiles(cd){
    if(!cd) return [];
    var out = [], i;
    var items = cd.items || [];
    for(i = 0; i < items.length; i++){
      if(items[i].kind === 'file' && items[i].type && items[i].type.indexOf('image/') === 0){
        var f = items[i].getAsFile();
        if(f) out.push(f);
      }
    }
    // items를 제공하지 않는 브라우저 대비 — files에서 이미지만 추림
    if(!out.length && cd.files){
      for(i = 0; i < cd.files.length; i++){
        if(cd.files[i].type && cd.files[i].type.indexOf('image/') === 0) out.push(cd.files[i]);
      }
    }
    return out;
  }

  var pasteSeq = 0;
  // 캡처 이미지는 이름이 없거나 'image.png'로 겹치므로 타임스탬프 이름을 부여
  function namedImage(f){
    if(f.name && f.name !== 'image.png' && f.name !== 'blob') return f;
    var ext = ((f.type.split('/')[1]) || 'png').replace('jpeg', 'jpg');
    var d = new Date();
    function pad(n){ return (n < 10 ? '0' : '') + n; }
    var stamp = '' + d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate()) + '_' +
                pad(d.getHours()) + pad(d.getMinutes()) + pad(d.getSeconds());
    var name = 'screenshot_' + stamp + (++pasteSeq > 1 ? '_' + pasteSeq : '') + '.' + ext;
    try { return new File([f], name, { type: f.type }); }
    catch(e){ return f; }
  }

  // 메모·파일 탭이 활성일 때만 동작 — 다른 탭의 텍스트 붙여넣기를 가로채지 않는다
  document.addEventListener('paste', function(e){
    var panel = document.getElementById('tab-notes');
    if(!panel || !panel.classList.contains('active')) return;
    var imgs = pastedImageFiles(e.clipboardData || window.clipboardData);
    if(!imgs.length) return;
    e.preventDefault();
    addDroppedFiles(imgs.map(namedImage));
  });

  // 체크박스 토글 -> 해당 줄의 [ ]/[x] 마커를 바꿔 PUT (낙관적 반영, 실패 시 원복)
  function toggleChecklistLine(n, idx, cb, row){
    var lines = (n.text || '').replace(/\\r\\n/g, '\\n').split('\\n');
    var m = CL_RE.exec(lines[idx] || '');
    if(!m){ return; }
    var done = cb.checked;
    var prev = n.text;
    lines[idx] = '[' + (done ? 'x' : ' ') + '] ' + m[2];
    n.text = lines.join('\\n');
    row.classList.toggle('done', done);
    fetch('/api/room/' + ROOM + '/notes', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id: n.id, text: n.text })
    })
      .then(function(r){
        if(!r.ok){ throw new Error('HTTP ' + r.status); }
      })
      .catch(function(e){
        n.text = prev;
        cb.checked = !done;
        row.classList.toggle('done', !done);
        flash(msgNotes, '체크 저장 실패: ' + e.message, true);
      });
  }

  // 메모 본문 렌더:
  //   - 체크리스트 줄: 체크박스(input) 클릭 → 토글, 항목 텍스트(span) 클릭 → 체크 토글
  //   - 빈 영역(div.cl 배경) 클릭 → 인라인 수정 편집창 열기
  function buildNoteBody(card, n){
    var lines = (n.text || '').replace(/\\r\\n/g, '\\n').split('\\n');
    var hasCl = lines.some(function(l){ return CL_RE.test(l); });
    if(!hasCl){
      var p = document.createElement('p'); p.textContent = n.text;
      p.className = 'editable'; p.title = '클릭하면 수정할 수 있습니다';
      p.addEventListener('click', function(){ startEditNote(card, n, p); });
      return p;
    }
    var box = document.createElement('div'); box.className = 'cl';
    function openEdit(){ startEditNote(card, n, box); }
    box.title = '항목: 클릭하면 체크 · 빈 영역: 클릭하면 수정';
    box.addEventListener('click', function(e){ if(e.target.type === 'checkbox') return; openEdit(); });
    lines.forEach(function(line, idx){
      var m = CL_RE.exec(line);
      if(m){
        var row = document.createElement('div');
        row.className = 'cl-row' + (/x/i.test(m[1] || '') ? ' done' : '');
        var cb = document.createElement('input'); cb.type = 'checkbox';
        cb.checked = /x/i.test(m[1] || '');
        // 항목 텍스트가 공백으로 시작하면(들여쓴 하위 항목) 체크박스 테두리를 투명 처리 —
        // 클릭·체크 동작은 그대로 유지하고 시각적으로만 숨긴다.
        if(/^\\s/.test(m[2] || '')) cb.className = 'ghost-box';
        cb.addEventListener('change', function(){ toggleChecklistLine(n, idx, cb, row); });
        var label = document.createElement('span'); label.textContent = m[2];
        label.addEventListener('click', function(e){ e.stopPropagation(); cb.checked = !cb.checked; cb.dispatchEvent(new Event('change')); });
        row.appendChild(cb); row.appendChild(label);
        box.appendChild(row);
      } else if(line.trim()){
        var t = document.createElement('div'); t.className = 'cl-text';
        t.textContent = line;
        box.appendChild(t);
      }
    });
    return box;
  }

  // 메모 본문 클릭 -> 그 자리에서 수정 (수정 저장 시 PUT, 취소 시 원복)
  function startEditNote(card, n, p){
    if(card.querySelector('.note-edit')) return;
    var wrap = document.createElement('div'); wrap.className = 'note-edit';
    var ta = document.createElement('textarea'); ta.className = 'input'; ta.value = n.text || '';
    // 수정창은 스크롤 없이 입력된 텍스트 전체가 보이도록 내용 높이에 맞춰 자동 확장
    ta.style.overflowY = 'hidden';
    function fitTa(){ ta.style.height = 'auto'; ta.style.height = (ta.scrollHeight + 4) + 'px'; }
    ta.addEventListener('input', fitTa);
    var editHistory = attachUndoRedo(ta, fitTa);
    ta.addEventListener('keydown', function(e){
      if(e.key !== 'Enter' || !hasChecklistText(n.text || ta.value)) return;
      e.preventDefault();
      var start = ta.selectionStart;
      var end = ta.selectionEnd;
      var insert = '\\n[ ] ';
      ta.value = ta.value.slice(0, start) + insert + ta.value.slice(end);
      ta.selectionStart = ta.selectionEnd = start + insert.length;
      editHistory.commit();
      fitTa();
    });
    var row = document.createElement('div'); row.className = 'meta-line';
    var actions = document.createElement('div'); actions.className = 'actions';
    var ok = document.createElement('button'); ok.className = 'mini'; ok.textContent = '수정 저장';
    var cancel = document.createElement('button'); cancel.className = 'mini'; cancel.textContent = '취소';
    ok.addEventListener('click', function(){
      var v = ta.value;
      if(hasChecklistText(n.text || v)) v = addChecklistMarkers(v);
      if(!v.trim() && !(n.files && n.files.length)){ flash(msgNotes, '내용을 입력하세요.', true); return; }
      ok.disabled = true; cancel.disabled = true;
      fetch('/api/room/' + ROOM + '/notes', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id: n.id, text: v })
      })
        .then(function(r){
          if(r.ok){ flash(msgNotes, '수정됨'); loadNotes(); }
          else { ok.disabled = false; cancel.disabled = false; flash(msgNotes, '수정 실패 (HTTP ' + r.status + ')', true); }
        })
        .catch(function(e){ ok.disabled = false; cancel.disabled = false; flash(msgNotes, '수정 실패: ' + e.message, true); });
    });
    cancel.addEventListener('click', function(){ wrap.replaceWith(p); });
    actions.appendChild(ok); actions.appendChild(cancel);
    row.appendChild(actions);
    wrap.appendChild(ta); wrap.appendChild(row);
    p.replaceWith(wrap);
    fitTa();          // DOM 삽입 후에야 scrollHeight가 잡히므로 여기서 1회 실행
    ta.focus();
  }

  function renderNotes(items){
    noteList.innerHTML = '';
    if(!items.length){
      noteList.innerHTML = '<p class="empty-line">아직 저장된 메모·파일이 없습니다.</p>';
      return;
    }
    items.forEach(function(n){
      var card = document.createElement('div'); card.className = 'note'; card.id = 'note-' + n.id;
      if(n.title){ var h = document.createElement('h3'); h.textContent = n.title; card.appendChild(h); }
      var bodyEl;
      if(n.text){ bodyEl = buildNoteBody(card, n); card.appendChild(bodyEl); }
      if(n.files && n.files.length){
        // 이미지 첨부는 썸네일로, 그 외 파일은 기존 링크 칩으로 표시
        var imgs = document.createElement('div'); imgs.className = 'imgs';
        var fw = document.createElement('div'); fw.className = 'files';
        n.files.forEach(function(f){
          var href = '/api/room/' + ROOM + '/file/' + f.id;
          if(isImage(f)){
            var a = document.createElement('a');
            a.href = href; a.target = '_blank'; a.rel = 'noopener'; a.title = f.name;
            var img = document.createElement('img'); img.src = href; img.alt = f.name; img.loading = 'lazy';
            a.appendChild(img); imgs.appendChild(a);
          } else {
            var link = document.createElement('a');
            link.href = href;
            link.textContent = f.name + ' (' + fmtSize(f.size) + ')';
            fw.appendChild(link);
          }
        });
        if(imgs.childNodes.length) card.appendChild(imgs);
        if(fw.childNodes.length) card.appendChild(fw);
      }
      var m = document.createElement('div'); m.className = 'meta-line';
      var s = document.createElement('span'); s.textContent = n.createdAt + (n.editedAt ? ' · 수정 ' + n.editedAt : ''); m.appendChild(s);
      var actions = document.createElement('div'); actions.className = 'actions';

      // 공유 링크는 쿼리 방식(?note=) — #해시는 메신저 인앱 브라우저·현관 게이트에서 유실될 수 있음
      var linkBtn = document.createElement('button'); linkBtn.className = 'mini'; linkBtn.textContent = '링크 복사';
      linkBtn.addEventListener('click', function(){ copyText(location.origin + '/' + ROOM + '?note=' + n.id, linkBtn); });
      actions.appendChild(linkBtn);

      if(n.text){
        var copyBtn = document.createElement('button'); copyBtn.className = 'mini'; copyBtn.textContent = '텍스트 복사';
        copyBtn.addEventListener('click', function(){ copyText(n.text, copyBtn); });
        actions.appendChild(copyBtn);

        var editBtn = document.createElement('button'); editBtn.className = 'mini'; editBtn.textContent = '수정';
        editBtn.addEventListener('click', function(){ startEditNote(card, n, bodyEl); });
        actions.appendChild(editBtn);
      }
      if(n.files && n.files.length){
        var saveBtn = document.createElement('button'); saveBtn.className = 'mini'; saveBtn.textContent = '파일 저장';
        saveBtn.addEventListener('click', function(){ saveFiles(n); });
        actions.appendChild(saveBtn);
      }
      var del = document.createElement('button'); del.className = 'mini danger'; del.textContent = '삭제';
      del.addEventListener('click', function(){
        if(!window.confirm('이 메모를 삭제할까요? 첨부 파일도 함께 삭제됩니다.')) return;
        fetch('/api/room/' + ROOM + '/notes?id=' + n.id, { method: 'DELETE' })
          .then(function(r){ if(r.ok) loadNotes(); else flash(msgNotes, '삭제 실패 (HTTP ' + r.status + ')', true); })
          .catch(function(e){ flash(msgNotes, '삭제 실패: ' + e.message, true); });
      });
      actions.appendChild(del);
      m.appendChild(actions);
      card.appendChild(m);
      noteList.appendChild(card);
    });
  }

  // ?note={id} 쿼리(또는 구형 #note-{id} 해시)로 진입하면 메모 탭을 열고
  // 해당 메모로 스크롤·강조 (최초 렌더 시 한 번만)
  function linkedNoteId(){
    var q = new URLSearchParams(location.search).get('note');
    if(q && /^[0-9a-f]+$/.test(q)) return q;
    var m = /^#note-([0-9a-f]+)$/.exec(location.hash);
    return m ? m[1] : null;
  }
  var linkedNoteShown = false;
  function focusLinkedNote(){
    if(linkedNoteShown) return;
    var id = linkedNoteId();
    if(!id) return;
    linkedNoteShown = true;
    var el = document.getElementById('note-' + id);
    if(!el){ flash(msgNotes, '링크된 메모를 찾을 수 없습니다. 삭제되었을 수 있습니다.', true); return; }
    openNotes();
    el.classList.add('linked');
    el.scrollIntoView({ block: 'center' });
  }

  function loadNotes(){
    fetch('/api/room/' + ROOM + '/notes')
      .then(function(r){ return r.ok ? r.json() : { items: [] }; })
      .then(function(d){ renderNotes(d.items || []); focusLinkedNote(); })
      .catch(function(){ noteList.innerHTML = '<p class="empty-line">목록을 불러오지 못했습니다.</p>'; });
  }

  nSave.addEventListener('click', function(){
    var files = nFiles.files ? Array.prototype.slice.call(nFiles.files) : [];
    if(!nText.value.trim() && !files.length){ flash(msgNotes, '내용을 쓰거나 파일을 첨부하세요.', true); return; }
    for(var i = 0; i < files.length; i++){
      if(files[i].size > 50 * 1048576){ flash(msgNotes, files[i].name + ' — 50MB를 초과합니다.', true); return; }
    }
    var textVal = nText.value;
    if(fmtMode === 'checklist'){
      textVal = addChecklistMarkers(textVal);
    } else if(fmtMode === 'bullet'){
      textVal = textVal.split('\\n').map(function(l){
        return l.trim() ? '• ' + l.trim() : l;
      }).join('\\n');
    } else if(fmtMode === 'number'){
      var seq = 0;
      textVal = textVal.split('\\n').map(function(l){
        if(!l.trim()) return l;
        seq++;
        return seq + '. ' + l.trim();
      }).join('\\n');
    }
    var fd = new FormData();
    fd.append('text', textVal);
    files.forEach(function(f){ fd.append('files', f); });
    nSave.disabled = true;
    flash(msgNotes, '저장 중…');
    fetch('/api/room/' + ROOM + '/notes', { method: 'POST', body: fd })
      .then(function(r){
        nSave.disabled = false;
        if(r.ok){ nText.value = ''; nFiles.value = ''; updateDropLabel(); flash(msgNotes, '저장됨'); loadNotes(); }
        else { flash(msgNotes, '저장 실패 (HTTP ' + r.status + ')', true); }
      })
      .catch(function(e){ nSave.disabled = false; flash(msgNotes, '저장 실패: ' + e.message, true); });
  });

  loadNotes();`;
}

// 게시중 공용: 페이지 탭 스트립(+ 추가 버튼) 렌더 + 활성 페이지 전환/열기/다운로드/삭제
// PAGES(서버 주입 목록)와 msgWeb, flash는 workspaceScript 스코프에 이미 있다.
function pagesCoreSnippet() {
  return `
  var pageFrame = document.getElementById('pageFrame');
  var viewerWrap = document.getElementById('viewerWrap');
  var pageActions = document.getElementById('pageActions');
  var cur = PAGES.length ? PAGES[0].id : 'main';

  function curPage(){
    for(var i = 0; i < PAGES.length; i++){ if(PAGES[i].id === cur) return PAGES[i]; }
    return null;
  }
  function viewUrl(id){
    return '/' + ROOM + '/view' + (id === 'main' ? '' : '?p=' + encodeURIComponent(id));
  }
  function setPage(id){
    saveCurrentPub();
    cur = id;
    mode = 'page'; activeDraft = null;
    pageFrame.src = viewUrl(id);
    showPanel('web');
    hideSub('addSec');
    if(typeof hidePub === 'function') hidePub();
    viewerWrap.style.display = '';
    pageActions.style.display = '';
    hideSub('editSec'); hideSub('srcRepSec');
    renderBar();
    flash(msgWeb, '');
  }
  setPage(cur);

  document.getElementById('openBtn').addEventListener('click', function(){
    window.open(viewUrl(cur), '_blank');
  });

  document.getElementById('dlBtn').addEventListener('click', function(){
    flash(msgWeb, '다운로드 준비 중…');
    fetch(viewUrl(cur)).then(function(r){
      if(!r.ok) throw new Error('HTTP ' + r.status);
      return r.text();
    }).then(function(t){
      var url = URL.createObjectURL(new Blob([t], { type: 'text/html' }));
      var a = document.createElement('a');
      a.href = url;
      a.download = ROOM + (cur === 'main' ? '' : '-' + cur) + '.html';
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      setTimeout(function(){ URL.revokeObjectURL(url); }, 1000);
      flash(msgWeb, '');
    }).catch(function(e){ flash(msgWeb, '다운로드 실패: ' + e.message, true); });
  });

  document.getElementById('deleteBtn').addEventListener('click', function(){
    if(!window.confirm('이 페이지를 삭제할까요? 다른 페이지와 메모·파일은 유지됩니다.')) return;
    flash(msgWeb, '삭제 중…');
    fetch('/api/room/' + ROOM + '/pages?id=' + encodeURIComponent(cur), { method: 'DELETE' })
      .then(function(r){
        if(r.ok){ location.reload(); return; }
        flash(msgWeb, r.status === 401 ? '권한이 없습니다. 새로고침 후 비밀번호를 다시 입력하세요.' : '삭제 실패 (HTTP ' + r.status + ')', true);
      }).catch(function(e){ flash(msgWeb, '삭제 실패: ' + e.message, true); });
  });`;
}

// 웹페이지 게시 폼 스크립트 — 첫 게시(미게시 방)와 새 페이지 추가(드래프트 탭)가 공용.
// 탭바 쪽(workspaceScript)의 드래프트 로직이 pubSnapshot/pubRestore/showPub/setPubCancel을 호출한다.
function pubFormSnippet() {
  return `
  var dz = document.getElementById('dz');
  var pubFileInput = document.getElementById('file');
  var srcTa = document.getElementById('srcTa');
  var modeFileBtn = document.getElementById('modeFileBtn');
  var modeSrcBtn = document.getElementById('modeSrcBtn');
  var modeFile = document.getElementById('modeFile');
  var modeSrc = document.getElementById('modeSrc');
  var publishBtn = document.getElementById('publishBtn');
  var pubCancelBtn = document.getElementById('pubCancel');
  var titleInput = document.getElementById('title');
  var pubMode = 'file';
  var htmlText = null;
  var pvLabel = document.getElementById('pvLabel');
  var pvWrap = document.getElementById('pvWrap');
  var pvFrame = document.getElementById('pvFrame');
  var pvTimer = null;
  var DZ_DEFAULT = dz.textContent;

  function renderPreview(){
    var doc = pubMode === 'file' ? htmlText : srcTa.value;
    if(doc && doc.trim()){
      // 컨테이너를 먼저 보이게 한 뒤 srcdoc을 넣어야, display:none 상태에서
      // srcdoc이 파싱되지 않아 미리보기가 빈 화면으로 남는 문제를 피한다.
      pvLabel.style.display = 'block';
      pvWrap.style.display = 'block';
      if(pvFrame.srcdoc !== doc) pvFrame.srcdoc = doc;
    } else {
      pvFrame.srcdoc = '';
      pvLabel.style.display = 'none';
      pvWrap.style.display = 'none';
    }
  }
  function schedulePreview(){
    clearTimeout(pvTimer);
    pvTimer = setTimeout(renderPreview, 400);
  }
  function syncPublish(immediate){
    publishBtn.disabled = pubMode === 'file' ? !htmlText : !srcTa.value.trim();
    if(immediate){ clearTimeout(pvTimer); renderPreview(); }
    else { schedulePreview(); }
  }
  function setPubMode(m){
    pubMode = m;
    modeFile.style.display = m === 'file' ? '' : 'none';
    modeSrc.style.display = m === 'src' ? '' : 'none';
    modeFileBtn.className = m === 'file' ? 'active' : '';
    modeSrcBtn.className = m === 'src' ? 'active' : '';
    syncPublish(true);
  }
  modeFileBtn.addEventListener('click', function(){ setPubMode('file'); });
  modeSrcBtn.addEventListener('click', function(){ setPubMode('src'); });
  srcTa.addEventListener('input', function(){ syncPublish(); });

  function onPubFile(text, file){
    htmlText = text;
    dz.textContent = file.name + ' (' + Math.round(file.size/1024) + 'KB) 선택됨';
    syncPublish(true);
    flash(msgWeb, '');
  }
  dz.addEventListener('click', function(){ pubFileInput.click(); });
  pubFileInput.addEventListener('change', function(){ readFile(pubFileInput.files[0], onPubFile); pubFileInput.value=''; });
  dz.addEventListener('dragover', function(e){ e.preventDefault(); dz.classList.add('is-over'); });
  dz.addEventListener('dragleave', function(){ dz.classList.remove('is-over'); });
  dz.addEventListener('drop', function(e){
    e.preventDefault(); dz.classList.remove('is-over');
    readFile(e.dataTransfer.files && e.dataTransfer.files[0], onPubFile);
  });

  // 드래프트 탭 전환용 — 폼 입력 상태를 탭별 객체에 저장/복원
  function pubSnapshot(t){
    t.mode = pubMode;
    t.html = htmlText;
    t.fileLabel = htmlText ? dz.textContent : '';
    t.src = srcTa.value;
    t.title = titleInput.value;
  }
  function pubRestore(s){
    htmlText = (s && s.html) || null;
    dz.textContent = (s && s.fileLabel) || DZ_DEFAULT;
    srcTa.value = (s && s.src) || '';
    titleInput.value = (s && s.title) || '';
    setPubMode((s && s.mode) || 'file');
  }
  function setPubCancel(on){ pubCancelBtn.style.display = on ? '' : 'none'; }
  function showPub(){
    var v = document.getElementById('viewerWrap'); if(v) v.style.display = 'none';
    var a = document.getElementById('pageActions'); if(a) a.style.display = 'none';
    hideSub('editSec'); hideSub('srcRepSec');
    document.getElementById('pubSec').style.display = '';
    flash(msgWeb, '');
  }
  function hidePub(){ var el = document.getElementById('pubSec'); if(el) el.style.display = 'none'; }
  pubCancelBtn.addEventListener('click', function(){
    if(mode === 'draft' && activeDraft){ closeDraft(activeDraft); }
    flash(msgWeb, '');
  });

  publishBtn.addEventListener('click', function(){
    var htmlBody = pubMode === 'file' ? htmlText : srcTa.value;
    if(!htmlBody || !htmlBody.trim()) return;
    publishBtn.disabled = true;
    flash(msgWeb, '게시 중…');
    fetch('/api/room/' + ROOM + '/pages', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ html: htmlBody, title: titleInput.value })
    }).then(function(r){
      if(r.ok){
        r.json().then(function(data){
          if(data.id && typeof setPage === 'function'){
            setPage(data.id);
          } else {
            location.reload();
          }
        });
        return;
      }
      flash(msgWeb, r.status === 401 ? '권한이 없습니다. 새로고침 후 비밀번호를 다시 입력하세요.' : '게시 실패 (HTTP ' + r.status + ')', true);
      publishBtn.disabled = false;
    }).catch(function(e){ flash(msgWeb, '게시 실패: ' + e.message, true); publishBtn.disabled = false; });
  });`;
}

// 웹페이지 탭 (상태별) — 비밀번호 설정은 방 설정 패널로 이관되어 게시 폼에서 제거됨
function webSnippet(room, meta, editor, used) {
  if (!used && editor) {
    return `
  var md = document.getElementById('md');
  var pv = document.getElementById('pv');
  var publishBtn = document.getElementById('publishBtn');
  ${editorCoreSnippet()}

  md.addEventListener('input', function(){
    render();
    publishBtn.disabled = !md.value.trim();
  });
  render();

  publishBtn.addEventListener('click', function(){
    if(!md.value.trim()) return;
    var title = document.getElementById('title').value;
    publishBtn.disabled = true;
    flash(msgWeb, '게시 중…');
    fetch('/api/room/' + ROOM + '/pages', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        html: buildDoc(title || ROOM, marked.parse(md.value)),
        markdown: md.value,
        title: title
      })
    }).then(function(r){
      if(r.ok){ location.reload(); return; }
      flash(msgWeb, '게시 실패 (HTTP ' + r.status + ')', true);
      publishBtn.disabled = false;
    }).catch(function(e){ flash(msgWeb, '게시 실패: ' + e.message, true); publishBtn.disabled = false; });
  });`;
  }

  if (!used) {
    return pubFormSnippet();
  }

  if (editor) {
    return `
  ${pagesCoreSnippet()}
  var md = document.getElementById('md');
  var pv = document.getElementById('pv');
  var editSec = document.getElementById('editSec');
  var saveBtn = document.getElementById('saveBtn');
  var addSec = document.getElementById('addSec');
  function showAddPage(){
    mode = 'add'; activeDraft = null;
    showPanel('web');
    addSec.style.display = '';
    viewerWrap.style.display = 'none';
    pageActions.style.display = 'none';
    hideSub('editSec');
    renderBar();
    flash(msgWeb, '');
  }
  ${editorCoreSnippet()}

  document.getElementById('editBtn').addEventListener('click', function(){
    flash(msgWeb, '내용 불러오는 중…');
    addSec.style.display = 'none';
    fetch('/' + ROOM + '/source' + (cur === 'main' ? '' : '?p=' + encodeURIComponent(cur))).then(function(r){
      return r.ok ? r.text() : '';
    }).then(function(t){
      md.value = t || '';
      editSec.style.display = '';
      render();
      flash(msgWeb, '');
      md.focus();
    }).catch(function(e){ flash(msgWeb, '불러오기 실패: ' + e.message, true); });
  });

  document.getElementById('cancelBtn').addEventListener('click', function(){
    editSec.style.display = 'none';
    flash(msgWeb, '');
  });

  md.addEventListener('input', render);

  saveBtn.addEventListener('click', function(){
    if(!md.value.trim()){ flash(msgWeb, '내용을 입력하세요.', true); return; }
    var p = curPage();
    var docTitle = (p && p.title) ? p.title : ROOM;
    saveBtn.disabled = true;
    flash(msgWeb, '게시 중…');
    fetch('/api/room/' + ROOM + '/pages?id=' + encodeURIComponent(cur), {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ html: buildDoc(docTitle, marked.parse(md.value)), markdown: md.value })
    }).then(function(r){
      if(r.ok){ location.reload(); return; }
      flash(msgWeb, r.status === 401 ? '권한이 없습니다. 새로고침 후 비밀번호를 다시 입력하세요.' : '게시 실패 (HTTP ' + r.status + ')', true);
      saveBtn.disabled = false;
    }).catch(function(e){ flash(msgWeb, '게시 실패: ' + e.message, true); saveBtn.disabled = false; });
  });

  // ---- 새 페이지 추가 (+ 버튼) ----
  var addMd = document.getElementById('addMd');
  var addPv = document.getElementById('addPv');
  var addGo = document.getElementById('addGo');
  var addTitle = document.getElementById('addTitle');

  function renderAdd(){
    if(addMd.value.trim()){ addPv.innerHTML = marked.parse(addMd.value); }
    else { addPv.innerHTML = '<p style="color:#5C6B79;font-size:15px">위 입력창에 작성하면 여기에 미리보기가 표시됩니다.</p>'; }
  }
  addMd.addEventListener('input', function(){
    renderAdd();
    addGo.disabled = !addMd.value.trim();
  });
  renderAdd();

  document.getElementById('addCancel').addEventListener('click', function(){
    setPage(cur);
  });

  addGo.addEventListener('click', function(){
    if(!addMd.value.trim()) return;
    var t = addTitle.value;
    addGo.disabled = true;
    flash(msgWeb, '게시 중…');
    fetch('/api/room/' + ROOM + '/pages', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ html: buildDoc(t || ROOM, marked.parse(addMd.value)), markdown: addMd.value, title: t })
    }).then(function(r){
      if(r.ok){ location.reload(); return; }
      flash(msgWeb, r.status === 401 ? '권한이 없습니다. 새로고침 후 비밀번호를 다시 입력하세요.' : '게시 실패 (HTTP ' + r.status + ')', true);
      addGo.disabled = false;
    }).catch(function(e){ flash(msgWeb, '게시 실패: ' + e.message, true); addGo.disabled = false; });
  });`;
  }

  return `
  ${pagesCoreSnippet()}
  var repFileInput = document.getElementById('repFile');
  var repSrcTa = document.getElementById('repSrcTa');
  var srcRepSec = document.getElementById('srcRepSec');

  document.getElementById('fileRepBtn').addEventListener('click', function(){ repFileInput.click(); });
  repFileInput.addEventListener('change', function(){
    readFile(repFileInput.files[0], function(text, file){
      if(!window.confirm(file.name + ' 으로 교체할까요? 현재 페이지 내용이 사라집니다.')) return;
      var title = window.prompt('표시 이름 (비우면 기존 이름 유지)') || '';
      flash(msgWeb, '교체 중…');
      fetch('/api/room/' + ROOM + '/pages?id=' + encodeURIComponent(cur), {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ html: text, title: title })
      }).then(function(r){
        if(r.ok){ location.reload(); return; }
        flash(msgWeb, r.status === 401 ? '권한이 없습니다. 새로고침 후 비밀번호를 다시 입력하세요.' : '교체 실패 (HTTP ' + r.status + ')', true);
      }).catch(function(e){ flash(msgWeb, '교체 실패: ' + e.message, true); });
    });
    repFileInput.value = '';
  });

  document.getElementById('srcRepBtn').addEventListener('click', function(){
    srcRepSec.style.display = srcRepSec.style.display === 'none' ? '' : 'none';
  });
  document.getElementById('srcRepCancel').addEventListener('click', function(){
    srcRepSec.style.display = 'none';
    flash(msgWeb, '');
  });
  document.getElementById('srcRepGo').addEventListener('click', function(){
    if(!repSrcTa.value.trim()){ flash(msgWeb, '교체할 HTML 소스를 입력하세요.', true); return; }
    if(!window.confirm('입력한 소스로 교체할까요? 현재 페이지 내용이 사라집니다.')) return;
    flash(msgWeb, '교체 중…');
    fetch('/api/room/' + ROOM + '/pages?id=' + encodeURIComponent(cur), {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ html: repSrcTa.value, title: '' })
    }).then(function(r){
      if(r.ok){ location.reload(); return; }
      flash(msgWeb, r.status === 401 ? '권한이 없습니다. 새로고침 후 비밀번호를 다시 입력하세요.' : '교체 실패 (HTTP ' + r.status + ')', true);
    }).catch(function(e){ flash(msgWeb, '교체 실패: ' + e.message, true); });
  });

  // ---- 새 페이지 게시 폼 (드래프트 탭 공용) ----
  ${pubFormSnippet()}`;
}

// 방 설정 패널 (공개/비공개 전환 + 사용기한 프리셋 + 테마 색)
function settingsSnippet(priv, exp, color) {
  return `
  var IS_PRIVATE = ${priv ? 'true' : 'false'};
  var setPanel = document.getElementById('setPanel');
  var msgSet = document.getElementById('msgSet');
  var setPw = document.getElementById('setPw');
  var setTitle = document.getElementById('setTitle');
  var setName = document.getElementById('setName');
  var setExp = document.getElementById('setExp');
  var setExpField = document.getElementById('setExpField');
  var expBtns = document.querySelectorAll('#expSel button');
  var expMode = ${exp ? "'pick'" : "'none'"};
  var colorBtns = document.querySelectorAll('#colorSel button');
  var colorSel = ${JSON.stringify(color)};

  document.getElementById('setBtn').addEventListener('click', function(){
    setPanel.style.display = setPanel.style.display === 'none' ? '' : 'none';
  });
  document.getElementById('setCancel').addEventListener('click', function(){
    setPanel.style.display = 'none';
    flash(msgSet, '');
  });

  function syncPwField(){
    var v = document.querySelector('input[name="vis"]:checked').value;
    document.getElementById('setPwField').style.display = v === 'private' ? '' : 'none';
  }
  document.querySelectorAll('input[name="vis"]').forEach(function(r){
    r.addEventListener('change', syncPwField);
  });

  // 사용기한 프리셋 선택 — 1일/1주일/1개월은 저장 시 KST 기준으로 날짜 계산
  expBtns.forEach(function(b){
    b.addEventListener('click', function(){
      expMode = b.getAttribute('data-exp');
      expBtns.forEach(function(x){ x.className = x === b ? 'active' : ''; });
      setExpField.style.display = expMode === 'pick' ? '' : 'none';
      flash(msgSet, '');
    });
  });

  // 테마 색 선택
  colorBtns.forEach(function(b){
    b.addEventListener('click', function(){
      colorSel = b.getAttribute('data-color');
      colorBtns.forEach(function(x){ x.className = x === b ? 'sel' : ''; });
    });
  });

  function expPreset(kind){
    var p = new Date().toLocaleString('sv-SE', { timeZone: 'Asia/Seoul' }).slice(0, 10).split('-');
    var d = new Date(+p[0], +p[1] - 1, +p[2]);
    if(kind === '1d') d.setDate(d.getDate() + 1);
    else if(kind === '1w') d.setDate(d.getDate() + 7);
    else if(kind === '1m') d.setMonth(d.getMonth() + 1);
    function z(n){ return (n < 10 ? '0' : '') + n; }
    return d.getFullYear() + '-' + z(d.getMonth() + 1) + '-' + z(d.getDate());
  }

  document.getElementById('setSave').addEventListener('click', function(){
    var vis = document.querySelector('input[name="vis"]:checked').value;
    if(vis === 'private' && !IS_PRIVATE && !setPw.value){
      flash(msgSet, '비공개로 바꾸려면 비밀번호를 입력하세요.', true);
      return;
    }
    // 방 이름(주소) 변경 — 설정 저장 뒤 PATCH /api/rooms 로 처리
    var newName = setName ? setName.value.trim() : '';
    var wantRename = !!(setName && newName && newName !== ROOM);
    if(setName && !newName){
      flash(msgSet, '방 이름은 비울 수 없어요.', true);
      return;
    }
    if(wantRename && !/^[A-Za-z0-9_-]{1,40}$/.test(newName)){
      flash(msgSet, '방 이름에는 영문·숫자·하이픈(-)·언더스코어(_)만 쓸 수 있어요. (공백·한글·특수문자 불가)', true);
      return;
    }
    var expiresAt = null;
    if(expMode === 'pick'){
      if(!setExp.value){ flash(msgSet, '달력에서 날짜를 선택하세요.', true); return; }
      expiresAt = setExp.value;
    } else if(expMode !== 'none'){
      expiresAt = expPreset(expMode);
    }
    flash(msgSet, '저장 중…');
    fetch('/api/room/' + ROOM + '/settings', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ visibility: vis, password: setPw.value, title: setTitle.value, expiresAt: expiresAt, color: colorSel || null })
    }).then(function(r){
      if(!r.ok){
        flash(msgSet, r.status === 401 ? '권한이 없습니다. 새로고침 후 비밀번호를 다시 입력하세요.' : '저장 실패 (HTTP ' + r.status + ')', true);
        return;
      }
      if(!wantRename){ location.reload(); return; }
      // 데이터·메타를 새 이름으로 옮기고 주소도 함께 바뀐다 (비공개 방은 새 인증 쿠키를 응답으로 받음)
      flash(msgSet, '방 이름 변경 중…');
      return fetch('/api/rooms', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id: ROOM, newId: newName })
      }).then(function(r2){
        if(r2.ok){ location.href = '/' + encodeURIComponent(newName); return; }
        var t = r2.status === 409 ? '이미 같은 이름의 방이 있어요.'
          : r2.status === 401 ? '권한이 없습니다. 새로고침 후 비밀번호를 다시 입력하세요.'
          : '사용할 수 없는 이름이거나 이름을 바꿀 수 없는 방이에요.';
        flash(msgSet, '설정은 저장했지만 이름 변경에 실패했어요 — ' + t, true);
      });
    }).catch(function(e){ flash(msgSet, '저장 실패: ' + e.message, true); });
  });`;
}

// 2탭 워크스페이스 전체 스크립트
function workspaceScript(room, meta, editor, used, priv, pages) {
  const pagesJs = JSON.stringify(pages || []).replace(/</g, '\\u003c');
  return `
(function(){
  var ROOM = '${room}';
  var PAGES = ${pagesJs};
  var msgWeb = document.getElementById('msgWeb');
  ${helperSnippet()}

  // ---- 탭바: 메모·파일 / 페이지 탭 / 드래프트 탭 / 웹페이지 + ----
  // '웹페이지 +'를 누르면 그 자리에 '웹페이지 N' 드래프트 탭이 생기고 + 버튼은 끝에 남는다.
  // 드래프트 탭은 게시 폼(파일 업로드/소스 입력/미리보기)을 열며, 탭마다 입력 상태를 따로 보관한다.
  var tabbarEl = document.querySelector('.tabbar');
  var addWebPageBtnBar = document.getElementById('addWebPageBtnBar');
  var notesTabBtn = document.querySelector('.tabbar button[data-tab="notes"]');
  var staticWebBtn = document.querySelector('.tabbar button[data-tab="web"]'); // 미게시 방에만 있음
  var USED = ${used ? 'true' : 'false'};
  var mode = 'notes';      // 'notes' | 'web'(미게시 게시 폼 탭) | 'page' | 'draft' | 'add'(에디터 방 추가 폼)
  var activeDraft = null;
  var DRAFTS = [];         // '웹페이지 +'로 연 드래프트 탭들 {mode, html, fileLabel, src, title}
  var STATIC_PUB = { mode: 'file', html: null, fileLabel: '', src: '', title: '' }; // 미게시 '웹페이지' 탭의 폼 상태

  function hideSub(id){ var el = document.getElementById(id); if(el) el.style.display = 'none'; }
  function showPanel(name){
    document.getElementById('tab-notes').className = 'tabpanel' + (name === 'notes' ? ' active' : '');
    document.getElementById('tab-web').className = 'tabpanel' + (name === 'web' ? ' active' : '');
  }
  function pageLabel(p, i){ return p.title ? p.title : (i === 0 ? '웹페이지' : '웹페이지 ' + (i + 1)); }
  function draftLabel(i){ return '웹페이지 ' + ((USED ? PAGES.length : 1) + i + 1); }
  function renderBar(){
    notesTabBtn.className = mode === 'notes' ? 'active' : '';
    if(staticWebBtn) staticWebBtn.className = mode === 'web' ? 'active' : '';
    Array.prototype.forEach.call(tabbarEl.querySelectorAll('button.webtab, button.drafttab'), function(b){
      b.parentNode.removeChild(b);
    });
    PAGES.forEach(function(p, i){
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'webtab' + (mode === 'page' && p.id === cur ? ' active' : '');
      b.textContent = pageLabel(p, i);
      b.title = pageLabel(p, i);
      b.addEventListener('click', function(){ setPage(p.id); });
      tabbarEl.insertBefore(b, addWebPageBtnBar);
    });
    DRAFTS.forEach(function(d, i){
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'drafttab addpage-bar' + (mode === 'draft' && activeDraft === d ? ' active' : '');
      b.textContent = draftLabel(i);
      b.title = draftLabel(i);
      b.addEventListener('click', function(){ openDraft(d); });
      tabbarEl.insertBefore(b, addWebPageBtnBar);
    });
    addWebPageBtnBar.className = 'addpage-bar' + (mode === 'add' ? ' active' : '');
  }
  function saveCurrentPub(){
    if(typeof pubSnapshot !== 'function') return;
    if(mode === 'draft' && activeDraft) pubSnapshot(activeDraft);
    else if(mode === 'web') pubSnapshot(STATIC_PUB);
  }
  function openNotes(){
    saveCurrentPub();
    mode = 'notes'; activeDraft = null;
    showPanel('notes');
    renderBar();
  }
  function openStaticWeb(){
    saveCurrentPub();
    mode = 'web'; activeDraft = null;
    showPanel('web');
    if(typeof pubRestore === 'function'){ showPub(); pubRestore(STATIC_PUB); setPubCancel(false); }
    renderBar();
  }
  function openDraft(d){
    saveCurrentPub();
    mode = 'draft'; activeDraft = d;
    showPanel('web');
    showPub(); pubRestore(d); setPubCancel(true);
    renderBar();
  }
  function closeDraft(d){
    var i = DRAFTS.indexOf(d);
    if(i > -1) DRAFTS.splice(i, 1);
    activeDraft = null;
    if(USED){ setPage(cur); } else { openStaticWeb(); }
  }
  notesTabBtn.addEventListener('click', openNotes);
  if(staticWebBtn) staticWebBtn.addEventListener('click', openStaticWeb);
  addWebPageBtnBar.addEventListener('click', function(){
    if(typeof pubRestore === 'function'){
      var d = { mode: 'file', html: null, fileLabel: '', src: '', title: '' };
      DRAFTS.push(d);
      openDraft(d);
      return;
    }
    if(typeof showAddPage === 'function'){ showAddPage(); return; } // 에디터 방(게시중)
    openStaticWeb();                                                // 에디터 방(미게시)
  });
  ${used ? '' : 'openNotes();'}

  // ---- 방 설정 ----
  ${settingsSnippet(priv, (meta && meta.expiresAt) ? meta.expiresAt : '', (meta && meta.color) ? meta.color : '')}

  // ---- 메모·파일 ----
  ${notesSnippet()}

  // ---- 웹페이지 ----
  ${webSnippet(room, meta, editor, used)}
})();`;
}

// 잠김 상태 (비밀번호 게이트)
function lockedScript(room) {
  return `
(function(){
  var ROOM = '${room}';
  var msg = document.getElementById('msg');
  var enterBtn = document.getElementById('enterBtn');
  var pw = document.getElementById('pw');
  function setMsg(t, err){ msg.textContent = t || ''; msg.className = err ? 'status-msg err' : 'status-msg'; }

  function enter(){
    if(!pw.value){ setMsg('비밀번호를 입력하세요.', true); return; }
    enterBtn.disabled = true;
    setMsg('확인 중…');
    fetch('/api/room/' + ROOM + '/auth', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ password: pw.value })
    }).then(function(r){
      if(r.ok){ location.reload(); return; }
      setMsg(r.status === 401 ? '비밀번호가 올바르지 않습니다.' : '확인 실패 (HTTP ' + r.status + ')', true);
      enterBtn.disabled = false;
    }).catch(function(e){ setMsg('확인 실패: ' + e.message, true); enterBtn.disabled = false; });
  }
  enterBtn.addEventListener('click', enter);
  pw.addEventListener('keydown', function(e){ if(e.key === 'Enter') enter(); });
})();`;
}
