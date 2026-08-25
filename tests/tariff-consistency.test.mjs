/**
 * 요금표 교차 일치 검사 — 단일 출처(SSOT) 게이트.
 *
 * 배경
 *   제주 TOU 시간대와 EV 충전전력요금 단가가 세 곳에 각각 하드코딩되어 있다.
 *     ① lib/simulator/engine.ts       (탐라 전기예보 · React)
 *     ② public/sim/ev/app.js          (전기차 · 바닐라)
 *     ③ public/sim/hp/index.html      (히트펌프 · 바닐라)
 *   값이 서로 같다는 것을 강제하는 장치가 없어, 단가가 개정될 때 한 곳만 고치면
 *   나머지가 조용히 어긋난다. 골든 테스트는 "결과가 예전과 같은가"만 보므로
 *   세 곳이 함께 틀리거나 한 곳만 바뀐 상태를 구분하지 못한다.
 *
 * 이 검사가 하는 일
 *   아래 OFFICIAL 표를 요금 단가의 단일 출처로 선언하고, 세 구현이 모두
 *   이 표와 일치하는지 확인한다. 요금이 개정되면 OFFICIAL 을 먼저 고치고,
 *   그 다음 세 파일을 맞추면 된다. 한 곳이라도 빠지면 여기서 빨간불이 뜬다.
 *
 * 실행
 *   node --test tests/tariff-consistency.test.mjs
 *
 * 주의
 *   구현 파일에서 값을 "텍스트로" 뽑아낸다. 해당 코드의 표기 방식이 바뀌면
 *   추출이 실패하는데, 그때는 조용히 통과하지 않고 명시적으로 실패한다.
 *   (추출 실패 = 검사 불능 = 실패, 로 취급한다.)
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), "utf8");

/* ────────────────────────────────────────────────────────────────
   단일 출처 — 공식 요금표
   ──────────────────────────────────────────────────────────────── */

const OFFICIAL = {
  /** 시간대 경계(제주, 계절 공통). [경부하 시작, 중간부하 시작, 최대부하 시작, 최대부하 종료] */
  bands: { offFrom: 22, midFrom: 8, peakFrom: 16, peakUntil: 22 },

  /** 봄·가을에 해당하는 월 */
  shoulderMonths: [3, 4, 5, 9, 10],

  /** 주택용 TOU 전력량요금(원/kWh) — [경부하, 중간부하, 최대부하] */
  residential: {
    SHOULDER: [125.8, 153.8, 172.4],
    OTHER: [138.7, 184.7, 220.5], // 여름·겨울 공통
  },

  /** 전기자동차 충전전력요금(원/kWh) — 2026-04-16 시행 */
  ev: {
    LOW: {
      SHOULDER: [85.4, 97.2, 102.1],
      SUMMER: [84.3, 172.0, 259.2],
      WINTER: [107.4, 154.9, 217.5],
    },
    HIGH: {
      SHOULDER: [80.2, 91.0, 94.9],
      SUMMER: [79.2, 137.4, 190.4],
      WINTER: [96.6, 127.7, 165.5],
    },
  },

  /** 전기자동차 기본요금(원/kW) */
  evBasicCharge: { LOW: 2390, HIGH: 2580 },
};

/* ────────────────────────────────────────────────────────────────
   추출 도우미
   ──────────────────────────────────────────────────────────────── */

function must(regex, text, label) {
  const m = regex.exec(text);
  if (!m) {
    throw new Error(
      `[추출 실패] ${label} 을(를) 찾지 못했습니다.\n` +
        `해당 파일의 표기 방식이 바뀌었을 수 있습니다. ` +
        `구현이 옳다면 이 테스트의 추출 규칙을 함께 갱신하세요.`,
    );
  }
  return m;
}

/** 1_000 같은 숫자 구분자를 걷어내고 숫자로 */
const num = (s) => Number(String(s).trim().replace(/_/g, ""));
const numList = (s) => s.split(",").map(num).filter((v) => Number.isFinite(v));

/* ── ① lib/simulator/engine.ts ── */

function fromEngine() {
  const src = read("lib/simulator/engine.ts");

  // EV 전력량요금표
  const table = must(
    /EV_ENERGY_RATE_TABLE\s*=\s*\{([\s\S]*?)\}\s*as const;/,
    src,
    "engine.ts 의 EV_ENERGY_RATE_TABLE",
  )[1];

  const ev = {};
  for (const voltage of ["LOW", "HIGH"]) {
    const block = must(
      new RegExp(`\\b${voltage}\\s*:\\s*\\{([\\s\\S]*?)\\}`),
      table,
      `engine.ts EV_ENERGY_RATE_TABLE.${voltage}`,
    )[1];
    ev[voltage] = {};
    for (const season of ["SHOULDER", "SUMMER", "WINTER"]) {
      const arr = must(
        new RegExp(`\\b${season}\\s*:\\s*\\[([^\\]]+)\\]`),
        block,
        `engine.ts EV_ENERGY_RATE_TABLE.${voltage}.${season}`,
      )[1];
      ev[voltage][season] = numList(arr);
    }
  }

  // EV 기본요금
  const basicBlock = must(
    /EV_BASIC_CHARGE_WON_PER_KW\s*=\s*\{([\s\S]*?)\}\s*as const;/,
    src,
    "engine.ts 의 EV_BASIC_CHARGE_WON_PER_KW",
  )[1];
  const evBasicCharge = {
    LOW: num(must(/\bLOW\s*:\s*([\d_]+)/, basicBlock, "engine.ts EV 저압 기본요금")[1]),
    HIGH: num(must(/\bHIGH\s*:\s*([\d_]+)/, basicBlock, "engine.ts EV 고압 기본요금")[1]),
  };

  // 주택용 TOU + 시간대 폭 — weekdayRates 안의 repeated(단가, 시간수) 나열을 순서대로 읽는다.
  const fn = must(
    /function weekdayRates\([\s\S]*?\n\}/,
    src,
    "engine.ts 의 weekdayRates 함수",
  )[0];
  // 주택용은 단가를 숫자로 직접 적고, EV 분기는 repeated(low, 8) 처럼 변수를 쓴다.
  // 따라서 단가 자리는 숫자와 식별자를 모두 허용하고, EV 쪽은 시간수만 사용한다.
  const pairs = [...fn.matchAll(/repeated\(\s*([\w.]+)\s*,\s*(\d+)\s*\)/g)].map((m) => ({
    rate: Number(m[1]), // 식별자면 NaN — EV 슬롯에서는 쓰지 않는다
    hours: Number(m[2]),
  }));
  if (pairs.length !== 12) {
    throw new Error(
      `[추출 실패] engine.ts weekdayRates 의 repeated(...) 가 12개여야 하는데 ${pairs.length}개입니다.\n` +
        `주택용 봄가을 4 + 주택용 그외 4 + EV 4 를 기대합니다.`,
    );
  }
  const slot = (from) => pairs.slice(from, from + 4);
  const ratesOf = (g) => [g[0].rate, g[1].rate, g[2].rate];
  const hoursOf = (g) => g.map((x) => x.hours);

  return {
    ev,
    evBasicCharge,
    residential: {
      SHOULDER: ratesOf(slot(0)),
      OTHER: ratesOf(slot(4)),
    },
    // 경부하 8h(0~7) · 중간 8h(8~15) · 최대 6h(16~21) · 경부하 2h(22~23)
    residentialHours: hoursOf(slot(0)),
    residentialHoursOther: hoursOf(slot(4)),
    evHours: hoursOf(slot(8)),
  };
}

/* ── ② public/sim/ev/app.js ── */

function fromEvApp() {
  const src = read("public/sim/ev/app.js");

  const ev = {};
  for (const [key, voltage] of [["self_low", "LOW"], ["self_high", "HIGH"]]) {
    const seasons = must(
      new RegExp(`${key}\\s*:\\s*\\{[\\s\\S]*?season\\s*:\\s*\\{([\\s\\S]*?)\\n\\s*\\}`),
      src,
      `app.js 의 RATE_TABLES.${key}.season`,
    )[1];
    ev[voltage] = {};
    for (const [k, season] of [["springfall", "SHOULDER"], ["summer", "SUMMER"], ["winter", "WINTER"]]) {
      const body = must(
        new RegExp(`\\b${k}\\s*:\\s*\\{([^}]*)\\}`),
        seasons,
        `app.js RATE_TABLES.${key}.season.${k}`,
      )[1];
      ev[voltage][season] = ["off", "mid", "peak"].map((field) =>
        Number(must(new RegExp(`\\b${field}\\s*:\\s*([\\d.]+)`), body, `app.js ${key}.${k}.${field}`)[1]),
      );
    }
  }

  // 시간대 경계
  const band = must(
    /function baseJejuPeriod\([\s\S]*?\n\}/,
    src,
    "app.js 의 baseJejuPeriod 함수",
  )[0];
  const off = must(/hour\s*>=\s*(\d+)\s*\|\|\s*hour\s*<\s*(\d+)/, band, "app.js 경부하 시간대")
    .slice(1, 3)
    .map(Number);
  const midEnd = Number(must(/hour\s*<\s*(\d+)\s*\)\s*return\s*"mid"/, band, "app.js 중간부하 종료시각")[1]);

  return { ev, bands: { offFrom: off[0], midFrom: off[1], peakFrom: midEnd } };
}

/* ── ③ public/sim/hp/index.html ── */

function fromHp() {
  const src = read("public/sim/hp/index.html");
  const line = must(/function touRate\([^)]*\)\s*\{.*?\}(?=\s*(?:\n|function))/s, src, "hp 의 touRate 함수")[0];

  const shoulderMonths = numList(
    must(/shoulder\s*=\s*\[([^\]]+)\]/, line, "hp touRate 의 봄·가을 월 목록")[1],
  );
  const arrays = must(
    /\?\s*\[([^\]]+)\]\s*:\s*\[([^\]]+)\]/,
    line,
    "hp touRate 의 계절별 단가 배열",
  );
  const off = must(/h\s*>=\s*(\d+)\s*\|\|\s*h\s*<\s*(\d+)/, line, "hp touRate 경부하 경계")
    .slice(1, 3)
    .map(Number);
  const peakFrom = Number(must(/if\s*\(\s*h\s*<\s*(\d+)\s*\)\s*return\s*r\[1\]/, line, "hp touRate 중간부하 종료시각")[1]);

  return {
    shoulderMonths,
    residential: { SHOULDER: numList(arrays[1]), OTHER: numList(arrays[2]) },
    bands: { offFrom: off[0], midFrom: off[1], peakFrom },
  };
}

/* ────────────────────────────────────────────────────────────────
   검사
   ──────────────────────────────────────────────────────────────── */

const engine = fromEngine();
const evApp = fromEvApp();
const hp = fromHp();

test("engine.ts · EV 충전전력요금이 공식 요금표와 일치", () => {
  assert.deepEqual(engine.ev, OFFICIAL.ev);
  assert.deepEqual(engine.evBasicCharge, OFFICIAL.evBasicCharge);
});

test("ev/app.js · EV 충전전력요금이 공식 요금표와 일치", () => {
  assert.deepEqual(evApp.ev, OFFICIAL.ev);
});

test("engine.ts ↔ ev/app.js · EV 단가가 서로 동일", () => {
  assert.deepEqual(
    evApp.ev,
    engine.ev,
    "두 구현의 EV 단가가 어긋났습니다. 요금 개정 시 한쪽만 고친 것이 아닌지 확인하세요.",
  );
});

test("engine.ts · 주택용 TOU 단가가 공식 요금표와 일치", () => {
  assert.deepEqual(engine.residential, OFFICIAL.residential);
});

test("hp/index.html · 주택용 TOU 단가가 공식 요금표와 일치", () => {
  assert.deepEqual(hp.residential, OFFICIAL.residential);
});

test("engine.ts ↔ hp/index.html · 주택용 TOU 단가가 서로 동일", () => {
  assert.deepEqual(
    hp.residential,
    engine.residential,
    "두 구현의 주택용 TOU 단가가 어긋났습니다.",
  );
});

test("세 구현의 시간대 경계가 모두 동일 (경부하 22–08 · 중간 08–16 · 최대 16–22)", () => {
  const { offFrom, midFrom, peakFrom } = OFFICIAL.bands;

  // engine.ts 는 24칸 배열을 시간수로 표현한다: 8 + 8 + 6 + 2
  const expectedSpans = [midFrom, peakFrom - midFrom, OFFICIAL.bands.peakUntil - peakFrom, 24 - offFrom];
  assert.deepEqual(engine.residentialHours, expectedSpans, "engine.ts 주택용 시간대 폭");
  assert.deepEqual(engine.residentialHoursOther, expectedSpans, "engine.ts 주택용(여름·겨울) 시간대 폭");
  assert.deepEqual(engine.evHours, expectedSpans, "engine.ts EV 시간대 폭");

  assert.deepEqual(evApp.bands, { offFrom, midFrom, peakFrom }, "ev/app.js 시간대 경계");
  assert.deepEqual(hp.bands, { offFrom, midFrom, peakFrom }, "hp/index.html 시간대 경계");
});

test("봄·가을 월 구분이 공식 기준과 일치", () => {
  assert.deepEqual(hp.shoulderMonths, OFFICIAL.shoulderMonths);
});
