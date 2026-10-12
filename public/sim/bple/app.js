/* ------------------------------------------------------------------
   PRAS-BPLE — 전력수급기본계획 시뮬레이터 엔진
   data/plans.js 가 먼저 로드돼 SRC / ENGINE / ACTUAL / PLANS / DSM11 /
   ADD11 전역을 제공한다는 전제로 동작한다.
   ------------------------------------------------------------------ */
/*__DATA__*/

/* ===================== 유틸 ===================== */
const $ = s => document.querySelector(s);
const css = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
const fmt = (v, d = 1) => (v === null || v === undefined || Number.isNaN(v)) ? '—'
  : v.toLocaleString('ko-KR', { minimumFractionDigits: d, maximumFractionDigits: d });
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const sum = o => SRC.reduce((a, s) => a + (o[s.key] || 0), 0);
const HOURS = 8.76; /* 1년 = 8,760h → GW×8.76 = TWh */

/* ===================== 상태 ===================== */
const S = {
  planId: 11,
  basePeak: 0, addSemi: 0, addDc: 0, addElec: 0, dsm: 0,
  reserve: 22, pcRenew: ENGINE.peakCredit.renew,
  cap: {}, cf: {}, pc: {}, nh3: 0, h2: 0,
  trajMode: 'all', mixMode: 'cap'
};

function plan() { return PLANS.find(p => p.id === S.planId); }
/* 계획별 피크기여도 = 공통 기본값에 그 계획의 실효/정격 실측 비율을 덮어씀 */
function planPC(p) { return Object.assign({}, ENGINE.peakCredit, p.pc || {}); }

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
  S.pc = planPC(p);
  S.pcRenew = S.pc.renew;
  S.cap = Object.assign({}, p.cap);
  S.cf = Object.assign({}, ENGINE.cf);
  const bl = p.blend || { nh3: 0, h2: 0 };
  S.nh3 = bl.nh3; S.h2 = bl.h2;
  /* 계획 원문 발전량이 있으면 그 계획의 실제 이용률로 보정.
     석탄·LNG는 공표값이 혼소분을 뺀 순발전량이므로 총발전량으로 환원해 역산한다. */
  if (p.gen) {
    S.estimated = false;
    const base = p.genCap || p.cap;
    SRC.forEach(s => {
      const c = base[s.key];
      let g = p.gen[s.key] || 0;
      if (s.key === 'coal' && S.nh3 > 0) g = g / (1 - S.nh3 / 100);
      if (s.key === 'lng' && S.h2 > 0) g = g / (1 - S.h2 / 100);
      S.cf[s.key] = (g > 0 && c > 0) ? +clamp((g / (c * HOURS)) * 100, 0, 100).toFixed(2) : 0;
    });
  } else {
    /* 원문에 전원별 발전량이 없는 계획(6·7·9차):
       그 계획의 목표연도 전력소비량에 발전단 보정 1.11을 적용해 총발전량을 잡고,
       원전·재생e는 기준 이용률로 고정한 뒤 나머지 급전가능 전원에 균등 배분한다. */
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
  const basePeak = S.basePeak + addTot;         /* 기준수요 */
  const target = Math.max(0.1, basePeak - S.dsm); /* 목표수요 */
  const targetCap = target * (1 + S.reserve / 100); /* 목표설비 */

  const pc = Object.assign({}, S.pc, { renew: S.pcRenew });
  const eff = {}, gen = {};
  SRC.forEach(s => {
    eff[s.key] = (S.cap[s.key] || 0) * (pc[s.key] / 100);
    gen[s.key] = (S.cap[s.key] || 0) * (S.cf[s.key] / 100) * HOURS;
  });
  const effTot = sum(eff);
  const gap = effTot - targetCap;               /* + 여유 / − 신규 필요설비 */
  const realReserve = (effTot / target - 1) * 100;

  /* 혼소 분리 */
  const h2nh3 = gen.coal * (S.nh3 / 100) + gen.lng * (S.h2 / 100);
  const genNet = Object.assign({}, gen);
  genNet.coal = gen.coal * (1 - S.nh3 / 100);
  genNet.lng = gen.lng * (1 - S.h2 / 100);
  const genTot = sum(genNet) + h2nh3;

  const co2 = (genNet.coal * ENGINE.ef.coal + genNet.lng * ENGINE.ef.lng) * ENGINE.efCal;
  const cfree = genNet.nuclear + genNet.renew + h2nh3;
  const cfreeShare = genTot > 0 ? (cfree / genTot) * 100 : 0;
  const renewShare = genTot > 0 ? ((genNet.renew + genNet.newe) / genTot) * 100 : 0;
  const intensity = genTot > 0 ? (co2 * 1000) / (genTot * 1000) : 0; /* tCO2/MWh */

  return { p, basePeak, target, targetCap, eff, effTot, gap, realReserve,
           gen, genNet, h2nh3, genTot, co2, cfree, cfreeShare, renewShare, intensity, pc };
}

/* ===================== 사이드바 구성 ===================== */
function buildSelect() {
  const sel = $('#planSel');
  sel.innerHTML = PLANS.map(p =>
    `<option value="${p.id}">${p.name} 전력수급기본계획 (${p.year} · ${p.period[0]}~${p.period[1]})</option>`
  ).join('');
}

function buildCapRows() {
  $('#capGrid').innerHTML = SRC.map(s =>
    `<div class="cap-row">
       <span class="nm"><i class="swatch" style="background:var(--s-${s.key})"></i>${s.short}</span>
       <input type="range" id="cap_${s.key}" min="0" max="200" step="0.1" aria-label="${s.label} 정격용량">
       <span class="num-wrap"><input type="number" id="capn_${s.key}" step="0.1" aria-label="${s.label} 정격용량 직접 입력"><span class="u">GW</span></span>
     </div>`).join('');
  $('#cfGrid').innerHTML = SRC.map(s =>
    `<div class="cap-row">
       <span class="nm"><i class="swatch" style="background:var(--s-${s.key})"></i>${s.short}</span>
       <input type="range" id="cf_${s.key}" min="0" max="100" step="0.1" aria-label="${s.label} 이용률">
       <span class="num-wrap"><input type="number" id="cfn_${s.key}" step="0.1" aria-label="${s.label} 이용률 직접 입력"><span class="u">%</span></span>
     </div>`).join('');
}

const PAIRS = [
  ['basePeak', 'basePeak', 1], ['addSemi', 'addSemi', 1], ['addDc', 'addDc', 1],
  ['addElec', 'addElec', 1], ['dsm', 'dsm', 1], ['reserve', 'reserve', 1],
  ['pcRenew', 'pcRenew', 1], ['bNh3', 'nh3', 0], ['bH2', 'h2', 0]
];

function syncInputs() {
  const p = plan();
  $('#planSel').value = S.planId;
  PAIRS.forEach(([id, key]) => {
    const r = $('#' + id), n = $('#' + id + 'N');
    if (id === 'basePeak') { r.max = Math.max(200, Math.ceil(S.basePeak * 1.4)); }
    r.value = S[key]; n.value = S[key];
  });
  SRC.forEach(s => {
    const v = S.cap[s.key] || 0, r = $('#cap_' + s.key), n = $('#capn_' + s.key);
    r.max = Math.max(200, Math.ceil(v * 1.6)); r.value = v; n.value = +v.toFixed(1);
    const c = S.cf[s.key] || 0;
    $('#cf_' + s.key).value = c; $('#cfn_' + s.key).value = +c.toFixed(1);
  });
  /* 계획 메타 */
  $('#planMeta').innerHTML = [
    ['계획기간', `${p.period[0]} – ${p.period[1]}`],
    ['목표연도', `${p.target}년`],
    ['기준 설비예비율', p.reserve],
    ['산정 기준', p.basis],
    [`${p.demandLabel} (${p.demandYear})`, `${fmt(p.demandVal, 1)} TWh`],
    ['최대전력 연평균', `${fmt(p.peakCagr, 1)} %`]
  ].map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join('');
  $('#planNote').textContent = p.note;
}

/* ===================== 렌더 ===================== */
function renderKPI(r) {
  const p = r.p;
  const gapCls = r.gap >= 0 ? 'pos' : 'neg';
  const resPill = r.realReserve >= S.reserve ? ['ok', '기준 충족']
    : r.realReserve >= S.reserve - 3 ? ['warn', '기준 근접'] : ['bad', '기준 미달'];
  const est = S.estimated ? ' <span class="pill warn">모형 추정</span>' : '';
  const items = [
    { cls: 'lead', label: `목표수요 (${p.target}년 최대전력)`, val: fmt(r.target, 1), u: 'GW',
      sub: `기준수요 ${fmt(r.basePeak, 1)} − 수요관리 ${fmt(S.dsm, 1)}` },
    { cls: 'lead', label: `목표설비 용량 (예비율 ${fmt(S.reserve, 1)}%)`, val: fmt(r.targetCap, 1), u: 'GW',
      sub: `${fmt(r.target, 1)} × (1 + ${fmt(S.reserve, 1)}%)` },
    { cls: '', label: '공급 실효용량', val: fmt(r.effTot, 1), u: 'GW',
      sub: `정격 ${fmt(sum(S.cap), 1)}GW 중 피크기여 반영분` },
    { cls: gapCls, label: r.gap >= 0 ? '설비 여유' : '신규 필요설비',
      val: (r.gap >= 0 ? '+' : '−') + fmt(Math.abs(r.gap), 1), u: 'GW',
      sub: r.gap >= 0 ? '목표설비 대비 초과 확보' : '목표설비 대비 부족분' },
    { cls: '', label: '실현 설비예비율', val: fmt(r.realReserve, 1), u: '%',
      sub: `<span class="pill ${resPill[0]}">${resPill[1]}</span>` },
    { cls: '', label: '총 발전량', val: fmt(r.genTot, 0), u: 'TWh',
      sub: `신재생 발전비중 ${fmt(r.renewShare, 1)}%${est}` },
    { cls: '', label: '무탄소 발전비중', val: fmt(r.cfreeShare, 1), u: '%',
      sub: '원전 + 재생e + 청정수소·암모니아' },
    { cls: '', label: '전환부문 온실가스', val: fmt(r.co2, 1), u: '백만톤',
      sub: `배출원단위 ${fmt(r.intensity, 3)} tCO₂/MWh${est}` }
  ];
  $('#kpiGrid').innerHTML = items.map(i =>
    `<div class="kpi ${i.cls}"><div class="label">${i.label}</div>
      <div class="value">${i.val}<span class="u">${i.u}</span></div>
      <div class="sub">${i.sub}</div></div>`).join('');
}

/* ---- Chart.js 공통 ---- */
let charts = {};
function destroy(k) { if (charts[k]) { charts[k].destroy(); delete charts[k]; } }
function baseOpts() {
  const tick = css('--tick'), grid = css('--grid'), ink = css('--ink'), surf = css('--surface'), line = css('--line');
  return {
    responsive: true, maintainAspectRatio: false,
    interaction: { mode: 'index', intersect: false },
    plugins: {
      legend: { display: false },
      tooltip: {
        backgroundColor: surf, titleColor: ink, bodyColor: ink, borderColor: line, borderWidth: 1,
        padding: 10, cornerRadius: 7, titleFont: { size: 11.5, weight: '600' }, bodyFont: { size: 11.5 },
        displayColors: true, boxWidth: 8, boxHeight: 8, boxPadding: 3
      }
    },
    scales: {
      x: { grid: { color: grid, drawTicks: false }, border: { color: grid }, ticks: { color: tick, font: { size: 10.5 }, maxRotation: 0, autoSkipPadding: 14 } },
      y: { grid: { color: grid, drawTicks: false }, border: { display: false }, ticks: { color: tick, font: { size: 10.5 }, padding: 6 } }
    }
  };
}

function renderBalance(r) {
  const p = r.p;
  const years = Object.keys(p.peak).map(Number).sort((a, b) => a - b);
  const peaks = years.map(y => p.peak[y]);
  const tcaps = years.map(y => p.peak[y] * (1 + S.reserve / 100));
  const res = years.map(y => p.reserveSeries ? (p.reserveSeries[y] ?? null) : null);
  destroy('bal');
  const o = baseOpts();
  o.scales.y.title = { display: true, text: '최대전력 · 목표설비 (GW)', color: css('--muted'), font: { size: 10.5 } };
  o.scales.y1 = { position: 'right', grid: { display: false }, border: { display: false },
    ticks: { color: css('--tick'), font: { size: 10.5 }, callback: v => v + '%' },
    title: { display: true, text: '계획상 설비예비율', color: css('--muted'), font: { size: 10.5 } } };
  charts.bal = new Chart($('#balChart'), {
    type: 'bar',
    data: {
      labels: years,
      datasets: [
        { type: 'bar', label: '목표수요 (최대전력)', data: peaks, backgroundColor: css('--s-lng'), borderRadius: 2, order: 3, barPercentage: .72, categoryPercentage: .82 },
        { type: 'line', label: `목표설비 (예비율 ${fmt(S.reserve, 1)}%)`, data: tcaps, borderColor: css('--s-nuclear'), borderWidth: 2, pointRadius: 0, tension: .2, order: 1 },
        { type: 'line', label: '계획상 설비예비율', data: res, yAxisID: 'y1', borderColor: css('--warn'), borderWidth: 1.6, borderDash: [4, 3], pointRadius: 0, tension: .2, order: 2, spanGaps: true }
      ]
    }, options: o
  });
  $('#balMuted').textContent = `${p.name} ${p.period[0]}~${p.period[1]} · ${p.basis}`;
  $('#balLegend').innerHTML = [
    [css('--s-lng'), '목표수요(최대전력)'],
    [css('--s-nuclear'), `목표설비 — 예비율 ${fmt(S.reserve, 1)}% 적용`],
    [css('--warn'), '계획 원문 설비예비율']
  ].map(([c, t]) => `<span><i style="background:${c}"></i>${t}</span>`).join('');
}

function renderTraj() {
  const ids = S.trajMode === 'recent' ? [8, 9, 10, 11] : PLANS.map(p => p.id);
  const ramp = ['#9aa3ab', '#8d969e', '#808a93', '#737e88', '#66727d', '#5a6672', '#4d5a67', '#404e5c', '#344251', '#273646', '#1b2a3b'];
  const rampD = ['#5e676f', '#6a747c', '#767f88', '#828c95', '#8e99a2', '#9aa5af', '#a6b1bc', '#b2bdc8', '#bec9d5', '#cad5e1', '#dbe4ee'];
  const dark = document.documentElement.getAttribute('data-theme') === 'dark' ||
    (!document.documentElement.getAttribute('data-theme') && matchMedia('(prefers-color-scheme: dark)').matches);
  const pal = dark ? rampD : ramp;
  const yrs = []; for (let y = 2001; y <= 2038; y++) yrs.push(y);
  const ds = ids.map(id => {
    const p = PLANS.find(x => x.id === id);
    const isSel = id === S.planId;
    return {
      label: p.name, data: yrs.map(y => p.peak[y] ?? null),
      borderColor: isSel ? css('--accent-dark') : pal[id - 1],
      borderWidth: isSel ? 2.6 : 1.3, pointRadius: 0, tension: .18, spanGaps: false,
      order: isSel ? 0 : 2
    };
  });
  ds.push({
    label: '실적', data: yrs.map(y => { const a = ACTUAL.peak.find(x => x[0] === y); return a ? a[1] : null; }),
    borderColor: css('--bad'), backgroundColor: css('--bad'), borderWidth: 0,
    pointRadius: 3.2, pointStyle: 'circle', showLine: false, order: 1
  });
  destroy('traj');
  const o = baseOpts();
  o.scales.y.title = { display: true, text: '최대전력 (GW)', color: css('--muted'), font: { size: 10.5 } };
  o.scales.y.min = 40;
  o.plugins.tooltip.callbacks = { label: c => c.parsed.y === null ? null : `${c.dataset.label}  ${fmt(c.parsed.y, 1)} GW` };
  charts.traj = new Chart($('#trajChart'), { type: 'line', data: { labels: yrs, datasets: ds }, options: o });
  $('#trajNote').innerHTML = `굵은 선이 선택한 ${plan().name} 계획이다. 붉은 점은 각 계획 본문에 '실적'으로 명시된 최대전력이다. ` +
    `8·9차는 동계, 나머지는 각 계획의 헤드라인 기준을 그대로 썼다.`;
}

function renderErr() {
  /* 전망 대비 실적: 계획이 전망한 해 가운데 실적이 확인되는 가장 나중 해를 쓴다.
     계절 기준을 맞추기 위해 하계 계열이 따로 있는 8·9차는 하계 전망을 쓴다. */
  const rows = [];
  PLANS.forEach(p => {
    const ser = p.peakSummer || p.peak;
    let best = null;
    ACTUAL.peak.forEach(([y, a]) => {
      if (ser[y] !== undefined && y >= p.period[0] + 3) best = { y, a, fc: ser[y] };
    });
    if (!best) return;
    const mk = ACTUAL.market.find(x => x[0] === best.y);
    const act = (p.id <= 9 && mk) ? mk[1] : best.a;   /* 1~9차는 전력시장 기준 전망 */
    rows.push({ id: p.id, name: p.name, year: best.y, fc: best.fc, act,
      basis: (p.id <= 9 && mk) ? '전력시장' : (p.id >= 10 ? '전력계통' : '당시 공표'),
      err: ((best.fc - act) / act) * 100 });
  });
  destroy('err');
  const o = baseOpts();
  o.indexAxis = 'y';
  o.scales.x.title = { display: true, text: '전망 오차 (%)', color: css('--muted'), font: { size: 10.5 } };
  o.scales.x.ticks.callback = v => (v > 0 ? '+' : '') + v + '%';
  o.plugins.tooltip.callbacks = {
    title: c => `${rows[c[0].dataIndex].name} · ${rows[c[0].dataIndex].year}년`,
    label: c => { const r = rows[c.dataIndex]; return [`전망 ${fmt(r.fc, 1)} GW`, `실적 ${fmt(r.act, 1)} GW (${r.basis})`, `오차 ${r.err > 0 ? '+' : ''}${fmt(r.err, 1)}%`]; }
  };
  charts.err = new Chart($('#errChart'), {
    type: 'bar',
    data: {
      labels: rows.map(r => `${r.name} (${String(r.year).slice(2)})`),
      datasets: [{
        data: rows.map(r => r.err),
        backgroundColor: rows.map(r => r.id === S.planId ? css('--accent-dark') : (r.err > 0 ? css('--s-oil') : css('--s-hydro'))),
        borderRadius: 2, barPercentage: .74
      }]
    }, options: o
  });
  const over = rows.filter(r => r.err > 0).length;
  $('#errNote').innerHTML = `비교 가능한 ${rows.length}개 계획 중 <b>${over}개가 과대전망</b>, <b>${rows.length - over}개가 과소전망</b>이었다. ` +
    `가로축은 (전망 − 실적) ÷ 실적이고, 계절 기준을 맞추려 하계 계열이 따로 있는 8·9차는 하계 전망을 썼다. ` +
    `전력시장 기준으로 전망한 1~9차는 같은 기준 실적('23년 93.6GW)과, 전력계통 기준인 10·11차는 전력계통 실적과 비교한다.`;
}

function renderMix(r) {
  const mode = S.mixMode;
  const rows = [];
  const mk = (label, sub, obj, extra, isCur) => {
    const tot = sum(obj) + (extra || 0);
    if (!tot) return null;
    return { label, sub, obj, extra: extra || 0, tot, isCur };
  };
  rows.push(mk('시나리오', `${plan().target}년 · 조정 전제`,
    mode === 'cap' ? S.cap : mode === 'eff' ? r.eff : r.genNet,
    mode === 'gen' ? r.h2nh3 : 0, true));
  PLANS.forEach(p => {
    if (mode === 'gen') {
      if (!p.gen) { rows.push({ label: p.name, sub: `${p.genYear}년 원안`, na: p.genNote }); return; }
      rows.push(mk(p.name, `${p.genYear}년 원안`, p.gen, p.genH2 || 0, false));
    } else if (mode === 'eff') {
      const q = planPC(p), e = {};
      SRC.forEach(s => e[s.key] = (p.cap[s.key] || 0) * (q[s.key] / 100));
      rows.push(mk(p.name, `${p.capYear}년 원안`, e, 0, false));
    } else {
      rows.push(mk(p.name, `${p.capYear}년 원안`, p.cap, 0, false));
    }
  });
  const unit = mode === 'gen' ? 'TWh' : 'GW';
  $('#mixWrap').innerHTML = rows.filter(Boolean).map(row => {
    if (row.na) return `<div class="mixbar"><div class="lab">${row.label}<small>${row.sub}</small></div><div class="na">${row.na}</div></div>`;
    const segs = SRC.map(s => {
      const v = row.obj[s.key] || 0; if (v <= 0) return '';
      const pct = (v / row.tot) * 100;
      return `<span class="seg-i" style="flex:${v};background:var(--s-${s.key})" title="${s.label} ${fmt(v, 1)}${unit} (${fmt(pct, 1)}%)">${pct >= 7 ? `<b>${pct.toFixed(0)}</b>` : ''}</span>`;
    }).join('');
    const ex = row.extra > 0
      ? `<span class="seg-i" style="flex:${row.extra};background:repeating-linear-gradient(135deg,var(--s-other),var(--s-other) 3px,var(--surface-3) 3px,var(--surface-3) 6px)" title="청정수소·암모니아 ${fmt(row.extra, 1)}TWh">${(row.extra / row.tot) * 100 >= 7 ? `<b>${((row.extra / row.tot) * 100).toFixed(0)}</b>` : ''}</span>` : '';
    return `<div class="mixbar${row.isCur ? ' current' : ''}">
      <div class="lab">${row.label}<small>${row.sub} · ${fmt(row.tot, 1)}${unit}</small></div>
      <div class="track">${segs}${ex}</div></div>`;
  }).join('');
  $('#mixLegend').innerHTML = SRC.map(s => `<span><i style="background:var(--s-${s.key})"></i>${s.label}</span>`).join('') +
    (mode === 'gen' ? `<span><i style="background:repeating-linear-gradient(135deg,var(--s-other),var(--s-other) 3px,var(--surface-3) 3px,var(--surface-3) 6px)"></i>청정수소·암모니아</span>` : '');
  $('#mixNote').textContent = mode === 'cap'
    ? '각 계획의 목표연도 정격용량(연말 기준)이다. 막대 안 숫자는 비중(%)이며 7% 미만은 생략했다.'
    : mode === 'eff'
      ? '각 계획이 자기 본문에서 쓴 실효/정격 비율을 그대로 적용한 실효용량이다. 1~5차는 정격 기준 표를 그대로 쓴다.'
      : '각 계획의 목표연도 전원별 발전량이다. 8차는 발전량 비중에 신재생 125.8TWh(20.0%)를 적용해 총 629TWh로 환산했다.';
}

function renderGen(r) {
  const used = SRC.filter(s => (r.genNet[s.key] || 0) > 0.05);
  destroy('gen');
  const o = baseOpts();
  o.indexAxis = 'y';
  o.scales.x.stacked = true; o.scales.y.stacked = true;
  o.scales.x.title = { display: true, text: '발전량 (TWh)', color: css('--muted'), font: { size: 10.5 } };
  o.plugins.tooltip.callbacks = { label: c => `${c.dataset.label}  ${fmt(c.parsed.x, 1)} TWh` };
  const cmpP = plan();
  const labels = ['시나리오'];
  const datasets = used.map(s => ({
    label: s.label, data: [r.genNet[s.key]], backgroundColor: css('--s-' + s.key), borderRadius: 1, stack: 'a'
  }));
  if (r.h2nh3 > 0.05) datasets.push({ label: '청정수소·암모니아', data: [r.h2nh3], backgroundColor: css('--warn'), borderRadius: 1, stack: 'a' });
  if (cmpP.gen) {
    labels.push(`${cmpP.name} 원안`);
    datasets.forEach(d => {
      const s = SRC.find(x => x.label === d.label);
      d.data.push(s ? (cmpP.gen[s.key] || 0) : (cmpP.genH2 || 0));
    });
  }
  charts.gen = new Chart($('#genChart'), { type: 'bar', data: { labels, datasets }, options: o });
  $('#genMuted').innerHTML = cmpP.gen
    ? `시나리오 ${fmt(r.genTot, 0)}TWh vs ${cmpP.name} 원안 ${fmt(sum(cmpP.gen) + (cmpP.genH2 || 0), 0)}TWh`
    : `${cmpP.genNote} — 계획의 ${cmpP.demandYear}년 ${cmpP.demandLabel} ${fmt(cmpP.demandVal, 1)}TWh에 발전단 보정 1.11을 적용해 역산한 <b>모형 추정</b>이다.`;
}

function renderCo2(r) {
  /* 11차 감축경로: '30년 145.9 → '38년 83.1 선형 */
  const yrs = []; for (let y = 2030; y <= 2038; y++) yrs.push(y);
  const path = yrs.map(y => 145.9 - (145.9 - 83.1) * ((y - 2030) / 8));
  destroy('co2');
  const o = baseOpts();
  o.scales.y.title = { display: true, text: '백만톤CO₂eq', color: css('--muted'), font: { size: 10.5 } };
  o.scales.y.beginAtZero = true;
  o.plugins.tooltip.callbacks = { label: c => c.parsed.y === null ? null : `${c.dataset.label}  ${fmt(c.parsed.y, 1)} 백만톤` };
  const ty = plan().target;
  const marker = yrs.map(y => (y === clamp(ty, 2030, 2038) ? r.co2 : null));
  charts.co2 = new Chart($('#co2Chart'), {
    type: 'bar',
    data: {
      labels: yrs,
      datasets: [
        { type: 'line', label: '11차 감축경로', data: path, borderColor: css('--s-nuclear'), borderWidth: 2, pointRadius: 0, tension: 0, fill: false },
        { type: 'bar', label: `시나리오 (${ty}년)`, data: marker, backgroundColor: r.co2 <= (145.9 - (145.9 - 83.1) * ((clamp(ty, 2030, 2038) - 2030) / 8)) * 1.005 ? css('--good') : css('--bad'), borderRadius: 2, barPercentage: .5 }
      ]
    }, options: o
  });
  const tgt = 145.9 - (145.9 - 83.1) * ((clamp(ty, 2030, 2038) - 2030) / 8);
  const diff = r.co2 - tgt;
  $('#co2Note').innerHTML = ty < 2030
    ? `${plan().name}의 목표연도 ${ty}년은 11차 감축경로(2030~2038) 이전이다. 막대는 2030년 칸에 참고로 표시된다. 시나리오 배출량 <b>${fmt(r.co2, 1)}</b>백만톤.`
    : `${ty}년 감축경로 기준 <b>${fmt(tgt, 1)}</b>백만톤 대비 시나리오는 <b>${diff >= 0 ? '+' : '−'}${fmt(Math.abs(diff), 1)}</b>백만톤 ${diff >= 0 ? '초과' : '여유'}다.`;
}

function renderDetail(r) {
  const head = ['전원', '정격용량 (GW)', '피크기여도 (%)', '실효용량 (GW)', '이용률 (%)', '발전량 (TWh)', '발전비중 (%)', '배출량 (백만톤)'];
  const body = SRC.map(s => {
    const cap = S.cap[s.key] || 0;
    const e = r.eff[s.key], g = r.genNet[s.key];
    const em = s.key === 'coal' ? g * ENGINE.ef.coal * ENGINE.efCal
      : s.key === 'lng' ? g * ENGINE.ef.lng * ENGINE.efCal : 0;
    return [`<span class="nm" style="display:inline-flex;align-items:center;gap:6px"><i class="swatch" style="background:var(--s-${s.key})"></i>${s.label}</span>`,
      fmt(cap, 1), fmt(r.pc[s.key], 1), fmt(e, 1), fmt(S.cf[s.key], 1), fmt(g, 1),
      fmt(r.genTot ? (g / r.genTot) * 100 : 0, 1), em > 0 ? fmt(em, 1) : '—'];
  });
  if (r.h2nh3 > 0.05) body.push(['<span style="display:inline-flex;align-items:center;gap:6px"><i class="swatch" style="background:var(--warn)"></i>청정수소·암모니아</span>',
    '—', '—', '—', '—', fmt(r.h2nh3, 1), fmt((r.h2nh3 / r.genTot) * 100, 1), '0.0']);
  body.push([`<b>합계</b>`, `<b>${fmt(sum(S.cap), 1)}</b>`, '—', `<b>${fmt(r.effTot, 1)}</b>`, '—',
    `<b>${fmt(r.genTot, 1)}</b>`, '<b>100.0</b>', `<b>${fmt(r.co2, 1)}</b>`]);
  $('#detailTable').innerHTML =
    `<thead><tr>${head.map(h => `<th>${h}</th>`).join('')}</tr></thead>` +
    `<tbody>${body.map((row, i) => `<tr${i === body.length - 1 ? ' class="is-sel"' : ''}>${row.map(c => `<td>${c}</td>`).join('')}</tr>`).join('')}</tbody>`;
  $('#detailNote').innerHTML = `혼소분은 석탄·LNG 발전량에서 빼 청정수소·암모니아로 옮긴다. 배출량에는 전환부문 보정계수 <code>${ENGINE.efCal}</code>가 적용돼 있다.` +
    (plan().gen && !plan().gen.hydro ? ` ${plan().name}은 양수 발전량을 '기타'에 합산해 공표하므로 수력·양수 행의 발전량이 0으로 표시된다.` : '');
}

function renderPlanTable() {
  const head = ['차수', '공고', '계획기간', '목표', '최대전력<br>(GW)', '연평균<br>(%)', '소비량<br>(TWh)', '기준 설비예비율', '설비<br>(GW)', '원전<br>(%)', '재생e<br>(%)'];
  const body = PLANS.map(p => {
    const tot = sum(p.cap);
    const ren = ((p.cap.renew + p.cap.newe) / tot) * 100;
    return { id: p.id, cells: [p.name, p.year, `${p.period[0]}–${p.period[1]}`, p.target,
      fmt(p.peak[p.target], 1), fmt(p.peakCagr, 1), fmt(p.demandVal, 1), p.reserve,
      fmt(tot, 1), fmt((p.cap.nuclear / tot) * 100, 1), fmt(ren, 1)] };
  });
  $('#planTable').innerHTML =
    `<thead><tr>${head.map(h => `<th>${h}</th>`).join('')}</tr></thead>` +
    `<tbody>${body.map(r => `<tr data-id="${r.id}"${r.id === S.planId ? ' class="is-sel"' : ''}>${r.cells.map(c => `<td>${c}</td>`).join('')}</tr>`).join('')}</tbody>`;
  $('#planTable').querySelectorAll('tbody tr').forEach(tr => {
    tr.style.cursor = 'pointer';
    tr.addEventListener('click', () => { loadPlan(+tr.dataset.id); syncInputs(); renderAll(); });
  });
}

function renderAll() {
  const r = compute();
  renderKPI(r); renderBalance(r); renderTraj(); renderErr();
  renderMix(r); renderGen(r); renderCo2(r); renderDetail(r); renderPlanTable();
}

/* ===================== 이벤트 ===================== */
function bind() {
  $('#planSel').addEventListener('change', e => { loadPlan(+e.target.value); syncInputs(); renderAll(); });

  PAIRS.forEach(([id, key, dec]) => {
    const r = $('#' + id), n = $('#' + id + 'N');
    const set = v => {
      v = Number(v); if (Number.isNaN(v)) return;
      v = Math.max(0, v);
      S[key] = +v.toFixed(dec);
      if (+r.max < v) r.max = Math.ceil(v * 1.2);
      r.value = S[key]; n.value = S[key];
      renderAll();
    };
    r.addEventListener('input', () => set(r.value));
    n.addEventListener('input', () => set(n.value));
  });

  SRC.forEach(s => {
    const cr = $('#cap_' + s.key), cn = $('#capn_' + s.key);
    const setCap = v => {
      v = Math.max(0, Number(v) || 0); S.cap[s.key] = +v.toFixed(1);
      if (+cr.max < v) cr.max = Math.ceil(v * 1.2);
      cr.value = S.cap[s.key]; cn.value = S.cap[s.key]; renderAll();
    };
    cr.addEventListener('input', () => setCap(cr.value));
    cn.addEventListener('input', () => setCap(cn.value));

    const fr = $('#cf_' + s.key), fn = $('#cfn_' + s.key);
    const setCf = v => {
      v = clamp(Number(v) || 0, 0, 100); S.cf[s.key] = +v.toFixed(1);
      fr.value = S.cf[s.key]; fn.value = S.cf[s.key]; renderAll();
    };
    fr.addEventListener('input', () => setCf(fr.value));
    fn.addEventListener('input', () => setCf(fn.value));
  });

  $('#btnReset').addEventListener('click', () => { loadPlan(S.planId); syncInputs(); renderAll(); });

  $('#btnFit').addEventListener('click', () => {
    /* 목표설비에 딱 맞도록 부족분을 전원별 현재 비중대로 비례 확대 */
    const r = compute();
    if (Math.abs(r.gap) < 0.05 || r.effTot <= 0) return;
    const k = r.targetCap / r.effTot;
    SRC.forEach(s => { S.cap[s.key] = +((S.cap[s.key] || 0) * k).toFixed(1); });
    syncInputs(); renderAll();
  });

  $('#btnCopy').addEventListener('click', async () => {
    const t = $('#detailTable');
    const txt = [...t.querySelectorAll('tr')].map(tr =>
      [...tr.children].map(td => td.textContent.trim()).join('\t')).join('\n');
    const btn = $('#btnCopy');
    try { await navigator.clipboard.writeText(txt); btn.textContent = '복사됨'; }
    catch { const sel = getSelection(); const rg = document.createRange(); rg.selectNode(t); sel.removeAllRanges(); sel.addRange(rg); btn.textContent = '표 선택됨'; }
    setTimeout(() => { btn.textContent = '표 복사'; }, 1600);
  });

  document.querySelectorAll('[data-tr]').forEach(b => b.addEventListener('click', () => {
    S.trajMode = b.dataset.tr;
    document.querySelectorAll('[data-tr]').forEach(x => x.setAttribute('aria-pressed', String(x === b)));
    renderTraj();
  }));
  document.querySelectorAll('[data-mx]').forEach(b => b.addEventListener('click', () => {
    S.mixMode = b.dataset.mx;
    document.querySelectorAll('[data-mx]').forEach(x => x.setAttribute('aria-pressed', String(x === b)));
    renderMix(compute());
  }));

  $('#themeBtn').addEventListener('click', () => {
    const cur = document.documentElement.getAttribute('data-theme');
    const dark = cur === 'dark' || (!cur && matchMedia('(prefers-color-scheme: dark)').matches);
    document.documentElement.setAttribute('data-theme', dark ? 'light' : 'dark');
    requestAnimationFrame(renderAll);
  });
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    if (!document.documentElement.getAttribute('data-theme')) requestAnimationFrame(renderAll);
  });
}

/* ===================== 부팅 ===================== */
buildSelect();
buildCapRows();
loadPlan(11);
syncInputs();
bind();
renderAll();
