// POST /api/room/:room/settings — 방 설정 (공개/비공개 전환, 사용기한)
//   body: { visibility?: 'public'|'private', password?: string, expiresAt?: 'YYYY-MM-DD'|null, color?: '#RRGGBB'|null }
//   - visibility 'private' + password → 새 비밀번호 설정 (이미 비공개면 password 생략 시 기존 유지)
//   - visibility 'public' → 비밀번호 해제
//   - expiresAt: 문자열이면 설정, null/''이면 해제, 키 자체가 없으면 변경 안 함
//   - color: 방 테마 색 — #rrggbb면 설정, null/''이면 기본색으로 복원, 키 없으면 변경 안 함
// 비공개 방은 인증 필요. 새 비밀번호 설정 시 설정자에게 인증 쿠키 즉시 발급.
import {
  isValidRoomId, roomExists, readIndex, writeIndex, sha256,
  isAuthorized, authCookieHeader, metaIsEmpty, json,
} from '../../../_lib.js';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const COLOR_RE = /^#[0-9a-fA-F]{6}$/;

export async function onRequestPost(context) {
  const room = context.params.room;
  if (!isValidRoomId(room)) return json({ error: 'unknown room' }, 404);

  const index = await readIndex(context.env);
  if (!roomExists(index, room)) return json({ error: 'unknown room' }, 404);

  const existing = index.rooms[room] || null;
  if (!(await isAuthorized(context.request, room, existing))) {
    return json({ error: 'unauthorized' }, 401);
  }

  let body;
  try { body = await context.request.json(); } catch (e) { return json({ error: 'invalid body' }, 400); }

  const meta = existing || { published: false, title: '', updatedAt: '', passwordHash: null, expiresAt: null, color: null };
  let newCookieHash = null;

  if (body.visibility === 'private') {
    if (typeof body.password === 'string' && body.password) {
      meta.passwordHash = await sha256(body.password);
      newCookieHash = meta.passwordHash;
    } else if (!meta.passwordHash) {
      return json({ error: 'password required' }, 400);
    }
  } else if (body.visibility === 'public') {
    meta.passwordHash = null;
  } else if (body.visibility !== undefined) {
    return json({ error: 'invalid visibility' }, 400);
  }

  if ('expiresAt' in body) {
    if (body.expiresAt === null || body.expiresAt === '') {
      meta.expiresAt = null;
    } else if (typeof body.expiresAt === 'string' && DATE_RE.test(body.expiresAt)) {
      meta.expiresAt = body.expiresAt;
    } else {
      return json({ error: 'invalid expiresAt' }, 400);
    }
  }

  if ('color' in body) {
    if (body.color === null || body.color === '') {
      meta.color = null;
    } else if (typeof body.color === 'string' && COLOR_RE.test(body.color)) {
      meta.color = body.color.toLowerCase();
    } else {
      return json({ error: 'invalid color' }, 400);
    }
  }

  if (metaIsEmpty(meta)) {
    delete index.rooms[room];
  } else {
    index.rooms[room] = meta;
  }
  await writeIndex(context.env, index);

  const headers = newCookieHash ? { 'set-cookie': authCookieHeader(room, newCookieHash) } : null;
  return json({ ok: true }, 200, headers);
}
