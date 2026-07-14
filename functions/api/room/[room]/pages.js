// /api/room/:room/pages — 웹페이지 다중 게시 관리 (브라우저 탭처럼 여러 페이지)
// GET    — 페이지 목록 { pages: [{id, title, updatedAt}] } (첫 페이지 id 'main' = page.html)
// POST   — 페이지 추가. 첫 게시는 page.html(main), 이후는 pages/{pid}.html
// PUT    ?id= — 해당 페이지 교체 (main은 meta.title도 갱신, 추가 페이지는 customMetadata)
// DELETE ?id= — 해당 페이지 삭제. main 삭제 시 다음 페이지를 main으로 승격해
//               "방 주소 = 첫 페이지" 모델을 유지. 마지막 페이지 삭제 시 게시 해제.
// 비공개 방은 인증 쿠키 또는 x-room-password 헤더 필요.
import {
  isValidRoomId, roomExists, readIndex, writeIndex,
  isAuthorized, metaIsEmpty, pageExists, listPages, json,
} from '../../../_lib.js';
import { trashKeys } from '../../../_trash.js';

const MAX_HTML_BYTES = 5 * 1024 * 1024; // 5MB
const MAX_MD_BYTES = 1 * 1024 * 1024;   // 1MB — 에디터 방 마크다운 원본

// WAF 우회: 클라이언트가 enc:'b64'로 보낸 본문을 평문으로 되돌린다(UTF-8 안전).
function b64ToStr(s) {
  const bin = atob(s);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
}
// 추가 페이지 id: 'p' + Date.now() base36(시각순 정렬 보장) + 난수 4자
const PID_RE = /^p[a-z0-9]{4,24}$/;

function nowKST() {
  return new Date().toLocaleString('sv-SE', { timeZone: 'Asia/Seoul' }).slice(0, 16);
}

function newPid() {
  return 'p' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

// R2 customMetadata는 ASCII만 안전 — CJK 제목은 URI 인코딩해 저장한다 (listPages에서 복호)
function encodeTitle(t) {
  return encodeURIComponent(String(t || '').slice(0, 60));
}

function keys(room, pid) {
  if (pid === 'main') {
    return { html: 'rooms/' + room + '/page.html', md: 'rooms/' + room + '/source.md' };
  }
  return { html: 'rooms/' + room + '/pages/' + pid + '.html', md: 'rooms/' + room + '/pages/' + pid + '.md' };
}

async function parseBody(request) {
  try {
    const body = await request.json();
    // WAF가 평문 HTML을 공격 시그니처로 오탐해 차단하므로, 클라이언트가 본문을
    // base64로 실어 보낸다(enc:'b64'). 여기서 원문으로 복원한 뒤 기존 검증을 탄다.
    if (body.enc === 'b64') {
      try {
        if (typeof body.html === 'string') body.html = b64ToStr(body.html);
        if (typeof body.markdown === 'string') body.markdown = b64ToStr(body.markdown);
      } catch (e) {
        return null;
      }
    }
    // html이 없으면 title 전용 업데이트 (탭 이름 변경용)
    if (!body.html) {
      if (typeof body.title !== 'string') return null;
      return body;
    }
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

// 공통 전처리: 방 유효성 + 인증. 실패 시 { err: Response }.
async function guard(context) {
  const room = context.params.room;
  if (!isValidRoomId(room)) return { err: json({ error: 'unknown room' }, 404) };
  const index = await readIndex(context.env);
  if (!roomExists(index, room)) return { err: json({ error: 'unknown room' }, 404) };
  const meta = index.rooms[room] || null;
  if (!(await isAuthorized(context.request, room, meta))) return { err: json({ error: 'unauthorized' }, 401) };
  return { room: room, index: index, meta: meta };
}

function pidParam(context) {
  return new URL(context.request.url).searchParams.get('id') || '';
}

async function putSource(env, k, body) {
  if (typeof body.markdown === 'string' && body.markdown.trim()) {
    await env.SPACE.put(k.md, body.markdown, {
      httpMetadata: { contentType: 'text/plain; charset=utf-8' },
    });
  }
}

export async function onRequestGet(context) {
  const g = await guard(context);
  if (g.err) return g.err;
  return json({ pages: await listPages(context.env, g.room, g.meta) });
}

// 추가 — 첫 게시는 main(page.html, 기존 단일 게시와 동일), 이후는 pages/{pid}.html
export async function onRequestPost(context) {
  const g = await guard(context);
  if (g.err) return g.err;

  const body = await parseBody(context.request);
  if (!body) return json({ error: 'invalid body' }, 400);

  const title = String(body.title || '').slice(0, 60);
  const hasMain = !!(await context.env.SPACE.head('rooms/' + g.room + '/page.html'));

  if (!hasMain) {
    const k = keys(g.room, 'main');
    await context.env.SPACE.put(k.html, body.html, {
      httpMetadata: { contentType: 'text/html; charset=utf-8' },
    });
    await putSource(context.env, k, body);

    const next = g.meta || { passwordHash: null, expiresAt: null };
    next.published = true;
    next.title = title;
    next.updatedAt = nowKST();
    g.index.rooms[g.room] = next;
    await writeIndex(context.env, g.index);
    return json({ ok: true, id: 'main' });
  }

  const pid = newPid();
  const k = keys(g.room, pid);
  await context.env.SPACE.put(k.html, body.html, {
    httpMetadata: { contentType: 'text/html; charset=utf-8' },
    customMetadata: { title: encodeTitle(title), updatedat: nowKST() },
  });
  await putSource(context.env, k, body);

  if (g.meta) {
    g.meta.updatedAt = nowKST();
    g.index.rooms[g.room] = g.meta;
    await writeIndex(context.env, g.index);
  }
  return json({ ok: true, id: pid });
}

// 교체 — 존재하는 페이지에만 허용 (파일 실존 기준)
export async function onRequestPut(context) {
  const g = await guard(context);
  if (g.err) return g.err;

  const pid = pidParam(context);
  if (pid !== 'main' && !PID_RE.test(pid)) return json({ error: 'invalid id' }, 400);

  const body = await parseBody(context.request);
  if (!body) return json({ error: 'invalid body' }, 400);

  const k = keys(g.room, pid);
  const obj = await context.env.SPACE.get(k.html);
  if (!obj) return json({ error: 'not published' }, 404);

  const title = String(body.title || '').slice(0, 60);

  // html이 없으면 제목 전용 업데이트 (탭 이름 변경)
  if (!body.html) {
    if (pid === 'main') {
      const meta = g.meta || { passwordHash: null, expiresAt: null };
      meta.published = true;
      if (title) meta.title = title;
      meta.updatedAt = nowKST();
      g.index.rooms[g.room] = meta;
      await writeIndex(context.env, g.index);
    } else {
      const oldTitle = (obj.customMetadata && obj.customMetadata.title) || '';
      await context.env.SPACE.put(k.html, await obj.arrayBuffer(), {
        httpMetadata: { contentType: 'text/html; charset=utf-8' },
        customMetadata: { title: title ? encodeTitle(title) : oldTitle, updatedat: nowKST() },
      });
      if (g.meta) {
        g.meta.updatedAt = nowKST();
        g.index.rooms[g.room] = g.meta;
        await writeIndex(context.env, g.index);
      }
    }
    return json({ ok: true });
  }

  if (pid === 'main') {
    await context.env.SPACE.put(k.html, body.html, {
      httpMetadata: { contentType: 'text/html; charset=utf-8' },
    });
    const meta = g.meta || { passwordHash: null, expiresAt: null };
    meta.published = true;
    if (title) meta.title = title;
    meta.updatedAt = nowKST();
    g.index.rooms[g.room] = meta;
    await writeIndex(context.env, g.index);
  } else {
    // 제목을 비우면 기존 customMetadata 제목 유지
    const oldTitle = (obj.customMetadata && obj.customMetadata.title) || '';
    await context.env.SPACE.put(k.html, body.html, {
      httpMetadata: { contentType: 'text/html; charset=utf-8' },
      customMetadata: { title: title ? encodeTitle(title) : oldTitle, updatedat: nowKST() },
    });
    if (g.meta) {
      g.meta.updatedAt = nowKST();
      g.index.rooms[g.room] = g.meta;
      await writeIndex(context.env, g.index);
    }
  }
  await putSource(context.env, k, body);
  return json({ ok: true });
}

// 삭제 — main 삭제 시 다음 페이지를 main으로 승격, 마지막 페이지면 게시 해제
export async function onRequestDelete(context) {
  const g = await guard(context);
  if (g.err) return g.err;

  const pid = pidParam(context);
  if (pid !== 'main' && !PID_RE.test(pid)) return json({ error: 'invalid id' }, 400);

  const k = keys(g.room, pid);
  // 즉시 파괴 대신 휴지통으로 이동(soft-delete) — main은 'page', 추가 탭은 'tab'으로 보관.
  const trashTitle = pid === 'main' ? ((g.meta && g.meta.title) || '') : '';
  await trashKeys(context.env, g.room, pid === 'main' ? 'page' : 'tab',
    pid === 'main' ? null : pid, trashTitle, [k.html, k.md]);

  if (pid === 'main') {
    // 다음 페이지 승격 — 키가 시각순이라 목록 첫 .html이 가장 오래된(다음) 페이지
    const l = await context.env.SPACE.list({
      prefix: 'rooms/' + g.room + '/pages/',
      include: ['customMetadata'],
    });
    const nextObj = (l.objects || []).filter(function (o) { return /\.html$/.test(o.key); })[0];
    if (nextObj) {
      const obj = await context.env.SPACE.get(nextObj.key);
      if (obj) {
        await context.env.SPACE.put('rooms/' + g.room + '/page.html', await obj.arrayBuffer(), {
          httpMetadata: { contentType: 'text/html; charset=utf-8' },
        });
        const mdKey = nextObj.key.slice(0, -5) + '.md';
        const mdObj = await context.env.SPACE.get(mdKey);
        if (mdObj) {
          await context.env.SPACE.put('rooms/' + g.room + '/source.md', await mdObj.arrayBuffer(), {
            httpMetadata: { contentType: 'text/plain; charset=utf-8' },
          });
          await context.env.SPACE.delete(mdKey);
        }
        await context.env.SPACE.delete(nextObj.key);

        const cm = nextObj.customMetadata || {};
        let t = cm.title || '';
        try { t = decodeURIComponent(t); } catch (e) { /* 인코딩 안 된 값은 그대로 */ }
        const meta = g.meta || { passwordHash: null, expiresAt: null };
        meta.published = true;
        meta.title = t;
        meta.updatedAt = cm.updatedat || nowKST();
        g.index.rooms[g.room] = meta;
        await writeIndex(context.env, g.index);
        return json({ ok: true, promoted: true });
      }
    }
  }

  // 남은 페이지가 없으면 게시 해제 — meta 정리 (기존 단일 삭제와 동일 규칙)
  if (!(await pageExists(context.env, g.room))) {
    if (g.meta) {
      g.meta.published = false;
      delete g.meta.title;
      delete g.meta.updatedAt;
      if (metaIsEmpty(g.meta)) {
        delete g.index.rooms[g.room];
      } else {
        g.index.rooms[g.room] = g.meta;
      }
      await writeIndex(context.env, g.index);
    }
  } else if (g.meta) {
    g.meta.updatedAt = nowKST();
    g.index.rooms[g.room] = g.meta;
    await writeIndex(context.env, g.index);
  }
  return json({ ok: true });
}
