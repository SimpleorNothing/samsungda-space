// /api/room/:room/bamboo — 대나무숲 (방별 익명 게시)
//   GET    글 목록 (작성자 정보 없음)
//   POST   { text } → { id, token } — 토큰은 본인 삭제용, 브라우저에만 보관
//   DELETE { id, token } — 토큰 해시 일치 시에만 삭제 (익명성 유지)
// 서버에는 글 내용·작성시각·토큰 해시만 저장하며 작성자 식별 정보는 일체 저장하지 않음.
import { isValidRoomId, roomExists, readIndex, isAuthorized, sha256, json } from '../../../_lib.js';

const MAX_TEXT_CHARS = 500;
const MAX_POSTS = 200; // 오래된 글부터 자동 정리

function nowKST() {
  return new Date().toLocaleString('sv-SE', { timeZone: 'Asia/Seoul' }).slice(0, 16);
}

function newId() {
  return crypto.randomUUID().replace(/-/g, '').slice(0, 12);
}

function bambooKey(room) {
  return 'rooms/' + room + '/bamboo.json';
}

async function readPosts(env, room) {
  const obj = await env.SPACE.get(bambooKey(room));
  if (!obj) return { posts: [] };
  try { return JSON.parse(await obj.text()); } catch (e) { return { posts: [] }; }
}

async function writePosts(env, room, data) {
  await env.SPACE.put(bambooKey(room), JSON.stringify(data), {
    httpMetadata: { contentType: 'application/json; charset=utf-8' },
  });
}

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
  const data = await readPosts(context.env, g.room);
  // 토큰 해시는 절대 내려보내지 않음
  const posts = (data.posts || []).map(function (p) {
    return { id: p.id, text: p.text, createdAt: p.createdAt };
  });
  return json({ posts: posts });
}

export async function onRequestPost(context) {
  const g = await guard(context);
  if (g.fail) return g.fail;
  const room = g.room;

  let body;
  try { body = await context.request.json(); } catch (e) {
    return json({ error: 'invalid body' }, 400);
  }
  const text = typeof body.text === 'string' ? body.text.trim() : '';
  if (!text) return json({ error: 'empty text' }, 400);
  if (text.length > MAX_TEXT_CHARS) return json({ error: 'too long (max 500)' }, 400);

  const id = newId();
  const token = crypto.randomUUID().replace(/-/g, '');
  const post = { id: id, text: text, createdAt: nowKST(), tokenHash: await sha256(token) };

  const data = await readPosts(context.env, room);
  data.posts = [post].concat(data.posts || []).slice(0, MAX_POSTS);
  await writePosts(context.env, room, data);

  return json({ ok: true, id: id, token: token, createdAt: post.createdAt });
}

export async function onRequestDelete(context) {
  const g = await guard(context);
  if (g.fail) return g.fail;
  const room = g.room;

  let body;
  try { body = await context.request.json(); } catch (e) {
    return json({ error: 'invalid body' }, 400);
  }
  const id = typeof body.id === 'string' ? body.id : '';
  const token = typeof body.token === 'string' ? body.token : '';
  if (!id || !token) return json({ error: 'id/token required' }, 400);

  const data = await readPosts(context.env, room);
  const posts = data.posts || [];
  const target = posts.find(function (p) { return p.id === id; });
  if (!target) return json({ error: 'not found' }, 404);
  if ((await sha256(token)) !== target.tokenHash) return json({ error: 'forbidden' }, 403);

  data.posts = posts.filter(function (p) { return p.id !== id; });
  await writePosts(context.env, room, data);
  return json({ ok: true });
}
