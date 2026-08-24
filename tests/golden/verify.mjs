/**
 * 골든 기준선 대조.
 *
 *   node tests/golden/verify.mjs             # 이관 후 사본을 기준선과 대조 (기본)
 *   node tests/golden/verify.mjs --origin    # 원본을 기준선과 대조 (하네스 자체 점검용)
 *
 * 결과가 하나라도 다르면 무엇이 어떻게 달라졌는지 출력하고 exit 1.
 * CI에서 빌드 앞단 게이트로 쓴다.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";
import { SIMULATORS } from "./scenarios.mjs";
import { HERE, runSimulator } from "./runner.mjs";

const which = process.argv.includes("--origin") ? "origin" : "target";
const only = process.argv.find((a) => a.startsWith("--sim="))?.split("=")[1];
const snapDir = path.join(HERE, "snapshots");

/** 두 정규화 문자열에서 처음 갈라지는 지점을 사람이 읽을 수 있게 뽑는다 */
function firstDivergence(expected, actual) {
  let i = 0;
  while (i < expected.length && i < actual.length && expected[i] === actual[i]) i += 1;
  const from = Math.max(0, i - 45);
  return {
    at: i,
    expected: `…${expected.slice(from, i + 55)}`,
    actual: `…${actual.slice(from, i + 55)}`,
  };
}

const sims = SIMULATORS.filter((s) => !only || s.name === only);
const browser = await chromium.launch();
const failures = [];
let checked = 0;

console.log(`골든 대조 — 대상: ${which === "origin" ? "원본" : "이관 후 사본"}\n`);

for (const sim of sims) {
  const file = path.join(snapDir, `${sim.name}.golden.json`);
  let golden;
  try {
    golden = JSON.parse(await fs.readFile(file, "utf8"));
  } catch {
    failures.push({ sim: sim.name, scenario: "-", kind: "기준선 없음", detail: `${path.relative(process.cwd(), file)} 를 먼저 생성하세요 (npm run golden:capture)` });
    continue;
  }

  const actual = await runSimulator(sim, which, { browser });

  for (const scenario of sim.scenarios) {
    checked += 1;
    const want = golden.scenarios?.[scenario.id];
    const got = actual.scenarios?.[scenario.id];
    if (!want) {
      failures.push({ sim: sim.name, scenario: scenario.id, kind: "기준선에 없는 시나리오", detail: "capture 를 다시 실행하세요" });
      continue;
    }
    if (got.pageErrors.length) {
      failures.push({ sim: sim.name, scenario: scenario.id, kind: "JS 오류", detail: got.pageErrors.slice(0, 2).join(" | ") });
    }
    if (want.digest === got.digest) {
      console.log(`  ✓ ${sim.name.padEnd(7)} ${scenario.id.padEnd(16)} ${got.digest}`);
      continue;
    }
    console.log(`  ✗ ${sim.name.padEnd(7)} ${scenario.id.padEnd(16)} ${want.digest} → ${got.digest}`);
    for (const [sel, wantText] of Object.entries(want.regions)) {
      const gotText = got.regions[sel];
      if (gotText === undefined) {
        failures.push({ sim: sim.name, scenario: scenario.id, kind: `${sel} 영역 사라짐`, detail: "" });
        continue;
      }
      if (gotText === wantText) continue;
      const d = firstDivergence(wantText, gotText);
      failures.push({
        sim: sim.name,
        scenario: scenario.id,
        kind: `${sel} 값 변경 (${d.at}번째 글자부터)`,
        detail: `기준: ${d.expected}\n           현재: ${d.actual}`,
      });
    }
  }
}

await browser.close();

console.log(`\n검사한 시나리오 ${checked}개 · 불일치 ${failures.length}건`);
if (!failures.length) {
  console.log("통과 — 계산 결과가 기준선과 동일합니다.");
  process.exit(0);
}
console.log("\n─ 불일치 상세 ─────────────────────────────────");
for (const f of failures) {
  console.log(`\n[${f.sim} · ${f.scenario}] ${f.kind}`);
  if (f.detail) console.log(`           ${f.detail}`);
}
process.exit(1);
