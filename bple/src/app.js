/* ------------------------------------------------------------------
   PRAS / BPLE — 전력수급기본계획 시뮬레이터
   data/plans.js 가 먼저 로드돼 SRC / ENGINE / ACTUAL / PLANS / DSM11 /
   ADD11 전역을 제공한다는 전제로 동작한다.
   차트는 IEA · EMBER · KEPCO Statistics 와 같은 방식의 인라인 SVG다.
   ------------------------------------------------------------------ */
(function () {
'use strict';

/* ===================== 유틸 ===================== */
const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const tok = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const fmt = (v, d = 1) => (v === null || v === undefined || Number.isNaN(v)) ? '—'
  : v.toLocaleString('ko-KR', { minimumFractionDigits: d, maximumFractionDigits: d });
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const sum = o => SRC.reduce((a, s) => a + (o[s.key] || 0), 0);
const HOURS = 8.76;                 /* 1년 8,760h → GW × 8.76 = TWh */
const col = k => tok('--c-' + k);

/* 축 눈금 — 보기 좋은 간격으로 끊는다 */
function ticks(lo, hi, n) {
  if (hi <= lo) hi = lo + 1;
  const raw = (hi - lo) / n, mag = Math.pow(10, Math.floor(Math.log10(raw))), norm = raw / mag;
  const step = (norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 2.5 ? 2.5 : norm <= 5 ? 5 : 10) * mag;
  const t = [], s = Math.ceil(lo / step) * step;
  for (let v = s; v <= hi + step * 1e-9; v += step) t.push(+v.toFixed(10));
  return { ticks: t, lo: Math.min(lo, t[0] ?? lo), hi: Math.max(hi, t[t.length - 1] ?? hi), step };
}
const chartW = el => Math.max(300, Math.round(el.getBoundingClientRect().width) || 600);

/* ===================== 툴팁 ===================== */
let tipEl = null;
function tipShow(html, ev) {
  if (!tipEl) { tipEl = document.createElement('div'); tipEl.className = 'tip'; document.body.appendChild(tipEl); }
  tipEl.innerHTML = html; tipEl.hidden = false;
  const r = tipEl.getBoundingClientRect();
  let x = ev.clientX + 14, y = ev.clientY + 14;
  if (x + r.width > innerWidth - 8) x = ev.clientX - r.width - 14;
  if (y + r.height > innerHeight - 8) y = ev.clientY - r.height - 14;
  tipEl.style.left = Math.max(8, x) + 'px'; tipEl.style.top = Math.max(8, y) + 'px';
}
function tipHide() { if (tipEl) tipEl.hidden = true; }

/* 조작 결과를 눈에 보이게 알린다 — 공용 .toast 규격 */
let toastEl = null, toastT = null;
function toast(msg) {
  if (!toastEl) { toastEl = document.createElement('div'); toastEl.className = 'toast'; toastEl.setAttribute('role', 'status'); document.body.appendChild(toastEl); }
  toastEl.innerHTML = msg; toastEl.hidden = false;
  clearTimeout(toastT); toastT = setTimeout(() => { toastEl.hidden = true; }, 2600);
}
/* 값이 바뀐 입력칸을 잠깐 강조한다 */
function flash(ids) {
  ids.forEach(id => { const el = document.getElementById(id); if (!el) return; el.classList.remove('flash'); void el.offsetWidth; el.classList.add('flash'); });
}
function bindTips(root) {
  root.querySelectorAll('[data-tip]').forEach(el => {
    el.addEventListener('mouseenter', e => tipShow(el.dataset.tip, e));
    el.addEventListener('mousemove', e => tipShow(el.dataset.tip, e));
    el.addEventListener('mouseleave', tipHide);
  });
}
addEventListener('scroll', tipHide, { passive: true });

/* ===================== 상태 ===================== */
const S = {
  planId: 11, basePeak: 0, addSemi: 0, addDc: 0, addElec: 0, dsm: 0,
  reserve: 22, pcRenew: 11.1, cap: {}, cf: {}, pc: {}, nh3: 0, h2: 0,
  estimated: false, trMode: 'all', mxMode: 'cap',
  off: { bal: new Set(), traj: new Set(), mix: new Set() }
};

/* 범례 — 클릭하면 해당 계열을 숨기고 다시 누르면 되살린다 */
function legend(host, ns, items, rerender) {
  host.innerHTML = items.map(it =>
    `<span data-k="${it.k}" class="${S.off[ns].has(it.k) ? 'off' : ''}" role="button" tabindex="0" aria-pressed="${!S.off[ns].has(it.k)}">` +
    `<i class="${it.dash ? 'dash' : ''}" style="${it.dash ? 'border-color:' + it.c : 'background:' + it.c + (it.sq ? ';height:10px;border-radius:3px' : '')}"></i>${esc(it.t)}</span>`).join('');
  host.querySelectorAll('[data-k]').forEach(el => {
    const go = () => { const k = el.dataset.k; S.off[ns].has(k) ? S.off[ns].delete(k) : S.off[ns].add(k); rerender(); };
    el.addEventListener('click', go);
    el.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); } });
  });
}
const plan = () => PLANS.find(p => p.id === S.planId);
const planPC = p => Object.assign({}, ENGINE.peakCredit, p.pc || {});

function loadPlan(id) {
  const p = PLANS.find(x => x.id === id);
  S.planId = id;
  /* 11차만 추가수요를 원문대로 분리 반영, 그 이전 계획은 모형수요에 통합돼 있다 */
  const add = id === 11 ? ADD11 : { semi: 0, dc: 0, elec: 0 };
  const addTot = add.semi + add.dc + add.elec;
  S.dsm = id === 11 ? DSM11 : 0;
  S.basePeak = +(p.peak[p.target] + S.dsm - addTot).toFixed(2);
  S.addSemi = add.semi; S.addDc = add.dc; S.addElec = add.elec;
  S.reserve = p.reserveNum;
  S.pc = planPC(p); S.pcRenew = S.pc.renew;
  S.cap = Object.assign({}, p.cap);
  S.cf = Object.assign({}, ENGINE.cf);
  const bl = p.blend || { nh3: 0, h2: 0 };
  S.nh3 = bl.nh3; S.h2 = bl.h2;

  if (p.gen) {
    /* 공표된 발전량에서 이용률을 역산. 석탄·LNG 는 혼소분을 뺀 순발전량이므로 총량으로 환원한다. */
    S.estimated = false;
    const base = p.genCap || p.cap;
    SRC.forEach(s => {
      const c = base[s.key]; let g = p.gen[s.key] || 0;
      if (s.key === 'coal' && S.nh3 > 0) g = g / (1 - S.nh3 / 100);
      if (s.key === 'lng' && S.h2 > 0) g = g / (1 - S.h2 / 100);
      S.cf[s.key] = (g > 0 && c > 0) ? +clamp((g / (c * HOURS)) * 100, 0, 100).toFixed(2) : 0;
    });
  } else {
    /* 전원별 발전량 미공표(6·7·9차): 목표연도 전력소비량 × 발전단 보정 1.11 을 총발전량으로 잡고
       원전·재생e 는 기준 이용률로 고정한 뒤 나머지 급전가능 전원에 균등 배분한다. */
    S.estimated = true;
    const FIX = ['nuclear', 'renew', 'newe'], DIS = ['coal', 'lng', 'oil', 'hydro', 'other'];
    const want = p.demandVal * 1.11;
    const fixed = FIX.reduce((a, k) => a + (p.cap[k] || 0) * (S.cf[k] / 100) * HOURS, 0);
    const disH = DIS.reduce((a, k) => a + (p.cap[k] || 0) * HOURS, 0);
    const cf = disH > 0 ? clamp(((want - fixed) / disH) * 100, 0, 95) : 0;
    DIS.forEach(k => S.cf[k] = +cf.toFixed(2));
  }
}

/* ===================== 엔진 ===================== */
function compute() {
  const p = plan();
  const addTot = S.addSemi + S.addDc + S.addElec;
  const basePeak = S.basePeak + addTot;                 /* 기준수요 */
  const target = Math.max(0.1, basePeak - S.dsm);       /* 목표수요 */
  const targetCap = target * (1 + S.reserve / 100);     /* 목표설비 */
  const pc = Object.assign({}, S.pc, { renew: S.pcRenew });

  const eff = {}, gen = {};
  SRC.forEach(s => {
    eff[s.key] = (S.cap[s.key] || 0) * (pc[s.key] / 100);
    gen[s.key] = (S.cap[s.key] || 0) * (S.cf[s.key] / 100) * HOURS;
  });
  const effTot = sum(eff);
  const gap = effTot - targetCap;
  const realReserve = (effTot / target - 1) * 100;

  const h2nh3 = gen.coal * (S.nh3 / 100) + gen.lng * (S.h2 / 100);
  const genNet = Object.assign({}, gen);
  genNet.coal = gen.coal * (1 - S.nh3 / 100);
  genNet.lng = gen.lng * (1 - S.h2 / 100);
  const genTot = sum(genNet) + h2nh3;

  const co2 = (genNet.coal * ENGINE.ef.coal + genNet.lng * ENGINE.ef.lng) * ENGINE.efCal;
  const cfree = genNet.nuclear + genNet.renew + h2nh3;
  const cfreeShare = genTot > 0 ? (cfree / genTot) * 100 : 0;
  const renewShare = genTot > 0 ? ((genNet.renew + genNet.newe) / genTot) * 100 : 0;
  const intensity = genTot > 0 ? co2 / genTot : 0;      /* 백만톤 / TWh = tCO2/MWh */

  return { p, basePeak, target, targetCap, eff, effTot, gap, realReserve,
           gen, genNet, h2nh3, genTot, co2, cfreeShare, renewShare, intensity, pc };
}

/* ===================== 입력 UI ===================== */
function buildSelect() {
  $('#planSel').innerHTML = [...PLANS].reverse().map(p =>
    `<option value="${p.id}">${p.name} (${p.year} · ${p.period[0]}~${p.period[1]})</option>`).join('');
}
function buildCapRows() {
  $('#capGrid').innerHTML = SRC.map(s => `
    <div class="field">
      <label for="capn_${s.key}"><span><i class="swatch" style="background:${'var(--c-' + s.key + ')'}"></i>${s.short}</span></label>
      <input type="number" id="capn_${s.key}" step="0.1" min="0" aria-label="${s.label} 정격용량 (GW)">
    </div>`).join('');
  $('#cfGrid').innerHTML = SRC.map(s => `
    <div class="field">
      <label for="cfn_${s.key}"><span><i class="swatch" style="background:${'var(--c-' + s.key + ')'}"></i>${s.short}</span></label>
      <input type="number" id="cfn_${s.key}" step="0.1" min="0" max="100" aria-label="${s.label} 이용률 (%)">
    </div>`).join('');
  $('#blendGrid').innerHTML = `
    <div class="field">
      <label for="bNh3N"><span><i class="swatch" style="background:var(--c-h2)"></i>석탄 암모니아 혼소</span><span class="hint">발전량이 청정수소·암모니아로 이전</span></label>
      <input type="number" id="bNh3N" step="1" min="0" max="100" aria-label="석탄 암모니아 혼소율 (%)">
    </div>
    <div class="field">
      <label for="bH2N"><span><i class="swatch" style="background:var(--c-h2)"></i>LNG 수소 혼소</span><span class="hint">발전량이 청정수소·암모니아로 이전</span></label>
      <input type="number" id="bH2N" step="1" min="0" max="100" aria-label="LNG 수소 혼소율 (%)">
    </div>`;
}

const PAIRS = [['basePeak', 'basePeak'], ['addSemi', 'addSemi'], ['addDc', 'addDc'],
               ['addElec', 'addElec'], ['dsm', 'dsm'], ['reserve', 'reserve'], ['pcRenew', 'pcRenew']];

function syncInputs() {
  const p = plan();
  $('#planSel').value = S.planId;
  PAIRS.forEach(([id, key]) => {
    const r = $('#' + id), n = $('#' + id + 'N');
    if (r && +r.max < S[key]) r.max = Math.ceil(S[key] * 1.3);
    if (r) r.value = S[key];
    n.value = S[key];
  });
  SRC.forEach(s => { $('#capn_' + s.key).value = +(S.cap[s.key] || 0).toFixed(1); $('#cfn_' + s.key).value = +(S.cf[s.key] || 0).toFixed(1); });
  $('#bNh3N').value = S.nh3; $('#bH2N').value = S.h2;

  $('#planHint').textContent = `${p.period[0]}~${p.period[1]} · 목표연도 ${p.target}년 · ${p.scope}`;
  $('#planMeta').innerHTML = [
    ['계획기간', `${p.period[0]} – ${p.period[1]}`],
    ['목표연도', `${p.target}년`],
    ['기준 설비예비율', p.reserve],
    ['산정 기준', p.basis],
    [`${p.demandLabel} (${p.demandYear})`, `${fmt(p.demandVal, 1)} TWh`],
    ['최대전력 연평균', `${fmt(p.peakCagr, 1)} %`]
  ].map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join('');
  $('#planNote').textContent = p.note;
}

/* ===================== KPI ===================== */
function renderKPI(r) {
  const p = r.p;
  const est = S.estimated ? ' <span class="pill sub">모형 추정</span>' : '';
  const resPill = r.realReserve >= S.reserve ? '<span class="pill ok">기준 충족</span>'
    : r.realReserve >= S.reserve - 3 ? '<span class="pill sub">기준 근접</span>'
    : '<span class="pill na">기준 미달</span>';
  const tile = (cls, k, v, u, n) =>
    `<div class="kpi ${cls}"><div class="k">${k}</div><div class="v">${v}<small>${u}</small></div><div class="n">${n}</div></div>`;

  $('#kpiA').innerHTML = [
    tile('lead', `목표수요 · ${p.target}년 최대전력`, fmt(r.target, 1), 'GW',
      `기준수요 ${fmt(r.basePeak, 1)} − 수요관리 ${fmt(S.dsm, 1)}`),
    tile('lead', `목표설비 용량`, fmt(r.targetCap, 1), 'GW',
      `${fmt(r.target, 1)} × (1 + ${fmt(S.reserve, 1)}%)`),
    tile('', '공급 실효용량', fmt(r.effTot, 1), 'GW',
      `정격 ${fmt(sum(S.cap), 1)}GW 중 피크기여 반영분`),
    tile(r.gap >= 0 ? 'pos' : 'neg', r.gap >= 0 ? '설비 여유' : '신규 필요설비',
      (r.gap >= 0 ? '+' : '−') + fmt(Math.abs(r.gap), 1), 'GW',
      r.gap >= 0 ? '목표설비 대비 초과 확보' : '목표설비 대비 부족분')
  ].join('');

  $('#kpiB').innerHTML = [
    tile('', '실현 설비예비율', fmt(r.realReserve, 1), '%', resPill),
    tile('', '총 발전량', fmt(r.genTot, 0), 'TWh', `신재생 발전비중 ${fmt(r.renewShare, 1)}%${est}`),
    tile('', '무탄소 발전비중', fmt(r.cfreeShare, 1), '%', '원전 + 재생e + 청정수소·암모니아'),
    tile('', '전환부문 온실가스', fmt(r.co2, 1), '백만톤', `배출원단위 ${fmt(r.intensity, 3)} tCO₂/MWh${est}`)
  ].join('');

  $('#kpiDesc').textContent =
    `${p.name} ${p.target}년 기준 · ${p.basis}`;
  bindTips($('#s-kpi'));
}

/* ===================== 03 수급 균형 (SVG) ===================== */
function renderBalance(r) {
  const p = r.p, host = $('#balChart');
  const years = Object.keys(p.peak).map(Number).sort((a, b) => a - b);
  const W = chartW(host), H = Math.round(clamp(W * 0.42, 260, 400));
  const m = { l: 46, r: 46, t: 12, b: 30 };
  const peaks = years.map(y => p.peak[y]);
  const tcaps = years.map(y => p.peak[y] * (1 + S.reserve / 100));
  const A = ticks(0, Math.max(...tcaps) * 1.06, 5);
  const resVals = years.map(y => p.reserveSeries ? p.reserveSeries[y] : null).filter(v => v != null);
  const B = ticks(0, resVals.length ? Math.max(...resVals) * 1.25 : 40, 4);

  const iw = W - m.l - m.r, ih = H - m.t - m.b;
  const xb = i => m.l + (i + 0.5) * (iw / years.length);
  const ya = v => m.t + (1 - (v - A.lo) / (A.hi - A.lo)) * ih;
  const yb = v => m.t + (1 - (v - B.lo) / (B.hi - B.lo)) * ih;
  const bw = Math.max(4, (iw / years.length) * 0.56);
  const skip = W < 560 ? 3 : W < 820 ? 2 : 1;

  let s = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="연도별 설비 수급 균형"><g class="axis">`;
  A.ticks.forEach(t => {
    s += `<line x1="${m.l}" x2="${W - m.r}" y1="${ya(t).toFixed(1)}" y2="${ya(t).toFixed(1)}" stroke="${tok('--line')}"/>` +
         `<text x="${m.l - 7}" y="${(ya(t) + 4).toFixed(1)}" text-anchor="end">${t}</text>`;
  });
  B.ticks.forEach(t => {
    s += `<text x="${W - m.r + 7}" y="${(yb(t) + 4).toFixed(1)}" text-anchor="start">${t}%</text>`;
  });
  years.forEach((y, i) => { if (i % skip === 0) s += `<text x="${xb(i).toFixed(1)}" y="${H - 9}" text-anchor="middle">'${String(y).slice(2)}</text>`; });
  s += `</g>`;

  if (!S.off.bal.has('peak')) years.forEach((y, i) => {
    const h = Math.max(0, ya(A.lo) - ya(peaks[i]));
    s += `<rect x="${(xb(i) - bw / 2).toFixed(1)}" y="${ya(peaks[i]).toFixed(1)}" width="${bw.toFixed(1)}" height="${h.toFixed(1)}" rx="2" fill="${col('lng')}"
      data-tip="&lt;div class='t'&gt;${y}년&lt;/div&gt;&lt;div class='r'&gt;&lt;span&gt;목표수요&lt;/span&gt;&lt;b&gt;${fmt(peaks[i], 1)} GW&lt;/b&gt;&lt;/div&gt;&lt;div class='r'&gt;&lt;span&gt;목표설비&lt;/span&gt;&lt;b&gt;${fmt(tcaps[i], 1)} GW&lt;/b&gt;&lt;/div&gt;"/>`;
  });
  if (!S.off.bal.has('cap'))
    s += `<path d="${years.map((y, i) => (i ? 'L' : 'M') + xb(i).toFixed(1) + ',' + ya(tcaps[i]).toFixed(1)).join('')}" fill="none" stroke="${tok('--navy')}" stroke-width="2.2"/>`;
  if (resVals.length && !S.off.bal.has('res')) {
    let d = '', pen = false;
    years.forEach((y, i) => {
      const v = p.reserveSeries ? p.reserveSeries[y] : null;
      if (v == null) { pen = false; return; }
      d += (pen ? 'L' : 'M') + xb(i).toFixed(1) + ',' + yb(v).toFixed(1); pen = true;
    });
    s += `<path d="${d}" fill="none" stroke="${tok('--blue')}" stroke-width="1.8" stroke-dasharray="5 4"/>`;
  }
  s += `</svg>`;
  host.innerHTML = s;
  bindTips(host);

  $('#balDesc').textContent = `${p.name} ${p.period[0]}~${p.period[1]} · ${p.basis}`;
  legend($('#balLegend'), 'bal', [
    { k: 'peak', t: '목표수요 (최대전력)', c: col('lng'), sq: true },
    { k: 'cap', t: `목표설비 — 예비율 ${fmt(S.reserve, 1)}% 적용`, c: tok('--navy') },
    { k: 'res', t: '계획 원문 설비예비율 (우측 축)', c: tok('--blue'), dash: true }
  ], () => renderBalance(compute()));
}

/* ===================== 04 전망 궤적 (SVG) ===================== */
function renderTraj() {
  const host = $('#trajChart');
  const ids = S.trMode === 'recent' ? [8, 9, 10, 11] : PLANS.map(p => p.id);
  const W = chartW(host), H = Math.round(clamp(W * 0.62, 280, 430));
  const m = { l: 40, r: 12, t: 12, b: 28 };
  const y0 = 2001, y1 = 2038;
  const all = [];
  ids.forEach(id => { const p = PLANS.find(x => x.id === id); Object.values(p.peak).forEach(v => all.push(v)); });
  ACTUAL.peak.forEach(([y, v]) => { if (y >= y0) all.push(v); });
  const A = ticks(Math.min(...all) * 0.92, Math.max(...all) * 1.04, 5);
  const iw = W - m.l - m.r, ih = H - m.t - m.b;
  const X = y => m.l + ((y - y0) / (y1 - y0)) * iw;
  const Y = v => m.t + (1 - (v - A.lo) / (A.hi - A.lo)) * ih;

  let s = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="역대 계획 최대전력 전망 궤적"><g class="axis">`;
  A.ticks.forEach(t => s += `<line x1="${m.l}" x2="${W - m.r}" y1="${Y(t).toFixed(1)}" y2="${Y(t).toFixed(1)}" stroke="${tok('--line')}"/>` +
    `<text x="${m.l - 7}" y="${(Y(t) + 4).toFixed(1)}" text-anchor="end">${t}</text>`);
  const xs = W < 480 ? 8 : W < 700 ? 6 : 4;
  for (let y = y0 + 1; y <= y1; y += xs) s += `<text x="${X(y).toFixed(1)}" y="${H - 8}" text-anchor="middle">'${String(y).slice(2)}</text>`;
  s += `</g>`;

  /* 선택하지 않은 계획은 옅은 그래파이트, 선택한 계획만 틸로 강조 */
  ids.forEach(id => {
    const p = PLANS.find(x => x.id === id), cur = id === S.planId;
    if (S.off.traj.has(cur ? 'cur' : 'rest')) return;
    const ys = Object.keys(p.peak).map(Number).sort((a, b) => a - b);
    const d = ys.map((y, i) => (i ? 'L' : 'M') + X(y).toFixed(1) + ',' + Y(p.peak[y]).toFixed(1)).join('');
    s += `<path d="${d}" fill="none" stroke="${cur ? tok('--blue') : '#c3c6cb'}" stroke-width="${cur ? 2.6 : 1.3}"/>`;
    const ly = ys[ys.length - 1];
    s += `<text x="${(X(ly) + 4).toFixed(1)}" y="${(Y(p.peak[ly]) + 3).toFixed(1)}" font-size="10" font-weight="${cur ? 800 : 600}" fill="${cur ? tok('--blue') : '#9398a2'}">${p.id}</text>`;
  });
  if (!S.off.traj.has('act')) ACTUAL.peak.forEach(([y, v]) => {
    if (y < y0) return;
    s += `<circle cx="${X(y).toFixed(1)}" cy="${Y(v).toFixed(1)}" r="3.1" fill="${col('act')}"
      data-tip="&lt;div class='t'&gt;${y}년 실적&lt;/div&gt;&lt;div class='r'&gt;&lt;span&gt;최대전력&lt;/span&gt;&lt;b&gt;${fmt(v, 1)} GW&lt;/b&gt;&lt;/div&gt;"/>`;
  });
  s += `</svg>`;
  host.innerHTML = s; bindTips(host);

  legend($('#trajLegend'), 'traj', [
    { k: 'cur', t: `선택한 ${plan().name}`, c: tok('--blue') },
    { k: 'rest', t: '나머지 계획 (선 끝 숫자 = 차수)', c: '#c3c6cb' },
    { k: 'act', t: '실적', c: col('act'), sq: true }
  ], renderTraj);
  $('#trajNote').textContent =
    '각 계획 본문에 \'실적\'으로 명시된 최대전력만 점으로 찍었습니다. 8·9차는 동계, 나머지는 각 계획의 헤드라인 기준을 그대로 썼습니다. 범례를 누르면 해당 계열을 숨길 수 있습니다.';
}

/* ===================== 04-b 계획 대비 실적 ===================== */
function renderErr() {
  const rows = [];
  [...PLANS].reverse().forEach(p => {
    const ser = p.peakSummer || p.peak;
    let best = null;
    ACTUAL.peak.forEach(([y, a]) => { if (ser[y] !== undefined && y >= p.period[0] + 3) best = { y, a, fc: ser[y] }; });
    if (!best) return;
    const mk = ACTUAL.market.find(x => x[0] === best.y);
    const act = (p.id <= 9 && mk) ? mk[1] : best.a;
    rows.push({ id: p.id, name: p.name, year: best.y, fc: best.fc, act,
      basis: (p.id <= 9 && mk) ? '전력시장' : (p.id >= 10 ? '전력계통' : '당시 공표'),
      err: ((best.fc - act) / act) * 100 });
  });
  const mx = Math.max(...rows.map(r => Math.abs(r.err))) * 1.1;
  $('#errRank').innerHTML = rows.map(r => {
    const w = (Math.abs(r.err) / mx) * 50;
    const left = r.err >= 0 ? 50 : 50 - w;
    return `<div class="rrow fc${r.id === S.planId ? ' cur' : ''}" data-id="${r.id}" role="button" tabindex="0"
      data-tip="&lt;div class='t'&gt;${r.name} · ${r.year}년&lt;/div&gt;&lt;div class='r'&gt;&lt;span&gt;전망&lt;/span&gt;&lt;b&gt;${fmt(r.fc, 1)} GW&lt;/b&gt;&lt;/div&gt;&lt;div class='r'&gt;&lt;span&gt;실적 (${r.basis})&lt;/span&gt;&lt;b&gt;${fmt(r.act, 1)} GW&lt;/b&gt;&lt;/div&gt;">
      <span class="nm">${r.name} <small class="cur">'${String(r.year).slice(2)}</small></span>
      <span class="track"><span class="zero"></span><span class="fill${r.err > 0 ? ' over' : ''}" style="left:${left}%;width:${w}%"></span></span>
      <span class="val">${r.err > 0 ? '+' : '−'}${fmt(Math.abs(r.err), 1)}%</span>
    </div>`;
  }).join('');
  $('#errRank').querySelectorAll('.rrow').forEach(el => {
    const go = () => { loadPlan(+el.dataset.id); syncInputs(); renderAll(); };
    el.addEventListener('click', go);
    el.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); } });
  });
  bindTips($('#errRank'));
  const over = rows.filter(r => r.err > 0).length;
  $('#errNote').innerHTML = `비교 가능한 ${rows.length}개 계획 중 <b>${over}개가 과대전망</b>, <b>${rows.length - over}개가 과소전망</b>이었습니다. ` +
    `가운데 선이 오차 0이고, 계절 기준을 맞추려 하계 계열이 따로 있는 8·9차는 하계 전망을 썼습니다. ` +
    `전력시장 기준으로 전망한 1~9차는 같은 기준 실적('23년 93.6GW)과, 전력계통 기준인 10·11차는 전력계통 실적과 비교합니다.`;
}

/* ===================== 05 전원구성 ===================== */
function mixBar(label, sub, obj, extra, unit, cur, na) {
  if (na) return `<div class="brow mx"><span class="nm">${esc(label)}<span class="sub">${esc(sub)}</span></span><span class="na">${esc(na)}</span><span></span></div>`;
  const vis = SRC.filter(s => !S.off.mix.has(s.key));
  const exV = S.off.mix.has('h2') ? 0 : (extra || 0);
  const tot = vis.reduce((t, s) => t + (obj[s.key] || 0), 0) + exV;
  if (!tot) return '';
  let segs = vis.map(s => {
    const v = obj[s.key] || 0; if (v <= 0) return '';
    const pct = (v / tot) * 100;
    return `<span style="flex:${v};background:${'var(--c-' + s.key + ')'}" data-tip="&lt;div class='t'&gt;${esc(label)} · ${s.label}&lt;/div&gt;&lt;div class='r'&gt;&lt;span&gt;용량&lt;/span&gt;&lt;b&gt;${fmt(v, 1)} ${unit}&lt;/b&gt;&lt;/div&gt;&lt;div class='r'&gt;&lt;span&gt;비중&lt;/span&gt;&lt;b&gt;${fmt(pct, 1)}%&lt;/b&gt;&lt;/div&gt;"></span>`;
  }).join('');
  if (exV > 0) segs += `<span style="flex:${exV};background:var(--c-h2)" data-tip="&lt;div class='t'&gt;${esc(label)} · 청정수소·암모니아&lt;/div&gt;&lt;div class='r'&gt;&lt;span&gt;발전량&lt;/span&gt;&lt;b&gt;${fmt(exV, 1)} ${unit}&lt;/b&gt;&lt;/div&gt;&lt;div class='r'&gt;&lt;span&gt;비중&lt;/span&gt;&lt;b&gt;${fmt((exV / tot) * 100, 1)}%&lt;/b&gt;&lt;/div&gt;"></span>`;
  return `<div class="brow mx${cur ? ' cur' : ''}"><span class="nm">${esc(label)}<span class="sub">${esc(sub)}</span></span>` +
         `<span class="track"><span class="mxbar">${segs}</span></span>` +
         `<span class="amt">${fmt(tot, 1)} <small class="cur">${unit}</small></span></div>`;
}

function renderMix(r) {
  const mode = S.mxMode, unit = mode === 'gen' ? 'TWh' : 'GW';
  let html = mixBar('시나리오', `${plan().target}년 · 조정 전제`,
    mode === 'cap' ? S.cap : mode === 'eff' ? r.eff : r.genNet,
    mode === 'gen' ? r.h2nh3 : 0, unit, true);
  [...PLANS].reverse().forEach(p => {
    if (mode === 'gen') {
      html += p.gen ? mixBar(p.name, `${p.genYear}년 원안`, p.gen, p.genH2 || 0, unit, false)
                    : mixBar(p.name, `${p.genYear}년 원안`, {}, 0, unit, false, '전원별 발전량 미공표');
    } else if (mode === 'eff') {
      const q = planPC(p), e = {};
      SRC.forEach(s => e[s.key] = (p.cap[s.key] || 0) * (q[s.key] / 100));
      html += mixBar(p.name, `${p.capYear}년 원안`, e, 0, unit, false);
    } else {
      html += mixBar(p.name, `${p.capYear}년 원안`, p.cap, 0, unit, false);
    }
  });
  $('#mixWrap').innerHTML = html; bindTips($('#mixWrap'));
  const li = SRC.map(s => ({ k: s.key, t: s.label, c: 'var(--c-' + s.key + ')', sq: true }));
  if (mode === 'gen') li.push({ k: 'h2', t: '청정수소·암모니아', c: 'var(--c-h2)', sq: true });
  legend($('#mixLegend'), 'mix', li, () => { const q = compute(); renderMix(q); renderGen(q); });
  $('#mixDesc').textContent = '시나리오를 맨 위에 두고 최근 차수부터 거슬러 올라가며 목표연도 원안을 같은 축으로 비교합니다. 범례를 누르면 해당 전원을 빼고 다시 계산합니다.';
  $('#mixNote').textContent = (mode === 'cap'
    ? '각 계획의 목표연도 정격용량(연말 기준)입니다.'
    : mode === 'eff'
      ? '각 계획이 자기 본문에서 쓴 실효/정격 비율을 적용한 실효용량입니다. 1~5차는 정격 기준 표를 그대로 씁니다.'
      : '각 계획의 목표연도 전원별 발전량입니다. 8차는 발전량 비중에 신재생 125.8TWh(20.0%)를 적용해 총 629TWh로 환산했습니다.')
    + ' 막대 길이는 구성비이고, 오른쪽 숫자가 합계입니다.';
}

/* ===================== 06 발전량·배출 ===================== */
function renderGen(r) {
  const p = plan();
  let html = mixBar('시나리오', `${p.target}년 · 조정 전제`, r.genNet, r.h2nh3, 'TWh', true);
  if (p.gen) html += mixBar(`${p.name} 원안`, `${p.genYear}년`, p.gen, p.genH2 || 0, 'TWh', false);

  /* 탄소 / 무탄소 분해 — 11차가 발전량 표에서 함께 공표하는 구분이다 */
  const carbon = r.genNet.coal + r.genNet.lng + r.genNet.oil;
  const free = r.genNet.nuclear + r.genNet.renew + r.h2nh3;
  const etc = Math.max(0, r.genTot - carbon - free);
  const cTot = carbon + free + etc;
  const seg = (v, c, lab) => v <= 0 ? '' :
    `<span style="flex:${v};background:${c}" data-tip="&lt;div class='t'&gt;${lab}&lt;/div&gt;&lt;div class='r'&gt;&lt;span&gt;발전량&lt;/span&gt;&lt;b&gt;${fmt(v, 1)} TWh&lt;/b&gt;&lt;/div&gt;&lt;div class='r'&gt;&lt;span&gt;비중&lt;/span&gt;&lt;b&gt;${fmt((v / cTot) * 100, 1)}%&lt;/b&gt;&lt;/div&gt;"></span>`;
  html += `<div class="brow mx" style="margin-top:6px">
      <span class="nm">탄소 · 무탄소<span class="sub">${p.target}년 시나리오</span></span>
      <span class="track"><span class="mxbar">${seg(free, 'var(--c-nuclear)', '무탄소 발전')}${seg(etc, 'var(--c-other)', '기타')}${seg(carbon, 'var(--c-coal)', '탄소 발전')}</span></span>
      <span class="amt">${fmt(r.cfreeShare, 1)} <small class="cur">% 무탄소</small></span></div>`;

  $('#genWrap').innerHTML = html; bindTips($('#genWrap'));
  $('#genSummary').innerHTML = [
    ['무탄소 발전', `${fmt(free, 1)} TWh`, `${fmt(r.cfreeShare, 1)}%`],
    ['탄소 발전', `${fmt(carbon, 1)} TWh`, `${fmt(cTot ? (carbon / cTot) * 100 : 0, 1)}%`],
    ['배출원단위', `${fmt(r.intensity, 3)} tCO₂/MWh`, `${fmt(r.co2, 1)}백만톤`]
  ].map(([k, v, s]) => `<div><dt>${k}</dt><dd>${v}<span>${s}</span></dd></div>`).join('');
  const gl = SRC.filter(s => (r.genNet[s.key] || 0) > 0.05).map(s => ({ k: s.key, t: s.label, c: 'var(--c-' + s.key + ')', sq: true }));
  if (r.h2nh3 > 0.05) gl.push({ k: 'h2', t: '청정수소·암모니아', c: 'var(--c-h2)', sq: true });
  legend($('#genLegend'), 'mix', gl, () => { const q = compute(); renderMix(q); renderGen(q); });
  $('#emisDesc').innerHTML = S.estimated
    ? `${p.name}은 전원별 발전량을 공표하지 않아, 목표연도 ${p.demandLabel} ${fmt(p.demandVal, 1)}TWh에 발전단 보정 1.11을 적용해 역산한 <b>모형 추정</b>입니다.`
    : `시나리오 ${fmt(r.genTot, 0)}TWh · 무탄소 ${fmt(r.cfreeShare, 1)}% · 배출 ${fmt(r.co2, 1)}백만톤`;
}

function renderCo2(r) {
  const host = $('#co2Chart');
  const W = chartW(host), H = Math.round(clamp(W * 0.6, 220, 300));
  const m = { l: 40, r: 10, t: 12, b: 28 };
  const yrs = []; for (let y = 2030; y <= 2038; y++) yrs.push(y);
  const path = y => 145.9 - (145.9 - 83.1) * ((y - 2030) / 8);
  const ty = clamp(plan().target, 2030, 2038);
  const tgt = path(ty);
  const A = ticks(0, Math.max(160, r.co2 * 1.12), 4);
  const iw = W - m.l - m.r, ih = H - m.t - m.b;
  const X = y => m.l + ((y - 2030) / 8) * iw;
  const Y = v => m.t + (1 - (v - A.lo) / (A.hi - A.lo)) * ih;

  let s = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="전환부문 온실가스 감축경로 대비"><g class="axis">`;
  A.ticks.forEach(t => s += `<line x1="${m.l}" x2="${W - m.r}" y1="${Y(t).toFixed(1)}" y2="${Y(t).toFixed(1)}" stroke="${tok('--line')}"/>` +
    `<text x="${m.l - 7}" y="${(Y(t) + 4).toFixed(1)}" text-anchor="end">${t}</text>`);
  for (let y = 2030; y <= 2038; y += (W < 420 ? 4 : 2)) s += `<text x="${X(y).toFixed(1)}" y="${H - 8}" text-anchor="middle">'${String(y).slice(2)}</text>`;
  s += `</g>`;
  s += `<path d="${yrs.map((y, i) => (i ? 'L' : 'M') + X(y).toFixed(1) + ',' + Y(path(y)).toFixed(1)).join('')}" fill="none" stroke="${tok('--navy')}" stroke-width="2.2"/>`;
  const bw = Math.min(30, iw / 12);
  const ok = r.co2 <= tgt * 1.005;
  s += `<rect x="${(X(ty) - bw / 2).toFixed(1)}" y="${Y(r.co2).toFixed(1)}" width="${bw.toFixed(1)}" height="${Math.max(0, Y(A.lo) - Y(r.co2)).toFixed(1)}" rx="2" fill="${ok ? tok('--down') : tok('--up')}"
    data-tip="&lt;div class='t'&gt;시나리오 ${ty}년&lt;/div&gt;&lt;div class='r'&gt;&lt;span&gt;배출량&lt;/span&gt;&lt;b&gt;${fmt(r.co2, 1)} 백만톤&lt;/b&gt;&lt;/div&gt;&lt;div class='r'&gt;&lt;span&gt;감축경로&lt;/span&gt;&lt;b&gt;${fmt(tgt, 1)} 백만톤&lt;/b&gt;&lt;/div&gt;"/>`;
  s += `</svg>`;
  host.innerHTML = s; bindTips(host);

  const d = r.co2 - tgt;
  $('#co2Note').innerHTML = plan().target < 2030
    ? `${plan().name}의 목표연도 ${plan().target}년은 11차 감축경로(2030~2038) 이전이라, 막대를 2030년 칸에 참고로 놓았습니다. 시나리오 배출량은 <b>${fmt(r.co2, 1)}</b>백만톤입니다.`
    : `${ty}년 감축경로 <b>${fmt(tgt, 1)}</b>백만톤 대비 ` +
      (Math.abs(d) < 0.05 ? '<b>사실상 부합</b>합니다' : `<b>${d > 0 ? '+' : '−'}${fmt(Math.abs(d), 1)}</b>백만톤 ${d > 0 ? '초과' : '여유'}`) +
      `. 실선은 11차가 제시한 '30년 145.9 → '38년 83.1백만톤 선형 감축경로입니다.`;
}

/* ===================== 07 표 ===================== */
function renderDetail(r) {
  const head = ['전원', '정격용량 (GW)', '피크기여도 (%)', '실효용량 (GW)', '이용률 (%)', '발전량 (TWh)', '발전비중 (%)', '배출량 (백만톤)'];
  const rows = SRC.map(s => {
    const g = r.genNet[s.key];
    const em = s.key === 'coal' ? g * ENGINE.ef.coal * ENGINE.efCal : s.key === 'lng' ? g * ENGINE.ef.lng * ENGINE.efCal : 0;
    return `<tr><td><i class="swatch" style="background:${'var(--c-' + s.key + ')'}"></i>${s.label}</td>` +
      [fmt(S.cap[s.key] || 0, 1), fmt(r.pc[s.key], 1), fmt(r.eff[s.key], 1), fmt(S.cf[s.key], 1),
       fmt(g, 1), fmt(r.genTot ? (g / r.genTot) * 100 : 0, 1), em > 0 ? fmt(em, 1) : '—']
        .map(v => `<td>${v}</td>`).join('') + '</tr>';
  });
  if (r.h2nh3 > 0.05) rows.push(`<tr><td><i class="swatch" style="background:var(--c-h2)"></i>청정수소·암모니아</td>` +
    ['—', '—', '—', '—', fmt(r.h2nh3, 1), fmt((r.h2nh3 / r.genTot) * 100, 1), '0.0'].map(v => `<td>${v}</td>`).join('') + '</tr>');
  rows.push(`<tr class="sum"><td>합계</td>` +
    [fmt(sum(S.cap), 1), '—', fmt(r.effTot, 1), '—', fmt(r.genTot, 1), '100.0', fmt(r.co2, 1)].map(v => `<td>${v}</td>`).join('') + '</tr>');
  $('#detailTable').innerHTML = `<thead><tr>${head.map(h => `<th>${h}</th>`).join('')}</tr></thead><tbody>${rows.join('')}</tbody>`;
  $('#detailNote').innerHTML = `혼소분은 석탄·LNG 발전량에서 빼 청정수소·암모니아로 옮깁니다. 배출량에는 전환부문 보정계수 <b>${ENGINE.efCal}</b>를 적용했습니다.` +
    (plan().gen && !plan().gen.hydro ? ` ${plan().name}은 양수 발전량을 '기타'에 합산해 공표하므로 수력·양수 행의 발전량이 0으로 표시됩니다.` : '');
}

function renderPlanTable() {
  const head = ['차수', '공고', '계획기간', '목표', '최대전력<br>(GW)', '연평균<br>(%)', '소비량<br>(TWh)', '기준 설비예비율', '설비<br>(GW)', '원전<br>(%)', '재생e<br>(%)'];
  const body = [...PLANS].reverse().map(p => {
    const tot = sum(p.cap), ren = ((p.cap.renew + p.cap.newe) / tot) * 100;
    return `<tr data-id="${p.id}"${p.id === S.planId ? ' class="cur"' : ''} role="button" tabindex="0">` +
      [p.name, p.year, `${p.period[0]}–${p.period[1]}`, p.target, fmt(p.peak[p.target], 1), fmt(p.peakCagr, 1),
       fmt(p.demandVal, 1), p.reserve, fmt(tot, 1), fmt((p.cap.nuclear / tot) * 100, 1), fmt(ren, 1)]
        .map(v => `<td>${v}</td>`).join('') + '</tr>';
  });
  $('#planTable').innerHTML = `<thead><tr>${head.map(h => `<th>${h}</th>`).join('')}</tr></thead><tbody>${body.join('')}</tbody>`;
  $('#planTable').querySelectorAll('tbody tr').forEach(tr => {
    const go = () => { loadPlan(+tr.dataset.id); syncInputs(); renderAll(); };
    tr.style.cursor = 'pointer';
    tr.addEventListener('click', go);
    tr.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); } });
  });
}

/* ===================== 렌더 ===================== */
function renderAll() {
  const r = compute();
  renderKPI(r); renderBalance(r); renderTraj(); renderErr();
  renderMix(r); renderGen(r); renderCo2(r); renderDetail(r); renderPlanTable();
}

/* ===================== 이벤트 ===================== */
function bind() {
  $('#planSel').addEventListener('change', e => { loadPlan(+e.target.value); syncInputs(); renderAll(); });

  PAIRS.forEach(([id, key]) => {
    const r = $('#' + id), n = $('#' + id + 'N');
    const set = v => {
      v = Number(v); if (Number.isNaN(v)) return;
      v = Math.max(0, v); S[key] = +v.toFixed(2);
      if (r) { if (+r.max < v) r.max = Math.ceil(v * 1.2); r.value = S[key]; }
      n.value = S[key]; renderAll();
    };
    if (r) r.addEventListener('input', () => set(r.value));
    n.addEventListener('input', () => set(n.value));
  });

  SRC.forEach(s => {
    $('#capn_' + s.key).addEventListener('input', e => {
      S.cap[s.key] = +Math.max(0, Number(e.target.value) || 0).toFixed(1); renderAll();
    });
    $('#cfn_' + s.key).addEventListener('input', e => {
      S.cf[s.key] = +clamp(Number(e.target.value) || 0, 0, 100).toFixed(2); renderAll();
    });
  });
  $('#bNh3N').addEventListener('input', e => { S.nh3 = clamp(Number(e.target.value) || 0, 0, 100); renderAll(); });
  $('#bH2N').addEventListener('input', e => { S.h2 = clamp(Number(e.target.value) || 0, 0, 100); renderAll(); });

  $('#btnReset').addEventListener('click', () => {
    loadPlan(S.planId); syncInputs(); renderAll();
    flash(['basePeakN', 'dsmN', 'reserveN', ...SRC.map(s => 'capn_' + s.key), ...SRC.map(s => 'cfn_' + s.key)]);
    toast(`${plan().name} 원안으로 되돌렸습니다`);
  });
  $('#btnFit').addEventListener('click', () => {
    const r = compute();
    if (r.effTot <= 0) return;
    if (Math.abs(r.gap) < 0.05) { toast(`이미 목표설비 ${fmt(r.targetCap, 1)}GW를 충족하고 있습니다`); return; }
    const before = sum(S.cap), k = r.targetCap / r.effTot, changed = [];
    SRC.forEach(s => {
      const v = +((S.cap[s.key] || 0) * k).toFixed(1);
      if (v !== S.cap[s.key]) changed.push('capn_' + s.key);
      S.cap[s.key] = v;
    });
    syncInputs(); renderAll(); flash(changed);
    const after = sum(S.cap);
    toast(`전원구성을 비례 ${after >= before ? '확대' : '축소'}해 목표설비 ${fmt(r.targetCap, 1)}GW에 맞췄습니다` +
          `<b> 정격 ${fmt(before, 1)} → ${fmt(after, 1)}GW</b>`);
  });

  $('#btnCopy').addEventListener('click', async () => {
    const t = $('#detailTable'), b = $('#btnCopy');
    const txt = [...t.querySelectorAll('tr')].map(tr => [...tr.children].map(td => td.textContent.trim()).join('\t')).join('\n');
    try { await navigator.clipboard.writeText(txt); b.textContent = '복사됨'; }
    catch { const sel = getSelection(), rg = document.createRange(); rg.selectNode(t); sel.removeAllRanges(); sel.addRange(rg); b.textContent = '표 선택됨'; }
    setTimeout(() => { b.textContent = '산출표 복사'; }, 1600);
  });

  $$('input[name=trMode]').forEach(el => el.addEventListener('change', () => { S.trMode = el.value; renderTraj(); }));
  $$('input[name=mxMode]').forEach(el => el.addEventListener('change', () => { S.mxMode = el.value; renderMix(compute()); }));

  /* 상단 네비 활성 표시 */
  const secs = $$('.sec[id]');
  const links = $$('#navList a');
  addEventListener('scroll', () => {
    let cur = secs[0];
    secs.forEach(s => { if (s.getBoundingClientRect().top <= 90) cur = s; });
    links.forEach(a => a.classList.toggle('active', a.getAttribute('href') === '#' + cur.id));
  }, { passive: true });

  /* 폭이 바뀌면 SVG 를 다시 그린다 — viewBox 를 실제 픽셀 폭에 맞춰야 글자 크기가 유지된다 */
  let t = null;
  const redraw = () => { clearTimeout(t); t = setTimeout(() => { const r = compute(); renderBalance(r); renderTraj(); renderCo2(r); }, 140); };
  addEventListener('resize', redraw);
  if (window.ResizeObserver) new ResizeObserver(redraw).observe($('#s-bal'));
}

/* ===================== 부팅 ===================== */
buildSelect(); buildCapRows(); loadPlan(11); syncInputs(); bind(); renderAll();
})();
