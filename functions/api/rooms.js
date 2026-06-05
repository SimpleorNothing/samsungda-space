// GET /api/rooms  — 전체 방 점유 현황 (시드 방 + 동적 생성 방)
// POST /api/rooms — 새 빈방 생성 (이름 = URL). 현관 인증을 통과한 사용자만 도달.
import { allRooms, isValidRoomId, roomExists, readIndex, writeIndex, json } from '../_lib.js';

export async function onRequestGet(context) {
  const index = await readIndex(context.env);
  const rooms = allRooms(index).map(function (id) {
    const meta = index.rooms[id];
    return meta
      ? {
          id: id,
          used: true,
          title: meta.title || '',
          updated: String(meta.updatedAt || '').slice(0, 10),
          hasPassword: !!meta.passwordHash,
        }
      : { id: id, used: false };
  });
  return json({ rooms: rooms });
}

export async function onRequestPost(context) {
  let body;
  try { body = await context.request.json(); } catch (e) { return json({ error: 'invalid body' }, 400); }

  const id = typeof body.id === 'string' ? body.id.trim() : '';
  if (!isValidRoomId(id)) return json({ error: 'invalid name' }, 400);

  const index = await readIndex(context.env);
  if (!Array.isArray(index.created)) index.created = [];
  if (roomExists(index, id)) return json({ error: 'exists' }, 409);

  index.created.push(id);
  await writeIndex(context.env, index);
  return json({ ok: true, id: id }, 201);
}
