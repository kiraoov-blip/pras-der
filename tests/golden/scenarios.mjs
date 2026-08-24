/**
 * 골든 테스트 정의.
 *
 * 목적은 커버리지가 아니라 "옮기기 전과 후의 계산 결과가 같은가"를 증명하는 것이다.
 * 시뮬레이터마다 대표 시나리오 몇 개를 고정하고, 화면에 실제로 렌더된
 * 결과 영역의 텍스트를 그대로 스냅샷으로 남긴다.
 *
 * inputs 값 설정 규칙
 *   - select / number / range : value 대입 후 input·change 이벤트 발생
 *   - checkbox                : boolean
 * click 은 값 설정이 끝난 뒤 순서대로 눌린다.
 */

export const SIMULATORS = [
  {
    name: "hp",
    label: "히트펌프",
    /** 이관 전 원본 저장소 */
    originDir: "../pras_repos/pras-heatpump",
    /** 이관 후 통합 저장소 내 위치 */
    targetDir: "public/sim/hp",
    /** 계산 결과가 렌더되는 영역 */
    outputs: [
      "#summaryTable",
      "#customerTable",
      "#householdEffectTable",
      "#loadBandBillTable",
      "#loadBandUsageTable",
      "#smpCostTable",
      "#touBreakTable",
      "#hourlyChangeTable",
      "#hourlyDeploymentTable",
      "#hourlyDeploymentSummary",
      "#deploymentNote",
    ],
    scenarios: [
      { id: "default", desc: "초기 기본값 (2025년 전체·Cosy 51% 할인)", inputs: {} },
      { id: "winter-hp01", desc: "겨울 · 단일 고객 HP01", inputs: { season: "winter", customer: "HP01" } },
      { id: "shift-on", desc: "부하이전 적용 · 참여율 70%", inputs: { loadShiftMode: "on", participationRate: "70" } },
      { id: "base-tariff-p", desc: "기준 요금제 변경 (p)", inputs: { baseTariff: "p" } },
      { id: "discount-30", desc: "Cosy 할인율 30%", inputs: { discountPct: "30" } },
    ],
  },
  {
    name: "ev",
    label: "전기차 충전",
    originDir: "../pras_repos/pras-ev",
    targetDir: "public/sim/ev",
    outputs: [
      "#kpiGrid",
      "#decompTable",
      "#periodTable",
      "#neutralGrid",
      "#smpGrid",
      "#hourlyTable",
      "#currentTariffSummary",
      "#rateComparison",
    ],
    scenarios: [
      { id: "default", desc: "초기 기본값 (전체·할인 70%·참여 80%)", inputs: {} },
      { id: "slow-only", desc: "완속 충전만", inputs: { filterType: "slow" } },
      { id: "fast-only", desc: "급속 충전만", inputs: { filterType: "fast" } },
      { id: "discount-40", desc: "할인율 40%", inputs: { discountPctNumber: "40" } },
      { id: "no-weekend", desc: "주말 할인 미적용", inputs: { applyWeekendDiscount: false } },
      { id: "fixed-price", desc: "고정단가 방식 80원/kWh", inputs: { pricingMode: "fixed", fixedPrice: "80" } },
    ],
  },
  {
    name: "pv-ess",
    label: "태양광·ESS",
    originDir: "../pras_repos/pras-pv-ess",
    targetDir: "public/sim/pv-ess",
    outputs: [
      "#energyKpis",
      "#energyBalanceCards",
      "#periodSummary",
      "#decomp",
      "#tariffTable",
      "#detailTable",
      "#smpImpactBody",
      "#behaviorSummary",
      "#hourlyChoiceTable",
    ],
    scenarios: [
      { id: "default", desc: "초기 기본값 (PV 3kW·ESS 8kWh)", inputs: {}, click: ["#recalc"] },
      { id: "pv-6kw", desc: "PV 용량 6kW", inputs: { pvCapacityKW: "6" }, click: ["#recalc"] },
      { id: "no-grid-charge", desc: "계통 충전 금지", inputs: { allowGridCharge: false }, click: ["#recalc"] },
      { id: "smp-2023", desc: "SMP 2023년 기준", inputs: { smpYear: "2023" }, click: ["#recalc"] },
      { id: "ess-16kwh", desc: "ESS 16kWh · 출력 5kW", inputs: { essCapacityKWh: "16", essPowerKW: "5" }, click: ["#recalc"] },
    ],
  },
];
