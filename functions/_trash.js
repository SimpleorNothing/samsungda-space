// functions/_trash.js
// 삭제를 즉시 파괴하지 않고 _trash/ 로 옮겨 보관하는 soft-delete 헬퍼.
// R2엔 object versioning이 없어, 삭제 대상 데이터를 _trash/{trashId}/data/ 로 복사한 뒤
// 원본을 지운다(=이동). 되돌릴 수 있고, 자동 정리는 R2 Object Lifecycle Rules
// (prefix '_trash/', 만료 30일)에 위임한다.
//
// 휴지통 항목 종류(kind):
//   room  방 전체       (rooms/{room}/ 하위 전부)
//   page  대표 웹페이지  (page.html + source.md)
//   tab   개별 추가 탭   (pages/{pid}.html + .md)

const TRASH = '_trash/';

// 파일명에 안전한 KST 타임스탬프: '20260714-153012'
export function trashStamp() {
  const s = new Date().toLocaleString('sv-SE', { timeZone: 'Asia/Seoul' }); // 'YYYY-MM-DD HH:MM:SS'
  const d = s.replace(/[^0-9]/g, '').slice(0, 14);
  return d.slice(0, 8) + '-' + d.slice(8, 14);
}

function nowKST() {
  return new Date().toLocaleString('sv-SE', { timeZone: 'Asia/Seoul' }).slice(0, 16);
}

// prefix 하위의 모든 키를 페이지네이션으로 수집
async function listAll(env, prefix) {
  const keys = [];
  let cursor;
  do {
    const l = await env.SPACE.list({ prefix: prefix, cursor: cursor });
    for (const o of l.objects) keys.push(o.key);
    cursor = l.truncated ? l.cursor : null;
  } while (cursor);
  return keys;
}

// 키 하나를 dstKey로 복사(순차 — 대용량 메모리 보호) 후 원본 삭제
async function moveKey(env, srcKey, dstKey) {
  const obj = await env.SPACE.get(srcKey);
  if (!obj) return false;
  await env.SPACE.put(dstKey, await obj.arrayBuffer(), {
    httpMetadata: obj.httpMetadata,
    customMetadata: obj.customMetadata,
  });
  await env.SPACE.delete(srcKey);
  return true;
}

// 방 전체를 휴지통으로 이동. 반환: trashId
export async function trashRoom(env, room, meta, seed) {
  const trashId = 'room__' + room + '__' + trashStamp();
  const base = TRASH + trashId + '/';
  const srcBase = 'rooms/' + room + '/';
  const files = [];
  for (const k of await listAll(env, srcBase)) {
    const rel = k.slice(srcBase.length);
    if (await moveKey(env, k, base + 'data/' + rel)) files.push(rel);
  }
  const info = {
    trashId: trashId, kind: 'room', room: room, pid: null,
    title: (meta && meta.title) || '', meta: meta || null, seed: !!seed,
    files: files, deletedAt: nowKST(),
  };
  await env.SPACE.put(base + '__info.json', JSON.stringify(info), {
    httpMetadata: { contentType: 'application/json; charset=utf-8' },
  });
  return trashId;
}

// 특정 키 집합(웹페이지/개별탭)을 휴지통으로 이동. 반환: trashId 또는 null(옮길 게 없음)
export async function trashKeys(env, room, kind, pid, title, keyList) {
  const stamp = trashStamp();
  const trashId = kind + '__' + room + (pid ? '__' + pid : '') + '__' + stamp;
  const base = TRASH + trashId + '/';
  const srcBase = 'rooms/' + room + '/';
  const files = [];
  for (const k of keyList) {
    const rel = k.startsWith(srcBase) ? k.slice(srcBase.length) : k.split('/').pop();
    if (await moveKey(env, k, base + 'data/' + rel)) files.push(rel);
  }
  if (!files.length) return null;
  const info = {
    trashId: trashId, kind: kind, room: room, pid: pid || null,
    title: title || '', meta: null, seed: false,
    files: files, deletedAt: nowKST(),
  };
  await env.SPACE.put(base + '__info.json', JSON.stringify(info), {
    httpMetadata: { contentType: 'application/json; charset=utf-8' },
  });
  return trashId;
}

// 메모(첨부 파일 포함)를 휴지통으로. note = notes.json 항목 객체.
export async function trashNote(env, room, note) {
  const trashId = 'note__' + room + '__' + trashStamp();
  const base = TRASH + trashId + '/';
  const files = [];
  for (const f of (note.files || [])) {
    const src = 'rooms/' + room + '/files/' + f.id;
    if (await moveKey(env, src, base + 'data/files/' + f.id)) files.push('files/' + f.id);
  }
  const info = {
    trashId: trashId, kind: 'note', room: room, pid: null,
    title: note.title || (note.text ? String(note.text).slice(0, 30) : '(메모)'),
    meta: null, note: note, seed: false,
    files: files, deletedAt: nowKST(),
  };
  await env.SPACE.put(base + '__info.json', JSON.stringify(info), {
    httpMetadata: { contentType: 'application/json; charset=utf-8' },
  });
  return trashId;
}

// 휴지통 목록(__info.json 모음, 최신 삭제순)
export async function listTrash(env) {
  const infos = [];
  for (const k of await listAll(env, TRASH)) {
    if (!k.endsWith('/__info.json')) continue;
    const obj = await env.SPACE.get(k);
    if (!obj) continue;
    try { infos.push(JSON.parse(await obj.text())); } catch (e) { /* 손상 항목 무시 */ }
  }
  infos.sort(function (a, b) { return a.deletedAt < b.deletedAt ? 1 : -1; });
  return infos;
}

async function loadInfo(env, trashId) {
  const obj = await env.SPACE.get(TRASH + trashId + '/__info.json');
  if (!obj) return null;
  try { return JSON.parse(await obj.text()); } catch (e) { return null; }
}

// 복구: data/ 하위를 rooms/{room}/ 로 되돌린다. index.json 갱신은 호출측(API)에서 처리.
// 반환: { ok, info } 또는 { error }
export async function restoreTrash(env, trashId) {
  const info = await loadInfo(env, trashId);
  if (!info) return { error: 'not found' };
  const base = TRASH + trashId + '/data/';
  const dstBase = 'rooms/' + info.room + '/';
  for (const k of await listAll(env, base)) {
    const rel = k.slice(base.length);
    await moveKey(env, k, dstBase + rel);
  }
  // 남은 메타·잔여 파일 정리
  for (const k of await listAll(env, TRASH + trashId + '/')) {
    await env.SPACE.delete(k);
  }
  return { ok: true, info: info };
}

// 영구 삭제
export async function purgeTrash(env, trashId) {
  for (const k of await listAll(env, TRASH + trashId + '/')) {
    await env.SPACE.delete(k);
  }
  return { ok: true };
}
