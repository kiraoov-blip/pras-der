import { chromium } from "playwright";
import crypto from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { serve } from "./serve.mjs";

export const HERE = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(HERE, "../..");

/** 시뮬레이터 루트 디렉터리 — origin(이관 전) 또는 target(이관 후) */
export function dirFor(sim, which) {
  return path.resolve(REPO_ROOT, which === "origin" ? sim.originDir : sim.targetDir);
}

/** 공백을 접어 비교 가능한 형태로 정규화 */
function normalize(text) {
  return text.replace(/\s+/g, " ").trim();
}

async function applyInputs(page, inputs) {
  await page.evaluate((values) => {
    for (const [id, value] of Object.entries(values)) {
      const el = document.getElementById(id);
      if (!el) throw new Error(`입력 컨트롤을 찾을 수 없음: #${id}`);
      if (el.type === "checkbox") {
        if (el.checked === value) continue;
        el.checked = value;
      } else {
        el.value = String(value);
      }
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
    }
  }, inputs);
}

/**
 * 한 시뮬레이터의 모든 시나리오를 돌려 결과 스냅샷을 만든다.
 * 시나리오마다 페이지를 새로 열어 이전 시나리오의 상태가 새지 않게 한다.
 */
export async function runSimulator(sim, which, { browser, onScenario } = {}) {
  const ownBrowser = !browser;
  const b = browser ?? (await chromium.launch());
  const server = await serve(dirFor(sim, which));
  const result = { sim: sim.name, label: sim.label, scenarios: {} };

  try {
    for (const scenario of sim.scenarios) {
      const page = await b.newPage({ viewport: { width: 1480, height: 1000 } });
      const pageErrors = [];
      page.on("pageerror", (e) => pageErrors.push(String(e.message)));

      await page.goto(`${server.url}/index.html`, { waitUntil: "networkidle", timeout: 90000 });
      await page.waitForTimeout(1200);

      if (Object.keys(scenario.inputs ?? {}).length) await applyInputs(page, scenario.inputs);
      for (const selector of scenario.click ?? []) await page.click(selector);
      await page.waitForTimeout(1500);

      const regions = await page.evaluate((selectors) => {
        const out = {};
        for (const sel of selectors) {
          const el = document.querySelector(sel);
          out[sel] = el ? el.textContent ?? "" : "__MISSING__";
        }
        return out;
      }, sim.outputs);

      const captured = {};
      const missing = [];
      for (const [sel, raw] of Object.entries(regions)) {
        if (raw === "__MISSING__") { missing.push(sel); continue; }
        captured[sel] = normalize(raw);
      }

      const digest = crypto
        .createHash("sha256")
        .update(JSON.stringify(captured))
        .digest("hex")
        .slice(0, 16);

      result.scenarios[scenario.id] = { desc: scenario.desc, digest, regions: captured, missing, pageErrors };
      onScenario?.(sim, scenario, result.scenarios[scenario.id]);
      await page.close();
    }
  } finally {
    await server.close();
    if (ownBrowser) await b.close();
  }
  return result;
}
