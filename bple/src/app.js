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
  off: { bal: new Set(), traj: new Set(), mix: new Set() },
  /* 역산 기본 선택 — 정격을 빼면 실효용량이 그대로라 수급 균형을 흔들지 않는다 */
  bsSel: new Set(['cfCoal', 'nh3', 'cfLng', 'h2']),
  pristine: ''
};

/* 분석 조건이 계획 원안에서 바뀌었는지 — 시나리오와 원안을 구분해 보여주기 위해 쓴다 */
function snapshot() {
  return JSON.stringify([S.planId, S.basePeak, S.addSemi, S.addDc, S.addElec, S.dsm,
    S.reserve, S.pcRenew, S.nh3, S.h2,
    SRC.map(s => S.cap[s.key]), SRC.map(s => S.cf[s.key])]);
}
const isDirty = () => snapshot() !== S.pristine;

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

  /* 기준 보정값 산출 — 공표 과부족(최종설비 − 목표설비)을 원안에서 재현하는 상수.
     공표 수급전망 표가 없는 1~7차는 보정 없이 모형값을 그대로 쓴다. */
  S.effAdj = 0;
  if (p.pub) {
    const r0 = compute();
    S.effAdj = +((p.pub.finalCap - p.pub.targetCap) - r0.gap).toFixed(3);
  }
  S.pristine = snapshot();
}

/* ===================== 엔진 ===================== */
/* st 를 넘기면 그 상태로 계산한다 — 민감도 분석이 S 를 건드리지 않고 돌려보기 위해 쓴다 */
function compute(st) {
  const C = st || S;
  const p = PLANS.find(x => x.id === C.planId);
  const addTot = C.addSemi + C.addDc + C.addElec;
  const basePeak = C.basePeak + addTot;                 /* 기준수요 */
  const target = Math.max(0.1, basePeak - C.dsm);       /* 목표수요 */
  const targetCap = target * (1 + C.reserve / 100);     /* 목표설비 */
  const pc = Object.assign({}, C.pc, { renew: C.pcRenew });

  const eff = {}, gen = {};
  SRC.forEach(s => {
    eff[s.key] = (C.cap[s.key] || 0) * (pc[s.key] / 100);
    gen[s.key] = (C.cap[s.key] || 0) * (C.cf[s.key] / 100) * HOURS;
  });
  /* 기준 보정 — 계획은 목표설비·과부족을 하계(또는 동계) 실효용량 기준으로 산정하는데
     전원별 정격용량 표는 연말 기준이다. 두 기준의 차이와 공표값 반올림을 한 값으로 모아
     목표연도 원안에서 계획이 공표한 과부족이 그대로 재현되도록 맞춘다. loadPlan 에서 1회 산출. */
  const effAdj = C.effAdj || 0;
  const effSrc = sum(eff);
  const effTot = effSrc + effAdj;
  const gap = effTot - targetCap;
  const realReserve = (effTot / target - 1) * 100;

  const h2nh3 = gen.coal * (C.nh3 / 100) + gen.lng * (C.h2 / 100);
  const genNet = Object.assign({}, gen);
  genNet.coal = gen.coal * (1 - C.nh3 / 100);
  genNet.lng = gen.lng * (1 - C.h2 / 100);
  const genTot = sum(genNet) + h2nh3;

  const co2 = (genNet.coal * ENGINE.ef.coal + genNet.lng * ENGINE.ef.lng) * ENGINE.efCal;
  const cfree = genNet.nuclear + genNet.renew + h2nh3;
  const cfreeShare = genTot > 0 ? (cfree / genTot) * 100 : 0;
  const renewShare = genTot > 0 ? ((genNet.renew + genNet.newe) / genTot) * 100 : 0;
  const intensity = genTot > 0 ? co2 / genTot : 0;      /* 백만톤 / TWh = tCO2/MWh */
  const capTot = SRC.reduce((t, s) => t + (C.cap[s.key] || 0), 0);

  return { p, basePeak, target, targetCap, eff, effSrc, effAdj, effTot, gap, realReserve, capTot,
           gen, genNet, h2nh3, genTot, co2, cfreeShare, renewShare, intensity, pc };
}

/* 상태 복제 — 민감도용 */
function cloneState(mut) {
  const c = Object.assign({}, S, { cap: Object.assign({}, S.cap), cf: Object.assign({}, S.cf), pc: Object.assign({}, S.pc) });
  if (mut) mut(c);
  return c;
}

/* 11차 감축경로상 해당 연도의 배출 상한 ('30년 145.9 → '38년 83.1 선형) */
const pathCo2 = y => 145.9 - (145.9 - 83.1) * ((clamp(y, 2030, 2038) - 2030) / 8);

/* ===================== 진단 · 민감도 · 역산 ===================== */

/* 전제가 기준을 벗어났는지 점검해 경고로 알린다 */
function alerts(r) {
  const p = r.p, out = [];
  const ty = p.target, lim = pathCo2(ty), inPath = ty >= 2030;

  /* 1. 공급신뢰도 */
  if (r.gap < -0.05) {
    const nameplate = r.effTot > 0 ? Math.abs(r.gap) * (r.capTot / r.effTot) : 0;
    out.push(['bad', '공급력 부족',
      `실효용량 ${fmt(r.effTot, 1)}GW가 목표설비 ${fmt(r.targetCap, 1)}GW에 <b>${fmt(Math.abs(r.gap), 1)}GW 미달</b>합니다. ` +
      `실현 설비예비율 ${fmt(r.realReserve, 1)}%로 기준 ${fmt(S.reserve, 1)}%를 밑돕니다. 현 구성비로는 정격 ${fmt(nameplate, 1)}GW 증설이 필요합니다.`]);
  }

  /* 1-b. 여유 없는 설계 — 계획 원안이 기준 예비율에 정확히 맞춰져 있는 경우 */
  if (p.pub && !isDirty() && Math.abs(r.gap) < 0.25) {
    const sp = p.pub.finalCap - p.pub.targetCap;
    out.push(['info', '설비 여유 없음',
      `${p.name}는 부족분 ${fmt(p.pub.newCap, 1)}GW를 신규설비로 전부 메워 ${ty}년 최종설비 ` +
      `${fmt(p.pub.finalCap, 1)}GW를 ${p.pub.label} ${fmt(p.pub.targetCap, 1)}GW에 맞췄습니다` +
      `(설비예비율 ${fmt(p.pub.reserve, 1)}%, 기준 ${fmt(p.reserveNum, 1)}%). ` +
      (Math.abs(sp) < 0.05
        ? '여유는 <b>0</b>입니다. 계획 스스로 예비율 기준에 정확히 맞춘 설계라 전제가 조금만 어긋나도 곧바로 부족으로 돌아섭니다.'
        : `여유는 <b>${fmt(Math.abs(sp), 1)}GW</b>로 신규 설비 1기보다 작아, 전제가 조금만 어긋나도 부족으로 돌아섭니다.`) +
      (p.pub.caveat ? ` ${p.pub.caveat}` : '')]);
  }

  /* 2. 감축경로 */
  if (inPath) {
    const d = r.co2 - lim;
    if (d > 0.05) out.push(['bad', '감축경로 미충족',
      `${ty}년 배출량 <b>${fmt(r.co2, 1)}백만톤</b>이 11차 감축경로 ${fmt(lim, 1)}백만톤을 ` +
      `<b>${fmt(d, 1)}백만톤(${fmt((d / lim) * 100, 1)}%)</b> 초과합니다.`]);
    else if (d > -lim * 0.005) out.push(['info', '감축경로 여유 없음',
      `${ty}년 배출량 ${fmt(r.co2, 1)}백만톤이 감축경로 ${fmt(lim, 1)}백만톤에 거의 맞닿아 있습니다. ` +
      `배출을 늘리는 조정은 곧바로 경로를 넘깁니다.`]);
  }

  /* 3. 계획 원안 대비 설비 조정폭 */
  const base = SRC.reduce((t, s) => t + (p.cap[s.key] || 0), 0);
  const dCap = r.capTot - base;
  if (Math.abs(dCap) >= 0.05) {
    let worst = null;
    SRC.forEach(s => {
      const d = (S.cap[s.key] || 0) - (p.cap[s.key] || 0);
      if (!worst || Math.abs(d) > Math.abs(worst.d)) worst = { s, d };
    });
    const pct = base > 0 ? (dCap / base) * 100 : 0;
    const sev = Math.abs(pct) >= 10 ? 'warn' : 'info';
    out.push([sev, '원안 대비 설비 조정',
      `정격 합계 ${fmt(r.capTot, 1)}GW는 ${p.name} 원안 ${fmt(base, 1)}GW 대비 ` +
      `<b>${dCap > 0 ? '+' : '−'}${fmt(Math.abs(dCap), 1)}GW(${pct > 0 ? '+' : '−'}${fmt(Math.abs(pct), 1)}%)</b> ` +
      `${dCap > 0 ? '초과' : '부족'}합니다.` +
      (worst && Math.abs(worst.d) >= 0.05
        ? ` 가장 크게 움직인 전원은 ${worst.s.label} ${worst.d > 0 ? '+' : '−'}${fmt(Math.abs(worst.d), 1)}GW입니다.` : '')]);
  }

  /* 4. 이상치 점검 */
  const over = SRC.filter(s => (S.cf[s.key] || 0) > 92);
  if (over.length) out.push(['warn', '이용률 과다',
    `${over.map(s => s.label).join('·')}의 이용률이 92%를 넘습니다. 예방정비와 고장정지를 감안하면 실현이 어려운 수준입니다.`]);

  /* 치명적 경고가 없으면 충족 메시지를 맨 앞에 둔다 */
  if (!out.some(x => x[0] === 'bad')) {
    const ok = [`기준 설비예비율 ${fmt(S.reserve, 1)}% 충족(실현 ${fmt(r.realReserve, 1)}%)`];
    if (inPath) ok.push(`${ty}년 감축경로 ${fmt(lim, 1)}백만톤 이내(${fmt(r.co2, 1)}백만톤)`);
    out.unshift(['ok', '기준 충족', ok.join(' · ') + '.']);
  }
  return out;
}

/* 레버를 한 단위씩 움직여 효과를 수치로 뽑는다 */
function sensitivity(base) {
  const L = [
    ['기준 설비예비율', '+1%p', c => c.reserve += 1],
    ['수요관리 목표', '+1GW', c => c.dsm += 1],
    ['추가수요 (데이터센터)', '+1GW', c => c.addDc += 1],
    ['재생e 피크기여도', '+1%p', c => c.pcRenew += 1],
    ['재생e 정격용량', '+10GW', c => c.cap.renew = (c.cap.renew || 0) + 10],
    ['원전 정격용량', '+1GW', c => c.cap.nuclear = (c.cap.nuclear || 0) + 1],
    ['석탄 이용률', '+1%p', c => c.cf.coal = (c.cf.coal || 0) + 1],
    ['석탄 암모니아 혼소율', '+10%p', c => c.nh3 = clamp(c.nh3 + 10, 0, 100)],
    ['LNG 수소 혼소율', '+10%p', c => c.h2 = clamp(c.h2 + 10, 0, 100)]
  ];
  return L.map(([name, unit, mut]) => {
    const n = compute(cloneState(mut));
    return { name, unit,
      targetCap: n.targetCap - base.targetCap, eff: n.effTot - base.effTot, gap: n.gap - base.gap,
      gen: n.genTot - base.genTot, cfree: n.cfreeShare - base.cfreeShare, co2: n.co2 - base.co2 };
  });
}

/* ── 감축경로 역산 ──────────────────────────────────────────────
   석탄·LNG 각각의 이용률·혼소율·정격용량 6개 레버 중 선택한 것만 움직여
   감축경로에 정확히 닿게 한다.

   배분 규칙 : 연료별로 현재 배출 기여도에 비례해 감축량을 나누고,
   한 연료 안에서 여러 레버를 골랐으면 같은 비율(β^(1/n))씩 분담시킨다.
   혼소율은 발전량을 유지한 채 탄소발전을 청정수소·암모니아로 옮기고,
   이용률·정격은 발전량 자체를 줄인다는 점이 결과 요약에 드러난다. */

const BSLEVERS = [
  { k: 'cfCoal',  fuel: 'coal', kind: 'cf',    label: '석탄 이용률',         unit: '%'  },
  { k: 'nh3',     fuel: 'coal', kind: 'blend', label: '석탄 암모니아 혼소율', unit: '%'  },
  { k: 'capCoal', fuel: 'coal', kind: 'cap',   label: '석탄 정격용량',        unit: 'GW' },
  { k: 'cfLng',   fuel: 'lng',  kind: 'cf',    label: 'LNG 이용률',          unit: '%'  },
  { k: 'h2',      fuel: 'lng',  kind: 'blend', label: 'LNG 수소 혼소율',      unit: '%'  },
  { k: 'capLng',  fuel: 'lng',  kind: 'cap',   label: 'LNG 정격용량',         unit: 'GW' }
];

/* 레버 값을 상태에 반영 */
function applyLever(c, lv, beta) {
  if (lv.kind === 'cf')    c.cf[lv.fuel] = clamp((c.cf[lv.fuel] || 0) * beta, 0, 100);
  if (lv.kind === 'cap')   c.cap[lv.fuel] = Math.max(0, (c.cap[lv.fuel] || 0) * beta);
  if (lv.kind === 'blend') {
    const b = lv.fuel === 'coal' ? 'nh3' : 'h2';
    c[b] = clamp(100 * (1 - (1 - (c[b] || 0) / 100) * beta), 0, 100);
  }
}
function leverValue(c, lv) {
  if (lv.kind === 'cf')  return c.cf[lv.fuel] || 0;
  if (lv.kind === 'cap') return c.cap[lv.fuel] || 0;
  return lv.fuel === 'coal' ? c.nh3 : c.h2;
}

function backsolve(r) {
  const p = r.p, ty = p.target;
  if (ty < 2030) return null;
  const lim = pathCo2(ty), EF = ENGINE.ef, K = ENGINE.efCal;
  const sel = BSLEVERS.filter(l => S.bsSel.has(l.k));
  const out = { lim, co2: r.co2, meet: r.co2 <= lim * 1.005, sel, rows: [], feasible: true };

  if (!sel.length) { out.msg = '아래에서 조정할 레버를 하나 이상 고르면 그 조합으로 역산합니다.'; return out; }
  if (out.meet) {
    out.msg = `현재 배출량 ${fmt(r.co2, 1)}백만톤은 ${ty}년 감축경로 ${fmt(lim, 1)}백만톤 안에 있습니다. ` +
              `여유는 ${fmt(Math.max(lim - r.co2, 0), 1)}백만톤이며, 선택한 레버를 아래 값까지 완화해도 경로를 지킵니다.`;
  }

  /* 연료별 현재 배출과, 선택된 레버 수 */
  const E = { coal: r.genNet.coal * EF.coal * K, lng: r.genNet.lng * EF.lng * K };
  const n = { coal: sel.filter(l => l.fuel === 'coal').length, lng: sel.filter(l => l.fuel === 'lng').length };
  const pool = (n.coal ? E.coal : 0) + (n.lng ? E.lng : 0);
  const need = r.co2 - lim;                      /* 양수면 감축 필요, 음수면 완화 여지 */

  if (pool <= 0) { out.msg = '선택한 레버로 움직일 수 있는 배출이 없습니다.'; out.feasible = false; return out; }
  if (need > pool + 1e-9) {
    out.feasible = false;
    out.msg = `선택한 레버를 모두 끝까지 밀어도 ${fmt(need - pool, 1)}백만톤이 남습니다. ` +
              `다른 레버를 함께 고르거나 무탄소 전원을 늘려야 합니다.`;
  }

  /* 기여도 비례 분담은 결국 '선택 연료의 배출 합계를 β배로 줄인다'와 같다.
     share_f = need × E_f/pool 이므로 β_f = (E_f − share_f)/E_f = 1 − need/pool 로 모든 연료가 동일하다. */
  const beta = clamp(1 - need / pool, 0, 10);
  const c2 = cloneState();
  const per = {};
  ['coal', 'lng'].forEach(f => {
    if (!n[f]) return;
    per[f] = Math.pow(beta, 1 / n[f]);                    /* 같은 연료 안에서 균등 분담 */
    sel.filter(l => l.fuel === f).forEach(l => applyLever(c2, l, per[f]));
  });
  out.beta = beta; out.per = per; out.need = need; out.pool = pool; out.E = E; out.n = n;

  const after = compute(c2);
  out.rows = sel.map(l => ({ label: l.label, unit: l.unit,
    from: leverValue(S, l), to: leverValue(c2, l) }));
  out.after = { co2: after.co2, genTot: after.genTot, cfree: after.cfreeShare,
                dGen: after.genTot - r.genTot, dCfree: after.cfreeShare - r.cfreeShare,
                eff: after.effTot, dEff: after.effTot - r.effTot, gap: after.gap };
  out.state = c2;
  if (!out.meet && out.feasible)
    out.msg = `현재 배출량 ${fmt(r.co2, 1)}백만톤이 ${ty}년 감축경로 ${fmt(lim, 1)}백만톤을 ` +
              `${fmt(need, 1)}백만톤 넘습니다. 선택한 ${sel.length}개 레버가 아래와 같이 나눠 감당합니다.`;
  out.steps = buildSteps(out, r, sel, lim);
  /* 혼소만으로 발전량 손실 없이 해결 가능한지 — 선택 여부와 무관하게 짚어준다 */
  const freePool = (r.gen.coal - r.genNet.coal >= 0 ? r.genNet.coal * EF.coal * K : 0) + r.genNet.lng * EF.lng * K;
  out.freeOnly = need > 0 && need <= freePool + 1e-9;
  return out;
}

/* 화면에 뜬 숫자가 어떻게 나왔는지 단계로 풀어쓴다 */
function buildSteps(out, r, sel, lim) {
  if (!out.feasible || out.meet || !sel.length) return [];
  const pct = v => fmt(v * 100, 1) + '%';
  const st = [];

  st.push({ t: '줄여야 할 양을 구합니다',
    d: `현재 배출 <b>${fmt(r.co2, 1)}</b> − 감축경로 <b>${fmt(lim, 1)}</b> = <b>${fmt(out.need, 1)}백만톤</b>`,
    n: '배출량 = (석탄 순발전량 × 0.8384 + LNG 순발전량 × 0.3800) × 보정계수 0.948' });

  const fuels = ['coal', 'lng'].filter(f => out.n[f]);
  const nmOf = f => f === 'coal' ? '석탄' : 'LNG';
  const josa = f => f === 'coal' ? '석탄은' : 'LNG는';

  st.push({ t: '선택한 연료의 배출을 같은 비율로 줄입니다',
    d: (fuels.length > 1
        ? fuels.map(f => `${nmOf(f)} <b>${fmt(out.E[f], 1)}</b>`).join(' + ') + ` = <b>${fmt(out.pool, 1)}백만톤</b>`
        : `${nmOf(fuels[0])} 배출 <b>${fmt(out.pool, 1)}백만톤</b>`) +
       `이 움직일 수 있는 전부입니다. 여기서 ${fmt(out.need, 1)}백만톤을 덜어내면 남는 비율은 ` +
       `<b>1 − ${fmt(out.need, 1)} ÷ ${fmt(out.pool, 1)} = ${pct(out.beta)}</b>`,
    n: fuels.length > 1
        ? '연료별로 현재 배출 기여도에 비례해 나누면, 어느 연료든 결국 같은 배율로 줄어듭니다. 기여가 큰 연료가 자동으로 더 많이 감당합니다.'
        : '고른 연료가 하나뿐이라 그 연료가 감축량을 전부 감당합니다.' });

  st.push({ t: '같은 연료 안에서 레버끼리 나눕니다',
    d: fuels.map(f => {
      const k = out.n[f];
      if (k === 1) return `${josa(f)} 레버가 1개라 혼자 <b>${pct(out.beta)}</b>를 감당합니다.`;
      const chain = Array(k).fill(pct(out.per[f])).join(' × ');
      return `${josa(f)} 레버가 ${k}개라 각자 <b>${pct(out.per[f])}</b>씩 맡습니다. ${chain} = ${pct(out.beta)}`;
    }).join('<br>'),
    n: '레버 효과는 곱으로 쌓이므로, 각자 같은 비율을 맡으면 합쳐서 정확히 목표 배율이 됩니다.' });

  st.push({ t: '레버별 최종값을 계산합니다',
    d: sel.map(l => {
      const row = out.rows.find(x => x.label === l.label);
      const k = out.per[l.fuel];
      if (l.kind === 'blend') {
        const b0 = row.from / 100;
        return `${esc(l.label)} · 혼소하고 남는 탄소분 ${pct(1 - b0)} × ${pct(k)} = ${pct((1 - b0) * k)} ` +
               `→ 혼소율 <b>${fmt(row.to, 1)}%</b>`;
      }
      return `${esc(l.label)} · ${fmt(row.from, 1)}${l.unit} × ${pct(k)} = <b>${fmt(row.to, 1)}${l.unit}</b>`;
    }).join('<br>'),
    n: sel.some(l => l.kind === 'blend')
        ? '혼소율은 "타는 쪽"의 비율을 줄이는 방식이라, 1에서 현재 혼소율을 뺀 값에 배율을 곱한 뒤 다시 1에서 뺍니다.'
        : '이용률과 정격용량은 발전량에 그대로 비례하므로 배율을 바로 곱합니다.' });
  return st;
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
  renderChain();
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

/* 모형수요 → 목표수요 산정 사슬을 입력칸 아래에 그대로 보여준다.
   11차처럼 계획이 항목별로 따로 반올림해 모형수요가 0.1 어긋나는 경우도 함께 밝힌다. */
function renderChain() {
  const p = plan(), add = S.addSemi + S.addDc + S.addElec;
  const tgt = Math.max(0.1, S.basePeak + add - S.dsm);
  let t;
  if (add === 0 && S.dsm === 0) {
    t = `추가수요와 수요관리를 따로 분리하지 않은 계획이라 모형수요가 곧 <b>목표수요 ${fmt(tgt, 1)} GW</b>입니다.`;
  } else {
    t = `모형수요 ${fmt(S.basePeak, 1)}`;
    if (add > 0) t += ` + 추가수요 ${fmt(add, 1)} = 기준수요 ${fmt(S.basePeak + add, 1)}`;
    if (S.dsm > 0) t += ` − 수요관리 ${fmt(S.dsm, 1)}`;
    t += ` = <b>목표수요 ${fmt(tgt, 1)} GW</b>`;
  }
  if (p.modelPub != null && Math.abs(p.modelPub - S.basePeak) >= 0.05)
    t += `<span class="cav">※ ${p.name} 공표 모형수요는 ${fmt(p.modelPub, 1)}GW이나, 계획이 항목별로 따로 반올림해 합계가 0.1 어긋납니다.` +
         ` 공표 기준수요 ${fmt(p.basePub, 1)}·목표수요 ${fmt(p.peak[p.target], 1)}GW가 정확히 떨어지도록 역산한 값을 씁니다.</span>`;
  $('#basePeakChain').innerHTML = t;
}

/* ===================== KPI ===================== */
function renderKPI(r) {
  const p = r.p, pub = p.pub, bal = Math.abs(r.gap) < 0.05;
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
      `${fmt(r.target, 1)} × (1 + ${fmt(S.reserve, 1)}%)` +
      (pub ? ` · 공표 ${fmt(pub.targetCap, 1)}` : '')),
    tile('', '공급 실효용량', fmt(r.effTot, 1), 'GW',
      `정격 ${fmt(sum(S.cap), 1)}GW 중 피크기여 반영분` +
      (Math.abs(r.effAdj) >= 0.05
        ? ` ${fmt(r.effSrc, 1)} ${r.effAdj < 0 ? '−' : '+'} 기준 보정 ${fmt(Math.abs(r.effAdj), 1)}` : '')),
    tile(bal ? '' : r.gap > 0 ? 'pos' : 'neg',
      bal ? '수급 균형' : r.gap > 0 ? '설비 여유' : '신규 필요설비',
      (bal ? '' : r.gap > 0 ? '+' : '−') + fmt(Math.abs(r.gap), 1), 'GW',
      bal
        ? `목표설비를 정확히 충족합니다${pub ? ` · 공표 과부족 ${fmt(pub.finalCap - pub.targetCap, 1)}GW` : ''}`
        : (r.gap > 0 ? '목표설비 대비 초과 확보' : '목표설비 대비 부족분') +
          (r.effTot > 0 ? ` · 현 구성비로 정격 <b>${fmt(Math.abs(r.gap) * (sum(S.cap) / r.effTot), 1)}GW</b> 상당` : ''))
  ].join('');

  $('#kpiB').innerHTML = [
    tile('', '실현 설비예비율', fmt(r.realReserve, 1), '%', resPill),
    tile('', '총 발전량', fmt(r.genTot, 0), 'TWh', `신재생 발전비중 ${fmt(r.renewShare, 1)}%${est}`),
    tile('', '무탄소 발전비중', fmt(r.cfreeShare, 1), '%', '원전 + 재생e + 청정수소·암모니아'),
    tile('', '전환부문 온실가스', fmt(r.co2, 1), '백만톤', `배출원단위 ${fmt(r.intensity, 3)} tCO₂/MWh${est}`)
  ].join('');

  $('#kpiDesc').innerHTML =
    `${p.name} ${p.target}년 기준 · ${p.basis}` +
    (pub ? ` · 과부족은 계획과 같은 ${pub.basis} 실효용량 기준 ` : ' ') +
    (isDirty() ? '<span class="pill sub">원안에서 수정됨</span>' : '<span class="pill ok">원안 그대로</span>');
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
function mixBar(label, sub, obj, extra, unit, cur, na, base) {
  if (na) return `<div class="brow mx${base ? ' base' : ''}"><span class="nm">${esc(label)}<span class="sub">${esc(sub)}</span></span><span class="na">${esc(na)}</span><span></span></div>`;
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
  return `<div class="brow mx${cur ? ' cur' : ''}${base ? ' base' : ''}"><span class="nm">${esc(label)}<span class="sub">${esc(sub)}</span></span>` +
         `<span class="track"><span class="mxbar">${segs}</span></span>` +
         `<span class="amt">${fmt(tot, 1)} <small class="cur">${unit}</small></span></div>`;
}

function renderMix(r) {
  const mode = S.mxMode, unit = mode === 'gen' ? 'TWh' : 'GW';
  const tag = isDirty() ? '원안에서 수정됨' : `${plan().name} 원안 그대로`;
  const scenario = mixBar('시나리오', `${plan().target}년 · ${tag}`,
    mode === 'cap' ? S.cap : mode === 'eff' ? r.eff : r.genNet,
    mode === 'gen' ? r.h2nh3 : 0, unit, true);
  const planBar = p => {
    if (mode === 'gen') {
      return p.gen ? mixBar(p.name, `${p.genYear}년 원안`, p.gen, p.genH2 || 0, unit, false, null, p.id === S.planId)
                   : mixBar(p.name, `${p.genYear}년 원안`, {}, 0, unit, false, '전원별 발전량 미공표', p.id === S.planId);
    }
    if (mode === 'eff') {
      const q = planPC(p), e = {};
      SRC.forEach(s => e[s.key] = (p.cap[s.key] || 0) * (q[s.key] / 100));
      return mixBar(p.name, `${p.capYear}년 원안`, e, 0, unit, false, null, p.id === S.planId);
    }
    return mixBar(p.name, `${p.capYear}년 원안`, p.cap, 0, unit, false, null, p.id === S.planId);
  };
  /* 시나리오 막대를 선택한 차수 바로 위에 끼워 넣어 원안과 맞붙여 본다 */
  let html = '';
  [...PLANS].reverse().forEach(p => {
    if (p.id === S.planId) html += scenario;
    html += planBar(p);
  });
  $('#mixWrap').innerHTML = html; bindTips($('#mixWrap'));
  const li = SRC.map(s => ({ k: s.key, t: s.label, c: 'var(--c-' + s.key + ')', sq: true }));
  if (mode === 'gen') li.push({ k: 'h2', t: '청정수소·암모니아', c: 'var(--c-h2)', sq: true });
  legend($('#mixLegend'), 'mix', li, () => { const q = compute(); renderMix(q); renderGen(q); });
  $('#mixDesc').innerHTML = `<b>시나리오</b>는 분석 조건에 입력된 값으로 계산한 결과이고, <b>제N차</b>는 그 계획이 공표한 원안입니다. ` +
    `바로 아래 <b>${plan().name}</b> 원안과 맞붙여 놓았으니 두 막대를 그대로 견주시면 됩니다. ` +
    '조건을 건드리지 않으면 두 막대가 같아집니다. 범례를 누르면 해당 전원을 빼고 다시 계산합니다.';
  $('#mixNote').textContent = (mode === 'cap'
    ? '각 계획의 목표연도 정격용량(연말 기준)입니다.'
    : mode === 'eff'
      ? '각 계획이 자기 본문에서 쓴 실효/정격 비율을 적용한 실효용량입니다. 1~5차는 정격 기준 표를 그대로 씁니다. 전원별 비교를 위한 값이라 계절 기준 보정은 넣지 않았으므로, 수급 균형 판정에 쓰이는 02의 실효용량과는 소수점 차이가 있습니다.'
      : '각 계획의 목표연도 전원별 발전량입니다. 8차는 발전량 비중에 신재생 125.8TWh(20.0%)를 적용해 총 629TWh로 환산했습니다.')
    + ' 막대 길이는 구성비이고, 오른쪽 숫자가 합계입니다.';
}

/* ===================== 06 발전량·배출 ===================== */
function renderGen(r) {
  const p = plan();
  let html = mixBar('시나리오', `${p.target}년 · ${isDirty() ? '원안에서 수정됨' : '원안 그대로'}`, r.genNet, r.h2nh3, 'TWh', true);
  if (p.gen) html += mixBar(`${p.name} 원안`, `${p.genYear}년 공표값`, p.gen, p.genH2 || 0, 'TWh', false);

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

/* ===================== 진단 렌더 ===================== */
function renderAlerts(r) {
  $('#alerts').innerHTML = alerts(r).map(([sev, t, m]) =>
    `<div class="alert ${sev}"><span class="t">${esc(t)}</span><span class="m">${m}</span></div>`).join('');
}

function renderSens(r) {
  const rows = sensitivity(r);
  const cell = (v, unit, inv) => {
    if (Math.abs(v) < 0.045) return '<td class="z">—</td>';
    const good = inv ? v < 0 : v > 0;
    return `<td class="${good ? 'dn' : 'up'}">${v > 0 ? '+' : '−'}${fmt(Math.abs(v), 1)}${unit}</td>`;
  };
  const head = ['조정 항목', '조정폭', '목표설비', '실효용량', '과부족', '총발전량', '무탄소비중', '배출량'];
  $('#sensTable').className = 'bple sens';
  $('#sensTable').innerHTML =
    `<thead><tr>${head.map(h => `<th>${h}</th>`).join('')}</tr></thead><tbody>` +
    rows.map(x => `<tr><td>${esc(x.name)}</td><td>${esc(x.unit)}</td>` +
      cell(x.targetCap, 'GW', true) + cell(x.eff, 'GW') + cell(x.gap, 'GW') +
      cell(x.gen, 'TWh') + cell(x.cfree, '%p') + cell(x.co2, '백만톤', true) +
      '</tr>').join('') + '</tbody>';
  /* 가장 효율적인 공급력 레버를 찾아 한 줄로 짚어준다 */
  const byEff = rows.filter(x => x.eff > 0.05).sort((a2, b2) => b2.eff - a2.eff)[0];
  const byCo2 = rows.filter(x => x.co2 < -0.05).sort((a2, b2) => a2.co2 - b2.co2)[0];
  let n = '초록은 수급·탄소에 유리한 방향, 주황은 불리한 방향입니다. 0.05 미만 변화는 생략했습니다.';
  if (byEff) n += ` 공급 실효용량을 가장 크게 올리는 레버는 <b>${esc(byEff.name)} ${esc(byEff.unit)}</b>(${fmt(byEff.eff, 1)}GW)입니다.`;
  if (byCo2) n += ` 배출을 가장 크게 줄이는 레버는 <b>${esc(byCo2.name)} ${esc(byCo2.unit)}</b>(${fmt(Math.abs(byCo2.co2), 1)}백만톤)입니다.`;
  $('#sensNote').innerHTML = n;
}

/* 레버 선택 UI 는 한 번만 그린다 — 체크할 때마다 다시 그리면 포커스가 날아간다 */
function renderBsPicks() {
  const host = $('#bsPicks');
  if (host.dataset.ready) return;
  host.dataset.ready = '1';
  host.innerHTML = ['coal', 'lng'].map(f => {
    const nm = f === 'coal' ? '석탄' : 'LNG';
    return `<div class="bs-fuel"><span class="bs-fuel-h"><i class="swatch" style="background:var(--c-${f})"></i>${nm}</span>` +
      BSLEVERS.filter(l => l.fuel === f).map(l => {
        const short = l.label.replace(nm, '').trim() || l.label;
        return `<label class="check"><input type="checkbox" class="bsL" value="${l.k}"${S.bsSel.has(l.k) ? ' checked' : ''}> ${esc(short)}</label>`;
      }).join('') + `</div>`;
  }).join('');
  host.querySelectorAll('.bsL').forEach(el => el.addEventListener('change', () => {
    el.checked ? S.bsSel.add(el.value) : S.bsSel.delete(el.value);
    renderBacksolve(compute());
  }));
}

function renderBacksolve(r) {
  const host = $('#bsResult');
  renderBsPicks();
  const bs = backsolve(r);
  if (!bs) {
    $('#bsPicks').hidden = true;
    host.innerHTML = `<p class="note">${r.p.name}의 목표연도 ${r.p.target}년은 11차 감축경로(2030~2038) 이전이라 역산 대상이 아닙니다.</p>`;
    return;
  }
  $('#bsPicks').hidden = false;

  const sev = !bs.sel.length ? 'info' : !bs.feasible ? 'bad' : bs.meet ? 'ok' : 'warn';
  const ttl = !bs.sel.length ? '레버 선택' : !bs.feasible ? '달성 불가' : bs.meet ? '경로 충족' : '경로 초과';

  let body = '';
  if (bs.rows.length) {
    body += `<div class="bs-grid">` + bs.rows.map(x => {
      const up = x.to > x.from + 0.05, dn = x.to < x.from - 0.05;
      return `<div class="bs-item"><div class="k">${esc(x.label)}</div>` +
        `<div class="v">${fmt(x.to, 1)}${esc(x.unit)}</div>` +
        `<div class="n">현재 ${fmt(x.from, 1)}${esc(x.unit)}` +
        (up || dn ? ` <b class="${dn ? 'dn' : 'up'}">${dn ? '▼' : '▲'} ${fmt(Math.abs(x.to - x.from), 1)}${esc(x.unit)}</b>` : ' · 변화 없음') +
        `</div></div>`;
    }).join('') + `</div>`;
    const A = bs.after;
    body += `<div class="bs-sum">` + [
      ['적용 후 배출량', `${fmt(A.co2, 1)} 백만톤`, `경로 ${fmt(bs.lim, 1)}백만톤`],
      ['총 발전량', `${fmt(A.genTot, 0)} TWh`, `${A.dGen >= 0 ? '+' : '−'}${fmt(Math.abs(A.dGen), 1)} TWh`],
      ['무탄소 발전비중', `${fmt(A.cfree, 1)} %`, `${A.dCfree >= 0 ? '+' : '−'}${fmt(Math.abs(A.dCfree), 1)}%p`],
      ['공급 실효용량', `${fmt(A.eff, 1)} GW`, A.gap >= 0 ? '목표설비 충족' : `${fmt(Math.abs(A.gap), 1)}GW 부족`]
    ].map(([k, v, n]) => `<div><dt>${k}</dt><dd>${v}<span>${n}</span></dd></div>`).join('') + `</div>`;
    if (bs.feasible) body += `<div class="tools" style="margin-top:13px"><button class="btn" type="button" id="bsApply">이 값으로 적용</button></div>`;
  }

  /* 계산 과정 */
  if (bs.steps && bs.steps.length) {
    body += `<details class="calc" open><summary>이 값이 나온 과정</summary><ol class="calc-steps">` +
      bs.steps.map(s => `<li><span class="ct">${s.t}</span><span class="cd">${s.d}</span>` +
        (s.n ? `<span class="cn">${s.n}</span>` : '') + `</li>`).join('') +
      `</ol>` +
      (bs.freeOnly ? `<p class="calc-alt"><b>참고</b> 필요한 감축량 ${fmt(bs.need, 1)}백만톤은 혼소율만 올려도 모두 덜어낼 수 있습니다. ` +
        `혼소는 발전량을 유지한 채 탄소발전을 청정수소·암모니아로 옮기므로, 혼소 레버만 고르면 <b>발전량 손실 없이</b> 경로를 맞출 수 있습니다. ` +
        `대신 그만큼의 청정수소·암모니아를 확보해야 합니다.</p>` : '') +
      `</details>`;
  }

  host.innerHTML =
    `<div class="alert ${sev}" style="margin:13px 0"><span class="t">${ttl}</span><span class="m">${bs.msg || ''}</span></div>` +
    body +
    `<p class="note">이 결과는 <b>비용 최적해가 아니라 분담 규칙에 따른 해</b>입니다. 이 시뮬레이터에는 비용 함수가 없어 ` +
    `"가장 싼 조합"을 고를 근거가 없으므로, 선택한 연료의 배출을 같은 비율로 줄이는 방식을 씁니다. ` +
    `다른 기준(예: 발전량 손실 최소화, 연료비 최소화)을 쓰면 배분이 달라집니다. ` +
    `정격을 고르면 실효용량도 함께 움직여 수급 균형에 영향을 줍니다.</p>`;

  const ap = $('#bsApply');
  if (ap) ap.addEventListener('click', () => {
    const c = bs.state;
    SRC.forEach(s => { S.cap[s.key] = +(c.cap[s.key] || 0).toFixed(2); S.cf[s.key] = +(c.cf[s.key] || 0).toFixed(2); });
    S.nh3 = +c.nh3.toFixed(1); S.h2 = +c.h2.toFixed(1);
    syncInputs(); renderAll();
    flash(bs.rows.map(x => {
      const l = BSLEVERS.find(y => y.label === x.label);
      return l.kind === 'cf' ? 'cfn_' + l.fuel : l.kind === 'cap' ? 'capn_' + l.fuel : (l.fuel === 'coal' ? 'bNh3N' : 'bH2N');
    }));
    toast(`역산 결과를 적용했습니다 <b>배출 ${fmt(bs.after.co2, 1)}백만톤</b>`);
  });
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
  if (Math.abs(r.effAdj) >= 0.05) rows.push(`<tr><td>기준 보정 (${r.p.pub ? r.p.pub.basis : '계절'} 환산)</td>` +
    ['—', '—', (r.effAdj < 0 ? '−' : '+') + fmt(Math.abs(r.effAdj), 1), '—', '—', '—', '—'].map(v => `<td>${v}</td>`).join('') + '</tr>');
  rows.push(`<tr class="sum"><td>합계</td>` +
    [fmt(sum(S.cap), 1), '—', fmt(r.effTot, 1), '—', fmt(r.genTot, 1), '100.0', fmt(r.co2, 1)].map(v => `<td>${v}</td>`).join('') + '</tr>');
  $('#detailTable').innerHTML = `<thead><tr>${head.map(h => `<th>${h}</th>`).join('')}</tr></thead><tbody>${rows.join('')}</tbody>`;
  $('#detailNote').innerHTML = `혼소분은 석탄·LNG 발전량에서 빼 청정수소·암모니아로 옮깁니다. 배출량에는 전환부문 보정계수 <b>${ENGINE.efCal}</b>을 적용했습니다.` +
    (Math.abs(r.effAdj) >= 0.05
      ? ` 전원별 정격용량은 연말 기준인데 계획은 과부족을 ${r.p.pub.basis} 실효용량 기준으로 산정하므로, 두 기준의 차이와 공표값 반올림을 <b>기준 보정</b> 한 줄로 모았습니다. 이 값을 더하면 ${r.p.name}가 공표한 ${r.p.target}년 과부족이 그대로 재현됩니다.` : '') +
    (plan().gen && !plan().gen.hydro ? ` ${plan().name}는 양수 발전량을 '기타'에 합산해 공표하므로 수력·양수 행의 발전량이 0으로 표시됩니다.` : '');
}

function renderPlanTable() {
  const head = ['차수', '공고', '계획기간', '목표<br>연도',
    '최대전력<br>(GW)', '최대전력<br>연평균(%)', '소비량<br>(TWh)', '소비량<br>연평균(%)',
    '기준 설비예비율', '정격설비<br>(GW)', '원전 설비<br>비중(%)', '신재생 설비<br>비중(%)'];
  const body = [...PLANS].reverse().map(p => {
    const tot = sum(p.cap), ren = ((p.cap.renew + p.cap.newe) / tot) * 100;
    return `<tr data-id="${p.id}"${p.id === S.planId ? ' class="cur"' : ''} role="button" tabindex="0">` +
      [p.name, p.year, `${p.period[0]}–${p.period[1]}`, p.target,
       fmt(p.peak[p.target], 1), fmt(p.peakCagr, 1), fmt(p.demandVal, 1), fmt(p.demandCagr, 1),
       p.reserve, fmt(tot, 1), fmt((p.cap.nuclear / tot) * 100, 1), fmt(ren, 1)]
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
  renderChain(); renderKPI(r); renderAlerts(r); renderBalance(r); renderTraj(); renderErr();
  renderMix(r); renderGen(r); renderCo2(r); renderSens(r); renderBacksolve(r);
  renderDetail(r); renderPlanTable();
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
