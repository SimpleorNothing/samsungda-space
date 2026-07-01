// GET    /api/rooms — 전체 방 현황 (점유·공개여부·사용기한·테마 색)
// POST   /api/rooms — 새 빈방 생성 (이름 = URL). 삭제된 시드 방과 같은 이름이면 그 방을 복구.
//                     신규 생성·복구 방은 사용기한 기본 1개월 (방 설정에서 변경 가능)
// PATCH  /api/rooms — 방 이름 변경. body { id, newId }
//                     데이터(rooms/{id}/*)를 새 이름으로 옮기고 meta·목록을 갱신 (주소도 함께 바뀜)
//                     비공개 방은 x-room-password 헤더 또는 인증 쿠키 필요
// DELETE /api/rooms — 방 관리. body { id, mode }
//                     mode 'clear'  → 데이터만 비우고 방은 유지
//                     mode 'delete' → 데이터 삭제 + 방을 목록에서 제거 (시드 방은 index.removed에 기록)
//                     비공개 방은 x-room-password 헤더 또는 인증 쿠키 필요
import {
  ROOMS, allRooms, isValidRoomId, isEditorRoom, roomExists, readIndex, writeIndex,
  isAuthorized, authCookieHeader, todayKST, json,
} from '../_lib.js';

// 신규 방 기본 사용기한: 생성일 + 1개월 (KST 기준)
function oneMonthLater() {
  const p = todayKST().split('-');
  const d = new Date(+p[0], +p[1] - 1, +p[2]);
  d.setMonth(d.getMonth() + 1);
  const z = function (n) { return (n < 10 ? '0' : '') + n; };
  return d.getFullYear() + '-' + z(d.getMonth() + 1) + '-' + z(d.getDate());
}

export async function onRequestGet(context) {
  const index = await readIndex(context.env);
  const ids = allRooms(index);
  const today = todayKST();

  // 메모·파일 존재 여부 — notes.json은 마지막 메모 삭제 시 함께 삭제되므로 존재 = 메모 있음
  const heads = await Promise.all(ids.map(function (id) {
    return context.env.SPACE.head('rooms/' + id + '/notes.json');
  }));
  // 게시 여부 — page.html 실존을 진실로 삼는다(meta.published 플래그 드리프트 무시)
  const pageHeads = await Promise.all(ids.map(function (id) {
    return context.env.SPACE.head('rooms/' + id + '/page.html');
  }));

  const rooms = ids.map(function (id, i) {
    const meta = index.rooms[id] || null;
    const published = !!pageHeads[i];
    const hasNotes = !!heads[i];
    const expiresAt = (meta && meta.expiresAt) || null;
    return {
      id: id,
      used: published || hasNotes,
      published: published,
      title: published && meta ? (meta.title || '') : '',
      updated: published && meta ? String(meta.updatedAt || '').slice(0, 10) : '',
      locked: !!(meta && meta.passwordHash),
      color: (meta && meta.color) || null,
      expiresAt: expiresAt,
      expired: !!(expiresAt && expiresAt < today),
      seed: ROOMS.indexOf(id) !== -1,
      editor: isEditorRoom(id),
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

  if (Array.isArray(index.removed) && index.removed.indexOf(id) !== -1) {
    // 삭제됐던 시드 방 복구 — removed에서만 빼면 ROOMS로 다시 노출됨
    index.removed = index.removed.filter(function (x) { return x !== id; });
  } else {
    index.created.push(id);
  }
  // 기본 사용기한 1개월 — published:false를 명시해 레거시 meta 정규화(published 미정의 = true)를 피함
  index.rooms[id] = { published: false, expiresAt: oneMonthLater() };
  await writeIndex(context.env, index);
  return json({ ok: true, id: id }, 201);
}

export async function onRequestPatch(context) {
  let body;
  try { body = await context.request.json(); } catch (e) { return json({ error: 'invalid body' }, 400); }

  const id = typeof body.id === 'string' ? body.id.trim() : '';
  const newId = typeof body.newId === 'string' ? body.newId.trim() : '';
  if (!isValidRoomId(id)) return json({ error: 'invalid name' }, 400);
  if (!isValidRoomId(newId)) return json({ error: 'invalid new name' }, 400);
  if (id === newId) return json({ error: 'same name' }, 400);

  const index = await readIndex(context.env);
  if (!roomExists(index, id)) return json({ error: 'unknown room' }, 404);
  if (roomExists(index, newId)) return json({ error: 'exists' }, 409);
  // 에디터 방(autoweb 등)은 동작이 이름에 묶여 있어 이름을 바꾸면 마크다운 에디터가 꺼짐 → 차단
  if (isEditorRoom(id)) return json({ error: 'editor room' }, 400);

  const meta = index.rooms[id] || null;
  if (!(await isAuthorized(context.request, id, meta))) {
    return json({ error: 'unauthorized' }, 401);
  }

  // 방 데이터 이동: rooms/{id}/* → rooms/{newId}/* (복사 후 원본 삭제)
  // R2에 이동 연산이 없어 객체 단위로 복사한다. 파일이 50MB까지 올 수 있어
  // 메모리 보호를 위해 병렬 대신 순차 복사.
  let cursor;
  do {
    const list = await context.env.SPACE.list({ prefix: 'rooms/' + id + '/', cursor: cursor });
    for (const o of list.objects) {
      const obj = await context.env.SPACE.get(o.key);
      if (!obj) continue;
      const newKey = 'rooms/' + newId + '/' + o.key.slice(('rooms/' + id + '/').length);
      await context.env.SPACE.put(newKey, await obj.arrayBuffer(), {
        httpMetadata: obj.httpMetadata,
        customMetadata: obj.customMetadata,
      });
      await context.env.SPACE.delete(o.key);
    }
    cursor = list.truncated ? list.cursor : null;
  } while (cursor);

  // 인덱스 갱신 — meta 이관 + 시드/생성 목록 정리 (DELETE·POST와 같은 규칙)
  if (meta) {
    index.rooms[newId] = meta;
    delete index.rooms[id];
  }
  if (ROOMS.indexOf(id) !== -1) {
    if (!Array.isArray(index.removed)) index.removed = [];
    if (index.removed.indexOf(id) === -1) index.removed.push(id);
  } else if (Array.isArray(index.created)) {
    index.created = index.created.filter(function (x) { return x !== id; });
  }
  if (Array.isArray(index.removed) && index.removed.indexOf(newId) !== -1) {
    index.removed = index.removed.filter(function (x) { return x !== newId; });
  } else {
    if (!Array.isArray(index.created)) index.created = [];
    index.created.push(newId);
  }
  await writeIndex(context.env, index);

  // 비공개 방이면 새 이름의 인증 쿠키를 발급해, 바꾼 사람이 다시 비밀번호를 입력하지 않게 함
  const headers = (meta && meta.passwordHash)
    ? { 'set-cookie': authCookieHeader(newId, meta.passwordHash) }
    : null;
  return json({ ok: true, id: newId }, 200, headers);
}

export async function onRequestDelete(context) {
  let body;
  try { body = await context.request.json(); } catch (e) { return json({ error: 'invalid body' }, 400); }

  const id = typeof body.id === 'string' ? body.id.trim() : '';
  if (!isValidRoomId(id)) return json({ error: 'invalid name' }, 400);
  const mode = body.mode === 'clear' ? 'clear' : 'delete';

  const index = await readIndex(context.env);
  if (!roomExists(index, id)) return json({ error: 'unknown room' }, 404);

  const meta = index.rooms[id] || null;
  if (!(await isAuthorized(context.request, id, meta))) {
    return json({ error: 'unauthorized' }, 401);
  }

  // 방 데이터 전체 삭제 (rooms/{id}/ 하위 — page.html, source.md, notes.json, files/*)
  // 블라인드 보이스는 전역 피드(bamboo.json)라 영향 없음
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
  if (mode === 'delete') {
    if (seed) {
      if (!Array.isArray(index.removed)) index.removed = [];
      if (index.removed.indexOf(id) === -1) index.removed.push(id);
    } else if (Array.isArray(index.created)) {
      index.created = index.created.filter(function (x) { return x !== id; });
    }
  }
  await writeIndex(context.env, index);

  return json({ ok: true, removed: mode === 'delete' });
}
