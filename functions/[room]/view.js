// GET /A-1/view — 업로드된 HTML 원본 (뷰어 iframe 소스 겸 전체화면 링크)
// 열람 비밀번호가 설정된 방은 인증 쿠키 없이는 방 페이지로 돌려보냄.
import { isValidRoomId, roomExists, readIndex, isAuthorized } from '../_lib.js';

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

  const obj = await context.env.SPACE.get('rooms/' + id + '/page.html');
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
