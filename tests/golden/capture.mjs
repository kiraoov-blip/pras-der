/**
 * 골든 기준선 생성.
 *
 *   node tests/golden/capture.mjs            # 이관 전 원본에서 캡처 (기본)
 *   node tests/golden/capture.mjs --target   # 이관 후 사본에서 캡처
 *
 * 기준선은 tests/golden/snapshots/<시뮬레이터>.golden.json 으로 저장된다.
 * 계산 로직을 의도적으로 고친 뒤에만 다시 실행할 것.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";
import { SIMULATORS } from "./scenarios.mjs";
import { HERE, runSimulator } from "./runner.mjs";

const which = process.argv.includes("--target") ? "target" : "origin";
const only = process.argv.find((a) => a.startsWith("--sim="))?.split("=")[1];
const outDir = path.join(HERE, "snapshots");
await fs.mkdir(outDir, { recursive: true });

const sims = SIMULATORS.filter((s) => !only || s.name === only);
const browser = await chromium.launch();
let problems = 0;

console.log(`골든 기준선 캡처 — 대상: ${which === "origin" ? "이관 전 원본" : "이관 후 사본"}\n`);

for (const sim of sims) {
  const result = await runSimulator(sim, which, {
    browser,
    onScenario: (_s, scenario, captured) => {
      const flags = [];
      if (captured.missing.length) flags.push(`누락 ${captured.missing.length}`);
      if (captured.pageErrors.length) flags.push(`JS오류 ${captured.pageErrors.length}`);
      if (flags.length) problems += 1;
      console.log(
        `  ${sim.name.padEnd(7)} ${scenario.id.padEnd(16)} ${captured.digest}` +
          (flags.length ? `  ⚠ ${flags.join(", ")}` : ""),
      );
    },
  });
  const file = path.join(outDir, `${sim.name}.golden.json`);
  await fs.writeFile(file, JSON.stringify(result, null, 2) + "\n", "utf8");
  console.log(`  → ${path.relative(process.cwd(), file)}\n`);
}

await browser.close();

if (problems) {
  console.log(`⚠ ${problems}개 시나리오에 누락 영역 또는 JS 오류가 있습니다. 기준선으로 굳히기 전에 확인하세요.`);
  process.exit(1);
}
console.log("완료 — 기준선이 저장되었습니다.");
