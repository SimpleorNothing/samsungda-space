// GET /api/rooms — 전체 방 점유 현황
import { ROOMS, readIndex, json } from '../_lib.js';

export async function onRequestGet(context) {
  const index = await readIndex(context.env);
  const rooms = ROOMS.map(function (id) {
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
