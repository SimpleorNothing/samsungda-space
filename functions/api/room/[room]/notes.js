// /api/room/:room/notes — GET 목록, POST 작성(메모+파일 멀티파트), PUT 수정(JSON), DELETE ?id= 삭제
// 비밀번호 설정된 방은 인증 쿠키 또는 x-room-password 헤더 필요.
import { isValidRoomId, roomExists, readIndex, writeIndex, isAuthorized, json } from '../../../_lib.js';
import { trashNote } from '../../../_trash.js';

const MAX_TEXT_CHARS = 5000;
const MAX_TITLE_CHARS = 60;
const MAX_FILE_BYTES = 50 * 1024 * 1024; // 파일 1개 50MB
const MAX_FILES_PER_NOTE = Infinity;

// 코드·HTML이 든 메모를 저장/수정할 때 Cloudflare WAF가 injection으로 오탐해 403으로
// 차단하는 것을 피하려고, 클라이언트가 enc:'b64'로 UTF-8 Base64 인코딩해 보낸다.
// 여기서 원문으로 복원한다. enc가 없으면(구버전 호환) 평문 그대로 사용.
function decodeMaybeB64(text, enc) {
  if (enc !== 'b64') return text;
  try {
    const bin = atob(text);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new TextDecoder().decode(bytes);
  } catch (e) {
    return text;
  }
}

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
  try {
    const obj = await env.SPACE.get(notesKey(room));
    if (!obj) return { items: [] };
    return JSON.parse(await obj.text());
  } catch (e) {
    return { items: [] };
  }
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
  return { room, index };
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
  const index = g.index;

  let form;
  try { form = await context.request.formData(); } catch (e) {
    return json({ error: 'invalid form' }, 400);
  }

  const title = (form.get('title') || '').toString().trim().slice(0, MAX_TITLE_CHARS);
  const text = decodeMaybeB64((form.get('text') || '').toString(), form.get('enc')).slice(0, MAX_TEXT_CHARS);

  const entries = form.getAll('files').filter(function (e) {
    return (e instanceof File) && e.size > 0;
  }).slice(0, MAX_FILES_PER_NOTE);

  if (!text.trim() && entries.length === 0) {
    return json({ error: 'empty note' }, 400);
  }

  const files = [];
  for (const f of entries) {
    if (f.size > MAX_FILE_BYTES) return json({ error: 'file too large (max 50MB)' }, 400);
    const fid = newId();
    await context.env.SPACE.put('rooms/' + room + '/files/' + fid, await f.arrayBuffer(), {
      httpMetadata: { contentType: f.type || 'application/octet-stream' },
      customMetadata: { name: f.name },
    });
    files.push({ id: fid, name: f.name, size: f.size, type: f.type || '' });
  }

  const item = { id: newId(), title: title, text: text, files: files, createdAt: nowKST() };
  const data = await readNotes(context.env, room);
  data.items = [item].concat(data.items || []);
  await writeNotes(context.env, room, data);

  if (!index.rooms[room]) index.rooms[room] = {};
  index.rooms[room].updatedAt = nowKST();
  await writeIndex(context.env, index);

  return json({ ok: true, item: item });
}

// 메모 본문 수정: JSON { id, text } — 파일은 유지, editedAt 기록
export async function onRequestPut(context) {
  const g = await guard(context);
  if (g.fail) return g.fail;
  const room = g.room;
  const index = g.index;

  let patch;
  try { patch = await context.request.json(); } catch (e) {
    return json({ error: 'invalid json' }, 400);
  }
  const id = (patch.id || '').toString();
  if (!id) return json({ error: 'id required' }, 400);

  const data = await readNotes(context.env, room);
  const items = data.items || [];
  const target = items.find(function (n) { return n.id === id; });
  if (!target) return json({ error: 'not found' }, 404);

  const rawText = (patch.text !== undefined ? patch.text : (target.text || '')).toString();
  const text = decodeMaybeB64(rawText, patch.enc).slice(0, MAX_TEXT_CHARS);
  if (patch.title !== undefined) {
    target.title = patch.title.toString().trim().slice(0, MAX_TITLE_CHARS);
  }
  // 결과가 빈 메모(본문·파일 모두 없음)가 되면 거부
  if (!text.trim() && (target.files || []).length === 0) {
    return json({ error: 'empty note' }, 400);
  }
  target.text = text;
  target.editedAt = nowKST();
  await writeNotes(context.env, room, data);

  if (!index.rooms[room]) index.rooms[room] = {};
  index.rooms[room].updatedAt = nowKST();
  await writeIndex(context.env, index);

  return json({ ok: true, item: target });
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

  // 첨부 파일 + 메모를 휴지통으로 이동(soft-delete) — 즉시 삭제 대신 30일 보관.
  await trashNote(context.env, room, target);

  data.items = items.filter(function (n) { return n.id !== id; });
  if (data.items.length === 0) {
    // 빈 notes.json은 삭제 — 'notes.json 존재 = 메모 있음'으로 점유 판정에 사용됨
    await context.env.SPACE.delete(notesKey(room));
  } else {
    await writeNotes(context.env, room, data);
  }
  return json({ ok: true });
}
