// 사이트 전체 접근 비밀번호 게이트 (공동 현관)
// 환경변수 SITE_PASSWORD가 설정된 경우에만 활성화됩니다.
// 설정되면 방문자는 공동 현관 비밀번호 입력 후에만 로비·빈방·비번 없는 방·API에 접근할 수 있습니다.
// 단, 자체 열람 비밀번호가 설정된 방은 현관을 거치지 않고 방 비밀번호만으로 직접 접근할 수 있습니다.
// 비밀번호 평문은 저장하지 않고(쿠키에는 SHA-256 해시만), 비교 시점에만 해시 대조합니다.
import { sha256, getCookie, escapeHtml, BASE_CSS, isValidRoomId, readIndex } from './_lib.js';

const COOKIE = 'space_site_auth';
const SUBMIT_PATH = '/__site_auth';
const FONT_LINK = '<link rel="stylesheet" href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/static/pretendard.min.css">';

function cookieHeader(hash) {
  // 12시간 유지. 방별 인증 쿠키와 동일한 보안 속성.
  return COOKIE + '=' + hash + '; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=43200';
}

// 방 비번 직접 접근 대상 경로에서 방 ID 후보를 추출.
// /A-2, /A-2/view, /api/room/A-2, /api/room/A-2/auth 만 해당.
function candidateRoom(pathname) {
  let m = pathname.match(/^\/api\/room\/([^\/]+)(?:\/auth)?\/?$/);
  if (m) return m[1];
  m = pathname.match(/^\/([^\/]+)(?:\/view)?\/?$/);
  if (m) return m[1];
  return null;
}

// 현관 통과 후 돌아갈 경로. 오픈 리다이렉트 방지를 위해 동일 출처 경로만 허용.
function safeNext(raw) {
  if (typeof raw !== 'string' || !raw) return '/';
  if (raw[0] !== '/' || raw[1] === '/') return '/';      // 절대 URL·프로토콜 상대 차단
  if (raw.indexOf(SUBMIT_PATH) === 0) return '/';          // 제출 경로로 되돌리지 않음
  return raw;
}

function gatePage(error, next) {
  const nextField = '<input type="hidden" name="next" value="' + escapeHtml(next) + '">';
  return `<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>DA Space · 공동 현관</title>
${FONT_LINK}
<style>${BASE_CSS}</style>
</head>
<body>
<div class="wrap">
  <section>
    <div class="section-head">
      <h1>DA Space</h1>
      <p class="sub">공동 현관 비밀번호를 입력하세요. (개별 방 비밀번호와 다릅니다)</p>
    </div>
    <form class="panel" method="POST" action="${SUBMIT_PATH}">
      ${nextField}
      <div class="field">
        <label for="pw">공동 현관 비밀번호</label>
        <input id="pw" name="password" type="password" autocomplete="current-password" autofocus>
      </div>
      <div class="btn-row"><button type="submit">입장</button></div>
      ${error ? '<div class="status-msg err" style="margin-top:14px">공동 현관 비밀번호가 올바르지 않습니다.</div>' : ''}
    </form>
  </section>
</div>
</body>
</html>`;
}

function htmlResponse(body, status) {
  return new Response(body, {
    status: status || 200,
    headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' },
  });
}

export async function onRequest(context) {
  const { request, env, next } = context;
  const expected = env.SITE_PASSWORD;

  // SITE_PASSWORD 미설정 시 게이트 비활성화 — 잠금 사고 방지.
  if (!expected) return next();

  const expectedHash = await sha256(String(expected));
  const url = new URL(request.url);

  // 공동 현관 비밀번호 제출 처리
  if (url.pathname === SUBMIT_PATH && request.method === 'POST') {
    let pw = '';
    let dest = '/';
    try {
      const form = await request.formData();
      pw = String(form.get('password') || '');
      dest = safeNext(String(form.get('next') || '/'));
    } catch (e) {
      pw = '';
    }
    if (pw && (await sha256(pw)) === expectedHash) {
      // 현관 통과 → 원래 가려던 경로로 복귀 (방 URL이면 거기서 방 비번 패널이 뜸)
      return new Response(null, {
        status: 303,
        headers: { 'set-cookie': cookieHeader(expectedHash), location: dest },
      });
    }
    return htmlResponse(gatePage(true, dest), 401);
  }

  // 이미 현관을 통과한 쿠키면 통과
  if (getCookie(request, COOKIE) === expectedHash) return next();

  // 자체 열람 비밀번호가 설정된 방은 현관을 건너뛰고 방 인증이 처리하도록 통과.
  // (방 페이지/뷰어/API의 실제 내용은 방 비번 검사로 보호됨)
  const candidate = candidateRoom(url.pathname);
  if (candidate && isValidRoomId(candidate)) {
    const index = await readIndex(env);
    const meta = index.rooms[candidate];
    if (meta && meta.passwordHash) return next();
  }

  // 미인증 → 공동 현관 게이트. 원래 요청 경로를 next로 보존.
  const requested = safeNext(url.pathname + url.search);
  return htmlResponse(gatePage(false, requested), 401);
}
