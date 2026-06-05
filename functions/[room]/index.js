// GET /A-1 — 빈방(사용법+업로드) / 잠김(비밀번호 입력) / 사용중(뷰어+교체·삭제)
import { isValidRoomId, roomExists, readIndex, isAuthorized, roomPage, html } from '../_lib.js';

export async function onRequestGet(context) {
  const id = context.params.room;
  if (!isValidRoomId(id)) return new Response('Not Found', { status: 404 });

  const index = await readIndex(context.env);
  if (!roomExists(index, id)) return new Response('Not Found', { status: 404 });

  const meta = index.rooms[id] || null;
  const authorized = await isAuthorized(context.request, id, meta);

  return html(roomPage(id, meta, authorized));
}
