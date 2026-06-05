// 사이트 전체 접근 비밀번호 게이트
// 환경변수 SITE_PASSWORD가 설정된 경우에만 활성화됩니다.
// 설정되면 방문자는 비밀번호 입력 후에만 로비·방·뷰어·API에 접근할 수 있습니다.
// 비밀번호 평문은 저장하지 않고(쿠키에는 SHA-256 해시만), 비교 시점에만 해시 대조합니다.
import { sha256, getCookie, BASE_CSS } from './_lib.js';

const COOKIE = 'space_site_auth';
const SUBMIT_PATH = '/__site_auth';
const FONT_LINK = '<link rel="stylesheet" href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/static/pretendard.min.css">';

function cookieHeader(hash) {
  // 12시간 유지. 방별 인증 쿠키와 동일한 보안 속성.
  return COOKIE + '=' + hash + '; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=43200';
}

function gatePage(error) {
  return `<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>DA Space · 접근 제한</title>
${FONT_LINK}
<style>${BASE_CSS}</style>
</head>
<body>
<div class="wrap">
  <section>
    <div class="section-head">
      <h1>DA Space</h1>
      <p class="sub">열람하려면 접근 비밀번호를 입력하세요.</p>
    </div>
    <form class="panel" method="POST" action="${SUBMIT_PATH}">
      <div class="field">
        <label for="pw">접근 비밀번호</label>
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

  const expectedHash = await sha256(String(expected));
  const url = new URL(request.url);

  // 비밀번호 제출 처리
  if (url.pathname === SUBMIT_PATH && request.method === 'POST') {
    let pw = '';
    try {
      const form = await request.formData();
      pw = String(form.get('password') || '');
    } catch (e) {
      pw = '';
    }
    if (pw && (await sha256(pw)) === expectedHash) {
      return new Response(null, {
        status: 303,
        headers: { 'set-cookie': cookieHeader(expectedHash), location: '/' },
      });
    }
    return htmlResponse(gatePage(true), 401);
  }

  // 이미 인증된 쿠키면 통과
  if (getCookie(request, COOKIE) === expectedHash) return next();

  // 미인증 → 게이트 페이지
  return htmlResponse(gatePage(false), 401);
}
