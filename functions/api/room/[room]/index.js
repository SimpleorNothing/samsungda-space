// /api/room/:room — 웹페이지 게시(POST)·교체(PUT)·삭제(DELETE)
// 비공개 방은 인증 쿠키 또는 x-room-password 헤더 필요.
// 비밀번호·사용기한 설정은 /api/room/:room/settings 로 분리됨 — 여기서는 다루지 않음.
import {
  isValidRoomId, roomExists, readIndex, writeIndex,
  isAuthorized, metaIsEmpty, pageExists, json,
} from '../../../_lib.js';

const MAX_HTML_BYTES = 5 * 1024 * 1024; // 5MB
const MAX_MD_BYTES = 1 * 1024 * 1024;   // 1MB — 에디터 방 마크다운 원본

function nowKST() {
  return new Date().toLocaleString('sv-SE', { timeZone: 'Asia/Seoul' }).slice(0, 16);
}

async function parseBody(request) {
  try {
    const body = await request.json();
    if (typeof body.html !== 'string' || !body.html.trim()) return null;
    if (new TextEncoder().encode(body.html).length > MAX_HTML_BYTES) return null;
    if (body.markdown !== undefined) {
      if (typeof body.markdown !== 'string') return null;
      if (new TextEncoder().encode(body.markdown).length > MAX_MD_BYTES) return null;
    }
    return body;
  } catch (e) {
    return null;
  }
}

// 에디터 방의 마크다운 원본 저장 — body.markdown이 있을 때만
async function putSource(env, room, body) {
  if (typeof body.markdown === 'string' && body.markdown.trim()) {
    await env.SPACE.put('rooms/' + room + '/source.md', body.markdown, {
      httpMetadata: { contentType: 'text/plain; charset=utf-8' },
    });
  }
}

// 게시 — 게시되지 않은 방에만 허용. 방의 비공개·사용기한 설정은 유지됨.
export async function onRequestPost(context) {
  const room = context.params.room;
  if (!isValidRoomId(room)) return json({ error: 'unknown room' }, 404);

  const body = await parseBody(context.request);
  if (!body) return json({ error: 'invalid body' }, 400);

  const index = await readIndex(context.env);
  if (!roomExists(index, room)) return json({ error: 'unknown room' }, 404);

  const meta = index.rooms[room] || null;
  // 게시 가능 여부는 실제 page.html 실존으로 판정 — meta.published 플래그가 잘못
  // 남아있어도(드리프트) 파일이 없으면 게시를 허용해 "다시 게시 불가" 막힘을 방지.
  if (await pageExists(context.env, room)) return json({ error: 'occupied' }, 409);
  if (!(await isAuthorized(context.request, room, meta))) return json({ error: 'unauthorized' }, 401);

  await context.env.SPACE.put('rooms/' + room + '/page.html', body.html, {
    httpMetadata: { contentType: 'text/html; charset=utf-8' },
  });
  await putSource(context.env, room, body);

  const next = meta || { passwordHash: null, expiresAt: null };
  next.published = true;
  next.title = (body.title || '').slice(0, 60);
  next.updatedAt = nowKST();
  index.rooms[room] = next;
  await writeIndex(context.env, index);
  return json({ ok: true });
}

// 교체 — 게시중인 방, 인증 필요
export async function onRequestPut(context) {
  const room = context.params.room;
  if (!isValidRoomId(room)) return json({ error: 'unknown room' }, 404);

  const index = await readIndex(context.env);
  if (!roomExists(index, room)) return json({ error: 'unknown room' }, 404);

  // 교체는 실제로 게시된(page.html 존재) 방에만 허용 — 플래그가 아닌 파일 실존 기준.
  if (!(await pageExists(context.env, room))) return json({ error: 'not published' }, 404);

  const meta = index.rooms[room] || { passwordHash: null, expiresAt: null };
  if (!(await isAuthorized(context.request, room, meta))) return json({ error: 'unauthorized' }, 401);

  const body = await parseBody(context.request);
  if (!body) return json({ error: 'invalid body' }, 400);

  await context.env.SPACE.put('rooms/' + room + '/page.html', body.html, {
    httpMetadata: { contentType: 'text/html; charset=utf-8' },
  });
  await putSource(context.env, room, body);

  meta.published = true;
  if (body.title) meta.title = String(body.title).slice(0, 60);
  meta.updatedAt = nowKST();
  index.rooms[room] = meta;
  await writeIndex(context.env, index);
  return json({ ok: true });
}

// 웹페이지 삭제 — 게시 해제. 비공개·사용기한 설정과 메모·대나무숲은 유지.
export async function onRequestDelete(context) {
  const room = context.params.room;
  if (!isValidRoomId(room)) return json({ error: 'unknown room' }, 404);

  const index = await readIndex(context.env);
  if (!roomExists(index, room)) return json({ error: 'unknown room' }, 404);

  const meta = index.rooms[room] || null;
  // 실제 page.html이 있거나, 플래그만 남아있는(드리프트) 경우 모두 삭제 대상.
  // 둘 다 없으면 진짜 게시된 게 없음.
  const hasPage = await pageExists(context.env, room);
  if (!hasPage && !(meta && meta.published)) return json({ error: 'not published' }, 404);
  if (!(await isAuthorized(context.request, room, meta))) return json({ error: 'unauthorized' }, 401);

  // page.html이 이미 없어도 무해(멱등). 남아있던 플래그까지 함께 정리해 불일치를 치유한다.
  await context.env.SPACE.delete('rooms/' + room + '/page.html');
  await context.env.SPACE.delete('rooms/' + room + '/source.md');

  if (meta) {
    meta.published = false;
    delete meta.title;
    delete meta.updatedAt;
    if (metaIsEmpty(meta)) {
      delete index.rooms[room];
    } else {
      index.rooms[room] = meta;
    }
    await writeIndex(context.env, index);
  }
  return json({ ok: true });
}
