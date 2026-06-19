// GET /api/room/:room/notezip/:id — 한 메모의 첨부 파일 전체를 ZIP 한 파일로 다운로드
// 모바일 브라우저는 한 번의 클릭에 파일 하나만 저장하므로, 여러 첨부는 ZIP으로 묶어 내려준다.
// 방 열람 권한은 파일 다운로드와 동일하게 보호.
import { isValidRoomId, roomExists, readIndex, isAuthorized } from '../../../../_lib.js';

function notesKey(room) {
  return 'rooms/' + room + '/notes.json';
}

async function readNotes(env, room) {
  const obj = await env.SPACE.get(notesKey(room));
  if (!obj) return { items: [] };
  try { return JSON.parse(await obj.text()); } catch (e) { return { items: [] }; }
}

// CRC-32 (ZIP store 방식 무결성용)
const CRC_TABLE = (function () {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(bytes) {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}

// 무압축(store) ZIP 생성. entries: [{ name, data(Uint8Array) }]
function buildZip(entries) {
  const enc = new TextEncoder();
  const parts = [];   // 로컬 헤더 + 데이터
  const central = []; // 중앙 디렉터리
  let offset = 0;

  entries.forEach(function (e) {
    const nameBytes = enc.encode(e.name);
    const crc = crc32(e.data);
    const size = e.data.length;

    const lh = new Uint8Array(30 + nameBytes.length);
    const lv = new DataView(lh.buffer);
    lv.setUint32(0, 0x04034b50, true);   // local file header signature
    lv.setUint16(4, 20, true);           // version needed
    lv.setUint16(6, 0x0800, true);       // flags: 파일명 UTF-8
    lv.setUint16(8, 0, true);            // method: store
    lv.setUint16(10, 0, true);           // mod time
    lv.setUint16(12, 0, true);           // mod date
    lv.setUint32(14, crc, true);
    lv.setUint32(18, size, true);        // compressed size
    lv.setUint32(22, size, true);        // uncompressed size
    lv.setUint16(26, nameBytes.length, true);
    lv.setUint16(28, 0, true);           // extra length
    lh.set(nameBytes, 30);
    parts.push(lh, e.data);

    const ch = new Uint8Array(46 + nameBytes.length);
    const cv = new DataView(ch.buffer);
    cv.setUint32(0, 0x02014b50, true);   // central dir signature
    cv.setUint16(4, 20, true);           // version made by
    cv.setUint16(6, 20, true);           // version needed
    cv.setUint16(8, 0x0800, true);       // flags: UTF-8
    cv.setUint16(10, 0, true);           // method
    cv.setUint16(12, 0, true);           // time
    cv.setUint16(14, 0, true);           // date
    cv.setUint32(16, crc, true);
    cv.setUint32(20, size, true);
    cv.setUint32(24, size, true);
    cv.setUint16(28, nameBytes.length, true);
    cv.setUint16(30, 0, true);           // extra length
    cv.setUint16(32, 0, true);           // comment length
    cv.setUint16(34, 0, true);           // disk number
    cv.setUint16(36, 0, true);           // internal attrs
    cv.setUint32(38, 0, true);           // external attrs
    cv.setUint32(42, offset, true);      // local header offset
    ch.set(nameBytes, 46);
    central.push(ch);

    offset += lh.length + size;
  });

  const centralSize = central.reduce(function (s, c) { return s + c.length; }, 0);
  const centralOffset = offset;

  const eocd = new Uint8Array(22);
  const ev = new DataView(eocd.buffer);
  ev.setUint32(0, 0x06054b50, true);     // end of central dir signature
  ev.setUint16(4, 0, true);              // disk number
  ev.setUint16(6, 0, true);              // central dir start disk
  ev.setUint16(8, entries.length, true); // entries on this disk
  ev.setUint16(10, entries.length, true);// total entries
  ev.setUint32(12, centralSize, true);
  ev.setUint32(16, centralOffset, true);
  ev.setUint16(20, 0, true);             // comment length

  const all = parts.concat(central, [eocd]);
  const total = all.reduce(function (s, c) { return s + c.length; }, 0);
  const out = new Uint8Array(total);
  let p = 0;
  all.forEach(function (c) { out.set(c, p); p += c.length; });
  return out;
}

export async function onRequestGet(context) {
  const room = context.params.room;
  const id = context.params.id;
  if (!isValidRoomId(room) || !/^[a-f0-9]{12}$/.test(id || '')) {
    return new Response('Not Found', { status: 404 });
  }

  const index = await readIndex(context.env);
  if (!roomExists(index, room)) return new Response('Not Found', { status: 404 });

  const meta = index.rooms[room] || null;
  if (!(await isAuthorized(context.request, room, meta))) {
    return new Response('Unauthorized', { status: 401 });
  }

  const data = await readNotes(context.env, room);
  const note = (data.items || []).find(function (n) { return n.id === id; });
  if (!note || !note.files || note.files.length === 0) {
    return new Response('Not Found', { status: 404 });
  }

  // 동일 파일명 중복 시 (1), (2) … 접미사로 구분
  const counts = Object.create(null);
  const entries = [];
  for (const f of note.files) {
    const obj = await context.env.SPACE.get('rooms/' + room + '/files/' + f.id);
    if (!obj) continue;
    const orig = (obj.customMetadata && obj.customMetadata.name) || f.name || f.id;
    let name = orig;
    if (counts[orig] === undefined) {
      counts[orig] = 0;
    } else {
      counts[orig]++;
      const dot = orig.lastIndexOf('.');
      const base = dot > 0 ? orig.slice(0, dot) : orig;
      const ext = dot > 0 ? orig.slice(dot) : '';
      name = base + ' (' + counts[orig] + ')' + ext;
    }
    entries.push({ name: name, data: new Uint8Array(await obj.arrayBuffer()) });
  }

  if (entries.length === 0) return new Response('Not Found', { status: 404 });

  const zip = buildZip(entries);
  const zipName = (note.title ? note.title : '메모-' + id) + '.zip';
  return new Response(zip, {
    headers: {
      'content-type': 'application/zip',
      'content-disposition': "attachment; filename*=UTF-8''" + encodeURIComponent(zipName),
      'cache-control': 'no-store',
    },
  });
}
