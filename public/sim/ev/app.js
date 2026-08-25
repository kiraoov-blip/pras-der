/* PRAS-EV v2.14 — 전기차 요금설계 및 매출영향 분석 시뮬레이터
   - 전력량요금만 산정
   - 2025년 사용량 × 2026년 전기자동차 충전전력요금
   - 제주 시간대: 경부하 22~08, 중간부하 08~16, 최대부하 16~22
*/

const RATE_TABLES = {
  self_low: {
    label: "자가소비용 · 저압",
    group: "자가소비용",
    voltage: "저압",
    season: {
      summer: { off: 84.3, mid: 172.0, peak: 259.2 },
      springfall: { off: 85.4, mid: 97.2, peak: 102.1 },
      winter: { off: 107.4, mid: 154.9, peak: 217.5 }
    }
  },
  self_high: {
    label: "자가소비용 · 고압",
    group: "자가소비용",
    voltage: "고압",
    season: {
      summer: { off: 79.2, mid: 137.4, peak: 190.4 },
      springfall: { off: 80.2, mid: 91.0, peak: 94.9 },
      winter: { off: 96.6, mid: 127.7, peak: 165.5 }
    }
  },
  service_low_1: {
    label: "충전서비스 제공사업자용 · 저압 선택Ⅰ",
    group: "충전서비스 제공사업자용",
    voltage: "저압",
    season: {
      summer: { off: 95.9, mid: 162.2, peak: 203.5 },
      springfall: { off: 85.4, mid: 97.2, peak: 102.1 },
      winter: { off: 110.6, mid: 143.1, peak: 172.0 }
    }
  },
  service_low_2: {
    label: "충전서비스 제공사업자용 · 저압 선택Ⅱ",
    group: "충전서비스 제공사업자용",
    voltage: "저압",
    season: {
      summer: { off: 83.1, mid: 140.0, peak: 270.8 },
      springfall: { off: 85.4, mid: 97.2, peak: 102.1 },
      winter: { off: 105.8, mid: 126.7, peak: 227.0 }
    }
  },
  service_low_3: {
    label: "충전서비스 제공사업자용 · 저압 선택Ⅲ",
    group: "충전서비스 제공사업자용",
    voltage: "저압",
    season: {
      summer: { off: 90.1, mid: 138.6, peak: 236.0 },
      springfall: { off: 85.4, mid: 97.2, peak: 102.1 },
      winter: { off: 115.5, mid: 125.4, peak: 198.4 }
    }
  },
  service_low_4: {
    label: "충전서비스 제공사업자용 · 저압 선택Ⅳ(전체시간)",
    group: "충전서비스 제공사업자용",
    voltage: "저압",
    season: {
      summer: { off: 172.0, mid: 172.0, peak: 172.0 },
      springfall: { off: 97.2, mid: 97.2, peak: 97.2 },
      winter: { off: 154.9, mid: 154.9, peak: 154.9 }
    }
  },
  service_high_1: {
    label: "충전서비스 제공사업자용 · 고압 선택Ⅰ",
    group: "충전서비스 제공사업자용",
    voltage: "고압",
    season: {
      summer: { off: 89.8, mid: 129.9, peak: 151.2 },
      springfall: { off: 80.2, mid: 91.0, peak: 94.9 },
      winter: { off: 99.4, mid: 118.4, peak: 132.4 }
    }
  },
  service_high_2: {
    label: "충전서비스 제공사업자용 · 고압 선택Ⅱ",
    group: "충전서비스 제공사업자용",
    voltage: "고압",
    season: {
      summer: { off: 78.2, mid: 113.0, peak: 198.6 },
      springfall: { off: 80.2, mid: 91.0, peak: 94.9 },
      winter: { off: 95.2, mid: 105.5, peak: 172.4 }
    }
  },
  service_high_3: {
    label: "충전서비스 제공사업자용 · 고압 선택Ⅲ",
    group: "충전서비스 제공사업자용",
    voltage: "고압",
    season: {
      summer: { off: 84.5, mid: 111.9, peak: 174.0 },
      springfall: { off: 80.2, mid: 91.0, peak: 94.9 },
      winter: { off: 103.6, mid: 104.5, peak: 151.6 }
    }
  },
  service_high_4: {
    label: "충전서비스 제공사업자용 · 고압 선택Ⅳ(전체시간)",
    group: "충전서비스 제공사업자용",
    voltage: "고압",
    season: {
      summer: { off: 137.4, mid: 137.4, peak: 137.4 },
      springfall: { off: 91.0, mid: 91.0, peak: 91.0 },
      winter: { off: 127.7, mid: 127.7, peak: 127.7 }
    }
  }
};

const PERIOD_LABEL = { off: "경부하", mid: "중간부하", peak: "최대부하" };
const TYPE_LABEL = { all: "전체", slow: "완속", fast: "급속" };

const $ = (id) => document.getElementById(id);
let hourlyChart = null;
let monthlyChart = null;
let lastResult = null;
let lastNeutralInfo = null;
const rawCurrentAvgCache = new Map();
const smpByDate = new Map();

function init() {
  if (!window.EV_USAGE_DATA || !Array.isArray(window.EV_USAGE_DATA.records)) {
    document.body.innerHTML = "<main class='card' style='margin:20px'>사용량 데이터가 로드되지 않았습니다. data/ev_usage_2025.js 파일을 확인하십시오.</main>";
    return;
  }
  if (!window.JEJU_SMP_2025 || !Array.isArray(window.JEJU_SMP_2025.records)) {
    document.body.innerHTML = "<main class='card' style='margin:20px'>제주 SMP 데이터가 로드되지 않았습니다. data/smp_jeju_2025.js 파일을 확인하십시오.</main>";
    return;
  }
  buildSmpIndex();
  populateSelects();
  bindEvents();
  updateVisibility();
  update();
}

function buildSmpIndex() {
  smpByDate.clear();
  window.JEJU_SMP_2025.records.forEach((rec) => {
    if (!rec || !rec.date_key || !Array.isArray(rec.hours) || rec.hours.length < 24) return;
    smpByDate.set(String(rec.date_key), rec.hours.map((v) => Number(v)));
  });
}

function smpRate(dateKey, hour) {
  const hours = smpByDate.get(String(dateKey));
  if (!hours || hour < 0 || hour >= 24) return null;
  const value = Number(hours[hour]);
  return Number.isFinite(value) ? value : null;
}

function populateSelects() {
  const tariffOptions = Object.entries(RATE_TABLES)
    .map(([key, item]) => `<option value="${key}">${item.label}</option>`)
    .join("");
  $("slowTariff").innerHTML = tariffOptions;
  $("fastTariff").innerHTML = tariffOptions;
  $("slowTariff").value = "self_low";
  $("fastTariff").value = "self_high";

  let hourOptions = "";
  for (let h = 0; h <= 24; h += 1) {
    const txt = String(h).padStart(2, "0") + ":00";
    hourOptions += `<option value="${h}">${txt}</option>`;
  }
  $("discountStart").innerHTML = hourOptions;
  $("discountEnd").innerHTML = hourOptions;
  $("discountStart").value = "10";
  $("discountEnd").value = "16";
}

const PAIRED_CONTROLS = [
  { rangeId: "currentTariffAdjPct", numberId: "currentTariffAdjPctNumber", digits: 1, dynamicMax: true },
  { rangeId: "discountPct", numberId: "discountPctNumber", digits: 1 },
  { rangeId: "nonDiscountAdj", numberId: "nonDiscountAdjNumber", digits: 1, dynamicMax: true },
  { rangeId: "participation", numberId: "participationNumber", digits: 0 },
  { rangeId: "slowShiftPct", numberId: "slowShiftPctNumber", digits: 0 },
  { rangeId: "fastShiftPct", numberId: "fastShiftPctNumber", digits: 0 }
];

function bindEvents() {
  PAIRED_CONTROLS.forEach(bindPairedControl);

  document.querySelectorAll("input:not([data-paired]),select").forEach((el) => {
    const refresh = () => {
      updateVisibility();
      update();
    };
    el.addEventListener("input", refresh);
    el.addEventListener("change", refresh);
  });

  $("neutralizeBtn").addEventListener("click", setRevenueNeutralAdjustment);
  $("neutralFixedBtn").addEventListener("click", applyRevenueNeutralFixedPrice);
  $("downloadCsv").addEventListener("click", downloadHourlyCsv);
  syncOutputs();
}

function bindPairedControl(config) {
  const range = $(config.rangeId);
  const number = $(config.numberId);
  const min = Number(range.min);

  const refresh = () => {
    updateVisibility();
    update();
  };

  const ensureDynamicMax = (value) => {
    if (!config.dynamicMax || !Number.isFinite(value)) return;
    const currentMax = Number(range.max || 0);
    if (value <= currentMax) return;
    const block = value <= 500 ? 50 : value <= 2000 ? 100 : 500;
    range.max = String(Math.ceil(value / block) * block);
  };

  range.addEventListener("input", () => {
    number.value = formatPairedValue(range.value, config.digits);
    refresh();
  });
  range.addEventListener("change", () => {
    number.value = formatPairedValue(range.value, config.digits);
    refresh();
  });

  const applyNumber = () => {
    if (number.value === "" || !Number.isFinite(Number(number.value))) return;
    let value = Math.max(min, Number(number.value));
    const explicitMax = number.hasAttribute("max") ? Number(number.max) : null;
    if (Number.isFinite(explicitMax)) value = Math.min(explicitMax, value);
    ensureDynamicMax(value);
    if (!config.dynamicMax) value = Math.min(Number(range.max), value);
    range.value = String(value);
    number.value = formatPairedValue(value, config.digits);
    refresh();
  };
  number.addEventListener("input", applyNumber);
  number.addEventListener("change", applyNumber);
}

function setPairedControlValue(config, value) {
  const range = $(config.rangeId);
  const number = $(config.numberId);
  let v = Number(value);
  if (!Number.isFinite(v)) return;
  const min = Number(range.min);
  v = Math.max(min, v);
  const explicitMax = number.hasAttribute("max") ? Number(number.max) : null;
  if (Number.isFinite(explicitMax)) v = Math.min(explicitMax, v);
  if (config.dynamicMax && v > Number(range.max)) {
    const block = v <= 500 ? 50 : v <= 2000 ? 100 : 500;
    range.max = String(Math.ceil(v / block) * block);
  }
  range.value = String(v);
  number.value = formatPairedValue(v, config.digits);
}

function formatPairedValue(value, digits) {
  const n = Number(value);
  if (!Number.isFinite(n)) return digits > 0 ? Number(0).toFixed(digits) : "0";
  if (digits === 0) return String(Math.round(n));
  return n.toLocaleString("ko-KR", { minimumFractionDigits: digits, maximumFractionDigits: digits, useGrouping: false });
}

function syncOutputs() {
  PAIRED_CONTROLS.forEach((config) => {
    const range = $(config.rangeId);
    const number = $(config.numberId);
    number.value = formatPairedValue(range.value, config.digits);
  });
}

function updateVisibility() {
  const mode = $("pricingMode").value;
  $("discountPctWrap").classList.toggle("is-hidden", mode !== "pct");
  $("fixedPriceWrap").classList.toggle("is-hidden", mode !== "fixed");

  const currentMode = $("currentTariffAdjMode").value;
  $("currentTariffAdjPctWrap").classList.toggle("is-hidden", currentMode !== "pct");
  $("currentTariffAvgPriceWrap").classList.toggle("is-hidden", currentMode !== "avg");
}

function getControls(override = {}) {
  const selectedPeriods = [...document.querySelectorAll(".sourcePeriod:checked")].map((el) => el.value);
  return {
    filterType: $("filterType").value,
    slowTariff: $("slowTariff").value,
    fastTariff: $("fastTariff").value,
    currentTariffAdjMode: $("currentTariffAdjMode").value,
    currentTariffAdjPct: Number($("currentTariffAdjPct").value),
    currentTariffAvgPrice: Number($("currentTariffAvgPrice").value),
    applyWeekendDiscount: $("applyWeekendDiscount").checked,
    allowStacking: $("allowStacking").checked,
    discountStart: Number($("discountStart").value),
    discountEnd: Number($("discountEnd").value),
    pricingMode: $("pricingMode").value,
    discountPct: Number($("discountPct").value),
    fixedPrice: Number($("fixedPrice").value),
    nonDiscountAdj: Number($("nonDiscountAdj").value),
    participation: Number($("participation").value) / 100,
    slowShiftPct: Number($("slowShiftPct").value) / 100,
    fastShiftPct: Number($("fastShiftPct").value) / 100,
    sourcePeriods: selectedPeriods,
    distributionMode: $("distributionMode").value,
    ...override
  };
}

function isSaturday(dayType) {
  return String(dayType).includes("토");
}

function isSundayOrHoliday(dayType) {
  const t = String(dayType).trim();
  return t === "일·공휴일" || t === "일요일" || t === "공휴일" || t.includes("공휴일");
}

function baseJejuPeriod(hour) {
  if (hour >= 22 || hour < 8) return "off";
  if (hour >= 8 && hour < 16) return "mid";
  return "peak";
}

function billingPeriod(record, hour) {
  if (isSundayOrHoliday(record.day_type)) return "off";
  const period = baseJejuPeriod(hour);
  if (isSaturday(record.day_type) && period === "peak") return "mid";
  return period;
}

function inRange(hour, start, end) {
  if (start === end) return false;
  if (start < end) return hour >= start && hour < end;
  return hour >= start || hour < end;
}

function weekendDiscountEligible(record, hour) {
  const weekend = isSaturday(record.day_type) || isSundayOrHoliday(record.day_type);
  return record.season === "springfall" && weekend && hour >= 11 && hour < 14;
}

function getTariffKey(record, controls) {
  return record.charge_type === "slow" ? controls.slowTariff : controls.fastTariff;
}

function baseRate(record, hour, tariffKey) {
  const period = billingPeriod(record, hour);
  return RATE_TABLES[tariffKey].season[record.season][period];
}

function rawCurrentRate(record, hour, tariffKey, controls) {
  const b = baseRate(record, hour, tariffKey);
  if (controls.applyWeekendDiscount && weekendDiscountEligible(record, hour)) return b * 0.5;
  return b;
}

function rawCurrentAnnualAverage(controls) {
  const cacheKey = [
    controls.filterType,
    controls.slowTariff,
    controls.fastTariff,
    controls.applyWeekendDiscount ? "1" : "0"
  ].join("|");
  if (rawCurrentAvgCache.has(cacheKey)) return rawCurrentAvgCache.get(cacheKey);

  const records = window.EV_USAGE_DATA.records.filter((rec) => controls.filterType === "all" || rec.charge_type === controls.filterType);
  let kwh = 0;
  let revenue = 0;
  for (const rec of records) {
    const tariffKey = getTariffKey(rec, controls);
    for (let h = 0; h < 24; h += 1) {
      const usage = Number(rec.hours[h] || 0);
      kwh += usage;
      revenue += usage * rawCurrentRate(rec, h, tariffKey, controls);
    }
  }
  const avg = kwh > 0 ? revenue / kwh : 0;
  rawCurrentAvgCache.set(cacheKey, avg);
  return avg;
}

function resolveCurrentTariffAdjustment(controls) {
  const originalAvg = rawCurrentAnnualAverage(controls);
  let scale = 1;
  if (controls.currentTariffAdjMode === "pct") {
    scale = Math.max(0, 1 + Number(controls.currentTariffAdjPct || 0) / 100);
  } else if (controls.currentTariffAdjMode === "avg") {
    const target = Number(controls.currentTariffAvgPrice || 0);
    if (originalAvg > 0 && target >= 0) scale = target / originalAvg;
  }
  const adjustedAvg = originalAvg * scale;
  return {
    originalAvg,
    adjustedAvg,
    scale,
    effectivePct: (scale - 1) * 100
  };
}

function currentRate(record, hour, tariffKey, controls) {
  return rawCurrentRate(record, hour, tariffKey, controls) * (controls.currentTariffScale ?? 1);
}

function newRate(record, hour, tariffKey, controls) {
  const scale = controls.currentTariffScale ?? 1;
  const b = baseRate(record, hour, tariffKey) * scale;
  const existingWeekend = controls.applyWeekendDiscount && weekendDiscountEligible(record, hour);
  const existingRate = existingWeekend ? b * 0.5 : b;
  const isDiscountHour = inRange(hour, controls.discountStart, controls.discountEnd);

  if (!isDiscountHour) {
    return Math.max(0, existingRate * (1 + controls.nonDiscountAdj / 100));
  }

  let proposedRate;
  if (controls.pricingMode === "fixed") {
    proposedRate = Math.max(0, controls.fixedPrice);
    if (existingWeekend && controls.allowStacking) return proposedRate * 0.5;
    if (existingWeekend && !controls.allowStacking) return Math.min(existingRate, proposedRate);
    return proposedRate;
  }

  proposedRate = b * Math.max(0, 1 - controls.discountPct / 100);
  if (existingWeekend && controls.allowStacking) return b * 0.5 * Math.max(0, 1 - controls.discountPct / 100);
  if (existingWeekend && !controls.allowStacking) return Math.min(existingRate, proposedRate);
  return proposedRate;
}

function blankPeriodStats() {
  return {
    off: { currentKwh: 0, scenarioKwh: 0, currentRevenue: 0, scenarioRevenue: 0 },
    mid: { currentKwh: 0, scenarioKwh: 0, currentRevenue: 0, scenarioRevenue: 0 },
    peak: { currentKwh: 0, scenarioKwh: 0, currentRevenue: 0, scenarioRevenue: 0 }
  };
}

function makeEmptyArray(length, value = 0) {
  return Array.from({ length }, () => value);
}

function computeScenario(controls) {
  const tariffAdjustment = resolveCurrentTariffAdjustment(controls);
  controls = {
    ...controls,
    currentTariffScale: tariffAdjustment.scale,
    currentTariffOriginalAvg: tariffAdjustment.originalAvg,
    currentTariffAdjustedAvg: tariffAdjustment.adjustedAvg,
    currentTariffEffectivePct: tariffAdjustment.effectivePct
  };
  const records = window.EV_USAGE_DATA.records.filter((rec) => controls.filterType === "all" || rec.charge_type === controls.filterType);
  const monthly = Array.from({ length: 12 }, (_, i) => ({ month: i + 1, currentRevenue: 0, scenarioRevenue: 0, currentKwh: 0, scenarioKwh: 0 }));
  const hourly = Array.from({ length: 24 }, (_, h) => ({ hour: h, currentKwh: 0, scenarioKwh: 0, currentRevenue: 0, scenarioRevenue: 0, currentSmpCost: 0, scenarioSmpCost: 0, smpPurchaseImpact: 0 }));
  const period = blankPeriodStats();
  const typeTotals = { slow: { kwh: 0, scenarioKwh: 0, shifted: 0 }, fast: { kwh: 0, scenarioKwh: 0, shifted: 0 } };

  let currentRevenue = 0;
  let noShiftRevenue = 0;
  let scenarioRevenue = 0;
  let currentKwh = 0;
  let scenarioKwh = 0;
  let discountKwh = 0;
  let shiftedKwh = 0;
  let targetWindowCurrentKwh = 0;
  let targetWindowScenarioKwh = 0;
  let peakCurrentKwh = 0;
  let peakScenarioKwh = 0;
  let annualMaxCurrentHourKwh = 0;
  let annualMaxScenarioHourKwh = 0;
  let currentPurchaseCost = 0;
  let scenarioPurchaseCost = 0;
  let purchaseCostIncrease = 0;
  let purchaseCostDecrease = 0;
  let missingSmpHours = 0;
  const participantRateStats = {
    discount: { kwh: 0, revenue: 0, currentRevenue: 0 },
    outside: { kwh: 0, revenue: 0, currentRevenue: 0 }
  };

  for (const rec of records) {
    const tariffKey = getTariffKey(rec, controls);
    const partShare = controls.participation;
    const shiftPct = rec.charge_type === "slow" ? controls.slowShiftPct : controls.fastShiftPct;
    const participant = rec.hours.map((kwh) => kwh * partShare);
    const nonParticipant = rec.hours.map((kwh) => kwh * (1 - partShare));
    const participantAfter = participant.slice();
    const shiftedOut = makeEmptyArray(24);
    const destHours = [];

    for (let h = 0; h < 24; h += 1) {
      if (inRange(h, controls.discountStart, controls.discountEnd)) destHours.push(h);
    }

    let movedTotal = 0;
    if (destHours.length > 0 && shiftPct > 0) {
      for (let h = 0; h < 24; h += 1) {
        const periodKey = billingPeriod(rec, h);
        const isDestination = inRange(h, controls.discountStart, controls.discountEnd);
        if (!isDestination && controls.sourcePeriods.includes(periodKey)) {
          const moved = participant[h] * shiftPct;
          shiftedOut[h] = moved;
          participantAfter[h] -= moved;
          movedTotal += moved;
        }
      }
      if (movedTotal > 0) {
        let weights = destHours.map(() => 1);
        if (controls.distributionMode === "profile") {
          const rawWeights = destHours.map((h) => participant[h]);
          const sumWeights = rawWeights.reduce((a, b) => a + b, 0);
          if (sumWeights > 0) weights = rawWeights;
        }
        const weightSum = weights.reduce((a, b) => a + b, 0);
        destHours.forEach((h, i) => {
          participantAfter[h] += movedTotal * (weights[i] / weightSum);
        });
      }
    }

    const totalAfter = makeEmptyArray(24);
    for (let h = 0; h < 24; h += 1) {
      totalAfter[h] = nonParticipant[h] + participantAfter[h];
    }

    const currentDayTotal = rec.hours.reduce((a, b) => a + b, 0);
    const scenarioDayTotal = totalAfter.reduce((a, b) => a + b, 0);
    annualMaxCurrentHourKwh = Math.max(annualMaxCurrentHourKwh, ...rec.hours);
    annualMaxScenarioHourKwh = Math.max(annualMaxScenarioHourKwh, ...totalAfter);
    typeTotals[rec.charge_type].kwh += currentDayTotal;
    typeTotals[rec.charge_type].scenarioKwh += scenarioDayTotal;
    typeTotals[rec.charge_type].shifted += movedTotal;
    currentKwh += currentDayTotal;
    scenarioKwh += scenarioDayTotal;
    shiftedKwh += movedTotal;

    for (let h = 0; h < 24; h += 1) {
      const kwh = rec.hours[h];
      const cr = currentRate(rec, h, tariffKey, controls);
      const nr = newRate(rec, h, tariffKey, controls);
      const nonKwh = nonParticipant[h];
      const partKwh = participant[h];
      const partAfterKwh = participantAfter[h];
      const afterKwh = totalAfter[h];
      const smp = smpRate(rec.date_key, h);
      if (smp == null) {
        missingSmpHours += 1;
      } else {
        const currentSmpCost = kwh * smp;
        const scenarioSmpCost = afterKwh * smp;
        const smpImpact = (afterKwh - kwh) * smp;
        currentPurchaseCost += currentSmpCost;
        scenarioPurchaseCost += scenarioSmpCost;
        hourly[h].currentSmpCost += currentSmpCost;
        hourly[h].scenarioSmpCost += scenarioSmpCost;
        hourly[h].smpPurchaseImpact += smpImpact;
        if (smpImpact >= 0) purchaseCostIncrease += smpImpact;
        else purchaseCostDecrease += smpImpact;
      }
      const curRev = kwh * cr;
      const noShiftRev = nonKwh * cr + partKwh * nr;
      const scenRev = nonKwh * cr + partAfterKwh * nr;
      const p = billingPeriod(rec, h);
      const m = rec.month - 1;

      currentRevenue += curRev;
      noShiftRevenue += noShiftRev;
      scenarioRevenue += scenRev;

      monthly[m].currentRevenue += curRev;
      monthly[m].scenarioRevenue += scenRev;
      monthly[m].currentKwh += kwh;
      monthly[m].scenarioKwh += afterKwh;

      hourly[h].currentKwh += kwh;
      hourly[h].scenarioKwh += afterKwh;
      hourly[h].currentRevenue += curRev;
      hourly[h].scenarioRevenue += scenRev;

      period[p].currentKwh += kwh;
      period[p].scenarioKwh += afterKwh;
      period[p].currentRevenue += curRev;
      period[p].scenarioRevenue += scenRev;

      if (p === "peak") {
        peakCurrentKwh += kwh;
        peakScenarioKwh += afterKwh;
      }
      if (inRange(h, controls.discountStart, controls.discountEnd)) {
        discountKwh += partAfterKwh;
        targetWindowCurrentKwh += kwh;
        targetWindowScenarioKwh += afterKwh;
        participantRateStats.discount.kwh += partAfterKwh;
        participantRateStats.discount.revenue += partAfterKwh * nr;
        participantRateStats.discount.currentRevenue += partAfterKwh * cr;
      } else {
        participantRateStats.outside.kwh += partAfterKwh;
        participantRateStats.outside.revenue += partAfterKwh * nr;
        participantRateStats.outside.currentRevenue += partAfterKwh * cr;
      }
    }
  }

  const recordCount = records.length;
  const dayCount = controls.filterType === "all" ? Math.max(1, recordCount / 2) : Math.max(1, recordCount);
  hourly.forEach((row) => {
    row.avgCurrentKwh = row.currentKwh / dayCount;
    row.avgScenarioKwh = row.scenarioKwh / dayCount;
    row.annualKwhDelta = row.scenarioKwh - row.currentKwh;
    // 시간대별 SMP는 2025년 실제값을 그대로 고정하고, 사용량 증감분에 직접 곱해 구입비 영향을 산정
    row.smpPurchaseImpact = row.scenarioSmpCost - row.currentSmpCost;
  });

  return {
    controls,
    recordCount,
    dayCount,
    currentRevenue,
    noShiftRevenue,
    scenarioRevenue,
    revenueDelta: scenarioRevenue - currentRevenue,
    priceEffect: noShiftRevenue - currentRevenue,
    shiftEffect: scenarioRevenue - noShiftRevenue,
    currentKwh,
    scenarioKwh,
    discountKwh,
    shiftedKwh,
    targetWindowCurrentKwh,
    targetWindowScenarioKwh,
    targetWindowDelta: targetWindowScenarioKwh - targetWindowCurrentKwh,
    peakCurrentKwh,
    peakScenarioKwh,
    peakDelta: peakScenarioKwh - peakCurrentKwh,
    annualMaxCurrentHourKwh,
    annualMaxScenarioHourKwh,
    currentPurchaseCost,
    scenarioPurchaseCost,
    purchaseCostDelta: scenarioPurchaseCost - currentPurchaseCost,
    purchaseCostIncrease,
    purchaseCostDecrease,
    missingSmpHours,
    monthly,
    hourly,
    period,
    typeTotals,
    participantRateStats
  };
}


function scenarioWithFixedPrice(controls, fixedPrice) {
  return computeScenario({ ...controls, pricingMode: "fixed", fixedPrice: fixedPrice });
}

function findRevenueNeutralFixedPrice(controls) {
  const baseControls = { ...controls, pricingMode: "fixed" };
  const targetRevenue = computeScenario(baseControls).currentRevenue;
  const fixedResult = scenarioWithFixedPrice(baseControls, Number(controls.fixedPrice || 0));

  const finalize = (price, exactResult = null) => {
    const floorPrice = Math.max(0, Math.floor(price * 10) / 10);
    const ceilPrice = Math.ceil(price * 10) / 10;
    const floorResult = scenarioWithFixedPrice(baseControls, floorPrice);
    const ceilResult = Math.abs(ceilPrice - floorPrice) < 0.0000001 ? floorResult : scenarioWithFixedPrice(baseControls, ceilPrice);
    const floorDelta = Math.abs(floorResult.scenarioRevenue - targetRevenue);
    const ceilDelta = Math.abs(ceilResult.scenarioRevenue - targetRevenue);
    const roundedPrice = floorDelta <= ceilDelta ? floorPrice : ceilPrice;
    const roundedResult = floorDelta <= ceilDelta ? floorResult : ceilResult;
    const plusTenthResult = scenarioWithFixedPrice(baseControls, roundedPrice + 0.1);
    return {
      possible: true,
      targetRevenue,
      price,
      floorPrice,
      ceilPrice,
      roundedPrice,
      roundedDelta: roundedResult.scenarioRevenue - targetRevenue,
      tenthWonImpact: plusTenthResult.scenarioRevenue - roundedResult.scenarioRevenue,
      fixedResult,
      exactResult
    };
  };

  // 주말할인 중복 허용 시 고정단가와 매출은 선형관계이므로 두 점만으로 정확히 계산 가능
  if (baseControls.allowStacking || !baseControls.applyWeekendDiscount) {
    const zeroResult = scenarioWithFixedPrice(baseControls, 0);
    const oneResult = scenarioWithFixedPrice(baseControls, 1);
    const slope = oneResult.scenarioRevenue - zeroResult.scenarioRevenue;
    if (!Number.isFinite(slope) || Math.abs(slope) < 0.000001) {
      return {
        possible: false,
        reason: "할인시간대 적용 사용량이 없어 계산할 수 없습니다.",
        targetRevenue,
        price: 0,
        roundedPrice: 0,
        roundedDelta: zeroResult.scenarioRevenue - targetRevenue,
        tenthWonImpact: 0,
        fixedResult
      };
    }
    const price = (targetRevenue - zeroResult.scenarioRevenue) / slope;
    if (price < 0) {
      return {
        possible: false,
        reason: "0원/kWh에서도 현행 매출을 초과합니다.",
        targetRevenue,
        price: 0,
        roundedPrice: 0,
        roundedDelta: zeroResult.scenarioRevenue - targetRevenue,
        tenthWonImpact: scenarioWithFixedPrice(baseControls, 0.1).scenarioRevenue - zeroResult.scenarioRevenue,
        fixedResult
      };
    }
    return finalize(price);
  }

  // 중복 미허용은 기존 주말할인과의 min() 때문에 구간별 선형이므로 이분법 사용
  const f = (price) => scenarioWithFixedPrice(baseControls, price).scenarioRevenue - targetRevenue;
  let lo = 0;
  let hi = 500;
  let flo = f(lo);
  let fhi = f(hi);

  while (fhi < 0 && hi < 5000) {
    hi *= 2;
    fhi = f(hi);
  }

  if (flo > 0) {
    const zeroResult = scenarioWithFixedPrice(baseControls, 0);
    return {
      possible: false,
      reason: "0원/kWh에서도 현행 매출을 초과합니다.",
      targetRevenue,
      price: 0,
      roundedPrice: 0,
      roundedDelta: zeroResult.scenarioRevenue - targetRevenue,
      tenthWonImpact: scenarioWithFixedPrice(baseControls, 0.1).scenarioRevenue - zeroResult.scenarioRevenue,
      fixedResult
    };
  }

  if (fhi < 0) {
    const highResult = scenarioWithFixedPrice(baseControls, hi);
    return {
      possible: false,
      reason: `${number(hi, 0)}원/kWh에서도 매출중립에 도달하지 못합니다.`,
      targetRevenue,
      price: hi,
      roundedPrice: hi,
      roundedDelta: highResult.scenarioRevenue - targetRevenue,
      tenthWonImpact: scenarioWithFixedPrice(baseControls, hi + 0.1).scenarioRevenue - highResult.scenarioRevenue,
      fixedResult
    };
  }

  for (let i = 0; i < 20; i += 1) {
    const mid = (lo + hi) / 2;
    const fm = f(mid);
    if (fm < 0) lo = mid;
    else hi = mid;
  }

  return finalize((lo + hi) / 2);
}

function calculateRevenueNeutralAdjustment(controls) {
  const baseControls = { ...controls, nonDiscountAdj: 0 };
  const baseResult = computeScenario(baseControls);
  const targetRevenue = baseResult.currentRevenue;
  const onePointResult = computeScenario({ ...baseControls, nonDiscountAdj: 1 });
  const revenuePerPctPoint = onePointResult.scenarioRevenue - baseResult.scenarioRevenue;
  const minAdj = -100;

  if (!Number.isFinite(revenuePerPctPoint) || Math.abs(revenuePerPctPoint) < 0.000001) {
    return { possible: false, reason: "비할인시간 적용 사용량이 없어 계산할 수 없습니다." };
  }

  const exactAdj = (targetRevenue - baseResult.scenarioRevenue) / revenuePerPctPoint;
  if (exactAdj < minAdj) {
    const boundedResult = computeScenario({ ...baseControls, nonDiscountAdj: minAdj });
    return {
      possible: false,
      reason: `필요 조정률이 하한 ${number(minAdj, 1)}%보다 낮습니다.`,
      exactAdj,
      roundedAdj: minAdj,
      roundedResult: boundedResult,
      residualDelta: boundedResult.scenarioRevenue - targetRevenue
    };
  }

  const lowerAdj = Math.floor(exactAdj * 10) / 10;
  const upperAdj = Math.ceil(exactAdj * 10) / 10;
  const lowerResult = computeScenario({ ...baseControls, nonDiscountAdj: lowerAdj });
  const upperResult = computeScenario({ ...baseControls, nonDiscountAdj: upperAdj });
  const lowerGap = Math.abs(lowerResult.scenarioRevenue - targetRevenue);
  const upperGap = Math.abs(upperResult.scenarioRevenue - targetRevenue);
  const roundedAdj = lowerGap <= upperGap ? lowerAdj : upperAdj;
  const roundedResult = lowerGap <= upperGap ? lowerResult : upperResult;

  return {
    possible: true,
    exactAdj,
    roundedAdj,
    roundedResult,
    residualDelta: roundedResult.scenarioRevenue - targetRevenue
  };
}

function participantAverageRate(result, windowKey) {
  const stats = result?.participantRateStats?.[windowKey];
  if (!stats || !Number.isFinite(stats.kwh) || stats.kwh <= 0) return null;
  return stats.revenue / stats.kwh;
}

function participantCurrentAverageRate(result, windowKey) {
  const stats = result?.participantRateStats?.[windowKey];
  if (!stats || !Number.isFinite(stats.kwh) || stats.kwh <= 0) return null;
  return stats.currentRevenue / stats.kwh;
}

function tariffRateRange(tariffKey) {
  const table = RATE_TABLES[tariffKey];
  if (!table) return null;
  const values = Object.values(table.season).flatMap((season) => Object.values(season));
  return { min: Math.min(...values), max: Math.max(...values), label: table.label };
}

function selectedTariffRangeText(controls) {
  const items = [];
  const scale = controls.currentTariffScale ?? 1;
  const rangeText = (prefix, range) => {
    const original = `${number(range.min, 1)}~${number(range.max, 1)}원/kWh`;
    if (Math.abs(scale - 1) < 0.0000001) return `${prefix} ${range.label} ${original}`;
    return `${prefix} ${range.label} ${original} → 조정 후 ${number(range.min * scale, 1)}~${number(range.max * scale, 1)}원/kWh`;
  };
  if (controls.filterType === "all" || controls.filterType === "slow") {
    const range = tariffRateRange(controls.slowTariff);
    if (range) items.push(rangeText("완속", range));
  }
  if (controls.filterType === "all" || controls.filterType === "fast") {
    const range = tariffRateRange(controls.fastTariff);
    if (range) items.push(rangeText("급속", range));
  }
  return items.join(" · ");
}

function currentTariffAdjustmentLabel(controls) {
  if (controls.currentTariffAdjMode === "pct") {
    return `현행요금 ${formatSignedPctOne(controls.currentTariffEffectivePct)} 조정`;
  }
  if (controls.currentTariffAdjMode === "avg") {
    return `현행 연평균 ${number(controls.currentTariffAdjustedAvg, 1)}원/kWh 직접 입력`;
  }
  return "현행 요금표 기준";
}

function renderCurrentTariffSummary(result) {
  const c = result.controls;
  const original = c.currentTariffOriginalAvg;
  const adjusted = c.currentTariffAdjustedAvg;
  $("currentTariffSummary").innerHTML = `
    <div><span>원기준 연평균</span><strong>${number(original, 1)}원/kWh</strong></div>
    <div><span>조정 후 연평균</span><strong>${number(adjusted, 1)}원/kWh</strong></div>
    <div><span>환산 조정률</span><strong>${formatSignedPctOne(c.currentTariffEffectivePct)}</strong></div>
    <small>선택한 현행요금과 2025년 실제 사용패턴 기준 · 직접 단가 입력 시 TOU 구조는 비례 유지</small>
  `;
}

function pricingConditionLabel(controls) {
  if (controls.pricingMode === "fixed") return `${number(controls.fixedPrice, 1)}원 고정단가`;
  return `${number(controls.discountPct, 1)}% 할인`;
}

function renderRateComparison(result) {
  const neutral = calculateRevenueNeutralAdjustment(result.controls);
  const baseDiscountRate = participantCurrentAverageRate(result, "discount");
  const baseOutsideRate = participantCurrentAverageRate(result, "outside");
  const currentDiscountRate = participantAverageRate(result, "discount");
  const currentOutsideRate = participantAverageRate(result, "outside");
  const neutralResult = neutral.roundedResult;
  const neutralDiscountRate = neutralResult ? participantAverageRate(neutralResult, "discount") : null;
  const neutralOutsideRate = neutralResult ? participantAverageRate(neutralResult, "outside") : null;
  const rateText = (value) => value == null ? "–" : `${number(value, 1)}원`;
  const condition = pricingConditionLabel(result.controls);
  const tariffRange = selectedTariffRangeText(result.controls);

  const neutralFoot = neutral.possible
    ? `비할인시간 ${formatSignedPctOne(neutral.roundedAdj)} 조정 · 잔여 ${formatSignedWon(neutral.residualDelta)}`
    : neutral.reason;

  $("rateComparison").innerHTML = `
    <div class="rate-compare-header">
      <span>구분</span><span>할인시간대</span><span>할인시간 외</span>
    </div>
    <div class="rate-compare-row baseline">
      <strong>현행요금 환산</strong>
      <b data-label="할인시간대">${rateText(baseDiscountRate)}</b>
      <b data-label="할인시간 외">${rateText(baseOutsideRate)}</b>
      <em>동일한 부하이전 후 참여고객 사용량 기준 · ${currentTariffAdjustmentLabel(result.controls)} · 기존 주말할인 반영</em>
    </div>
    <div class="rate-compare-row">
      <strong>현재 설정안</strong>
      <b data-label="할인시간대">${rateText(currentDiscountRate)}</b>
      <b data-label="할인시간 외">${rateText(currentOutsideRate)}</b>
      <em>${condition} · 비할인시간 ${formatSignedPctOne(result.controls.nonDiscountAdj)} 조정 · 매출증감 ${formatSignedWon(result.revenueDelta)}</em>
    </div>
    <div class="rate-compare-row neutral">
      <strong>매출중립안</strong>
      <b data-label="할인시간대">${rateText(neutralDiscountRate)}</b>
      <b data-label="할인시간 외">${rateText(neutralOutsideRate)}</b>
      <em>${neutralFoot}</em>
    </div>
    <div class="rate-source-note"><strong>선택한 현행 요금표 원단가 범위</strong><span>${tariffRange}</span><small>계절·경부하·중간부하·최대부하별 단가이며 기존 주말 50% 할인 적용 전 기준</small></div>
  `;
}

function renderNeutralSummary(result) {
  const info = findRevenueNeutralFixedPrice(result.controls);
  lastNeutralInfo = info;
  const fixedPrice = Number(result.controls.fixedPrice || 0);
  const fixedDelta = info.fixedResult ? info.fixedResult.revenueDelta : 0;
  const priceLine = info.possible
    ? `근사값 ${number(info.roundedPrice, 1)}원/kWh 적용 시 ${formatSignedWon(info.roundedDelta)}`
    : info.reason;
  const sensitivityLine = `단가 0.1원/kWh 인상 시 ${formatSignedWon(info.tenthWonImpact)} 변동`;
  const modeNote = result.controls.pricingMode === "fixed"
    ? "현재 화면도 고정단가 모드로 계산 중"
    : "현재 화면은 정률할인 모드이며, 아래 단가는 고정단가 대안 기준";

  $("neutralGrid").innerHTML = `
    <article class="neutral-item primary">
      <span>정확 매출중립 할인시간 단가</span>
      <strong>${number(info.price, 2)}원/kWh</strong>
      <em>${priceLine}</em>
    </article>
    <article class="neutral-item">
      <span>0.1원 조정 민감도</span>
      <strong>${formatSignedWon(info.tenthWonImpact)}</strong>
      <em>${sensitivityLine}</em>
    </article>
    <article class="neutral-item">
      <span>현재 고정단가 입력값</span>
      <strong>${number(fixedPrice, 1)}원/kWh</strong>
      <em>고정단가 적용 시 매출증감 ${formatSignedWon(fixedDelta)}</em>
    </article>
    <article class="neutral-item">
      <span>계산 조건</span>
      <strong>${timeRangeText(result.controls.discountStart, result.controls.discountEnd)}</strong>
      <em>${modeNote}</em>
    </article>
  `;
}

function applyRevenueNeutralFixedPrice() {
  const controls = getControls();
  const info = findRevenueNeutralFixedPrice(controls);
  if (!info || !Number.isFinite(info.roundedPrice)) return;
  $("pricingMode").value = "fixed";
  $("fixedPrice").value = Number(info.roundedPrice).toFixed(1);
  syncOutputs();
  updateVisibility();
  update();
}

function update() {
  let controls = getControls();
  if (controls.currentTariffAdjMode !== "avg") {
    const rawAvg = rawCurrentAnnualAverage(controls);
    const previewScale = controls.currentTariffAdjMode === "pct"
      ? Math.max(0, 1 + Number(controls.currentTariffAdjPct || 0) / 100)
      : 1;
    if (Number.isFinite(rawAvg)) $("currentTariffAvgPrice").value = Number(rawAvg * previewScale).toFixed(1);
    controls = getControls();
  }
  lastResult = computeScenario(controls);
  renderCurrentTariffSummary(lastResult);
  renderKpis(lastResult);
  renderSmpPurchaseImpact(lastResult);
  renderRateComparison(lastResult);
  renderNeutralSummary(lastResult);
  renderCharts(lastResult);
  renderTables(lastResult);
}

function scenarioRevenueAtCurrentTariffScale(controls, scale) {
  const boundedScale = Math.max(0, Number(scale || 0));
  const pct = (boundedScale - 1) * 100;
  const scenario = computeScenario({
    ...controls,
    currentTariffAdjMode: "pct",
    currentTariffAdjPct: pct
  });
  return scenario.scenarioRevenue;
}

function findCurrentTariffRevenueRecovery(result) {
  const controls = result.controls;
  const targetRevenue = result.currentRevenue;
  const currentScenarioRevenue = result.scenarioRevenue;
  const currentScale = Number(controls.currentTariffScale || 0);
  const rawAverage = Number(controls.currentTariffOriginalAvg || 0);

  if (!Number.isFinite(targetRevenue) || targetRevenue <= 0 || !Number.isFinite(rawAverage) || rawAverage <= 0) {
    return { possible: false, reason: "기준매출 또는 현행 평균단가가 없어 계산할 수 없습니다." };
  }

  // 정률 할인 모드에서는 신규요금 매출도 현행 요금표 스케일에 정확히 비례함.
  if (controls.pricingMode === "pct") {
    if (!Number.isFinite(currentScenarioRevenue) || currentScenarioRevenue <= 0 || currentScale <= 0) {
      return { possible: false, reason: "신규요금 매출이 0이어서 필요 단가를 계산할 수 없습니다." };
    }
    const requiredScale = currentScale * (targetRevenue / currentScenarioRevenue);
    const requiredAverage = rawAverage * requiredScale;
    const totalPct = (requiredScale - 1) * 100;
    const additionalPct = (requiredScale / currentScale - 1) * 100;
    return {
      possible: true,
      targetRevenue,
      requiredScale,
      requiredAverage,
      totalPct,
      additionalPct,
      recoveredScenarioRevenue: targetRevenue
    };
  }

  // 고정단가 모드는 할인시간대 단가가 현행요금 스케일과 독립적일 수 있어 수치적으로 해를 탐색함.
  const revenueAt = (scale) => scenarioRevenueAtCurrentTariffScale(controls, scale);
  let lo = 0;
  let hi = Math.max(1, currentScale || 1);
  let revHi = revenueAt(hi);
  let guard = 0;
  while (revHi < targetRevenue && guard < 40) {
    hi *= 2;
    revHi = revenueAt(hi);
    guard += 1;
  }
  if (!Number.isFinite(revHi) || revHi < targetRevenue) {
    return { possible: false, reason: "현행요금 인상만으로 기준매출 보전 수준을 찾지 못했습니다." };
  }

  for (let i = 0; i < 42; i += 1) {
    const mid = (lo + hi) / 2;
    const rev = revenueAt(mid);
    if (rev >= targetRevenue) hi = mid;
    else lo = mid;
  }
  const requiredScale = (lo + hi) / 2;
  const requiredAverage = rawAverage * requiredScale;
  const totalPct = (requiredScale - 1) * 100;
  const additionalPct = currentScale > 0 ? (requiredScale / currentScale - 1) * 100 : null;
  return {
    possible: true,
    targetRevenue,
    requiredScale,
    requiredAverage,
    totalPct,
    additionalPct,
    recoveredScenarioRevenue: revenueAt(requiredScale)
  };
}

function renderKpis(result) {
  const deltaClass = result.revenueDelta >= 0 ? "positive" : "negative";
  const revenuePct = result.currentRevenue ? result.revenueDelta / result.currentRevenue * 100 : 0;
  const peakPct = result.peakCurrentKwh ? result.peakDelta / result.peakCurrentKwh * 100 : 0;
  const targetPct = result.targetWindowCurrentKwh ? result.targetWindowDelta / result.targetWindowCurrentKwh * 100 : 0;
  const recovery = findCurrentTariffRevenueRecovery(result);
  const recoveryCard = recovery.possible
    ? {
        label: "기준매출 보전 필요 현행 평균단가",
        value: `${number(recovery.requiredAverage, 1)}원/kWh`,
        sub: `원요금 대비 ${formatSignedPctOne(recovery.totalPct)} · 현재 설정 대비 ${formatSignedPctOne(recovery.additionalPct)} · ${formatWon(recovery.targetRevenue)} 보전`,
        cls: "recovery"
      }
    : {
        label: "기준매출 보전 필요 현행 평균단가",
        value: "계산 불가",
        sub: recovery.reason,
        cls: "recovery"
      };
  const cards = [
    { label: "현행 전력량요금 매출", value: formatWon(result.currentRevenue), sub: `${formatKwh(result.currentKwh)} · 기본요금 제외` },
    { label: "신규요금 적용 후 매출", value: formatWon(result.scenarioRevenue), sub: `${formatKwh(result.scenarioKwh)} · 참여율 ${Math.round(result.controls.participation * 100)}%` },
    recoveryCard,
    { label: "매출 증감", value: `${result.revenueDelta >= 0 ? "+" : ""}${formatWon(result.revenueDelta)}`, sub: `${formatSignedPct(revenuePct)} · 현행 대비`, cls: `delta ${deltaClass}` },
    { label: "할인 적용 사용량", value: formatKwh(result.discountKwh), sub: `${timeRangeText(result.controls.discountStart, result.controls.discountEnd)} 참여고객 기준` },
    { label: "부하 이전량", value: formatKwh(result.shiftedKwh), sub: `완속 ${Math.round(result.controls.slowShiftPct*100)}% · 급속 ${Math.round(result.controls.fastShiftPct*100)}%` },
    { label: "최대부하 시간대 변화", value: `${result.peakDelta >= 0 ? "+" : ""}${formatKwh(result.peakDelta)}`, sub: `${formatSignedPct(peakPct)} · 경부하화 기준 반영`, cls: `delta ${result.peakDelta <= 0 ? "positive" : "negative"}` },
    { label: "할인시간대 부하 변화", value: `${result.targetWindowDelta >= 0 ? "+" : ""}${formatKwh(result.targetWindowDelta)}`, sub: `${formatSignedPct(targetPct)} · ${timeRangeText(result.controls.discountStart, result.controls.discountEnd)}` },
    { label: "연중 최대 시간사용량 변화", value: `${formatKwh(result.annualMaxScenarioHourKwh - result.annualMaxCurrentHourKwh)}`, sub: `현행 ${formatKwh(result.annualMaxCurrentHourKwh)} → 변경 ${formatKwh(result.annualMaxScenarioHourKwh)}` }
  ];
  $("kpiGrid").innerHTML = cards.map(card => `
    <article class="kpi ${card.cls || ""}">
      <div class="label">${card.label}</div>
      <div class="value">${card.value}</div>
      <div class="sub">${card.sub}</div>
    </article>
  `).join("");
}

function renderSmpPurchaseImpact(result) {
  const delta = result.purchaseCostDelta;
  const pct = result.currentPurchaseCost ? delta / result.currentPurchaseCost * 100 : 0;
  const perShiftKwh = result.shiftedKwh ? delta / result.shiftedKwh : 0;
  const deltaClass = delta <= 0 ? "positive" : "negative";
  const missingNote = result.missingSmpHours > 0
    ? ` · SMP 누락 ${number(result.missingSmpHours, 0)}건`
    : "";

  const items = [
    {
      label: "기준안 SMP 기반 구입비",
      value: formatWon(result.currentPurchaseCost),
      sub: `2025 제주 SMP × 기준 시간대별 사용량${missingNote}`
    },
    {
      label: "신규요금 SMP 기반 구입비",
      value: formatWon(result.scenarioPurchaseCost),
      sub: `부하이전 후 사용량 × 동일 시간대 SMP${missingNote}`
    },
    {
      label: "SMP 기반 구입비 영향",
      value: formatSignedWon(delta),
      sub: `${formatSignedPct(pct)} · 사용량 감소시간 절감 ${formatSignedWon(result.purchaseCostDecrease)} · 사용량 증가시간 부담 ${formatSignedWon(result.purchaseCostIncrease)} · 이전 1kWh당 ${formatSignedUnitPrice(perShiftKwh)}`,
      cls: `delta ${deltaClass}`
    }
  ];

  $("smpGrid").innerHTML = items.map((item) => `
    <article class="smp-item ${item.cls || ""}">
      <span>${item.label}</span>
      <strong>${item.value}</strong>
      <em>${item.sub}</em>
    </article>
  `).join("");
}

function renderCharts(result) {
  if (!window.Chart) return;
  const hourLabels = result.hourly.map(row => `${String(row.hour).padStart(2,"0")}:00`);
  const currentHourly = result.hourly.map(row => round(row.avgCurrentKwh, 1));
  const scenarioHourly = result.hourly.map(row => round(row.avgScenarioKwh, 1));
  const monthLabels = result.monthly.map(row => `${row.month}월`);
  const currentMonthly = result.monthly.map(row => round(row.currentRevenue / 100000000, 3));
  const scenarioMonthly = result.monthly.map(row => round(row.scenarioRevenue / 100000000, 3));

  if (!hourlyChart) {
    hourlyChart = new Chart($("hourlyChart"), {
      type: "line",
      data: { labels: hourLabels, datasets: [
        { label: "현행 평균 kWh", data: currentHourly, borderWidth: 2, tension: .25 },
        { label: "신규 평균 kWh", data: scenarioHourly, borderWidth: 2, tension: .25 }
      ]},
      options: chartOptions("평균 kWh")
    });
  } else {
    hourlyChart.data.labels = hourLabels;
    hourlyChart.data.datasets[0].data = currentHourly;
    hourlyChart.data.datasets[1].data = scenarioHourly;
    hourlyChart.update();
  }

  if (!monthlyChart) {
    monthlyChart = new Chart($("monthlyChart"), {
      type: "bar",
      data: { labels: monthLabels, datasets: [
        { label: "현행 매출(억 원)", data: currentMonthly, borderWidth: 1 },
        { label: "신규 매출(억 원)", data: scenarioMonthly, borderWidth: 1 }
      ]},
      options: chartOptions("억 원")
    });
  } else {
    monthlyChart.data.labels = monthLabels;
    monthlyChart.data.datasets[0].data = currentMonthly;
    monthlyChart.data.datasets[1].data = scenarioMonthly;
    monthlyChart.update();
  }
}

function chartOptions(yTitle) {
  return {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { position: "bottom", labels: { boxWidth: 12, boxHeight: 12, padding: 12 } },
      tooltip: { callbacks: { label: ctx => `${ctx.dataset.label}: ${number(ctx.raw)}` } }
    },
    scales: {
      y: { title: { display: true, text: yTitle }, ticks: { callback: value => number(value) } },
      x: { ticks: { maxRotation: 0, autoSkip: true } }
    }
  };
}

function renderTables(result) {
  renderDecompTable(result);
  renderPeriodTable(result);
  renderHourlyTable(result);
}

function renderDecompTable(result) {
  const rows = [
    ["현행 전력량요금 매출", result.currentRevenue, "기준선"],
    ["단가·할인 효과", result.priceEffect, "부하이전 전, 참여고객에 신규요금 적용"],
    ["부하이전 효과", result.shiftEffect, "이전 후 시간대별 사용량 재배분"],
    ["신규요금 적용 후 매출", result.scenarioRevenue, "단가·할인 및 부하이전 반영"],
    ["총 매출 증감", result.revenueDelta, `${formatSignedPct(result.currentRevenue ? result.revenueDelta/result.currentRevenue*100 : 0)}`]
  ];
  $("decompTable").innerHTML = `
    <thead><tr><th>구분</th><th>금액</th><th>비고</th></tr></thead>
    <tbody>${rows.map((r, idx) => `
      <tr><td data-label="구분">${r[0]}</td><td data-label="금액">${idx === 0 || idx === 3 ? formatWon(r[1]) : formatSignedWon(r[1])}</td><td data-label="비고">${r[2]}</td></tr>
    `).join("")}</tbody>`;
}

function renderPeriodTable(result) {
  const rows = Object.keys(PERIOD_LABEL).map(key => {
    const p = result.period[key];
    return [PERIOD_LABEL[key], p.currentKwh, p.scenarioKwh, p.scenarioKwh - p.currentKwh, p.currentRevenue, p.scenarioRevenue, p.scenarioRevenue - p.currentRevenue];
  });
  $("periodTable").innerHTML = `
    <thead><tr><th>시간대</th><th>현행 사용량</th><th>변경 사용량</th><th>사용량 증감</th><th>현행 매출</th><th>변경 매출</th><th>매출 증감</th></tr></thead>
    <tbody>${rows.map(r => `
      <tr><td data-label="시간대">${r[0]}</td><td data-label="현행 사용량">${formatKwh(r[1])}</td><td data-label="변경 사용량">${formatKwh(r[2])}</td><td data-label="사용량 증감">${formatSignedKwh(r[3])}</td><td data-label="현행 매출">${formatWon(r[4])}</td><td data-label="변경 매출">${formatWon(r[5])}</td><td data-label="매출 증감">${formatSignedWon(r[6])}</td></tr>
    `).join("")}</tbody>`;
}

function renderHourlyTable(result) {
  $("hourlyTable").innerHTML = `
    <thead><tr><th>시각</th><th>현행 평균부하</th><th>변경 평균부하</th><th>평균부하 증감</th><th>연간 사용량 증감</th><th>SMP 기반 구입비 영향</th><th>현행 매출</th><th>변경 매출</th><th>매출 증감</th></tr></thead>
    <tbody>${result.hourly.map(row => `
      <tr><td data-label="시각">${String(row.hour).padStart(2,"0")}:00~${String((row.hour+1)%24).padStart(2,"0")}:00</td><td data-label="현행 평균부하">${number(row.avgCurrentKwh)} kWh</td><td data-label="변경 평균부하">${number(row.avgScenarioKwh)} kWh</td><td data-label="평균부하 증감">${formatSignedKwh(row.avgScenarioKwh - row.avgCurrentKwh)}</td><td data-label="연간 사용량 증감">${formatSignedKwh(row.annualKwhDelta)}</td><td data-label="SMP 기반 구입비 영향">${formatSignedWon(row.smpPurchaseImpact)}</td><td data-label="현행 매출">${formatWon(row.currentRevenue)}</td><td data-label="변경 매출">${formatWon(row.scenarioRevenue)}</td><td data-label="매출 증감">${formatSignedWon(row.scenarioRevenue - row.currentRevenue)}</td></tr>
    `).join("")}</tbody>`;
}

function setRevenueNeutralAdjustment() {
  const info = calculateRevenueNeutralAdjustment(getControls());
  if (!info || !Number.isFinite(info.roundedAdj)) {
    alert(info?.reason || "매출중립 조정률을 계산할 수 없습니다.");
    return;
  }

  const config = PAIRED_CONTROLS.find((item) => item.rangeId === "nonDiscountAdj");
  setPairedControlValue(config, info.roundedAdj);
  update();

  if (!info.possible) alert(info.reason);
}

function downloadHourlyCsv() {
  if (!lastResult) return;
  const header = ["hour","current_avg_kwh","scenario_avg_kwh","delta_avg_kwh","annual_delta_kwh","smp_purchase_impact_won","current_revenue_won","scenario_revenue_won","delta_revenue_won"];
  const rows = lastResult.hourly.map(row => [
    `${String(row.hour).padStart(2,"0")}:00`,
    round(row.avgCurrentKwh, 3),
    round(row.avgScenarioKwh, 3),
    round(row.avgScenarioKwh - row.avgCurrentKwh, 3),
    round(row.annualKwhDelta, 3),
    round(row.smpPurchaseImpact, 0),
    round(row.currentRevenue, 0),
    round(row.scenarioRevenue, 0),
    round(row.scenarioRevenue - row.currentRevenue, 0)
  ]);
  const csv = [header, ...rows].map(cols => cols.join(",")).join("\n");
  const blob = new Blob(["\ufeff" + csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "jeju_ev_tariff_hourly_result.csv";
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function formatWon(value) {
  const abs = Math.abs(value);
  if (abs >= 100000000) return `${number(value / 100000000, 1)}억 원`;
  if (abs >= 1000000) return `${number(value / 1000000, 1)}백만 원`;
  return `${number(value, 0)}원`;
}

function formatSignedWon(value) {
  return `${value >= 0 ? "+" : ""}${formatWon(value)}`;
}

function formatUnitPrice(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "–";
  return `${number(n, 1)}원/kWh`;
}

function formatSignedUnitPrice(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "–";
  return `${n >= 0 ? "+" : ""}${number(n, 2)}원/kWh`;
}

function formatKwh(value) {
  const abs = Math.abs(value);
  if (abs >= 1000000) return `${number(value / 1000000, 2)}GWh`;
  if (abs >= 1000) return `${number(value / 1000, 1)}MWh`;
  return `${number(value, 1)}kWh`;
}

function formatSignedKwh(value) {
  return `${value >= 0 ? "+" : ""}${formatKwh(value)}`;
}

function formatSignedPct(value) {
  return `${value >= 0 ? "+" : ""}${number(value, 2)}%`;
}

function formatSignedPctOne(value) {
  const n = Number(value);
  return `${n > 0 ? "+" : ""}${number(n, 1)}%`;
}

function compactNumber(value, maxDigits = 6) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "0";
  return n.toLocaleString("ko-KR", { maximumFractionDigits: maxDigits });
}

function number(value, digits = 0) {
  // 호출부가 요청한 소수 자릿수를 그대로 반영한다(정수 표기는 0자리 유지).
  // 이전에는 Math.min(digits,1)로 강제해 number(x,2)로 요청한 "정확 단가"가
  // 소수 1자리로 절삭됐다.
  return Number(value).toLocaleString("ko-KR", { maximumFractionDigits: digits, minimumFractionDigits: digits });
}

function round(value, digits = 0) {
  const factor = 10 ** digits;
  return Math.round((Number(value) + Number.EPSILON) * factor) / factor;
}

function timeRangeText(start, end) {
  return `${String(start).padStart(2,"0")}:00–${String(end).padStart(2,"0")}:00`;
}

document.addEventListener("DOMContentLoaded", init);
