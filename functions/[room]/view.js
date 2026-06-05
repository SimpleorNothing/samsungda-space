// GET /A-1/view — 업로드된 HTML 원본 (뷰어 iframe 소스 겸 전체화면 링크)
// 열람 비밀번호가 설정된 방은 인증 쿠키 없이는 방 페이지로 돌려보냄.
import { isValidRoomId, roomExists, readIndex, isAuthorized } from '../_lib.js';

export async function onRequestGet(context) {
  const id = context.params.room;
  if (!isValidRoomId(id)) return new Response('Not Found', { status: 404 });

  const index = await readIndex(context.env);
  if (!roomExists(index, id)) return new Response('Not Found', { status: 404 });

  const meta = index.rooms[id];
  const roomUrl = new URL('/' + encodeURIComponent(id), context.request.url).toString();
  if (!meta) return Response.redirect(roomUrl, 302);

  if (!(await isAuthorized(context.request, id, meta))) {
    return Response.redirect(roomUrl, 302);
  }

  const obj = await context.env.SPACE.get('rooms/' + id + '/page.html');
  if (!obj) return Response.redirect(roomUrl, 302);

  return new Response(obj.body, {
    headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' },
  });
}
