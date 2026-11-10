/*!
 * 시뮬레이터 접근 승인 잠금 화면 (gate.js)
 *
 * 잠글 시뮬레이터의 <head> 맨 앞에 아래 한 줄이 들어가면 동작한다.
 *   <script src="/auth/gate.js" data-sim="care"></script>
 * 배포 워크플로(.github/workflows/deploy-pages.yml)가 LOCKED 목록의 폴더에 자동으로 넣어 준다.
 *
 * - 사번·소속·이름 입력 → 관리자 카카오톡으로 6자리 코드 발송 → 관리자가 전달한 코드 입력 → 입장
 * - 관리자는 '관리자 로그인'에서 사번 + 비밀번호로 입장
 * - 한 번 승인되면 통행증이 이 브라우저에 저장되어 잠긴 시뮬레이터 모두에 다시 묻지 않고 들어간다
 * - 주소 끝에 ?sg-logout 을 붙여 열면 이 브라우저의 통행증을 지운다
 * - 유포 방지(관리자는 제외): 화면·인쇄물에 이름·사번·날짜 워터마크, 그림(PNG) 저장물에 워터마크,
 *   엑셀 저장물에 '이용자' 시트, 30자 이상 복사 시 출처 문구 덧붙임, 내려받기·복사·인쇄를 승인 서버 시트에 기록
 *
 * ※ 화면 잠금(A 수준)이다. 페이지 파일과 데이터는 공개 저장소에 그대로 있으므로
 *   개발자 도구를 쓰는 사람까지 막지는 못한다.
 */
(function () {
  'use strict';
  // ▼ Apps Script 웹앱을 배포한 뒤 받은 주소(/exec로 끝남)를 여기에 넣는다
  var API = 'https://script.google.com/macros/s/AKfycbyimpa3X5-KDXxJC8_iqLtXn1uHOhidJ6XqJ2o-0H_UkP6jDKE4XMa8N8PLj09-hsu2DA/exec';

  var NAMES = { pras: 'PRAS-DER', tou: 'PRAS-TOU', care: 'CARE-Jeju', 'iea-price': 'IEA Prices and Taxes',
    'ember-sim': 'EMBER Electricity', 'kepco-stat': 'KEPCO Statistics', 'elec-intensity': '전력원단위',
    bple: '전력수급기본계획', 'renewable-lcoe': '재생에너지 LCOE', lcoe: '태양광 LCOE' };
  var me = document.currentScript;
  if (me && me.getAttribute('data-api')) API = me.getAttribute('data-api');
  var SIM = (me && me.getAttribute('data-sim')) || location.pathname.split('/')[1] || '';
  var SIMNAME = NAMES[SIM] || SIM;
  var K_TOKEN = 'simgate.v1', K_PEND = 'simgate.pending.v1';
  var doc = document.documentElement;

  /* ---------- 저장소(사생활 보호 모드 등에서 막혀도 동작하도록) ---------- */
  var mem = {};
  function sget(k) { try { var v = localStorage.getItem(k); return v ? JSON.parse(v) : null; } catch (e) { return mem[k] || null; } }
  function sset(k, v) { mem[k] = v; try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }
  function sdel(k) { delete mem[k]; try { localStorage.removeItem(k); } catch (e) {} }

  /* ---------- 먼저 화면을 가린다(본문이 그려지기 전에) ---------- */
  var css = document.createElement('style');
  css.id = 'sg-style';
  css.textContent = [
    'html.sg-lock body{overflow:hidden!important}',
    'html.sg-lock body>*:not(#sg-root){visibility:hidden!important}',
    '#sg-root{position:fixed;inset:0;z-index:2147483000;display:flex;align-items:center;justify-content:center;padding:20px 16px;overflow-y:auto;',
    ' background:radial-gradient(1200px 500px at 85% -10%,rgba(37,99,235,.10),transparent 60%),#f3f4f6;',
    ' font-family:Pretendard,"Pretendard Variable",-apple-system,BlinkMacSystemFont,"Apple SD Gothic Neo","Malgun Gothic",system-ui,sans-serif;color:#1f2329;-webkit-font-smoothing:antialiased;word-break:keep-all}',
    '#sg-root *{box-sizing:border-box;font-family:inherit;letter-spacing:normal}',
    '#sg-root .sg-card{width:100%;max-width:420px;margin:auto;background:#fff;border:1px solid #e3e5e9;border-radius:18px;box-shadow:0 12px 40px rgba(17,24,39,.08);padding:28px 26px 22px}',
    '#sg-root .sg-top{display:flex;align-items:center;gap:12px;margin-bottom:18px}',
    '#sg-root .sg-ico{flex:none;width:44px;height:44px;border-radius:12px;background:#1f2937;color:#fff;display:flex;align-items:center;justify-content:center}',
    '#sg-root .sg-ico svg{width:22px;height:22px}',
    '#sg-root .sg-kicker{margin:0;font-size:12px;font-weight:700;color:#6b7280}',
    '#sg-root .sg-title{margin:2px 0 0;font-size:20px;font-weight:800;line-height:1.3;color:#111827}',
    '#sg-root .sg-lead{margin:0 0 18px;font-size:13.5px;line-height:1.6;color:#4b5563}',
    '#sg-root .sg-lead b{color:#111827}',
    '#sg-root label{display:block;margin:0 0 12px;font-size:12.5px;font-weight:700;color:#374151}',
    '#sg-root input{display:block;width:100%;margin-top:6px;height:46px;padding:0 14px;border:1px solid #d1d5db;border-radius:11px;background:#fff;font-size:16px;color:#111827;outline:none;-webkit-appearance:none;appearance:none}',
    '#sg-root input:focus{border-color:#1f2937;box-shadow:0 0 0 3px rgba(31,41,55,.12)}',
    '#sg-root input.sg-code{height:58px;text-align:center;font-size:26px;font-weight:800;letter-spacing:.42em;padding-left:.42em;font-variant-numeric:tabular-nums}',
    '#sg-root .sg-btn{display:flex;align-items:center;justify-content:center;width:100%;height:48px;margin-top:6px;border:0;border-radius:12px;background:#1f2937;color:#fff;font-size:15px;font-weight:800;cursor:pointer}',
    '#sg-root .sg-btn:hover{background:#111827}',
    '#sg-root .sg-btn[disabled]{opacity:.55;cursor:default}',
    '#sg-root .sg-msg{min-height:20px;margin:10px 0 0;font-size:13px;line-height:1.5;color:#b91c1c}',
    '#sg-root .sg-msg.ok{color:#047857}',
    '#sg-root .sg-links{display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap;margin-top:14px}',
    '#sg-root .sg-link{border:0;background:none;padding:4px 0;font-size:13px;font-weight:700;color:#4b5563;cursor:pointer;text-decoration:none}',
    '#sg-root .sg-link:hover{color:#111827;text-decoration:underline}',
    '#sg-root .sg-link[disabled]{color:#9ca3af;cursor:default;text-decoration:none}',
    '#sg-root .sg-note{margin:16px 0 0;padding-top:14px;border-top:1px solid #eef0f2;font-size:11.5px;line-height:1.55;color:#8a9099}',
    '#sg-root .sg-foot{display:flex;justify-content:space-between;align-items:center;margin-top:16px;font-size:12.5px}',
    '#sg-root .sg-spin{display:inline-block;width:16px;height:16px;margin-right:8px;border:2px solid rgba(255,255,255,.4);border-top-color:#fff;border-radius:50%;animation:sgspin .8s linear infinite}',
    '@keyframes sgspin{to{transform:rotate(360deg)}}',
    '#sg-wm{position:fixed;inset:0;z-index:2147482000;pointer-events:none;background-repeat:repeat}',
    '@media print{#sg-wm{-webkit-print-color-adjust:exact;print-color-adjust:exact}}',
    '@media(max-width:420px){#sg-root .sg-card{padding:24px 18px 18px;border-radius:16px}#sg-root .sg-title{font-size:18px}}'
  ].join('\n');
  (document.head || doc).appendChild(css);

  var tok = sget(K_TOKEN);
  if (/[?&]sg-logout\b/.test(location.search)) { if (tok) api({ action: 'logout', token: tok.token }); sdel(K_TOKEN); sdel(K_PEND); tok = null; }
  var hasLocal = !!(tok && tok.token && tok.exp > Date.now());
  if (!hasLocal) doc.classList.add('sg-lock');

  /* ---------- 유포 방지: 워터마크·저장물 표시·기록 (관리자는 제외) ---------- */
  function who() { var t = sget(K_TOKEN); return t && t.token && t.exp > Date.now() && t.role !== 'admin' ? t : null; }
  function today() { var d = new Date(); return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2); }
  function mark(t) { return t.name + (t.empId ? ' · ' + t.empId : '') + ' · ' + today(); }
  function report(kind, detail) { var t = who(); if (t) api({ action: 'event', token: t.token, kind: kind, detail: String(detail || '').slice(0, 120) }); }
  var WMFONT = 'Pretendard,"Apple SD Gothic Neo","Malgun Gothic",sans-serif';

  // ① 화면 워터마크(인쇄물에도 찍힘). 지워도 다시 붙는다
  var wm = null, wmObs = null;
  function wmBg(text) {
    var svg = '<svg xmlns="http://www.w3.org/2000/svg" width="380" height="210"><text x="190" y="105" text-anchor="middle" dominant-baseline="middle" transform="rotate(-22 190 105)" font-family=\'' + WMFONT.replace(/"/g, '') + '\' font-size="15" font-weight="600" fill="rgb(90,96,108)" fill-opacity=".14">' + esc(text) + '</text></svg>';
    return 'url("data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg) + '")';
  }
  function placeWatermark() {
    var t = who();
    if (!t) { if (wmObs) { wmObs.disconnect(); wmObs = null; } if (wm) { wm.remove(); wm = null; } return; }
    if (!document.body) { document.addEventListener('DOMContentLoaded', placeWatermark); return; }
    if (!wm) { wm = document.createElement('div'); wm.id = 'sg-wm'; wm.setAttribute('aria-hidden', 'true'); }
    wm.setAttribute('style', 'background-image:' + wmBg(mark(t)) + ' !important;display:block!important;opacity:1!important;visibility:visible!important');
    if (!wm.isConnected) document.body.appendChild(wm);
    if (!wmObs && window.MutationObserver) {
      wmObs = new MutationObserver(function () {
        if (who() && wm && (!wm.isConnected || wm.id !== 'sg-wm' || (wm.getAttribute('style') || '').indexOf('background-image') < 0)) { wm.id = 'sg-wm'; placeWatermark(); }
      });
      wmObs.observe(document.body, { childList: true });
      wmObs.observe(wm, { attributes: true });
    }
  }

  // ② 그림 저장(html2canvas)에 워터마크와 저장자 표시(오른쪽 위)
  function stampCanvas(c) {
    var t = who(); if (!t || !c || !c.getContext) return c;
    try {
      var g = c.getContext('2d'), w = c.width, h = c.height, fs = Math.max(14, Math.round(Math.min(w, 2400) / 75)), txt = mark(t);
      // html2canvas가 남겨 둔 확대·이동 변환을 지우고 캔버스 픽셀 기준으로 그린다
      g.save(); g.setTransform(1, 0, 0, 1, 0, 0); g.font = '600 ' + fs + 'px ' + WMFONT; g.fillStyle = 'rgba(90,96,108,.11)'; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.translate(w / 2, h / 2); g.rotate(-22 * Math.PI / 180);
      var dx = g.measureText(txt).width + fs * 5, dy = fs * 7, R = Math.sqrt(w * w + h * h) / 2 + dx, row = 0;
      for (var y = -R; y < R; y += dy, row++) for (var x = -R + (row % 2) * dx / 2; x < R; x += dx) g.fillText(txt, x, y);
      g.restore();
      var f2 = Math.round(fs * .8), label = '저장: ' + SIMNAME + ' · ' + txt;
      g.save(); g.setTransform(1, 0, 0, 1, 0, 0); g.font = '700 ' + f2 + 'px ' + WMFONT; var tw = g.measureText(label).width;
      g.fillStyle = 'rgba(255,255,255,.88)'; g.fillRect(w - tw - f2 * 1.6, f2 * .5, tw + f2 * 1.2, f2 * 1.8);
      g.fillStyle = 'rgba(55,60,70,.92)'; g.textAlign = 'right'; g.textBaseline = 'middle'; g.fillText(label, w - f2, f2 * 1.4); g.restore();
    } catch (e) {}
    return c;
  }
  // 시뮬레이터가 나중에 불러오는 전역 라이브러리(html2canvas, XLSX)를 감싼다
  function trapGlobal(name, wrap) {
    try {
      var cur = window[name];
      Object.defineProperty(window, name, { configurable: true, enumerable: true,
        get: function () { return cur ? wrap(cur) : cur; },
        set: function (v) { cur = v; } });
    } catch (e) {}
  }
  var h2cWrapped = null, h2cOrig = null;
  trapGlobal('html2canvas', function (fn) {
    if (fn === h2cOrig && h2cWrapped) return h2cWrapped;
    h2cOrig = fn;
    h2cWrapped = function () { var p = fn.apply(this, arguments); return p && p.then ? p.then(stampCanvas) : p; };
    return h2cWrapped;
  });
  // ③ 엑셀 저장(XLSX.writeFile / XLSX.write)에 '이용자' 시트 추가
  function addUserSheet(X, wb) {
    var t = who();
    if (!t || !wb || wb.__sg || !X.utils || !X.utils.aoa_to_sheet || !wb.SheetNames) return;
    try {
      var ws = X.utils.aoa_to_sheet([['내려받은 사람', t.name], ['사번', t.empId || ''], ['내려받은 날짜', today()], ['시뮬레이터', SIMNAME], ['안내', '승인된 이용자 개인 확인용 자료입니다. 외부로 전달하지 말아 주세요.']]);
      var nm = '이용자', i = 1; while (wb.SheetNames.indexOf(nm) >= 0) nm = '이용자' + (++i);
      X.utils.book_append_sheet(wb, ws, nm);
      try { Object.defineProperty(wb, '__sg', { value: true }); } catch (e) {}
    } catch (e) {}
  }
  trapGlobal('XLSX', function (X) {
    if (!X || X.__sg || typeof X.writeFile !== 'function' || typeof X.write !== 'function') return X;
    var wf = X.writeFile, w = X.write;
    X.writeFile = function (wb) { addUserSheet(X, wb); return wf.apply(this, arguments); };
    X.write = function (wb) { addUserSheet(X, wb); return w.apply(this, arguments); };
    try { X.__sg = true; } catch (e) {}
    return X;
  });

  // ④ 복사: 30자 이상이면 출처 문구를 덧붙이고 기록
  function cpFoot(t) { return '\n\n— ' + SIMNAME + ' · ' + mark(t) + ' 복사 · 외부 전달 금지'; }
  document.addEventListener('copy', function (e) {
    var t = who(); if (!t || !e.clipboardData) return;
    var sel = window.getSelection ? window.getSelection() : null, txt = sel ? String(sel) : '', html = '';
    var ae = document.activeElement;
    if (!txt && ae && /^(TEXTAREA|INPUT)$/.test(ae.tagName)) { try { txt = ae.value.slice(ae.selectionStart, ae.selectionEnd); } catch (x) {} }
    if (txt.length < 30) return;
    try { if (sel && sel.rangeCount) { var d = document.createElement('div'); for (var i = 0; i < sel.rangeCount; i++) d.appendChild(sel.getRangeAt(i).cloneContents()); html = d.innerHTML; } } catch (x) {}
    e.clipboardData.setData('text/plain', txt + cpFoot(t));
    if (html) e.clipboardData.setData('text/html', html + '<p style="color:#666;font-size:11px">' + esc(cpFoot(t).trim()) + '</p>');
    e.preventDefault();
    report('copy', txt.length + '자');
  }, true);
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      var cbWrite = navigator.clipboard.writeText.bind(navigator.clipboard);
      navigator.clipboard.writeText = function (txt) {
        var t = who(); txt = String(txt);
        if (t && txt.length >= 30) { report('copy', '표 복사 ' + txt.length + '자'); txt += cpFoot(t); }
        return cbWrite(txt);
      };
    }
  } catch (e) {}

  // ⑤ 내려받기·인쇄 기록
  var lastDl = {};
  function dl(a) {
    try {
      if (!a || !a.hasAttribute || !a.hasAttribute('download')) return;
      var n = a.getAttribute('download') || String(a.href || '').split('/').pop();
      if (lastDl[n] && Date.now() - lastDl[n] < 1500) return;
      lastDl[n] = Date.now(); report('download', n);
    } catch (e) {}
  }
  document.addEventListener('click', function (e) { var a = e.target && e.target.closest ? e.target.closest('a[download]') : null; if (a) dl(a); }, true);
  try { var aClick = HTMLAnchorElement.prototype.click; HTMLAnchorElement.prototype.click = function () { if (!this.isConnected) dl(this); return aClick.apply(this, arguments); }; } catch (e) {}
  window.addEventListener('beforeprint', function () { report('print', document.title || SIMNAME); });

  /* ---------- 서버 호출 ---------- */
  function api(body) {
    if (!API) return Promise.resolve({ ok: false, msg: '접근 승인 서버 주소가 아직 설정되지 않았습니다. 관리자에게 문의해주세요.' });
    body.sim = SIM;
    var ctl = typeof AbortController === 'function' ? new AbortController() : null;
    var timer = setTimeout(function () { if (ctl) ctl.abort(); }, 25000);
    // Content-Type을 지정하지 않으면 text/plain으로 보내져 사전 요청(CORS preflight) 없이 Apps Script에 닿는다
    return fetch(API, { method: 'POST', body: JSON.stringify(body), redirect: 'follow', signal: ctl ? ctl.signal : undefined })
      .then(function (r) { return r.json(); })
      .catch(function () { return { ok: false, net: true, msg: '서버에 연결하지 못했습니다. 인터넷 연결을 확인하고 다시 시도해주세요.' }; })
      .then(function (r) { clearTimeout(timer); return r || { ok: false, msg: '응답이 없습니다.' }; });
  }

  /* ---------- 잠금 화면 ---------- */
  var root = null, step = 'req', cooldownTimer = null;
  var LOCK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="4.5" y="10.5" width="15" height="10" rx="2.2"/><path d="M8 10.5V7.8a4 4 0 0 1 8 0v2.7"/><circle cx="12" cy="15.5" r="1.2" fill="currentColor"/></svg>';

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function $(sel) { return root.querySelector(sel); }

  function mount() {
    if (root) return;
    root = document.createElement('div');
    root.id = 'sg-root';
    root.setAttribute('role', 'dialog');
    root.setAttribute('aria-modal', 'true');
    root.setAttribute('aria-label', '시뮬레이터 접근 승인');
    document.body.appendChild(root);
    var p = sget(K_PEND);
    if (p && p.exp > Date.now()) show('code'); else { sdel(K_PEND); show('req'); }
  }

  function head(kicker) {
    return '<div class="sg-top"><div class="sg-ico" aria-hidden="true">' + LOCK + '</div><div><p class="sg-kicker">' + esc(kicker) +
      '</p><p class="sg-title">' + esc(SIMNAME || '시뮬레이터') + '</p></div></div>';
  }
  function foot(right) {
    return '<div class="sg-foot"><a class="sg-link" href="/">← 처음 화면으로</a>' + (right || '') + '</div>';
  }

  function show(s, notice) {
    step = s; clearInterval(cooldownTimer);
    var p = sget(K_PEND) || {};
    var h = '';
    if (s === 'req') {
      h = head('접근 승인이 필요한 시뮬레이터') +
        '<p class="sg-lead">사번·소속·이름을 입력하면 관리자에게 접속 요청이 전달됩니다. 관리자에게 받은 <b>6자리 코드</b>를 입력하면 이용할 수 있습니다.</p>' +
        '<form id="sg-f" novalidate>' +
        '<label>사번 (8자리)<input id="sg-emp" inputmode="numeric" autocomplete="off" maxlength="8" placeholder="예: 12345678" value="' + esc(p.empId || '') + '"></label>' +
        '<label>소속<input id="sg-dept" autocomplete="organization" maxlength="40" placeholder="예: 요금전략처 요금분석팀" value="' + esc(p.dept || '') + '"></label>' +
        '<label>이름<input id="sg-name" autocomplete="name" maxlength="20" placeholder="예: 홍길동" value="' + esc(p.name || '') + '"></label>' +
        '<button class="sg-btn" id="sg-go" type="submit">접속 코드 요청</button>' +
        '<p class="sg-msg" id="sg-msg" role="status"></p></form>' +
        '<p class="sg-note">입력한 사번·소속·이름은 접속 승인과 이용 기록 관리에만 쓰이며 관리자만 볼 수 있습니다. 한 번 승인되면 이 브라우저에서는 30일 동안 다시 묻지 않습니다.</p>' +
        foot('<button class="sg-link" type="button" id="sg-to-admin">관리자 로그인</button>');
    } else if (s === 'code') {
      h = head('접속 코드 입력') +
        '<p class="sg-lead"><b>' + esc(p.name) + '</b>(' + esc(p.empId) + ')님의 접속 요청을 관리자에게 보냈습니다. 관리자에게 받은 6자리 코드를 입력해주세요. 코드는 요청 후 ' + (p.ttl || 24) + '시간 동안 유효합니다.</p>' +
        '<form id="sg-f" novalidate>' +
        '<label>접속 코드<input id="sg-code" class="sg-code" inputmode="numeric" autocomplete="one-time-code" maxlength="6" placeholder="······"></label>' +
        '<button class="sg-btn" id="sg-go" type="submit">확인</button>' +
        '<p class="sg-msg" id="sg-msg" role="status"></p></form>' +
        '<div class="sg-links"><button class="sg-link" type="button" id="sg-resend">코드 다시 요청</button><button class="sg-link" type="button" id="sg-back">정보 다시 입력</button></div>' +
        foot('');
    } else if (s === 'admin') {
      h = head('관리자 로그인') +
        '<form id="sg-f" novalidate>' +
        '<label>사번<input id="sg-emp" inputmode="numeric" autocomplete="username" maxlength="8"></label>' +
        '<label>비밀번호<input id="sg-pw" type="password" autocomplete="current-password"></label>' +
        '<button class="sg-btn" id="sg-go" type="submit">로그인</button>' +
        '<p class="sg-msg" id="sg-msg" role="status"></p></form>' +
        foot('<button class="sg-link" type="button" id="sg-back">일반 접속으로</button>');
    }
    root.innerHTML = '<div class="sg-card">' + h + '</div>';
    if (notice) msg(notice.text, notice.ok);
    bind();
    var first = root.querySelector('input'); if (first && !('ontouchstart' in window)) first.focus();
    if (s === 'code') startCooldown(p.at);
  }

  function msg(t, ok) { var m = $('#sg-msg'); if (m) { m.textContent = t || ''; m.className = 'sg-msg' + (ok ? ' ok' : ''); } }
  function busy(on, label) {
    var b = $('#sg-go'); if (!b) return;
    if (on) { b.dataset.l = b.textContent; b.disabled = true; b.innerHTML = '<span class="sg-spin"></span>' + esc(label || '확인 중…'); }
    else { b.disabled = false; b.textContent = b.dataset.l || b.textContent; }
  }
  function digits(el, n) { el.addEventListener('input', function () { var v = el.value.replace(/\D/g, '').slice(0, n); if (v !== el.value) el.value = v; }); }

  function startCooldown(at) {
    var b = $('#sg-resend'); if (!b) return;
    function tick() {
      var left = Math.ceil(((at || 0) + 60000 - Date.now()) / 1000);
      if (left > 0) { b.disabled = true; b.textContent = '코드 다시 요청 (' + left + '초)'; }
      else { b.disabled = false; b.textContent = '코드 다시 요청'; clearInterval(cooldownTimer); }
    }
    tick(); cooldownTimer = setInterval(tick, 1000);
  }

  function requestCode(empId, dept, name) {
    return api({ action: 'request', empId: empId, dept: dept, name: name }).then(function (r) {
      if (r.ok) sset(K_PEND, { empId: empId, dept: dept, name: name, at: Date.now(), ttl: r.ttlHours || 24, exp: Date.now() + (r.ttlHours || 24) * 3600000 });
      return r;
    });
  }

  function bind() {
    var f = $('#sg-f');
    if (step === 'req') {
      digits($('#sg-emp'), 8);
      f.addEventListener('submit', function (e) {
        e.preventDefault();
        var empId = $('#sg-emp').value.trim(), dept = $('#sg-dept').value.trim(), name = $('#sg-name').value.trim();
        if (!/^\d{8}$/.test(empId)) { msg('사번은 8자리 숫자로 입력해주세요.'); $('#sg-emp').focus(); return; }
        if (dept.length < 2) { msg('소속을 입력해주세요.'); $('#sg-dept').focus(); return; }
        if (name.length < 2) { msg('이름을 입력해주세요.'); $('#sg-name').focus(); return; }
        busy(true, '요청 보내는 중…');
        requestCode(empId, dept, name).then(function (r) {
          if (r.ok) show('code', { text: '관리자에게 요청을 보냈습니다.', ok: true });
          else { busy(false); msg(r.msg); }
        });
      });
      $('#sg-to-admin').addEventListener('click', function () { show('admin'); });
    } else if (step === 'code') {
      var c = $('#sg-code'); digits(c, 6);
      c.addEventListener('input', function () { if (c.value.length === 6) f.requestSubmit ? f.requestSubmit() : f.dispatchEvent(new Event('submit', { cancelable: true })); });
      f.addEventListener('submit', function (e) {
        e.preventDefault();
        if ($('#sg-go').disabled) return;
        var p = sget(K_PEND) || {}, code = c.value.trim();
        if (!/^\d{6}$/.test(code)) { msg('6자리 숫자 코드를 입력해주세요.'); return; }
        busy(true);
        api({ action: 'verify', empId: p.empId, code: code }).then(function (r) {
          if (r.ok) { sdel(K_PEND); grant(r); return; }
          busy(false); c.value = ''; c.focus();
          if (r.expired) { sdel(K_PEND); show('req', { text: r.msg }); } else msg(r.msg);
        });
      });
      $('#sg-resend').addEventListener('click', function () {
        var p = sget(K_PEND) || {}, b = this;
        b.disabled = true;
        requestCode(p.empId, p.dept, p.name).then(function (r) {
          if (r.ok) { msg('관리자에게 새 코드를 요청했습니다. 이전 코드는 더 이상 쓸 수 없습니다.', true); startCooldown(Date.now()); }
          else { b.disabled = false; msg(r.msg); }
        });
      });
      $('#sg-back').addEventListener('click', function () { show('req'); });
    } else if (step === 'admin') {
      digits($('#sg-emp'), 8);
      f.addEventListener('submit', function (e) {
        e.preventDefault();
        var empId = $('#sg-emp').value.trim(), pw = $('#sg-pw').value;
        if (!/^\d{8}$/.test(empId) || !pw) { msg('사번과 비밀번호를 입력해주세요.'); return; }
        busy(true, '로그인 중…');
        api({ action: 'admin', empId: empId, password: pw }).then(function (r) {
          if (r.ok) grant(r); else { busy(false); $('#sg-pw').value = ''; msg(r.msg); }
        });
      });
      $('#sg-back').addEventListener('click', function () { show('req'); });
    }
  }

  function grant(r) {
    sset(K_TOKEN, { token: r.token, exp: r.exp, name: r.name, empId: r.empId, role: r.role });
    unlock(); placeWatermark();
  }
  function unlock() {
    doc.classList.remove('sg-lock');
    clearInterval(cooldownTimer);
    if (root) { root.remove(); root = null; }
    // 가려져 있던 동안의 크기를 다시 계산하도록(그래프 등)
    try { window.dispatchEvent(new Event('resize')); } catch (e) {}
  }
  function lock(notice) {
    doc.classList.add('sg-lock'); placeWatermark();
    whenBody(function () { mount(); if (notice) show('req', notice); });
  }
  function whenBody(fn) { if (document.body) fn(); else document.addEventListener('DOMContentLoaded', fn); }

  /* ---------- 시작 ---------- */
  if (hasLocal) {
    placeWatermark();
    // 저장된 통행증이 있으면 바로 보여 주고, 서버에서 다시 확인해 취소·차단된 경우에만 잠근다(서버 연결 실패 시에는 그대로 둔다)
    api({ action: 'check', token: tok.token }).then(function (r) {
      if (r.ok) { tok.name = r.name; tok.role = r.role; if (r.empId) tok.empId = r.empId; if (r.exp) tok.exp = r.exp; sset(K_TOKEN, tok); placeWatermark(); }
      else if (r.revoked) { sdel(K_TOKEN); lock({ text: r.msg || '통행증이 만료되었습니다. 다시 요청해주세요.' }); }
    });
  } else {
    whenBody(mount);
  }

  window.SimGate = {
    logout: function () { var t = sget(K_TOKEN); if (t) api({ action: 'logout', token: t.token }); sdel(K_TOKEN); sdel(K_PEND); lock(); },
    user: function () { var t = sget(K_TOKEN); return t ? { name: t.name, role: t.role, exp: t.exp } : null; }
  };
})();
