/**
 * 시뮬레이터 접근 승인 서버 (Google Apps Script 웹앱)
 *
 * 흐름
 *  1) 잠긴 시뮬레이터에서 사번·소속·이름을 입력 → action=request
 *     → 6자리 코드를 만들어 관리자 카카오톡(나에게 보내기)으로 보냄
 *  2) 관리자가 코드를 요청자에게 직접 전달 → 요청자가 입력 → action=verify
 *     → 맞으면 통행증(토큰)을 발급. 토큰이 살아 있는 동안 다시 묻지 않음
 *  3) 관리자는 '관리자 로그인'에서 사번 + 비밀번호 → action=admin
 *  4) 잠긴 페이지를 열 때마다 action=check 로 토큰을 다시 확인
 *     (시트에서 '차단'으로 바꾸거나 행을 지우면 1분 안에 다시 잠김)
 *
 * 기록은 이 스크립트가 붙어 있는 구글 시트의 '사용자'·'접속기록' 탭에 쌓인다.
 * 비밀값(관리자 비밀번호, 카카오 키·토큰)은 코드가 아니라 스크립트 속성에만 둔다.
 * 설치 순서는 auth/README.md 참고.
 */

const CFG = {
  TZ: 'Asia/Seoul',
  SITE_URL: 'https://simulator-kepco.co.kr/',   // 카카오 메시지의 링크(카카오 앱 '플랫폼 > Web 사이트 도메인'에 등록해야 함)
  CODE_TTL_H: 24,          // 코드 유효시간(관리자가 직접 전달하므로 넉넉히)
  CODE_MAX_TRIES: 5,       // 코드 입력 허용 횟수
  TOKEN_DAYS: 30,          // 일반 사용자 통행증 유지 기간
  ADMIN_TOKEN_DAYS: 30,    // 관리자 통행증 유지 기간
  REQ_PER_ID_HOUR: 3,      // 같은 사번의 코드 요청 한도(1시간)
  REQ_ALL_HOUR: 30,        // 전체 코드 요청 한도(1시간) — 카카오 발송 남용 방지
  ADMIN_MAX_FAILS: 5,      // 관리자 비밀번호 실패 허용 횟수(30분)
  STATUS_CACHE_S: 60,      // 사용자 상태(승인/차단) 캐시 — 시트에서 바꾼 뒤 반영까지 걸리는 최대 시간
  SIMS: { pras: 'PRAS-DER', tou: 'PRAS-TOU', care: 'CARE-Jeju', 'iea-price': 'IEA Prices and Taxes',
          'ember-sim': 'EMBER Electricity', 'kepco-stat': 'KEPCO Statistics', 'elec-intensity': '전력원단위',
          bple: '전력수급기본계획', 'renewable-lcoe': '재생에너지 LCOE', lcoe: '태양광 LCOE' }
};
const SHEET_USERS = '사용자', SHEET_LOG = '접속기록';
const USER_HEAD = ['사번', '이름', '소속', '상태', '최초 승인', '최근 접속', '접속 횟수', '메모', '워터마크 제외'];
const NOMARK_COL = 9;   // '워터마크 제외' 칸(I열). 체크하거나 O·예·Y를 넣으면 그 사람에게는 워터마크·저장물 표시를 하지 않는다
const LOG_HEAD = ['시각', '구분', '사번', '이름', '소속', '시뮬레이터', '내용'];

/* ---------------- 웹 요청 ---------------- */

function doPost(e) {
  let req = {};
  try { req = JSON.parse((e && e.postData && e.postData.contents) || '{}'); } catch (err) { return out_({ ok: false, msg: '잘못된 요청입니다.' }); }
  try {
    switch (req.action) {
      case 'request': return out_(requestCode_(req));
      case 'verify':  return out_(verifyCode_(req));
      case 'admin':   return out_(adminLogin_(req));
      case 'check':   return out_(checkToken_(req));
      case 'logout':  return out_(logout_(req));
      case 'event':   return out_(event_(req));
      default:        return out_({ ok: false, msg: '알 수 없는 요청입니다.' });
    }
  } catch (err) {
    console.error(err);
    return out_({ ok: false, msg: '서버에서 오류가 났습니다. 잠시 뒤 다시 시도해주세요.' });
  }
}

/** 카카오 동의 후 돌아오는 주소(/exec?code=...) 처리. 그 밖의 GET은 상태 안내만 */
function doGet(e) {
  const p = (e && e.parameter) || {};
  if (p.code || p.error) return kakaoCallback_(p);
  return HtmlService.createHtmlOutput('<p style="font-family:sans-serif">시뮬레이터 접근 승인 서버가 동작 중입니다.</p>');
}

function out_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

/* ---------------- 1) 코드 요청 ---------------- */

function requestCode_(r) {
  const empId = clean_(r.empId), name = clean_(r.name), dept = clean_(r.dept), sim = simName_(r.sim);
  if (!/^\d{8}$/.test(empId)) return { ok: false, msg: '사번은 8자리 숫자로 입력해주세요.' };
  if (name.length < 2 || name.length > 20) return { ok: false, msg: '이름을 정확히 입력해주세요.' };
  if (dept.length < 2 || dept.length > 40) return { ok: false, msg: '소속을 입력해주세요.' };

  const user = findUser_(empId);
  if (user && user.status === '차단') {
    log_('요청거부', empId, name, dept, sim, '차단된 사번');
    return { ok: false, msg: '이용이 제한된 사번입니다. 관리자에게 문의해주세요.' };
  }
  const cache = CacheService.getScriptCache();
  const kId = 'rq_' + empId, kAll = 'rq_all';
  const nId = Number(cache.get(kId) || 0), nAll = Number(cache.get(kAll) || 0);
  if (nId >= CFG.REQ_PER_ID_HOUR) return { ok: false, msg: '코드 요청이 너무 잦습니다. 1시간 뒤 다시 시도하거나, 이미 받은 코드를 입력해주세요.' };
  if (nAll >= CFG.REQ_ALL_HOUR) return { ok: false, msg: '지금은 요청이 많아 잠시 뒤 다시 시도해주세요.' };
  cache.put(kId, String(nId + 1), 3600); cache.put(kAll, String(nAll + 1), 3600);

  const code = newCode_();
  const exp = Date.now() + CFG.CODE_TTL_H * 3600 * 1000;
  props_().setProperty('P_' + empId, JSON.stringify({ h: hash_(empId + ':' + code), exp, tries: 0, name, dept }));

  const prev = user && user.name && user.name !== name ? `\n(기존 등록 이름: ${user.name})` : '';
  const text = `🔐 시뮬레이터 접속 요청\n${name} · ${dept}\n사번 ${empId}${prev}\n대상: ${sim}\n\n코드 ${code}\n(${CFG.CODE_TTL_H}시간 유효 · ${fmt_(new Date())})`;
  const sent = notifyAdmin_(text, `[시뮬레이터] ${name}(${empId}) 접속 요청 · 코드 ${code}`);
  log_('코드요청', empId, name, dept, sim, sent);
  return { ok: true, ttlHours: CFG.CODE_TTL_H };
}

/* ---------------- 2) 코드 확인 → 통행증 발급 ---------------- */

function verifyCode_(r) {
  const empId = clean_(r.empId), code = clean_(r.code), sim = simName_(r.sim);
  if (!/^\d{8}$/.test(empId) || !/^\d{6}$/.test(code)) return { ok: false, msg: '6자리 숫자 코드를 입력해주세요.' };
  const lock = LockService.getScriptLock(); lock.waitLock(10000);
  try {
    const key = 'P_' + empId, raw = props_().getProperty(key);
    if (!raw) return { ok: false, expired: true, msg: '요청된 코드가 없습니다. 코드를 다시 요청해주세요.' };
    const p = JSON.parse(raw);
    if (Date.now() > p.exp) { props_().deleteProperty(key); return { ok: false, expired: true, msg: '코드 유효시간이 지났습니다. 다시 요청해주세요.' }; }
    if (p.h !== hash_(empId + ':' + code)) {
      p.tries++;
      if (p.tries >= CFG.CODE_MAX_TRIES) {
        props_().deleteProperty(key);
        log_('코드실패', empId, p.name, p.dept, sim, '허용 횟수 초과로 코드 무효');
        return { ok: false, expired: true, msg: `코드를 ${CFG.CODE_MAX_TRIES}번 틀려 무효가 되었습니다. 다시 요청해주세요.` };
      }
      props_().setProperty(key, JSON.stringify(p));
      return { ok: false, msg: `코드가 맞지 않습니다. (남은 횟수 ${CFG.CODE_MAX_TRIES - p.tries}번)` };
    }
    props_().deleteProperty(key);
    const user = findUser_(empId);
    if (user && user.status === '차단') return { ok: false, msg: '이용이 제한된 사번입니다. 관리자에게 문의해주세요.' };
    upsertUser_(empId, p.name, p.dept, true);
    const t = issueToken_({ role: 'user', empId, name: p.name, dept: p.dept }, CFG.TOKEN_DAYS);
    log_('승인', empId, p.name, p.dept, sim, `통행증 발급(${CFG.TOKEN_DAYS}일)`);
    return { ok: true, token: t.token, exp: t.exp, name: p.name, empId, role: 'user', nowm: userState_(empId).nowm };
  } finally { lock.releaseLock(); }
}

/* ---------------- 3) 관리자 로그인 ---------------- */

function adminLogin_(r) {
  const empId = clean_(r.empId), pw = String(r.password || ''), sim = simName_(r.sim);
  const P = props_(), cache = CacheService.getScriptCache();
  const fails = Number(cache.get('adm_fail') || 0);
  if (fails >= CFG.ADMIN_MAX_FAILS) return { ok: false, msg: '로그인 실패가 많아 30분 동안 잠겼습니다.' };
  const adminId = P.getProperty('ADMIN_EMP_ID'), salt = P.getProperty('ADMIN_PW_SALT'), h = P.getProperty('ADMIN_PW_HASH');
  if (!adminId || !salt || !h) return { ok: false, msg: '관리자 비밀번호가 아직 설정되지 않았습니다.' };
  if (empId !== adminId || hash_(salt + pw) !== h) {
    cache.put('adm_fail', String(fails + 1), 1800);
    log_('관리자실패', empId, '', '', sim, `실패 ${fails + 1}회`);
    if (fails + 1 >= CFG.ADMIN_MAX_FAILS) notifyAdmin_(`⚠️ 관리자 로그인 ${fails + 1}회 실패로 30분 잠금\n(${fmt_(new Date())})`, '[시뮬레이터] 관리자 로그인 잠금');
    return { ok: false, msg: '사번 또는 비밀번호가 맞지 않습니다.' };
  }
  cache.remove('adm_fail');
  const t = issueToken_({ role: 'admin', empId, name: '관리자', dept: '' }, CFG.ADMIN_TOKEN_DAYS);
  log_('관리자로그인', empId, '관리자', '', sim, '');
  return { ok: true, token: t.token, exp: t.exp, name: '관리자', empId, role: 'admin' };
}

/* ---------------- 4) 통행증 확인 ---------------- */

function checkToken_(r) {
  const s = readToken_(r.token);
  if (!s) return { ok: false, revoked: true, msg: '통행증이 만료되었거나 취소되었습니다.' };
  if (s.role !== 'admin') {
    var us = userState_(s.empId), st = us.status;
    if (st !== '승인') return { ok: false, revoked: true, msg: st === '차단' ? '이용이 제한된 사번입니다.' : '승인이 취소되었습니다. 다시 요청해주세요.' };
  }
  // 같은 통행증·시뮬레이터·날짜에는 기록을 한 번만 남긴다(시트가 너무 커지지 않도록)
  const sim = simName_(r.sim), day = Utilities.formatDate(new Date(), CFG.TZ, 'yyyyMMdd');
  const seenKey = 'seen_' + hash_(r.token + sim + day).slice(0, 40), cache = CacheService.getScriptCache();
  if (!cache.get(seenKey)) {
    cache.put(seenKey, '1', 21600);
    log_('접속', s.empId, s.name, s.dept, sim, s.role === 'admin' ? '관리자' : '');
    if (s.role !== 'admin') touchUser_(s.empId);
  }
  return { ok: true, name: s.name, empId: s.empId, role: s.role, exp: s.exp, nowm: s.role === 'admin' ? true : us.nowm };
}

/** 내려받기·복사·인쇄 기록(잠금 화면이 보내 옴). 같은 내용은 30초 안에 한 번만, 통행증당 1시간 60건까지 */
const EVENT_KINDS = { download: '내려받기', copy: '복사', print: '인쇄' };
function event_(r) {
  const s = readToken_(r.token);
  if (!s) return { ok: false };
  const kind = EVENT_KINDS[r.kind]; if (!kind) return { ok: false };
  const detail = clean_(r.detail).slice(0, 120), sim = simName_(r.sim), cache = CacheService.getScriptCache();
  const th = hash_(String(r.token)).slice(0, 24), dk = 'ev_' + hash_(th + kind + detail + sim).slice(0, 40), nk = 'evn_' + th;
  const n = Number(cache.get(nk) || 0);
  if (cache.get(dk) || n >= 60) return { ok: true, skipped: true };
  cache.put(dk, '1', 30); cache.put(nk, String(n + 1), 3600);
  log_(kind, s.empId, s.name, s.dept, sim, detail);
  return { ok: true };
}

function logout_(r) {
  const k = 'T_' + hash_(String(r.token || ''));
  if (props_().getProperty(k)) props_().deleteProperty(k);
  return { ok: true };
}

/* ---------------- 통행증 ---------------- */

function issueToken_(info, days) {
  const token = (Utilities.getUuid() + Utilities.getUuid()).replace(/-/g, '');
  const exp = Date.now() + days * 86400 * 1000;
  props_().setProperty('T_' + hash_(token), JSON.stringify(Object.assign({ exp, iat: Date.now() }, info)));
  purgeExpired_();
  return { token, exp };
}
function readToken_(token) {
  token = String(token || '');
  if (!/^[0-9a-f]{64}$/.test(token)) return null;
  const k = 'T_' + hash_(token), raw = props_().getProperty(k);
  if (!raw) return null;
  const s = JSON.parse(raw);
  if (Date.now() > s.exp) { props_().deleteProperty(k); return null; }
  return s;
}
/** 만료된 통행증·코드 정리(발급할 때 가끔 실행) */
function purgeExpired_() {
  if (Math.random() > 0.1) return;
  const P = props_(), all = P.getProperties(), now = Date.now();
  Object.keys(all).forEach(k => {
    if (!/^(T_|P_)/.test(k)) return;
    try { if (JSON.parse(all[k]).exp < now) P.deleteProperty(k); } catch (e) { P.deleteProperty(k); }
  });
}

/* ---------------- 시트(사용자·접속기록) ---------------- */

function book_() {
  const id = props_().getProperty('SHEET_ID');
  return id ? SpreadsheetApp.openById(id) : SpreadsheetApp.getActiveSpreadsheet();
}
function sheet_(name, head) {
  const b = book_();
  let sh = b.getSheetByName(name);
  if (!sh) { sh = b.insertSheet(name); sh.appendRow(head); sh.setFrozenRows(1); sh.getRange(1, 1, 1, head.length).setFontWeight('bold'); }
  return sh;
}
function findUser_(empId) {
  const sh = sheet_(SHEET_USERS, USER_HEAD), v = sh.getDataRange().getValues();
  for (let i = 1; i < v.length; i++) if (String(v[i][0]).replace(/\D/g, '').padStart(8, '0') === empId)
    return { row: i + 1, name: String(v[i][1]), dept: String(v[i][2]), status: String(v[i][3]).trim() || '승인', count: Number(v[i][6]) || 0, nowm: isYes_(v[i][NOMARK_COL - 1]) };
  return null;
}
function upsertUser_(empId, name, dept, approved) {
  const sh = sheet_(SHEET_USERS, USER_HEAD), now = fmt_(new Date()), u = findUser_(empId);
  if (!u) { sh.appendRow(["'" + empId, name, dept, '승인', now, now, 0, '', false]); try { sh.getRange(sh.getLastRow(), NOMARK_COL).insertCheckboxes(); } catch (e) {} }
  else { sh.getRange(u.row, 2, 1, 3).setValues([[name, dept, approved ? '승인' : u.status]]); }
  CacheService.getScriptCache().remove('st_' + empId);
}
function touchUser_(empId) {
  const u = findUser_(empId); if (!u) return;
  sheet_(SHEET_USERS, USER_HEAD).getRange(u.row, 6, 1, 2).setValues([[fmt_(new Date()), u.count + 1]]);
}
/** 상태('승인' / '차단' / '없음')와 워터마크 제외 여부 — 시트에서 바꾼 값이 최대 STATUS_CACHE_S초 뒤 반영 */
function userState_(empId) {
  const c = CacheService.getScriptCache(), k = 'st_' + empId, hit = c.get(k);
  if (hit) { const [status, nm] = hit.split('|'); return { status, nowm: nm === '1' }; }
  const u = findUser_(empId), st = { status: !u ? '없음' : (u.status === '차단' ? '차단' : '승인'), nowm: !!(u && u.nowm) };
  c.put(k, st.status + '|' + (st.nowm ? '1' : '0'), CFG.STATUS_CACHE_S);
  return st;
}
function isYes_(v) { return v === true || /^(o|y|yes|예|제외|true|v|✓|✔)$/i.test(String(v == null ? '' : v).trim()); }
function log_(kind, empId, name, dept, sim, note) {
  try {
    const sh = sheet_(SHEET_LOG, LOG_HEAD);
    sh.appendRow([fmt_(new Date()), kind, empId ? "'" + empId : '', name || '', dept || '', sim || '', note || '']);
  } catch (e) { console.error('log', e); }
}

/* ---------------- 관리자 알림(카카오톡 나에게 보내기, 실패하면 메일) ---------------- */

function notifyAdmin_(text, mailSubject) {
  try { sendKakaoMemo_(text); return '카카오톡 발송'; }
  catch (e) {
    console.error('kakao', e);
    // 카카오 연결이 끊겨도 코드가 사라지지 않도록, 이 스크립트 소유자 메일로 대신 보낸다
    try {
      MailApp.sendEmail(Session.getEffectiveUser().getEmail(), mailSubject || '[시뮬레이터] 알림',
        text + '\n\n※ 카카오톡 발송 실패로 메일로 보냈습니다: ' + String(e).slice(0, 200) + '\n카카오 재연결: 스크립트 편집기에서 showKakaoConnectUrl 실행');
      return '카카오 실패 → 메일 발송';
    } catch (e2) { return '발송 실패: ' + String(e).slice(0, 80); }
  }
}

function sendKakaoMemo_(text) {
  const token = kakaoAccessToken_();
  const link = { web_url: CFG.SITE_URL, mobile_web_url: CFG.SITE_URL };
  const template = { object_type: 'text', text: text.slice(0, 200), link: link, button_title: '시뮬레이터 열기' };
  const res = UrlFetchApp.fetch('https://kapi.kakao.com/v2/api/talk/memo/default/send', {
    method: 'post', headers: { Authorization: 'Bearer ' + token },
    payload: { template_object: JSON.stringify(template) }, muteHttpExceptions: true
  });
  const data = JSON.parse(res.getContentText() || '{}');
  if (res.getResponseCode() !== 200 || data.result_code !== 0) throw new Error('카카오 발송 오류 ' + res.getResponseCode() + ': ' + String(data.msg || res.getContentText()).slice(0, 150));
}

function kakaoRedirectUri_() { return ScriptApp.getService().getUrl(); }

function kakaoTokenRequest_(payload) {
  const P = props_(), key = P.getProperty('KAKAO_REST_API_KEY');
  if (!key) throw new Error('KAKAO_REST_API_KEY가 등록되지 않았습니다.');
  const body = Object.assign({ client_id: key }, payload);
  const secret = P.getProperty('KAKAO_CLIENT_SECRET'); if (secret) body.client_secret = secret;
  const res = UrlFetchApp.fetch('https://kauth.kakao.com/oauth/token', { method: 'post', payload: body, muteHttpExceptions: true });
  const data = JSON.parse(res.getContentText() || '{}');
  if (res.getResponseCode() !== 200 || !data.access_token) throw new Error('카카오 토큰 오류: ' + (data.error_description || data.error || res.getResponseCode()));
  const now = Date.now();
  P.setProperty('KAKAO_ACCESS_TOKEN', data.access_token);
  P.setProperty('KAKAO_ACCESS_EXPIRES', String(now + (Number(data.expires_in) || 3600) * 1000));
  if (data.refresh_token) {   // 갱신 토큰은 만료 1개월 전부터 갱신할 때 새로 내려온다
    P.setProperty('KAKAO_REFRESH_TOKEN', data.refresh_token);
    P.setProperty('KAKAO_REFRESH_EXPIRES', String(now + (Number(data.refresh_token_expires_in) || 5184000) * 1000));
  }
  return data.access_token;
}
function kakaoAccessToken_() {
  const P = props_(), token = P.getProperty('KAKAO_ACCESS_TOKEN'), exp = Number(P.getProperty('KAKAO_ACCESS_EXPIRES') || 0);
  if (token && exp - Date.now() > 5 * 60 * 1000) return token;
  const refresh = P.getProperty('KAKAO_REFRESH_TOKEN');
  if (!refresh) throw new Error('카카오톡이 연결되어 있지 않습니다.');
  return kakaoTokenRequest_({ grant_type: 'refresh_token', refresh_token: refresh });
}
function kakaoCallback_(p) {
  const page = (t, m) => HtmlService.createHtmlOutput('<div style="font-family:sans-serif;max-width:420px;margin:60px auto;padding:24px;border:1px solid #ddd;border-radius:14px"><h2 style="margin-top:0">' + t + '</h2><p style="line-height:1.6;color:#555">' + m + '</p></div>').addMetaTag('viewport', 'width=device-width, initial-scale=1');
  try {
    if (p.error) return page('카카오 연결이 취소되었습니다', String(p.error_description || p.error).replace(/</g, '&lt;'));
    const saved = props_().getProperty('KAKAO_OAUTH_STATE');
    if (!saved || p.state !== saved) return page('잘못된 요청입니다', '편집기에서 showKakaoConnectUrl을 다시 실행해 새 주소로 진행해주세요.');
    props_().deleteProperty('KAKAO_OAUTH_STATE');
    kakaoTokenRequest_({ grant_type: 'authorization_code', redirect_uri: kakaoRedirectUri_(), code: p.code });
    return page('✅ 카카오톡이 연결되었습니다', '이 창을 닫고 편집기에서 testKakao를 실행해 "나와의 채팅"에 메시지가 오는지 확인해주세요.');
  } catch (err) { return page('카카오 연결 실패', String(err).replace(/</g, '&lt;')); }
}

/* ---------------- 편집기에서 직접 실행하는 설정 함수 ---------------- */

/** ① 처음 한 번: 시트 탭 만들기 + 이 시트를 기록 장소로 지정 */
function setup() {
  const b = SpreadsheetApp.getActiveSpreadsheet();
  if (b) props_().setProperty('SHEET_ID', b.getId());
  const us = sheet_(SHEET_USERS, USER_HEAD); sheet_(SHEET_LOG, LOG_HEAD);
  // 예전에 만든 시트에도 '워터마크 제외' 머리글과 체크박스를 넣는다(다시 실행해도 괜찮음)
  us.getRange(1, 1, 1, USER_HEAD.length).setValues([USER_HEAD]).setFontWeight('bold');
  if (us.getLastRow() >= 2) us.getRange(2, NOMARK_COL, us.getLastRow() - 1, 1).insertCheckboxes();   // 이미 있는 사람 행에만
  Logger.log('시트 준비 완료: ' + book_().getUrl());
}

/** ② 관리자 비밀번호 저장: 스크립트 속성에 ADMIN_EMP_ID와 ADMIN_PASSWORD를 넣고 실행 → 비밀번호는 해시로 바뀌고 원문은 지워짐 */
function setupAdminPassword() {
  const P = props_(), pw = P.getProperty('ADMIN_PASSWORD');
  if (!P.getProperty('ADMIN_EMP_ID')) throw new Error('스크립트 속성에 ADMIN_EMP_ID(관리자 사번 8자리)를 먼저 넣어주세요.');
  if (!pw || pw.length < 8) throw new Error('스크립트 속성 ADMIN_PASSWORD에 8자 이상의 비밀번호를 넣어주세요.');
  const salt = Utilities.getUuid();
  P.setProperty('ADMIN_PW_SALT', salt); P.setProperty('ADMIN_PW_HASH', hash_(salt + pw)); P.deleteProperty('ADMIN_PASSWORD');
  Logger.log('관리자 비밀번호를 저장했습니다. (원문은 스크립트 속성에서 지웠습니다)');
}

/** ③ 웹앱 배포 후: 실행 로그의 주소를 카카오 개발자 콘솔의 Redirect URI에 등록 */
function showKakaoRedirectUri() { Logger.log(kakaoRedirectUri_()); }

/** ④ 실행 로그의 주소를 브라우저에서 열어 카카오 동의 → 연결 완료 */
function showKakaoConnectUrl() {
  const key = props_().getProperty('KAKAO_REST_API_KEY');
  if (!key) throw new Error('스크립트 속성에 KAKAO_REST_API_KEY를 먼저 넣어주세요.');
  const state = Utilities.getUuid(); props_().setProperty('KAKAO_OAUTH_STATE', state);
  Logger.log('https://kauth.kakao.com/oauth/authorize?response_type=code&scope=talk_message&client_id=' + encodeURIComponent(key) +
    '&redirect_uri=' + encodeURIComponent(kakaoRedirectUri_()) + '&state=' + encodeURIComponent(state));
}

/** ⑤ 연결 확인: '나와의 채팅'에 테스트 메시지 */
function testKakao() { sendKakaoMemo_('🔐 시뮬레이터 접근 승인\n카카오톡 연결 테스트 메시지입니다.'); Logger.log('보냈습니다.'); }

/** 카카오 갱신 토큰(약 2개월) 만료일 확인 */
function showKakaoStatus() {
  const exp = Number(props_().getProperty('KAKAO_REFRESH_EXPIRES') || 0);
  Logger.log(exp ? '카카오 갱신 토큰 만료: ' + fmt_(new Date(exp)) : '카카오 미연결');
}

/** (선택) 매주 한 번 실행되게 트리거를 걸어 두면, 카카오 연결이 끊기기 2주 전에 메일로 알려줌 */
function weeklyKakaoCheck() {
  const exp = Number(props_().getProperty('KAKAO_REFRESH_EXPIRES') || 0);
  try { kakaoAccessToken_(); } catch (e) {}
  const exp2 = Number(props_().getProperty('KAKAO_REFRESH_EXPIRES') || 0) || exp;
  if (!exp2 || exp2 - Date.now() < 14 * 86400 * 1000)
    MailApp.sendEmail(Session.getEffectiveUser().getEmail(), '[시뮬레이터] 카카오 재연결 필요',
      '카카오 연결이 ' + (exp2 ? fmt_(new Date(exp2)) + '에 만료됩니다.' : '되어 있지 않습니다.') + '\n편집기에서 showKakaoConnectUrl을 실행해 다시 연결해주세요.');
}

/** 모든 통행증 무효화(전원 다시 코드 인증) */
function revokeAllTokens() {
  const P = props_(); let n = 0;
  Object.keys(P.getProperties()).forEach(k => { if (k.indexOf('T_') === 0) { P.deleteProperty(k); n++; } });
  Logger.log('통행증 ' + n + '개를 무효화했습니다.');
}

/* ---------------- 공통 ---------------- */

function props_() { return PropertiesService.getScriptProperties(); }
function clean_(s) { return String(s == null ? '' : s).replace(/[\u0000-\u001f<>]/g, '').trim(); }
function simName_(k) { k = clean_(k); return CFG.SIMS[k] || k.slice(0, 30) || '-'; }
function fmt_(d) { return Utilities.formatDate(d, CFG.TZ, 'yyyy-MM-dd HH:mm:ss'); }
function hash_(s) {
  return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, s, Utilities.Charset.UTF_8)
    .map(b => ('0' + (b & 0xff).toString(16)).slice(-2)).join('');
}
/** 6자리 코드(000000–999999). UUID의 무작위 비트를 써서 만든다 */
function newCode_() {
  const hex = Utilities.getUuid().replace(/-/g, '').slice(0, 12);
  return String(parseInt(hex, 16) % 1000000).padStart(6, '0');
}
