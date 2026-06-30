// GET /A-1 — 빈방(사용법+업로드) / 잠김(비밀번호 입력) / 사용중(뷰어+교체·삭제)
import { isValidRoomId, roomExists, readIndex, isAuthorized, pageExists, roomPage, html } from '../_lib.js';

export async function onRequestGet(context) {
  const id = context.params.room;
  if (!isValidRoomId(id)) return new Response('Not Found', { status: 404 });

  const index = await readIndex(context.env);
  if (!roomExists(index, id)) return new Response('Not Found', { status: 404 });

  const meta = index.rooms[id] || null;
  const authorized = await isAuthorized(context.request, id, meta);
  // 게시 여부는 page.html 실존으로 판정 — meta.published 플래그 드리프트에 영향받지 않음
  const hasPage = await pageExists(context.env, id);

  return html(roomPage(id, meta, authorized, hasPage));
}
