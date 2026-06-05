// /api/room/:room — POST 업로드, PUT 교체, DELETE 삭제
// 비밀번호 설정된 방의 PUT/DELETE는 인증 쿠키 또는 x-room-password 헤더 필요.
import {
  isValidRoomId, roomExists, readIndex, writeIndex, sha256,
  isAuthorized, authCookieHeader, json,
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

// 업로드 — 빈방에만 허용. 비밀번호 설정 시 업로더에게 인증 쿠키 즉시 발급.
export async function onRequestPost(context) {
  const room = context.params.room;
  if (!isValidRoomId(room)) return json({ error: 'unknown room' }, 404);

  const body = await parseBody(context.request);
  if (!body) return json({ error: 'invalid body' }, 400);

  const index = await readIndex(context.env);
  if (!roomExists(index, room)) return json({ error: 'unknown room' }, 404);
  if (index.rooms[room]) return json({ error: 'occupied' }, 409);

  const password = typeof body.password === 'string' ? body.password : '';
  const passwordHash = password ? await sha256(password) : null;

  await context.env.SPACE.put('rooms/' + room + '/page.html', body.html, {
    httpMetadata: { contentType: 'text/html; charset=utf-8' },
  });
  await putSource(context.env, room, body);

  index.rooms[room] = {
    title: (body.title || '').slice(0, 60),
    updatedAt: nowKST(),
    passwordHash: passwordHash,
  };
  await writeIndex(context.env, index);

  const headers = passwordHash ? { 'set-cookie': authCookieHeader(room, passwordHash) } : null;
  return json({ ok: true }, 200, headers);
}

// 교체 — 사용중인 방, 인증 필요
export async function onRequestPut(context) {
  const room = context.params.room;
  if (!isValidRoomId(room)) return json({ error: 'unknown room' }, 404);

  const index = await readIndex(context.env);
  const meta = index.rooms[room];
  if (!meta) return json({ error: 'empty room' }, 404);
  if (!(await isAuthorized(context.request, room, meta))) return json({ error: 'unauthorized' }, 401);

  const body = await parseBody(context.request);
  if (!body) return json({ error: 'invalid body' }, 400);

  await context.env.SPACE.put('rooms/' + room + '/page.html', body.html, {
    httpMetadata: { contentType: 'text/html; charset=utf-8' },
  });
  await putSource(context.env, room, body);

  if (body.title) meta.title = String(body.title).slice(0, 60);
  meta.updatedAt = nowKST();
  await writeIndex(context.env, index);
  return json({ ok: true });
}

// 삭제 — 사용중인 방, 인증 필요
export async function onRequestDelete(context) {
  const room = context.params.room;
  if (!isValidRoomId(room)) return json({ error: 'unknown room' }, 404);

  const index = await readIndex(context.env);
  const meta = index.rooms[room];
  if (!meta) return json({ error: 'empty room' }, 404);
  if (!(await isAuthorized(context.request, room, meta))) return json({ error: 'unauthorized' }, 401);

  await context.env.SPACE.delete('rooms/' + room + '/page.html');
  await context.env.SPACE.delete('rooms/' + room + '/source.md');
  delete index.rooms[room];
  await writeIndex(context.env, index);
  return json({ ok: true });
}
