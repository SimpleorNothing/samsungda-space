// GET /api/room/:room/file/:id — 메모 첨부파일 다운로드
// 방 열람 권한과 동일하게 보호.
import { isValidRoomId, roomExists, readIndex, isAuthorized } from '../../../../_lib.js';

export async function onRequestGet(context) {
  const room = context.params.room;
  const id = context.params.id;
  if (!isValidRoomId(room) || !/^[a-f0-9]{12}$/.test(id || '')) {
    return new Response('Not Found', { status: 404 });
  }

  const index = await readIndex(context.env);
  if (!roomExists(index, room)) return new Response('Not Found', { status: 404 });

  const meta = index.rooms[room] || null;
  if (!(await isAuthorized(context.request, room, meta))) {
    return new Response('Unauthorized', { status: 401 });
  }

  const obj = await context.env.SPACE.get('rooms/' + room + '/files/' + id);
  if (!obj) return new Response('Not Found', { status: 404 });

  const name = (obj.customMetadata && obj.customMetadata.name) || id;
  const headers = {
    'content-type': (obj.httpMetadata && obj.httpMetadata.contentType) || 'application/octet-stream',
    'content-disposition': "attachment; filename*=UTF-8''" + encodeURIComponent(name),
    'cache-control': 'no-store',
  };
  return new Response(obj.body, { headers: headers });
}
