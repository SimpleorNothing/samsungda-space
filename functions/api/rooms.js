// GET    /api/rooms — 전체 방 현황 (점유·공개여부·사용기한)
// POST   /api/rooms — 새 빈방 생성 (이름 = URL)
// DELETE /api/rooms — 방 관리: 시드 방은 데이터 비우기, 생성 방은 방 자체 삭제
//                     비공개 방은 x-room-password 헤더 또는 인증 쿠키 필요
import {
  ROOMS, allRooms, isValidRoomId, roomExists, readIndex, writeIndex,
  isAuthorized, todayKST, json,
} from '../_lib.js';

export async function onRequestGet(context) {
  const index = await readIndex(context.env);
  const ids = allRooms(index);
  const today = todayKST();

  // 메모·파일 존재 여부 — notes.json은 마지막 메모 삭제 시 함께 삭제되므로 존재 = 메모 있음
  const heads = await Promise.all(ids.map(function (id) {
    return context.env.SPACE.head('rooms/' + id + '/notes.json');
  }));

  const rooms = ids.map(function (id, i) {
    const meta = index.rooms[id] || null;
    const published = !!(meta && meta.published);
    const hasNotes = !!heads[i];
    const expiresAt = (meta && meta.expiresAt) || null;
    return {
      id: id,
      used: published || hasNotes,
      published: published,
      title: published ? (meta.title || '') : '',
      updated: published ? String(meta.updatedAt || '').slice(0, 10) : '',
      locked: !!(meta && meta.passwordHash),
      expiresAt: expiresAt,
      expired: !!(expiresAt && expiresAt < today),
      seed: ROOMS.indexOf(id) !== -1,
    };
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

export async function onRequestDelete(context) {
  let body;
  try { body = await context.request.json(); } catch (e) { return json({ error: 'invalid body' }, 400); }

  const id = typeof body.id === 'string' ? body.id.trim() : '';
  if (!isValidRoomId(id)) return json({ error: 'invalid name' }, 400);

  const index = await readIndex(context.env);
  if (!roomExists(index, id)) return json({ error: 'unknown room' }, 404);

  const meta = index.rooms[id] || null;
  if (!(await isAuthorized(context.request, id, meta))) {
    return json({ error: 'unauthorized' }, 401);
  }

  // 방 데이터 전체 삭제 (rooms/{id}/ 하위 — page.html, source.md, notes.json, files/*)
  // 대나무숲은 전역 피드(bamboo.json)라 영향 없음
  let cursor;
  do {
    const list = await context.env.SPACE.list({ prefix: 'rooms/' + id + '/', cursor: cursor });
    await Promise.all(list.objects.map(function (o) {
      return context.env.SPACE.delete(o.key);
    }));
    cursor = list.truncated ? list.cursor : null;
  } while (cursor);

  delete index.rooms[id];
  const seed = ROOMS.indexOf(id) !== -1;
  if (!seed && Array.isArray(index.created)) {
    index.created = index.created.filter(function (x) { return x !== id; });
  }
  await writeIndex(context.env, index);

  // seed면 비우기(방 유지), 아니면 방 자체 삭제
  return json({ ok: true, removed: !seed });
}
