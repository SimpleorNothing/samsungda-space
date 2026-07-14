// /api/trash — 휴지통 목록·복구·영구삭제
// GET  → { items: [info…] }         삭제 보관 항목 목록(최신순)
// POST → body { trashId, action }   action 'restore'(기본) | 'purge'
//        restore: 데이터를 원위치로 되돌리고 index.json 갱신
//        purge:   해당 항목을 영구 삭제
// 사이트 공통 현관(_middleware) 뒤에 있어 사내 사용자만 접근한다.
import {
  ROOMS, readIndex, writeIndex, pageExists, json,
} from '../_lib.js';
import { listTrash, restoreTrash, purgeTrash } from '../_trash.js';

function nowKST() {
  return new Date().toLocaleString('sv-SE', { timeZone: 'Asia/Seoul' }).slice(0, 16);
}

export async function onRequestGet(context) {
  const items = await listTrash(context.env);
  return json({ items: items });
}

export async function onRequestPost(context) {
  let body;
  try { body = await context.request.json(); } catch (e) { return json({ error: 'invalid body' }, 400); }

  const trashId = typeof body.trashId === 'string' ? body.trashId : '';
  const action = body.action === 'purge' ? 'purge' : 'restore';
  // 경로 탈출 방지 — trashId는 단일 세그먼트여야 한다
  if (!trashId || trashId.indexOf('/') !== -1 || trashId.indexOf('..') !== -1) {
    return json({ error: 'invalid trashId' }, 400);
  }

  if (action === 'purge') {
    await purgeTrash(context.env, trashId);
    return json({ ok: true, purged: true });
  }

  // 복구 — 파일을 원위치로 되돌린 뒤 index.json을 종류별로 갱신
  const r = await restoreTrash(context.env, trashId);
  if (r.error) return json({ error: r.error }, 404);
  const info = r.info;

  const index = await readIndex(context.env);
  if (!index.rooms) index.rooms = {};

  if (info.kind === 'room') {
    // 시드 방은 removed에서 제거해 다시 노출 / 사용자 방은 created에 추가
    if (Array.isArray(index.removed)) {
      index.removed = index.removed.filter(function (x) { return x !== info.room; });
    }
    const seed = ROOMS.indexOf(info.room) !== -1;
    if (!seed) {
      if (!Array.isArray(index.created)) index.created = [];
      if (index.created.indexOf(info.room) === -1) index.created.push(info.room);
    }
    // 삭제 시 보관한 meta(title·color·비밀번호 등) 복원
    if (info.meta) index.rooms[info.room] = info.meta;
    // 배치에도 다시 추가(끝자리)
    if (Array.isArray(index.layout) && index.layout.indexOf(info.room) === -1) {
      index.layout.push(info.room);
    }
  } else {
    // page/tab 복구 — 방 meta의 게시 상태·갱신시각 정리
    const meta = index.rooms[info.room] || { passwordHash: null, expiresAt: null };
    if (await pageExists(context.env, info.room)) {
      meta.published = true;
      if (info.kind === 'page' && info.title) meta.title = info.title;
    }
    meta.updatedAt = nowKST();
    index.rooms[info.room] = meta;
  }
  await writeIndex(context.env, index);
  return json({ ok: true, restored: info.kind, room: info.room });
}
