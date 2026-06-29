// 사이트 전체 접근 비밀번호 게이트 (기획 도구 모음 공통 현관)
// 환경변수 SITE_PASSWORD가 설정된 경우에만 활성화됩니다.
// 설정되면 방문자는 공통 비밀번호 입력 후에만 로비·빈방·비번 없는 방·API에 접근할 수 있습니다.
// 단, 자체 열람 비밀번호가 설정된 방은 현관을 거치지 않고 방 비밀번호만으로 직접 접근할 수 있습니다.
//
// ── 포털(samsungda-portal)과 세션 공유(SSO) ──────────────────────────────────
// 포털(samsungda.net) 및 다른 도구(agentguide.samsungda.net 등)와 "같은"
// SITE_PASSWORD·세션 토큰·쿠키 이름(da_portal_session)을 쓰고, 쿠키를
// Domain=.samsungda.net 으로 발급한다. 따라서 포털(또는 다른 도구)에서 한 번
// 로그인했다면 여기(space.samsungda.net)로 직접 와도 재입력이 필요 없고(공유 쿠키로
// 통과), 반대로 여기서 로그인해도 포털·다른 도구에 그대로 통한다.
// 비밀번호를 바꾸면(SITE_PASSWORD 변경) 토큰이 달라져 기존 쿠키는 자동 무효화된다.
// SITE_PASSWORD 미설정 시 게이트 비활성화 — 잠금 사고 방지.
import { getCookie, escapeHtml, BASE_CSS, isValidRoomId, readIndex } from './_lib.js';

// 포털과 "동일"해야 세션 쿠키가 호환된다(한쪽 로그인이 양쪽에 통함).
const AUTH_COOKIE = 'da_portal_session';
const AUTH_MSG = 'da-portal-auth-v1';
const AUTH_MAX_AGE = 60 * 60 * 24 * 180; // 약 180일 동안 재입력 없이 유지
const SUBMIT_PATH = '/__site_auth';
const FONT_LINK = '<link rel="stylesheet" href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/static/pretendard.min.css">';

// ── 비밀번호/세션 토큰 (포털 samsungda-portal과 동일 방식) ─────────────────────
function bytesToHex(bytes) {
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function hmacHex(key, message) {
  const k = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(key),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', k, new TextEncoder().encode(message));
  return bytesToHex(new Uint8Array(sig));
}

function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

// 현재 비밀번호에서 결정되는 세션 토큰. 포털과 동일한 (SITE_PASSWORD, AUTH_MSG)
// 조합이라 토큰이 서로 호환된다.
function sessionToken(env) {
  return hmacHex(env.SITE_PASSWORD, AUTH_MSG);
}

async function isAuthed(request, env) {
  const cookie = getCookie(request, AUTH_COOKIE);
  if (!cookie) return false;
  return timingSafeEqual(cookie, await sessionToken(env));
}

// samsungda.net 영역에서는 서브도메인 간 세션 공유를 위해 Domain=.samsungda.net 으로
// 쿠키를 발급한다(포털·다른 도구와 같은 로그인 세션을 인식). 로컬(localhost)·
// *.pages.dev 미리보기에서는 Domain을 생략해 브라우저가 쿠키를 거부하지 않게 한다.
function cookieDomainAttr(hostname) {
  return hostname === 'samsungda.net' || hostname.endsWith('.samsungda.net')
    ? '; Domain=.samsungda.net'
    : '';
}

function cookieHeader(token, url) {
  const secure = url.protocol === 'https:' ? '; Secure' : '';
  return AUTH_COOKIE + '=' + token + '; Path=/; Max-Age=' + AUTH_MAX_AGE +
    '; HttpOnly; SameSite=Lax' + cookieDomainAttr(url.hostname) + secure;
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
<title>My Space · 기획 도구 모음</title>
${FONT_LINK}
<style>${BASE_CSS}</style>
</head>
<body>
<div class="wrap">
  <section>
    <div class="section-head">
      <h1>My Space</h1>
      <p class="sub">기획 도구 모음 공통 비밀번호를 입력하세요. (개별 방 비밀번호와 다릅니다)</p>
    </div>
    <form class="panel" method="POST" action="${SUBMIT_PATH}">
      ${nextField}
      <div class="field">
        <label for="pw">공통 비밀번호</label>
        <input id="pw" name="password" type="password" autocomplete="current-password" autofocus>
      </div>
      <div class="btn-row"><button type="submit">입장</button></div>
      ${error ? '<div class="status-msg err" style="margin-top:14px">비밀번호가 올바르지 않습니다.</div>' : ''}
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

  const url = new URL(request.url);

  // 공통 비밀번호 제출 처리 → 포털과 공유되는 세션 쿠키 발급(180일).
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
    if (pw && timingSafeEqual(pw, String(expected))) {
      // 현관 통과 → 원래 가려던 경로로 복귀 (방 URL이면 거기서 방 비번 패널이 뜸)
      return new Response(null, {
        status: 303,
        headers: { 'set-cookie': cookieHeader(await sessionToken(env), url), location: dest },
      });
    }
    return htmlResponse(gatePage(true, dest), 401);
  }

  // 이미 현관(또는 포털·다른 도구)을 통과한 공유 쿠키면 통과
  if (await isAuthed(request, env)) return next();

  // 자체 열람 비밀번호가 설정된 방은 현관을 건너뛰고 방 인증이 처리하도록 통과.
  // (방 페이지/뷰어/API의 실제 내용은 방 비번 검사로 보호됨)
  const candidate = candidateRoom(url.pathname);
  if (candidate && isValidRoomId(candidate)) {
    const index = await readIndex(env);
    const meta = index.rooms[candidate];
    if (meta && meta.passwordHash) return next();
  }

  // 미인증 → 공통 현관 게이트. 원래 요청 경로를 next로 보존.
  const requested = safeNext(url.pathname + url.search);
  return htmlResponse(gatePage(false, requested), 401);
}
