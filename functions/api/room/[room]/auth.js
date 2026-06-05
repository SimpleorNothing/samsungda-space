// POST /api/room/:room/auth — 열람 비밀번호 검증 → 인증 쿠키 발급(12시간)
import { normalizeRoom, readIndex, sha256, authCookieHeader, json } from '../../../_lib.js';

export async function onRequestPost(context) {
  const room = normalizeRoom(context.params.room);
  if (!room) return json({ error: 'unknown room' }, 404);

  const index = await readIndex(context.env);
  const meta = index.rooms[room];
  if (!meta) return json({ error: 'empty room' }, 404);
  if (!meta.passwordHash) return json({ ok: true }); // 비밀번호 없는 방

  let body;
  try { body = await context.request.json(); } catch (e) { return json({ error: 'invalid body' }, 400); }
  const pw = typeof body.password === 'string' ? body.password : '';
  if (!pw || (await sha256(pw)) !== meta.passwordHash) return json({ error: 'unauthorized' }, 401);

  return json({ ok: true }, 200, { 'set-cookie': authCookieHeader(room, meta.passwordHash) });
}
