// GET /A-1/source — 에디터 방의 마크다운 원본 (수정 시 프리필용)
// view와 동일한 열람 권한 적용. 원본이 없으면 404.
import { isValidRoomId, roomExists, readIndex, isAuthorized } from '../_lib.js';

export async function onRequestGet(context) {
  const id = context.params.room;
  if (!isValidRoomId(id)) return new Response('Not Found', { status: 404 });

  const index = await readIndex(context.env);
  if (!roomExists(index, id)) return new Response('Not Found', { status: 404 });

  const meta = index.rooms[id];
  if (!meta) return new Response('Not Found', { status: 404 });

  if (!(await isAuthorized(context.request, id, meta))) {
    return new Response('Unauthorized', { status: 401 });
  }

  const obj = await context.env.SPACE.get('rooms/' + id + '/source.md');
  if (!obj) return new Response('Not Found', { status: 404 });

  return new Response(obj.body, {
    headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' },
  });
}
