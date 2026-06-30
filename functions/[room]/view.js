// GET /A-1/view — 업로드된 HTML 원본 (뷰어 iframe 소스 겸 전체화면 링크)
// 열람 비밀번호가 설정된 방은 인증 쿠키 없이는 방 페이지로 돌려보냄.
import { isValidRoomId, roomExists, readIndex, isAuthorized, escapeHtml } from '../_lib.js';

// 게시된 페이지가 없을 때 보여줄 독립 안내 문서.
// 방 페이지로 리다이렉트하면 웹페이지 탭의 뷰어 iframe 안에서 방 화면이
// 자기 자신 안에 중첩 렌더링되므로(무한 반복처럼 보임), 뷰어 임베드에는
// 절대 방 페이지를 돌려주지 않고 이 안내 문서를 대신 응답한다.
function missingPage(id) {
  return `<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${escapeHtml(id)} · 게시된 웹페이지 없음</title>
<link rel="stylesheet" href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/static/pretendard.min.css">
<style>
  html,body{height:100%;margin:0}
  body{display:flex;align-items:center;justify-content:center;
    font-family:Pretendard,system-ui,sans-serif;font-size:15px;color:#667085;background:#fff;padding:24px}
  p{margin:0;text-align:center;line-height:1.6}
</style>
</head>
<body>
<p>게시된 웹페이지가 없습니다.<br>웹페이지 탭에서 다시 게시해 주세요.</p>
</body>
</html>`;
}

export async function onRequestGet(context) {
  const id = context.params.room;
  if (!isValidRoomId(id)) return new Response('Not Found', { status: 404 });

  const index = await readIndex(context.env);
  if (!roomExists(index, id)) return new Response('Not Found', { status: 404 });

  const meta = index.rooms[id] || null;
  const roomUrl = new URL('/' + encodeURIComponent(id), context.request.url).toString();

  // 비공개 방 미인증 → 방 페이지(비밀번호 게이트)로. 게이트 화면에는 뷰어 iframe이
  // 없으므로 재귀 위험이 없다. page.html 실존·meta 유무와 무관하게 인증을 먼저 판정한다.
  if (!(await isAuthorized(context.request, id, meta))) {
    return Response.redirect(roomUrl, 302);
  }

  // page.html이 있으면 meta 유무와 상관없이 그대로 제공한다. (meta가 없는데 방으로
  // 리다이렉트하면, 방 페이지가 page.html 실존으로 뷰어를 다시 렌더해 재귀가 되살아난다.)
  const obj = await context.env.SPACE.get('rooms/' + id + '/page.html');
  if (!obj) {
    // 임베드(뷰어 iframe)는 방으로 보내면 중첩 렌더링되므로 안내 문서를 응답.
    // 직접 탐색(전체화면 링크·오래된 URL)일 때만 방 페이지로 돌려보낸다.
    if (context.request.headers.get('Sec-Fetch-Dest') === 'document') {
      return Response.redirect(roomUrl, 302);
    }
    return new Response(missingPage(id), {
      status: 404,
      headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' },
    });
  }

  return new Response(obj.body, {
    headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' },
  });
}
