// DA Space 공유 유틸 — 방 목록·해시·인덱스·인증·페이지 템플릿
// 방 구성을 바꾸려면 ROOMS 배열만 수정하면 됩니다.

export const ROOMS = ['A-1', 'A-2', 'A-3', 'A-4', 'A-5', 'A-6', 'autoweb'];

// 에디터 방 — 파일 업로드 대신 마크다운 입력창으로 페이지를 작성·게시
export const EDITOR_ROOMS = ['autoweb'];
export function isEditorRoom(id) {
  return EDITOR_ROOMS.indexOf(id) !== -1;
}

// 방 이름 형식: 영문·숫자·하이픈·언더스코어 1~40자 (URL·R2 키·쿠키 모두 안전)
const ROOM_ID_RE = /^[A-Za-z0-9_-]{1,40}$/;

export function isValidRoomId(raw) {
  return typeof raw === 'string' && ROOM_ID_RE.test(raw);
}

// 시드 방(ROOMS) + 동적 생성 방(index.created) 합본 목록 (중복 제거, 순서 유지)
export function allRooms(index) {
  const created = (index && Array.isArray(index.created)) ? index.created : [];
  const seen = Object.create(null);
  const list = [];
  ROOMS.concat(created).forEach(function (id) {
    if (!seen[id]) { seen[id] = true; list.push(id); }
  });
  return list;
}

export function roomExists(index, id) {
  return allRooms(index).indexOf(id) !== -1;
}

export async function sha256(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf)).map(function (b) {
    return b.toString(16).padStart(2, '0');
  }).join('');
}

export function escapeHtml(s) {
  return String(s || '').replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
}

// ---------- R2 인덱스 ----------

export async function readIndex(env) {
  const obj = await env.SPACE.get('index.json');
  if (!obj) return { rooms: {} };
  try { return JSON.parse(await obj.text()); } catch (e) { return { rooms: {} }; }
}

export async function writeIndex(env, index) {
  await env.SPACE.put('index.json', JSON.stringify(index), {
    httpMetadata: { contentType: 'application/json; charset=utf-8' },
  });
}

// ---------- 인증 (열람 비밀번호) ----------
// 비밀번호 검증 성공 시 space_auth_{room} 쿠키에 해시를 저장하고,
// 이후 요청은 쿠키 해시 == 저장 해시로 판정. 교체/삭제도 동일 권한.

export function cookieName(room) {
  return 'space_auth_' + room;
}

export function getCookie(request, name) {
  const raw = request.headers.get('cookie') || '';
  const parts = raw.split(';');
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i].trim();
    if (p.indexOf(name + '=') === 0) return p.slice(name.length + 1);
  }
  return '';
}

// meta가 비밀번호 없는 방이면 항상 true.
// 있으면 쿠키 해시 일치 또는 x-room-password 헤더 평문 해시 일치.
export async function isAuthorized(request, room, meta) {
  if (!meta || !meta.passwordHash) return true;
  if (getCookie(request, cookieName(room)) === meta.passwordHash) return true;
  const pw = request.headers.get('x-room-password') || '';
  if (pw && (await sha256(pw)) === meta.passwordHash) return true;
  return false;
}

export function authCookieHeader(room, hash) {
  return cookieName(room) + '=' + hash + '; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=43200';
}

// ---------- 응답 헬퍼 ----------

export function json(data, status, extraHeaders) {
  const headers = { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' };
  if (extraHeaders) for (const k in extraHeaders) headers[k] = extraHeaders[k];
  return new Response(JSON.stringify(data), { status: status || 200, headers: headers });
}

export function html(body) {
  return new Response(body, {
    headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' },
  });
}

// ---------- 공통 스타일 (space-prototype.html 그대로) ----------

export const BASE_CSS = `
:root{--bg:#ffffff;--surface:#f6f7f9;--text:#1a1d21;--muted:#5b6470;--border:#e6e9ee;--brand:#1257d6;}
*{box-sizing:border-box;margin:0;padding:0}
body{background:var(--bg);color:var(--text);padding:56px 24px;
  font-family:'Pretendard',system-ui,-apple-system,'Segoe UI',Roboto,'Apple SD Gothic Neo','Noto Sans KR',sans-serif;}
.wrap{max-width:860px;margin:0 auto}
h1{font-size:30px;font-weight:800;letter-spacing:-0.5px}
.sub{font-size:15px;color:var(--muted);margin-top:6px}
h2{font-size:20px;font-weight:700;letter-spacing:-0.3px}
.desc{font-size:13px;color:var(--muted);margin-top:4px}
section{margin-bottom:40px}
.section-head{margin-bottom:16px}
.back{display:inline-block;font-size:13px;color:var(--muted);text-decoration:none;margin-bottom:18px;cursor:pointer;}
.back:hover{color:var(--brand)}
.panel{background:var(--surface);border:1.5px solid var(--border);border-radius:14px;padding:26px 22px;margin-top:16px;}
.panel ol{margin:10px 0 0 18px}
.panel li{font-size:13px;color:var(--muted);line-height:1.9}
.dropzone{border:1.5px dashed var(--border);border-radius:14px;padding:22px;text-align:center;
  font-size:14px;color:var(--muted);margin-top:16px;transition:.15s;cursor:pointer;}
.dropzone:hover{border-color:var(--brand)}
.dropzone.is-over{border-color:var(--brand);background:rgba(18,87,214,.06)}
.opt{display:flex;align-items:center;gap:8px;margin-top:14px;font-size:13px;color:var(--muted)}
.opt input{accent-color:var(--brand)}
.field{margin-top:14px}
.field label{display:block;font-size:13px;font-weight:600;margin-bottom:6px}
.field input{width:100%;font-family:inherit;font-size:14px;color:var(--text);
  background:var(--bg);border:1.5px solid var(--border);border-radius:7px;padding:9px 12px;outline:none;}
.field input:focus{border-color:var(--brand)}
button{font-family:inherit;font-size:13px;font-weight:600;
  border:1.5px solid var(--border);border-radius:7px;background:#eef1f5;color:var(--text);
  padding:8px 16px;cursor:pointer;transition:.15s;}
button:hover{border-color:var(--brand);color:var(--brand)}
button.danger:hover{background:#ffe1e1;color:#c0392b;border-color:#ffe1e1}
button:disabled{opacity:.5;cursor:default}
.btn-row{display:flex;gap:8px;margin-top:16px}
.viewer{border:1.5px solid var(--border);border-radius:14px;margin-top:16px;overflow:hidden;background:var(--surface);}
.viewer iframe{display:block;width:100%;height:70vh;border:none;background:#fff}
.status-line{font-size:13px;color:var(--muted);margin-top:6px}
.status-msg{font-size:13px;color:var(--muted);margin-top:12px;min-height:18px}
.status-msg.err{color:#c0392b}
textarea.md{width:100%;min-height:280px;margin-top:16px;font-family:inherit;font-size:14px;line-height:1.7;
  color:var(--text);background:var(--bg);border:1.5px solid var(--border);border-radius:14px;
  padding:14px 16px;outline:none;resize:vertical;}
textarea.md:focus{border-color:var(--brand)}
.preview-label{font-size:13px;font-weight:600;color:var(--muted);margin-top:16px}
.preview{background:#fff;border:1.5px solid var(--border);border-radius:14px;padding:22px;margin-top:8px;
  min-height:100px;overflow:auto;}
`;

// 마크다운 본문 타이포그래피 — 미리보기(.preview)와 게시 문서가 공유
export const MD_CSS = `
.md-body{font-size:15px;line-height:1.75;color:#1a1d21}
.md-body h1{font-size:26px;font-weight:800;letter-spacing:-0.5px;margin:28px 0 12px}
.md-body h1:first-child{margin-top:0}
.md-body h2{font-size:20px;font-weight:700;letter-spacing:-0.3px;margin:24px 0 10px}
.md-body h3{font-size:17px;font-weight:700;margin:20px 0 8px}
.md-body p{margin:10px 0}
.md-body ul,.md-body ol{margin:10px 0 10px 22px}
.md-body li{margin:4px 0}
.md-body a{color:#1257d6}
.md-body code{background:#f6f7f9;border:1px solid #e6e9ee;border-radius:4px;padding:1px 5px;font-size:13px}
.md-body pre{background:#f6f7f9;border:1px solid #e6e9ee;border-radius:14px;padding:14px 16px;overflow:auto;margin:12px 0}
.md-body pre code{background:none;border:none;padding:0}
.md-body blockquote{border-left:3px solid #1257d6;margin:12px 0;padding:2px 0 2px 14px;color:#5b6470}
.md-body table{border-collapse:collapse;margin:12px 0;width:100%}
.md-body th,.md-body td{border:1px solid #e6e9ee;padding:7px 10px;font-size:14px;text-align:left}
.md-body th{background:#f6f7f9;font-weight:700}
.md-body img{max-width:100%}
.md-body hr{border:none;border-top:1px solid #e6e9ee;margin:20px 0}
`;

const FONT_LINK = `<link rel="stylesheet" href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/static/pretendard.min.css">`;
const MARKED_LINK = `<script src="https://cdn.jsdelivr.net/npm/marked@12.0.2/marked.min.js"></script>`;

// ---------- 방 페이지 (3상태: 빈방 / 잠김 / 사용중) ----------

export function roomPage(room, meta, authorized) {
  const used = !!meta;
  const locked = used && meta.passwordHash && !authorized;
  const editor = isEditorRoom(room);
  const title = used ? escapeHtml(meta.title || '(제목 없음)') : '';
  const updated = used ? escapeHtml(String(meta.updatedAt || '').slice(0, 10)) : '';

  let statusLine, bodyHtml, script;

  if (!used) {
    if (editor) {
      statusLine = '빈방 · 마크다운으로 바로 작성해 게시할 수 있습니다';
      bodyHtml = `
      <div class="panel">
        <h2>사용법</h2>
        <ol>
          <li>아래 입력창에 마크다운으로 내용을 작성합니다. (<code># 제목</code>, <code>- 목록</code>, <code>**굵게**</code>, <code>| 표 |</code> 등)</li>
          <li>입력하는 즉시 아래 미리보기에서 완성된 페이지 모습을 확인할 수 있습니다.</li>
          <li>게시하면 작성한 내용이 그대로 이 방의 웹페이지가 됩니다. 게시 후 수정·삭제 가능합니다.</li>
        </ol>
      </div>
      <div class="field">
        <label for="title">표시 이름 (선택 — 방 목록에 노출)</label>
        <input id="title" type="text" placeholder="예: 주간 회의 안내">
      </div>
      <textarea id="md" class="md" placeholder="# 제목&#10;&#10;내용을 입력하세요…"></textarea>
      <div class="preview-label">미리보기</div>
      <div class="preview md-body" id="pv"></div>
      <label class="opt"><input type="checkbox" id="pwChk"> 열람 비밀번호 설정</label>
      <div class="field" id="pwField" style="display:none">
        <label for="pw">비밀번호</label>
        <input id="pw" type="password" autocomplete="new-password">
      </div>
      <div class="btn-row"><button id="publishBtn" disabled>게시</button></div>
      <div class="status-msg" id="msg"></div>`;
      script = editorEmptyScript(room);
    } else {
      statusLine = '빈방 · 지금 바로 사용할 수 있습니다';
      bodyHtml = `
      <div class="panel">
        <h2>사용법</h2>
        <ol>
          <li>아래 영역에 HTML 파일을 끌어다 놓거나 클릭해 선택합니다.</li>
          <li>비밀번호를 설정하면 방문자는 비밀번호 입력 후에만 열람할 수 있습니다.</li>
          <li>업로드 후 같은 화면에서 다른 HTML로 교체하거나 삭제할 수 있습니다.</li>
        </ol>
      </div>
      <div class="dropzone" id="dz">HTML 파일을 여기에 끌어다 놓거나 클릭하세요</div>
      <input id="file" type="file" accept=".html,.htm,text/html" hidden>
      <div class="field">
        <label for="title">표시 이름 (선택 — 방 목록에 노출)</label>
        <input id="title" type="text" placeholder="예: 26년 시장 전망 대시보드">
      </div>
      <label class="opt"><input type="checkbox" id="pwChk"> 열람 비밀번호 설정</label>
      <div class="field" id="pwField" style="display:none">
        <label for="pw">비밀번호</label>
        <input id="pw" type="password" autocomplete="new-password">
      </div>
      <div class="btn-row"><button id="uploadBtn" disabled>업로드</button></div>
      <div class="status-msg" id="msg"></div>`;
      script = emptyScript(room);
    }
  } else if (locked) {
    statusLine = '사용중 · ' + title + ' · 업데이트 ' + updated + ' · 열람 비밀번호가 설정된 방입니다';
    bodyHtml = `
      <div class="panel">
        <h2>비밀번호 입력</h2>
        <div class="field">
          <label for="pw">열람 비밀번호</label>
          <input id="pw" type="password" autocomplete="current-password">
        </div>
        <div class="btn-row"><button id="enterBtn">열람하기</button></div>
        <div class="status-msg" id="msg"></div>
      </div>`;
    script = lockedScript(room);
  } else if (editor) {
    statusLine = '사용중 · ' + title + ' · 업데이트 ' + updated;
    bodyHtml = `
      <div class="viewer"><iframe src="/${room}/view" title="${room}"></iframe></div>
      <div class="btn-row">
        <button id="openBtn">전체화면으로 열기</button>
        <button id="editBtn">내용 수정</button>
        <button class="danger" id="deleteBtn">삭제</button>
      </div>
      <div id="editSec" style="display:none">
        <textarea id="md" class="md"></textarea>
        <div class="preview-label">미리보기</div>
        <div class="preview md-body" id="pv"></div>
        <div class="btn-row">
          <button id="saveBtn">수정 게시</button>
          <button id="cancelBtn">취소</button>
        </div>
      </div>
      <div class="status-msg" id="msg"></div>`;
    script = editorUsedScript(room, meta);
  } else {
    statusLine = '사용중 · ' + title + ' · 업데이트 ' + updated;
    bodyHtml = `
      <div class="viewer"><iframe src="/${room}/view" title="${room}"></iframe></div>
      <div class="btn-row">
        <button id="openBtn">전체화면으로 열기</button>
        <button id="replaceBtn">HTML 교체</button>
        <button class="danger" id="deleteBtn">삭제</button>
      </div>
      <input id="file" type="file" accept=".html,.htm,text/html" hidden>
      <div class="status-msg" id="msg"></div>`;
    script = usedScript(room);
  }

  return `<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${room} · DA Space</title>
${FONT_LINK}
${editor && !locked ? MARKED_LINK : ''}
<style>${BASE_CSS}${editor && !locked ? MD_CSS : ''}</style>
</head>
<body>
<div class="wrap">
  <a class="back" href="/">← 방 목록으로</a>
  <section>
    <div class="section-head">
      <h1>${room}</h1>
      <p class="status-line">${statusLine}</p>
    </div>
    ${bodyHtml}
  </section>
</div>
<script>${script}</script>
</body>
</html>`;
}

// ---------- 클라이언트 스크립트 (상태별) ----------

function fileReaderSnippet() {
  return `
  function setMsg(t, err){ msg.textContent = t || ''; msg.className = err ? 'status-msg err' : 'status-msg'; }
  function readFile(file, cb){
    if(!file) return;
    if(!/\\.html?$/i.test(file.name)){ setMsg('HTML 파일(.html)만 올릴 수 있습니다.', true); return; }
    var r = new FileReader();
    r.onload = function(){ cb(r.result, file); };
    r.onerror = function(){ setMsg('파일을 읽지 못했습니다.', true); };
    r.readAsText(file);
  }`;
}

// 에디터 공통: 메시지·이스케이프·게시 문서 빌드·미리보기 렌더
function editorCoreSnippet() {
  return `
  var MD_CSS = ${JSON.stringify(MD_CSS)};
  function setMsg(t, err){ msg.textContent = t || ''; msg.className = err ? 'status-msg err' : 'status-msg'; }
  function esc(s){
    return String(s || '').replace(/[&<>"']/g, function(c){
      return { '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c];
    });
  }
  function buildDoc(title, bodyHtml){
    return '<!DOCTYPE html><html lang="ko"><head><meta charset="UTF-8">'
      + '<meta name="viewport" content="width=device-width, initial-scale=1.0">'
      + '<title>' + esc(title) + '</title>'
      + '<link rel="stylesheet" href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/static/pretendard.min.css">'
      + '<style>body{background:#fff;margin:0;padding:48px 24px;'
      + "font-family:'Pretendard',system-ui,-apple-system,'Segoe UI',Roboto,'Apple SD Gothic Neo','Noto Sans KR',sans-serif}"
      + '.wrap{max-width:860px;margin:0 auto}' + MD_CSS + '</style>'
      + '</head><body><div class="wrap md-body">' + bodyHtml + '</div></body></html>';
  }
  function render(){
    var t = md.value;
    if(t.trim()){ pv.innerHTML = marked.parse(t); }
    else { pv.innerHTML = '<p style="color:#5b6470;font-size:13px">위 입력창에 작성하면 여기에 미리보기가 표시됩니다.</p>'; }
  }`;
}

function emptyScript(room) {
  return `
(function(){
  var ROOM = '${room}';
  var dz = document.getElementById('dz');
  var input = document.getElementById('file');
  var pwChk = document.getElementById('pwChk');
  var pwField = document.getElementById('pwField');
  var uploadBtn = document.getElementById('uploadBtn');
  var msg = document.getElementById('msg');
  var htmlText = null;
  ${fileReaderSnippet()}

  function onFile(text, file){
    htmlText = text;
    dz.textContent = file.name + ' (' + Math.round(file.size/1024) + 'KB) 선택됨';
    uploadBtn.disabled = false;
    setMsg('');
  }

  dz.addEventListener('click', function(){ input.click(); });
  input.addEventListener('change', function(){ readFile(input.files[0], onFile); input.value=''; });
  dz.addEventListener('dragover', function(e){ e.preventDefault(); dz.classList.add('is-over'); });
  dz.addEventListener('dragleave', function(){ dz.classList.remove('is-over'); });
  dz.addEventListener('drop', function(e){
    e.preventDefault(); dz.classList.remove('is-over');
    readFile(e.dataTransfer.files && e.dataTransfer.files[0], onFile);
  });
  pwChk.addEventListener('change', function(){ pwField.style.display = pwChk.checked ? '' : 'none'; });

  uploadBtn.addEventListener('click', function(){
    if(!htmlText) return;
    var pw = pwChk.checked ? document.getElementById('pw').value : '';
    if(pwChk.checked && !pw){ setMsg('비밀번호를 입력하거나 설정을 해제하세요.', true); return; }
    uploadBtn.disabled = true;
    setMsg('업로드 중…');
    fetch('/api/room/' + ROOM, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ html: htmlText, title: document.getElementById('title').value, password: pw })
    }).then(function(r){
      if(r.ok){ location.reload(); return; }
      if(r.status === 409){ setMsg('이미 사용중인 방입니다. 새로고침 후 확인하세요.', true); }
      else { setMsg('업로드 실패 (HTTP ' + r.status + ')', true); }
      uploadBtn.disabled = false;
    }).catch(function(e){ setMsg('업로드 실패: ' + e.message, true); uploadBtn.disabled = false; });
  });
})();`;
}

function editorEmptyScript(room) {
  return `
(function(){
  var ROOM = '${room}';
  var md = document.getElementById('md');
  var pv = document.getElementById('pv');
  var pwChk = document.getElementById('pwChk');
  var pwField = document.getElementById('pwField');
  var publishBtn = document.getElementById('publishBtn');
  var msg = document.getElementById('msg');
  ${editorCoreSnippet()}

  md.addEventListener('input', function(){
    render();
    publishBtn.disabled = !md.value.trim();
  });
  render();
  pwChk.addEventListener('change', function(){ pwField.style.display = pwChk.checked ? '' : 'none'; });

  publishBtn.addEventListener('click', function(){
    if(!md.value.trim()) return;
    var pw = pwChk.checked ? document.getElementById('pw').value : '';
    if(pwChk.checked && !pw){ setMsg('비밀번호를 입력하거나 설정을 해제하세요.', true); return; }
    var title = document.getElementById('title').value;
    publishBtn.disabled = true;
    setMsg('게시 중…');
    fetch('/api/room/' + ROOM, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        html: buildDoc(title || ROOM, marked.parse(md.value)),
        markdown: md.value,
        title: title,
        password: pw
      })
    }).then(function(r){
      if(r.ok){ location.reload(); return; }
      if(r.status === 409){ setMsg('이미 사용중인 방입니다. 새로고침 후 확인하세요.', true); }
      else { setMsg('게시 실패 (HTTP ' + r.status + ')', true); }
      publishBtn.disabled = false;
    }).catch(function(e){ setMsg('게시 실패: ' + e.message, true); publishBtn.disabled = false; });
  });
})();`;
}

function editorUsedScript(room, meta) {
  const titleJs = JSON.stringify((meta && meta.title) ? meta.title : room).replace(/</g, '\\u003c');
  return `
(function(){
  var ROOM = '${room}';
  var TITLE = ${titleJs};
  var md = document.getElementById('md');
  var pv = document.getElementById('pv');
  var editSec = document.getElementById('editSec');
  var saveBtn = document.getElementById('saveBtn');
  var msg = document.getElementById('msg');
  ${editorCoreSnippet()}

  document.getElementById('openBtn').addEventListener('click', function(){
    window.open('/' + ROOM + '/view', '_blank');
  });

  document.getElementById('editBtn').addEventListener('click', function(){
    setMsg('내용 불러오는 중…');
    fetch('/' + ROOM + '/source').then(function(r){
      return r.ok ? r.text() : '';
    }).then(function(t){
      md.value = t || '';
      editSec.style.display = '';
      render();
      setMsg('');
      md.focus();
    }).catch(function(e){ setMsg('불러오기 실패: ' + e.message, true); });
  });

  document.getElementById('cancelBtn').addEventListener('click', function(){
    editSec.style.display = 'none';
    setMsg('');
  });

  md.addEventListener('input', render);

  saveBtn.addEventListener('click', function(){
    if(!md.value.trim()){ setMsg('내용을 입력하세요.', true); return; }
    saveBtn.disabled = true;
    setMsg('게시 중…');
    fetch('/api/room/' + ROOM, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ html: buildDoc(TITLE, marked.parse(md.value)), markdown: md.value })
    }).then(function(r){
      if(r.ok){ location.reload(); return; }
      setMsg(r.status === 401 ? '권한이 없습니다. 새로고침 후 비밀번호를 다시 입력하세요.' : '게시 실패 (HTTP ' + r.status + ')', true);
      saveBtn.disabled = false;
    }).catch(function(e){ setMsg('게시 실패: ' + e.message, true); saveBtn.disabled = false; });
  });

  document.getElementById('deleteBtn').addEventListener('click', function(){
    if(!window.confirm(ROOM + ' 방을 비울까요? 게시물이 삭제됩니다.')) return;
    setMsg('삭제 중…');
    fetch('/api/room/' + ROOM, { method: 'DELETE' })
      .then(function(r){
        if(r.ok){ location.href = '/'; return; }
        setMsg(r.status === 401 ? '권한이 없습니다. 새로고침 후 비밀번호를 다시 입력하세요.' : '삭제 실패 (HTTP ' + r.status + ')', true);
      }).catch(function(e){ setMsg('삭제 실패: ' + e.message, true); });
  });
})();`;
}

function lockedScript(room) {
  return `
(function(){
  var ROOM = '${room}';
  var msg = document.getElementById('msg');
  var enterBtn = document.getElementById('enterBtn');
  var pw = document.getElementById('pw');
  function setMsg(t, err){ msg.textContent = t || ''; msg.className = err ? 'status-msg err' : 'status-msg'; }

  function enter(){
    if(!pw.value){ setMsg('비밀번호를 입력하세요.', true); return; }
    enterBtn.disabled = true;
    setMsg('확인 중…');
    fetch('/api/room/' + ROOM + '/auth', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ password: pw.value })
    }).then(function(r){
      if(r.ok){ location.reload(); return; }
      setMsg(r.status === 401 ? '비밀번호가 올바르지 않습니다.' : '확인 실패 (HTTP ' + r.status + ')', true);
      enterBtn.disabled = false;
    }).catch(function(e){ setMsg('확인 실패: ' + e.message, true); enterBtn.disabled = false; });
  }
  enterBtn.addEventListener('click', enter);
  pw.addEventListener('keydown', function(e){ if(e.key === 'Enter') enter(); });
})();`;
}

function usedScript(room) {
  return `
(function(){
  var ROOM = '${room}';
  var input = document.getElementById('file');
  var msg = document.getElementById('msg');
  ${fileReaderSnippet()}

  document.getElementById('openBtn').addEventListener('click', function(){
    window.open('/' + ROOM + '/view', '_blank');
  });

  document.getElementById('replaceBtn').addEventListener('click', function(){ input.click(); });
  input.addEventListener('change', function(){
    readFile(input.files[0], function(text, file){
      if(!window.confirm(file.name + ' 으로 교체할까요? 기존 게시물은 사라집니다.')) return;
      var title = window.prompt('표시 이름 (비우면 기존 이름 유지)') || '';
      setMsg('교체 중…');
      fetch('/api/room/' + ROOM, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ html: text, title: title })
      }).then(function(r){
        if(r.ok){ location.reload(); return; }
        setMsg(r.status === 401 ? '권한이 없습니다. 새로고침 후 비밀번호를 다시 입력하세요.' : '교체 실패 (HTTP ' + r.status + ')', true);
      }).catch(function(e){ setMsg('교체 실패: ' + e.message, true); });
    });
    input.value = '';
  });

  document.getElementById('deleteBtn').addEventListener('click', function(){
    if(!window.confirm(ROOM + ' 방을 비울까요? 게시물이 삭제됩니다.')) return;
    setMsg('삭제 중…');
    fetch('/api/room/' + ROOM, { method: 'DELETE' })
      .then(function(r){
        if(r.ok){ location.href = '/'; return; }
        setMsg(r.status === 401 ? '권한이 없습니다. 새로고침 후 비밀번호를 다시 입력하세요.' : '삭제 실패 (HTTP ' + r.status + ')', true);
      }).catch(function(e){ setMsg('삭제 실패: ' + e.message, true); });
  });
})();`;
}
