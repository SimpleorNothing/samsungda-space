// GET /A-1/view — 업로드된 HTML 원본 (뷰어 iframe 소스 겸 전체화면 링크)
// 열람 비밀번호가 설정된 방은 인증 쿠키 없이는 방 페이지로 돌려보냄.
import { normalizeRoom, readIndex, isAuthorized } from '../_lib.js';

export async function onRequestGet(context) {
  const room = normalizeRoom(context.params.room);
  if (!room) return new Response('Not Found', { status: 404 });

  const index = await readIndex(context.env);
  const meta = index.rooms[room];
  if (!meta) return Response.redirect(new URL('/' + room, context.request.url).toString(), 302);

  if (!(await isAuthorized(context.request, room, meta))) {
    return Response.redirect(new URL('/' + room, context.request.url).toString(), 302);
  }

  const obj = await context.env.SPACE.get('rooms/' + room + '/page.html');
  if (!obj) return Response.redirect(new URL('/' + room, context.request.url).toString(), 302);

  return new Response(obj.body, {
    headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' },
  });
}
