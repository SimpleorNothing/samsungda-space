// GET /A-1 — 빈방(사용법+업로드) / 잠김(비밀번호 입력) / 사용중(뷰어+교체·삭제)
import { normalizeRoom, readIndex, isAuthorized, roomPage, html } from '../_lib.js';

export async function onRequestGet(context) {
  const room = normalizeRoom(context.params.room);
  if (!room) return new Response('Not Found', { status: 404 });

  const index = await readIndex(context.env);
  const meta = index.rooms[room] || null;
  const authorized = await isAuthorized(context.request, room, meta);

  return html(roomPage(room, meta, authorized));
}
