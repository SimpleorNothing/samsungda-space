// /api/room/:room/notes — GET 목록, POST 작성(메모+파일 멀티파트), DELETE ?id= 삭제
// 비밀번호 설정된 방은 인증 쿠키 또는 x-room-password 헤더 필요.
import { isValidRoomId, roomExists, readIndex, isAuthorized, json } from '../../../_lib.js';

const MAX_TEXT_CHARS = 5000;
const MAX_TITLE_CHARS = 60;
const MAX_FILE_BYTES = 10 * 1024 * 1024; // 파일 1개 10MB
const MAX_FILES_PER_NOTE = 5;

function nowKST() {
  return new Date().toLocaleString('sv-SE', { timeZone: 'Asia/Seoul' }).slice(0, 16);
}

function newId() {
  return crypto.randomUUID().replace(/-/g, '').slice(0, 12);
}

function notesKey(room) {
  return 'rooms/' + room + '/notes.json';
}

async function readNotes(env, room) {
  const obj = await env.SPACE.get(notesKey(room));
  if (!obj) return { items: [] };
  try { return JSON.parse(await obj.text()); } catch (e) { return { items: [] }; }
}

async function writeNotes(env, room, data) {
  await env.SPACE.put(notesKey(room), JSON.stringify(data), {
    httpMetadata: { contentType: 'application/json; charset=utf-8' },
  });
}

// 공통 가드: 방 존재 + 인증. 실패 시 Response, 성공 시 meta 반환
async function guard(context) {
  const room = context.params.room;
  if (!isValidRoomId(room)) return { fail: json({ error: 'unknown room' }, 404) };
  const index = await readIndex(context.env);
  if (!roomExists(index, room)) return { fail: json({ error: 'unknown room' }, 404) };
  const meta = index.rooms[room] || null;
  if (!(await isAuthorized(context.request, room, meta))) {
    return { fail: json({ error: 'unauthorized' }, 401) };
  }
  return { room };
}

export async function onRequestGet(context) {
  const g = await guard(context);
  if (g.fail) return g.fail;
  const data = await readNotes(context.env, g.room);
  return json({ items: data.items || [] });
}

export async function onRequestPost(context) {
  const g = await guard(context);
  if (g.fail) return g.fail;
  const room = g.room;

  let form;
  try { form = await context.request.formData(); } catch (e) {
    return json({ error: 'invalid form' }, 400);
  }

  const title = (form.get('title') || '').toString().trim().slice(0, MAX_TITLE_CHARS);
  const text = (form.get('text') || '').toString().slice(0, MAX_TEXT_CHARS);

  const entries = form.getAll('files').filter(function (e) {
    return (e instanceof File) && e.size > 0;
  }).slice(0, MAX_FILES_PER_NOTE);

  if (!text.trim() && entries.length === 0) {
    return json({ error: 'empty note' }, 400);
  }

  const files = [];
  for (const f of entries) {
    if (f.size > MAX_FILE_BYTES) return json({ error: 'file too large (max 10MB)' }, 400);
    const fid = newId();
    await context.env.SPACE.put('rooms/' + room + '/files/' + fid, await f.arrayBuffer(), {
      httpMetadata: { contentType: f.type || 'application/octet-stream' },
      customMetadata: { name: f.name },
    });
    files.push({ id: fid, name: f.name, size: f.size });
  }

  const item = { id: newId(), title: title, text: text, files: files, createdAt: nowKST() };
  const data = await readNotes(context.env, room);
  data.items = [item].concat(data.items || []);
  await writeNotes(context.env, room, data);
  return json({ ok: true, item: item });
}

export async function onRequestDelete(context) {
  const g = await guard(context);
  if (g.fail) return g.fail;
  const room = g.room;

  const id = new URL(context.request.url).searchParams.get('id') || '';
  if (!id) return json({ error: 'id required' }, 400);

  const data = await readNotes(context.env, room);
  const items = data.items || [];
  const target = items.find(function (n) { return n.id === id; });
  if (!target) return json({ error: 'not found' }, 404);

  for (const f of (target.files || [])) {
    await context.env.SPACE.delete('rooms/' + room + '/files/' + f.id);
  }
  data.items = items.filter(function (n) { return n.id !== id; });
  if (data.items.length === 0) {
    // 빈 notes.json은 삭제 — 'notes.json 존재 = 메모 있음'으로 점유 판정에 사용됨
    await context.env.SPACE.delete(notesKey(room));
  } else {
    await writeNotes(context.env, room, data);
  }
  return json({ ok: true });
}
