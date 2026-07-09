// GET /A-1/view — 게시된 HTML 원본 (뷰어 iframe 소스 겸 전체화면 링크)
// ?p={pid}로 추가 페이지(pages/{pid}.html)를 지정할 수 있다. 없거나 'main'이면 page.html.
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

const PID_RE = /^p[a-z0-9]{4,24}$/;

export async function onRequestGet(context) {
  const id = context.params.room;
  if (!isValidRoomId(id)) return new Response('Not Found', { status: 404 });

  const index = await readIndex(context.env);
  if (!roomExists(index, id)) return new Response('Not Found', { status: 404 });

  const meta = index.rooms[id] || null;

  // 비공개 방 미인증 → 방 페이지(비밀번호 게이트)로. 게이트 화면에는 뷰어 iframe이
  // 없으므로 재귀 위험이 없다. page.html 실존 여부와 무관하게 인증을 먼저 판정한다.
  if (!(await isAuthorized(context.request, id, meta))) {
    const roomUrl = new URL('/' + encodeURIComponent(id), context.request.url).toString();
    return Response.redirect(roomUrl, 302);
  }

  // 페이지 선택 — ?p={pid}는 추가 페이지, 없거나 'main'이면 첫 페이지(page.html)
  const pid = new URL(context.request.url).searchParams.get('p') || '';
  let key = 'rooms/' + id + '/page.html';
  if (pid && pid !== 'main') {
    if (!PID_RE.test(pid)) return new Response('Not Found', { status: 404 });
    key = 'rooms/' + id + '/pages/' + pid + '.html';
  }

  // 페이지가 있으면 meta 유무와 상관없이 그대로 제공한다. (meta가 없는데 방으로
  // 리다이렉트하면, 방 페이지가 페이지 실존으로 뷰어를 다시 렌더해 재귀가 되살아난다.)
  const obj = await context.env.SPACE.get(key);
  // 페이지가 없으면 방 페이지로 리다이렉트하면 안 된다 — 방 페이지가 이 뷰어를
  // <iframe src=".../view">로 다시 품기 때문에 무한 재귀 중첩이 생긴다(삭제한
  // 내용이 다시 살아나는 것처럼 보이는 원인). 깔끔한 빈 안내 페이지를 돌려준다.
  if (!obj) {
    return new Response(emptyViewPage(), {
      status: 404,
      headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' },
    });
  }

  return new Response(obj.body, {
    headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' },
  });
}

function emptyViewPage() {
  return '<!DOCTYPE html><html lang="ko"><head><meta charset="UTF-8">'
    + '<meta name="viewport" content="width=device-width, initial-scale=1.0">'
    + '<title>게시된 웹페이지 없음</title>'
    + '<link rel="stylesheet" href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/static/pretendard.min.css">'
    + '<style>html,body{height:100%}body{margin:0;display:flex;align-items:center;justify-content:center;'
    + 'background:#fff;color:#5b6470;font-size:15px;'
    + 'font-family:"Pretendard",-apple-system,BlinkMacSystemFont,"Apple SD Gothic Neo","Malgun Gothic",sans-serif}</style>'
    + '</head><body>게시된 웹페이지가 없습니다.</body></html>';
}
