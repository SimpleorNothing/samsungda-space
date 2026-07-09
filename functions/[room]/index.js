// GET /A-1 — 빈방(사용법+업로드) / 잠김(비밀번호 입력) / 사용중(페이지 탭 뷰어+교체·삭제)
import { isValidRoomId, roomExists, readIndex, isAuthorized, listPages, roomPage, html } from '../_lib.js';

export async function onRequestGet(context) {
  const id = context.params.room;
  if (!isValidRoomId(id)) return new Response('Not Found', { status: 404 });

  const index = await readIndex(context.env);
  if (!roomExists(index, id)) return new Response('Not Found', { status: 404 });

  const meta = index.rooms[id] || null;
  const authorized = await isAuthorized(context.request, id, meta);
  // 게시 여부·페이지 목록은 R2 실존(page.html + pages/)을 진실로 삼는다
  // — meta.published 플래그 드리프트에 영향받지 않음. 잠긴 방은 목록을 노출하지 않는다.
  const pages = authorized ? await listPages(context.env, id, meta) : [];

  return html(roomPage(id, meta, authorized, pages));
}
