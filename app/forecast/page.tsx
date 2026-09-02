"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { DEFAULT_CUSTOMER_COUNTS, REFERENCE_MONTHLY_USAGE_KWH } from "@/lib/simulator/defaults";
import { EV_CONTRACT_POWER_THRESHOLD_KW, EV_REPRESENTATIVE_BASIS, findRevenueNeutralDiscount, findTargetBenefitSettings, runSimulation } from "@/lib/simulator/engine";
import { ALL_APPLIANCE_CODES, SELECTABLE_APPLIANCES } from "@/lib/simulator/appliances";
import type { AnalysisDayType, AnalysisSeason, AnalysisYear, ApplianceCode, CustomerTypeCode, EventMode, EvTariffVoltage, LoadShiftMode, RevenueNeutralDiscountResult, SimulationInput } from "@/lib/simulator/types";

type CustomerType = "주택용 TOU" | "전기차 전체" | "전기차 완속(50kW 미만)" | "전기차 급속(50kW 이상)";
type ResultTab = "고객" | "한전" | "계통";

const months = ["1월", "2월", "3월", "4월", "5월", "6월", "7월", "8월", "9월", "10월", "11월", "12월"];
const CUSTOMER_CODES: Record<CustomerType, CustomerTypeCode> = {
  "주택용 TOU": "RESIDENTIAL_TOU",
  "전기차 전체": "EV_TOTAL",
  "전기차 완속(50kW 미만)": "EV_SLOW_LOW_VOLTAGE",
  "전기차 급속(50kW 이상)": "EV_FAST_HIGH_VOLTAGE",
};
const SEASON_LABELS: Record<AnalysisSeason, string> = {
  ALL: "전체 계절",
  SHOULDER: "봄·가을",
  SUMMER: "여름",
  WINTER: "겨울",
};
const DAY_TYPE_LABELS: Record<AnalysisDayType, string> = {
  ALL: "전체 요일",
  WEEKDAY: "주중",
  WEEKEND: "주말",
};
const FULL_APPLIANCE_RATES = Object.fromEntries(
  ALL_APPLIANCE_CODES.map((code) => [code, 1]),
) as Record<ApplianceCode, number>;
const MAX_CHART_WIDTH = 760;

function formatInteger(value: number) {
  return new Intl.NumberFormat("ko-KR", { maximumFractionDigits: 0 }).format(value);
}

function formatOneDecimal(value: number) {
  return new Intl.NumberFormat("ko-KR", { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(value);
}

function formatWon(value: number) {
  return `${value > 0 ? "+" : ""}${formatInteger(value)}원`;
}

function formatMwh(value: number) {
  return `${formatOneDecimal(value)}MWh`;
}

function formatTenThousandWon(value: number) {
  return `${formatInteger(value / 10_000)}만원`;
}

function clampOneDecimalPercent(value: number) {
  return Math.max(0, Math.min(100, Math.round(value * 10) / 10));
}

function FieldLabel({ children, hint }: { children: React.ReactNode; hint?: string }) {
  return <div className="field-label"><span>{children}</span>{hint ? <small>{hint}</small> : null}</div>;
}

function StatusDot({ tone = "blue" }: { tone?: "blue" | "green" | "amber" }) {
  return <span className={`status-dot ${tone}`} aria-hidden="true" />;
}

export default function Home() {
  const [analysisYear, setAnalysisYear] = useState<AnalysisYear>(2025);
  const [seasonFilter, setSeasonFilter] = useState<AnalysisSeason>("ALL");
  const [dayTypeFilter, setDayTypeFilter] = useState<AnalysisDayType>("ALL");
  const [customerType, setCustomerType] = useState<CustomerType>("주택용 TOU");
  const [evTariffVoltage, setEvTariffVoltage] = useState<EvTariffVoltage>("AUTO");
  const [customerCount, setCustomerCount] = useState<number>(DEFAULT_CUSTOMER_COUNTS.RESIDENTIAL_TOU);
  const [discount, setDiscount] = useState(50);
  const [shiftRate, setShiftRate] = useState(50);
  const [scenario, setScenario] = useState<LoadShiftMode>("SCENARIO_1");
  const [selectedAppliances, setSelectedAppliances] = useState<ApplianceCode[]>([...ALL_APPLIANCE_CODES]);
  const [applianceShiftRates, setApplianceShiftRates] = useState<Record<ApplianceCode, number>>({ ...FULL_APPLIANCE_RATES });
  const [weekendPriority, setWeekendPriority] = useState(true);
  const [eventMode, setEventMode] = useState<EventMode>("ACTUAL");
  const [smpThreshold, setSmpThreshold] = useState(0);
  const [startHour, setStartHour] = useState(10);
  const [endHour, setEndHour] = useState(16);
  const [resultTab, setResultTab] = useState<ResultTab>("고객");
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [hoveredHour, setHoveredHour] = useState<number | null>(null);
  const [neutralDiscountResult, setNeutralDiscountResult] = useState<RevenueNeutralDiscountResult | null>(null);
  const [targetPerEvent, setTargetPerEvent] = useState<number | null>(null);
  const [solveDiscount, setSolveDiscount] = useState(true);
  const [solveShift, setSolveShift] = useState(true);
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const [chartWidth, setChartWidth] = useState(MAX_CHART_WIDTH);

  useEffect(() => {
    const container = chartContainerRef.current;
    if (!container) return undefined;
    const updateWidth = () => setChartWidth(Math.max(300, Math.min(MAX_CHART_WIDTH, Math.floor(container.clientWidth))));
    updateWidth();
    const observer = new ResizeObserver(updateWidth);
    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  const customerCode = CUSTOMER_CODES[customerType];
  const monthlyUsage = REFERENCE_MONTHLY_USAGE_KWH[customerCode];
  const contractPowerBasis = customerCode === "EV_TOTAL"
    ? `${EV_CONTRACT_POWER_THRESHOLD_KW}kW 미만·이상 합산`
    : customerCode === "EV_SLOW_LOW_VOLTAGE"
      ? `${EV_CONTRACT_POWER_THRESHOLD_KW}kW 미만`
      : customerCode === "EV_FAST_HIGH_VOLTAGE"
        ? `${EV_CONTRACT_POWER_THRESHOLD_KW}kW 이상`
        : "-";
  const simulationInput = useMemo<SimulationInput>(() => ({
    analysisYear,
    seasonFilter,
    dayTypeFilter,
    customerType: customerCode,
    evTariffVoltage,
    customerCount,
    discountRate: discount / 100,
    shiftRate: shiftRate / 100,
    shiftMode: scenario,
    selectedAppliances,
    applianceShiftRates,
    weekendDiscountPriority: weekendPriority,
    eventRule: {
      mode: eventMode,
      startHour,
      endHour,
      smpThresholdWonPerKwh: smpThreshold,
    },
  }), [analysisYear, seasonFilter, dayTypeFilter, customerCode, evTariffVoltage, customerCount, discount, shiftRate, scenario, selectedAppliances, applianceShiftRates, weekendPriority, eventMode, startHour, endHour, smpThreshold]);
  const result = useMemo(() => runSimulation(simulationInput), [simulationInput]);

  const maxProfile = Math.max(...result.baseLoadProfile, ...result.shiftedLoadProfile) * 1.08;
  const averageEventHours = result.eventDays ? result.eventHours / result.eventDays : 0;
  const yearLabel = analysisYear === 2026 ? "2026 YTD" : `${analysisYear}년`;
  const scopeLabel = `${yearLabel} · ${SEASON_LABELS[seasonFilter]} · ${DAY_TYPE_LABELS[dayTypeFilter]}`;

  // 발령 1회당 편익 = 기준기간 편익 ÷ 발령일수
  const perEventBenefit = result.eventDays
    ? result.customer.annualBenefitPerCustomerWon / result.eventDays
    : 0;

  // 목표 편익 슬라이더 상한: 할인율·수요이전율을 모두 100%로 올렸을 때의 1회당 편익
  const targetSliderMax = useMemo(() => {
    if (!result.eventDays) return 0;
    const ceiling = findTargetBenefitSettings(simulationInput, {
      targetPerEventBenefitWon: Number.POSITIVE_INFINITY,
      solveDiscount: true,
      solveShift: true,
    }).maxReachablePerEventBenefitWon;
    return Math.max(Math.ceil(ceiling / 10) * 10, Math.ceil(perEventBenefit / 10) * 10, 10);
  }, [simulationInput, result.eventDays, perEventBenefit]);

  // 목표값 미입력 시 현재 1회당 편익을 기본값으로 사용(내림해 반올림으로 인한 미달 표시 방지)
  const effectiveTarget = targetPerEvent ?? Math.floor(perEventBenefit);

  const targetSolution = useMemo(() => findTargetBenefitSettings(simulationInput, {
    targetPerEventBenefitWon: effectiveTarget,
    solveDiscount,
    solveShift,
  }), [simulationInput, effectiveTarget, solveDiscount, solveShift]);

  const targetMessage = (() => {
    const s = targetSolution;
    const d = `할인율 ${formatOneDecimal(s.discountRate * 100)}%`;
    const t = `수요이전율 ${formatOneDecimal(s.shiftRate * 100)}%`;
    switch (s.status) {
      case "NO_EVENTS":
        return "선택한 분석범위에 발령일이 없어 1회당 편익을 계산할 수 없습니다.";
      case "NO_VARIABLE":
        return "조절할 변수를 하나 이상 선택하세요.";
      case "ALREADY_MET":
        return `현재 설정(${d}, ${t})으로 목표를 이미 충족합니다.`;
      case "UNREACHABLE":
        return `선택한 변수를 100%까지 올려도 최대 ${formatInteger(s.maxReachablePerEventBenefitWon)}원입니다. 목표 달성을 위해서는 다른 변수도 함께 조절해야 합니다.`;
      default:
        if (solveDiscount && solveShift) return `목표 편익 달성을 위해서는 ${d}, ${t}이 필요합니다.`;
        if (solveDiscount) return `수요이전율 ${formatOneDecimal(shiftRate)}% 고정 시, 목표 편익 달성을 위해서는 ${d}이 필요합니다.`;
        return `할인율 ${formatOneDecimal(discount)}% 고정 시, 목표 편익 달성을 위해서는 ${t}이 필요합니다.`;
    }
  })();

  const applyTargetSolution = () => {
    if (targetSolution.status !== "OK") return;
    if (solveDiscount) setDiscount(Number((targetSolution.discountRate * 100).toFixed(1)));
    if (solveShift) setShiftRate(Number((targetSolution.shiftRate * 100).toFixed(1)));
  };

  // 목표 편익 역산 영역만 기본 상태로 되돌린다.
  // (할인율·수요이전율 50%, 목표는 현재 1회당 편익, 두 변수 모두 조절 허용)
  const resetTargetSolver = () => {
    setDiscount(50);
    setShiftRate(50);
    setTargetPerEvent(null);
    setSolveDiscount(true);
    setSolveShift(true);
    setNeutralDiscountResult(null);
  };
  const compactChart = chartWidth < 520;
  const lineChart = {
    width: chartWidth,
    height: compactChart ? 250 : 280,
    left: compactChart ? 36 : 42,
    right: compactChart ? 10 : 18,
    top: 20,
    bottom: 34,
  };
  const chartPlotWidth = lineChart.width - lineChart.left - lineChart.right;
  const chartPlotHeight = lineChart.height - lineChart.top - lineChart.bottom;
  const chartX = (index: number) => lineChart.left + (index / 23) * chartPlotWidth;
  const chartY = (value: number) => lineChart.top + chartPlotHeight - (value / maxProfile) * chartPlotHeight;
  const linePoints = (values: readonly number[]) => values.map((value, index) => `${chartX(index)},${chartY(value)}`).join(" ");
  const chartHourLabels = compactChart ? [1, 5, 9, 13, 17, 21, 24] : [1, 4, 7, 10, 13, 16, 19, 22, 24];

  const resultCopy: Record<ResultTab, {
    eyebrow: string;
    title: string;
    items: Array<[string, string]>;
  }> = {
    고객: {
      eyebrow: "고객 관점",
      title: "할인과 부하이전으로 발생하는 요금 편익",
      items: [
        ["고객당 기준기간 편익", formatWon(result.customer.annualBenefitPerCustomerWon)],
        ["대상고객 전체 편익", formatTenThousandWon(result.customer.totalAnnualBenefitWon)],
        ["제도 적용 후 고객요금", `${formatInteger(result.customer.newAnnualBillWon)}원`],
      ],
    },
    한전: {
      eyebrow: "한전 관점",
      title: "판매수입 감소와 SMP 구입비 절감을 분리",
      items: [
        ["전력판매수입 변화", formatWon(result.utility.salesRevenueChangeWon)],
        ["SMP 구입비 변화", formatWon(result.utility.smpPurchaseCostChangeWon)],
        ["단기 순재무영향", formatWon(result.utility.shortTermNetImpactWon)],
      ],
    },
    계통: {
      eyebrow: "계통 관점",
      title: "태양광 과잉시간으로 이동한 전력량",
      items: [
        ["기준기간 이전 전력량", formatMwh(result.grid.shiftedEnergyMwh)],
        ["발령시간 증가부하", formatMwh(result.grid.eventWindowLoadIncreaseMwh)],
        ["출력제어 회피 가능량", formatMwh(result.grid.curtailmentReductionMwh)],
      ],
    },
  };
  const activeResult = resultCopy[resultTab];
  const neutralResultIsCurrent = neutralDiscountResult !== null
    && Math.abs(discount / 100 - neutralDiscountResult.discountRate) < 1e-9
    && Math.abs(result.utility.shortTermNetImpactWon - neutralDiscountResult.shortTermNetImpactWon) < 0.5;

  const applyRevenueNeutralDiscount = () => {
    const neutral = findRevenueNeutralDiscount(simulationInput);
    setDiscount(Number((neutral.discountRate * 100).toFixed(1)));
    setNeutralDiscountResult(neutral);
    setResultTab("한전");
  };

  const reset = () => {
    setAnalysisYear(2025); setSeasonFilter("ALL"); setDayTypeFilter("ALL");
    setCustomerType("주택용 TOU"); setCustomerCount(DEFAULT_CUSTOMER_COUNTS.RESIDENTIAL_TOU);
    setEvTariffVoltage("AUTO");
    setDiscount(50); setShiftRate(50); setScenario("SCENARIO_1");
    setSelectedAppliances([...ALL_APPLIANCE_CODES]);
    setApplianceShiftRates({ ...FULL_APPLIANCE_RATES });
    setWeekendPriority(true); setEventMode("ACTUAL"); setSmpThreshold(0);
    setStartHour(10); setEndHour(16);
    setNeutralDiscountResult(null);
    setTargetPerEvent(null); setSolveDiscount(true); setSolveShift(true);
  };

  const changeCustomerType = (value: CustomerType) => {
    setCustomerType(value);
    setCustomerCount(DEFAULT_CUSTOMER_COUNTS[CUSTOMER_CODES[value]]);
    setScenario("SCENARIO_1");
  };

  const toggleAppliance = (code: ApplianceCode) => {
    setSelectedAppliances((current) => current.includes(code)
      ? current.filter((item) => item !== code)
      : [...current, code]);
  };

  const changeApplianceShare = (code: ApplianceCode, sharePercent: number, maximumPercent: number) => {
    const nextRate = maximumPercent > 0 ? Math.max(0, Math.min(1, sharePercent / maximumPercent)) : 0;
    setApplianceShiftRates((current) => ({ ...current, [code]: nextRate }));
  };

  const scenarioOptions: Array<{ mode: LoadShiftMode; title: string; description: string }> = customerType === "주택용 TOU"
    ? [
      { mode: "SCENARIO_1", title: "시나리오 1 · 전체부하 균등이전", description: "가전 보유 여부와 무관하게 최대부하 시간대 전체 부하에서 발령시간 수만큼 균등 이전" },
      { mode: "RES_SCENARIO_2", title: "시나리오 2 · 가전 선택형 이전", description: "체크한 13개 주요 가전의 이전 가능 사용량에만 이전율 적용" },
    ]
    : [
      { mode: "SCENARIO_1", title: "시나리오 1 · 전체부하 균등이전", description: "계약종별 전체 부하에서 발령시간 수만큼 최대부하 시간대 사용량을 균등 이전" },
      { mode: "EV_SCENARIO_2_1" as const, title: "시나리오 2-1 · 발령일 계약종별 충전", description: "발령일에만 충전: 완속은 경부하에서 발령시간만큼, 급속은 최대부하 1시간을 이전" },
      { mode: "EV_SCENARIO_2_2" as const, title: "시나리오 2-2 · 주 2회 대표고객 충전", description: "2-1과 같은 이전 규칙에 주 2회 충전한도 적용: 발령이 난 주는 평일 1일·주말 1일에만 충전 배정" },
    ];

  const routeSource = scenario === "RES_SCENARIO_2"
    ? "선택한 주요 가전"
    : scenario === "EV_SCENARIO_2_1" || scenario === "EV_SCENARIO_2_2"
      ? customerCode === "EV_SLOW_LOW_VOLTAGE"
        ? "완속 경부하 충전구간"
        : customerCode === "EV_FAST_HIGH_VOLTAGE"
          ? "급속 최대부하 1시간"
          : "완속 경부하·급속 최대부하"
        : "최대부하 시간대 전체부하";

  return (
    <main>
      <header className="hero">
        <div className="page-shell hero-grid">
          <div className="hero-title">
            <div>
              <h1>탐라는 전기예보 요금·편익 분석 시뮬레이터(PRAS - TAMRA)</h1>
              <p>Pricing and Revenue Analysis Simulator - 탐라는 전기예보</p>
            </div>
          </div>
        </div>
      </header>

      <div className="page-shell workspace">
        <div className="dashboard-layout">
          <aside className="control-rail" aria-label="분석조건 및 부하이전 시나리오">
        <section className="section-card settings-card">
          <div className="section-heading"><div><p>01 · INPUT</p><h2>분석 조건</h2></div><button className="text-button" onClick={reset}>기본값으로 초기화</button></div>
          <div className="settings-grid">
            <label className="control-field"><FieldLabel>분석연도</FieldLabel><select value={analysisYear} onChange={(event) => setAnalysisYear(Number(event.target.value) as AnalysisYear)}><option value={2024}>2024</option><option value={2025}>2025</option><option value={2026}>2026 YTD</option></select></label>
            <label className="control-field"><FieldLabel hint="미선택 시 전체">계절</FieldLabel><select value={seasonFilter} onChange={(event) => setSeasonFilter(event.target.value as AnalysisSeason)}><option value="ALL">전체 계절</option><option value="SHOULDER">봄·가을</option><option value="SUMMER">여름</option><option value="WINTER">겨울</option></select></label>
            <label className="control-field"><FieldLabel hint="미선택 시 전체">요일</FieldLabel><select value={dayTypeFilter} onChange={(event) => setDayTypeFilter(event.target.value as AnalysisDayType)}><option value="ALL">전체 요일</option><option value="WEEKDAY">주중</option><option value="WEEKEND">주말</option></select></label>
            <label className="control-field"><FieldLabel>고객 유형</FieldLabel><select value={customerType} onChange={(event) => changeCustomerType(event.target.value as CustomerType)}><option>주택용 TOU</option><option>전기차 전체</option><option>전기차 완속(50kW 미만)</option><option>전기차 급속(50kW 이상)</option></select></label>
            <label className="control-field"><FieldLabel hint="호">대상 고객 수</FieldLabel><input className="formatted-number" inputMode="numeric" value={formatInteger(customerCount)} onChange={(event) => {
              const digits = event.target.value.replace(/[^0-9]/g, "");
              setCustomerCount(Math.max(1, Number(digits) || 1));
            }} /></label>
            <label className="control-field"><FieldLabel hint="월">기준 사용량</FieldLabel><div className="unit-input"><input value={formatOneDecimal(monthlyUsage)} readOnly /><span>kWh</span></div></label>
            {customerCode !== "RESIDENTIAL_TOU" ? <label className="control-field"><FieldLabel>계약전력 구분</FieldLabel><div className="unit-input"><input value={contractPowerBasis} readOnly /></div></label> : null}
            {customerCode !== "RESIDENTIAL_TOU" ? <label className="control-field"><FieldLabel hint="충전방식과 별도">공급전압 요금종별</FieldLabel><select value={evTariffVoltage} onChange={(event) => setEvTariffVoltage(event.target.value as EvTariffVoltage)}><option value="AUTO">자동(완속 저압·급속 고압)</option><option value="LOW">저압</option><option value="HIGH">고압</option></select></label> : null}
            <div className="control-field range-field discount-field">
              <FieldLabel hint={`${discount.toFixed(1)}%`}>발령시간 할인율</FieldLabel>
              <div className="discount-action-row">
                <input aria-label="발령시간 할인율" type="range" min="0" max="100" step="0.1" value={discount} onChange={(event) => {
                  setDiscount(Number(event.target.value));
                  setNeutralDiscountResult(null);
                }} />
                <label className="discount-percent-entry">
                  <input aria-label="발령시간 할인율 직접 입력" type="number" min="0" max="100" step="0.1" value={discount} onChange={(event) => {
                    setDiscount(clampOneDecimalPercent(Number(event.target.value) || 0));
                    setNeutralDiscountResult(null);
                  }} />
                  <span>%</span>
                </label>
                <button type="button" className="neutral-rate-button" onClick={applyRevenueNeutralDiscount}>한전 매출중립 할인율 계산</button>
              </div>
              <small className={`neutral-rate-note ${neutralResultIsCurrent ? "calculated" : ""}`} aria-live="polite">
                {neutralResultIsCurrent && neutralDiscountResult
                  ? `${formatOneDecimal(neutralDiscountResult.discountRate * 100)}% 적용 · ${neutralDiscountResult.neutralPointWithinRange ? "잔여 영향" : "0~100% 범위 최접값"} ${formatWon(neutralDiscountResult.shortTermNetImpactWon)}`
                  : "전력판매수입 변화 − SMP 구입비 변화가 0원에 가장 가까운 0.1%p 할인율을 적용합니다."}
              </small>
            </div>
            <div className="control-field weekend-control"><FieldLabel>주말할인 중복처리</FieldLabel><button type="button" className={`toggle-row ${weekendPriority ? "active" : ""}`} onClick={() => setWeekendPriority((value) => !value)} aria-pressed={weekendPriority}><span className="toggle"><i /></span><span>{weekendPriority ? "기존 주말할인 우선" : "전기예보 할인 우선"}</span></button></div>
          </div>
          <button className="advanced-toggle" onClick={() => setAdvancedOpen((value) => !value)} aria-expanded={advancedOpen}><span>고급 발령조건</span><span>{advancedOpen ? "−" : "+"}</span></button>
          {advancedOpen ? <div className="advanced-panel">
            <label className="control-field"><FieldLabel>발령방식</FieldLabel><select value={eventMode} onChange={(event) => setEventMode(event.target.value as EventMode)}><option value="ACTUAL">연도별 실제 발령</option><option value="RULE">SMP 조건 재판정</option></select></label>
            <label className="control-field"><FieldLabel hint="원/kWh">SMP 임계값</FieldLabel><input type="number" max="0" value={smpThreshold} disabled={eventMode === "ACTUAL"} onChange={(event) => setSmpThreshold(Math.min(0, Number(event.target.value) || 0))} /></label>
            <div className="hour-range">
              <label className="control-field"><FieldLabel>시작시간</FieldLabel><input type="number" min="1" max="24" value={startHour} disabled={eventMode === "ACTUAL"} onChange={(event) => setStartHour(Math.max(1, Math.min(endHour, Number(event.target.value) || 1)))} /></label>
              <label className="control-field"><FieldLabel>종료시간</FieldLabel><input type="number" min="1" max="24" value={endHour} disabled={eventMode === "ACTUAL"} onChange={(event) => setEndHour(Math.min(24, Math.max(startHour, Number(event.target.value) || startHour)))} /></label>
            </div>
          </div> : null}
        </section>

        <section className="section-card scenario-card">
          <div className="section-heading"><div><p>02 · SCENARIO</p><h2>부하이전 시나리오</h2></div><span className="scenario-badge">실시간 계산</span></div>
          <div className="scenario-layout">
            <div className="scenario-options">
              {scenarioOptions.map((option) => <button key={option.mode} className={`scenario-option ${scenario === option.mode ? "selected" : ""}`} onClick={() => setScenario(option.mode)}><span className="radio-dot" /><span><strong>{option.title}</strong><small>{option.description}</small></span></button>)}
            </div>
            {scenario !== "RES_SCENARIO_2" ? <div className="shift-control">
              <div className="shift-value"><span>수요이전율</span><strong>{shiftRate.toFixed(1)}<small>%</small></strong></div>
              <div className="shift-slider-row">
                <input type="range" min="0" max="100" step="0.1" value={shiftRate} onChange={(event) => setShiftRate(clampOneDecimalPercent(Number(event.target.value)))} />
                <label className="percent-entry"><input aria-label="수요이전율 직접 입력" type="number" min="0" max="100" step="0.1" value={shiftRate} onChange={(event) => setShiftRate(clampOneDecimalPercent(Number(event.target.value) || 0))} /><span>%</span></label>
              </div>
              <div className="range-marks"><span>0%</span><span>50%</span><span>100%</span></div>
              <p className="shift-definition">이전 가능한 부하를 모두 옮기면 100%, 절반만 옮기면 50%, 반응하지 않으면 0%입니다.</p>
              <div className="route-row"><div><span>이전 출발</span><strong>{routeSource}</strong></div><span className="route-arrow">→</span><div><span>이전 도착</span><strong>발령시간</strong></div></div>
            </div> : <div className="shift-control appliance-summary">
              <div className="shift-value"><span>수요이전율</span><strong>{shiftRate.toFixed(1)}<small>%</small></strong></div>
              <div className="shift-slider-row">
                <input type="range" min="0" max="100" step="0.1" value={shiftRate} onChange={(event) => setShiftRate(clampOneDecimalPercent(Number(event.target.value)))} />
                <label className="percent-entry"><input aria-label="수요이전율 직접 입력" type="number" min="0" max="100" step="0.1" value={shiftRate} onChange={(event) => setShiftRate(clampOneDecimalPercent(Number(event.target.value) || 0))} /><span>%</span></label>
              </div>
              <div className="range-marks"><span>0%</span><span>50%</span><span>100%</span></div>
              <p>선택한 가전의 최대 이전가능량을 기준으로 실제 반응 비율을 적용합니다. 현재 유효 이전비중 합계는 {(result.selectedApplianceShare * 100).toFixed(1)}%입니다.</p>
              <div className="route-row"><div><span>이전 출발</span><strong>선택한 주요 가전</strong></div><span className="route-arrow">→</span><div><span>이전 도착</span><strong>발령시간</strong></div></div>
            </div>}
          </div>
          {(scenario === "EV_SCENARIO_2_1" || scenario === "EV_SCENARIO_2_2") && customerCode !== "RESIDENTIAL_TOU" ? <div className="ev-scenario-basis">
            <div><span>완속 · 50kW 미만</span><strong>{EV_REPRESENTATIVE_BASIS.slow.contractPowerKw}kW × {EV_REPRESENTATIVE_BASIS.slow.chargeHours}시간</strong><small>경부하 충전 · 월 {formatInteger(EV_REPRESENTATIVE_BASIS.slow.monthlyUsageKwh)}kWh</small></div>
            <div><span>급속 · 50kW 이상</span><strong>{EV_REPRESENTATIVE_BASIS.fast.contractPowerKw}kW × {EV_REPRESENTATIVE_BASIS.fast.chargeHours}시간</strong><small>최대부하 충전 · 월 {formatInteger(EV_REPRESENTATIVE_BASIS.fast.monthlyUsageKwh)}kWh</small></div>
            <p>{scenario === "EV_SCENARIO_2_1"
              ? `계약종별 실적 부하곡선을 사용하고 선택된 ${result.eventDays}개 발령일에 충전한 것으로 계산합니다.`
              : `계약종별 실적 부하곡선에 주 2회(평일 1회·주말 1회) 충전한도를 적용해, 선택된 ${result.eventDays}개 발령일 중 ${formatInteger(result.evChargingEventDays)}일을 충전일로 배정합니다.`}</p>
          </div> : null}
          {scenario === "RES_SCENARIO_2" && customerType === "주택용 TOU" ? <div className="appliance-selector">
            <div className="appliance-selector-head">
              <div><p>이전 대상 주요 가전</p><strong>{result.selectedApplianceCount}/{result.selectableApplianceCount}개 선택 · 이전 가능량 {Math.round(result.selectedApplianceShare * 100)}%</strong></div>
              <div><button type="button" onClick={() => setSelectedAppliances([...ALL_APPLIANCE_CODES])}>전체 선택</button><button type="button" onClick={() => setSelectedAppliances([])}>전체 해제</button></div>
            </div>
            <div className="appliance-grid">
              {SELECTABLE_APPLIANCES.map((appliance) => {
                const selected = selectedAppliances.includes(appliance.code);
                const maximumPercent = result.applianceMaximumShares[appliance.code] * 100;
                const configuredPercent = selected ? maximumPercent * applianceShiftRates[appliance.code] : 0;
                const zeroReason = appliance.code === "LIVING_ROOM_AC"
                  ? "분석기간 발령일에 여름철 에어컨 이전대상 부하 없음"
                  : appliance.code === "ROBOT_VACUUM"
                    ? "사용시간이 발령시간 안에 있어 추가 이전량 없음"
                    : "발령시간 밖의 이전대상 부하 없음";
                return <div className={`appliance-item ${selected ? "checked" : ""}`} key={appliance.code}>
                  <label className="appliance-check">
                    <input type="checkbox" checked={selected} onChange={() => toggleAppliance(appliance.code)} />
                    <span><strong>{appliance.label}</strong><small>{appliance.category}</small></span>
                  </label>
                  <div className="appliance-share-control">
                    <div><span>설정 {configuredPercent.toFixed(1)}%</span><small>최대 {maximumPercent.toFixed(1)}%</small></div>
                    <input
                      aria-label={`${appliance.label} 이전비중`}
                      type="range"
                      min="0"
                      max={Math.max(0.1, maximumPercent)}
                      step="0.1"
                      value={configuredPercent}
                      disabled={!selected || maximumPercent === 0}
                      onChange={(event) => changeApplianceShare(appliance.code, Number(event.target.value), maximumPercent)}
                    />
                    {maximumPercent === 0 ? <em>{zeroReason}</em> : null}
                  </div>
                </div>;
              })}
            </div>
            <p className="appliance-note">가전별 최대 비중은 {scopeLabel}의 선택 발령일에서 발령시간 밖에 존재하는 13개 가전의 최대 이전가능량 합계를 100%로 환산한 구성비입니다. 각 가전 설정값에 공통 수요이전율을 곱하며, 수요이전율 0%에서는 모든 가전이 반응하지 않습니다.</p>
          </div> : null}
        </section>
          </aside>

          <div className="results-pane">

        <section className="metric-grid" aria-label="분석 핵심 지표">
          <article className="metric-card accent-blue"><p>발령일수</p><strong>{formatInteger(result.eventDays)}<small>일</small></strong><span>{scopeLabel}</span></article>
          <article className="metric-card"><p>총 발령시간</p><strong>{formatInteger(result.eventHours)}<small>시간</small></strong><span>일평균 {averageEventHours.toFixed(1)}시간</span></article>
          <article className="metric-card"><p>분석대상 고객</p><strong>{formatInteger(result.targetCustomers)}<small>호</small></strong><span>입력한 대상 고객 전체</span></article>
          <article className="metric-card accent-green"><p>부하 이전량</p><strong>{formatOneDecimal(result.grid.shiftedEnergyMwh)}<small>MWh</small></strong><span>에너지 총량 보존</span></article>
          <article className="metric-card"><p>고객당 기준기간 편익</p><strong>{formatInteger(result.customer.annualBenefitPerCustomerWon)}<small>원</small></strong><span>할인 및 부하이전 반영</span></article>
          <article className="metric-card accent-blue"><p>대상고객 전체편익</p><strong>{formatInteger(result.customer.totalAnnualBenefitWon / 10_000)}<small>만원</small></strong><span>대상 고객 전체의 편익 합계</span></article>
          <article className="metric-card accent-green"><p>고객당 1회당 편익</p><strong>{formatInteger(perEventBenefit)}<small>원</small></strong><span>기준기간 편익 ÷ 발령 {formatInteger(result.eventDays)}일</span></article>
          <article className="metric-card"><p>목표 1회당 편익</p><strong>{formatInteger(effectiveTarget)}<small>원</small></strong><span>{effectiveTarget > perEventBenefit ? `현재 대비 +${formatInteger(effectiveTarget - perEventBenefit)}원` : "현재 수준 이하"}</span></article>
        </section>

        <section className="target-solver" aria-label="목표 편익 역산">
          <div className="target-solver-input">
            <div className="target-solver-head">
              <span>목표 1회당 편익</span>
              <label className="percent-entry">
                <input
                  aria-label="목표 1회당 편익 직접 입력"
                  type="number"
                  min={0}
                  max={targetSliderMax}
                  step={10}
                  value={effectiveTarget}
                  onChange={(event) => setTargetPerEvent(Math.max(0, Math.round(Number(event.target.value) || 0)))}
                />
                <span>원</span>
              </label>
            </div>
            <input
              type="range"
              min={0}
              max={targetSliderMax}
              step={10}
              value={Math.min(effectiveTarget, targetSliderMax)}
              onChange={(event) => setTargetPerEvent(Number(event.target.value))}
            />
            <div className="target-solver-vars">
              <span>조절 변수</span>
              <label><input type="checkbox" checked={solveDiscount} onChange={(event) => setSolveDiscount(event.target.checked)} />할인율</label>
              <label><input type="checkbox" checked={solveShift} onChange={(event) => setSolveShift(event.target.checked)} />수요이전율</label>
            </div>
          </div>
          <div className="target-solver-output">
            <p className={`target-message ${targetSolution.status.toLowerCase()}`}>{targetMessage}</p>
            <div className="target-solver-actions">
              <button type="button" onClick={applyTargetSolution} disabled={targetSolution.status !== "OK"}>이 조합 적용</button>
              <button type="button" className="secondary" onClick={resetTargetSolver} title="할인율·수요이전율을 50%로 되돌리고 목표 편익을 현재값으로 초기화합니다">기본값으로 초기화</button>
            </div>
          </div>
        </section>

        <section className="analysis-grid">
          <article className="section-card load-chart-card">
            <div className="section-heading compact"><div><p>03 · LOAD PROFILE</p><h2>시간별 전력사용량 변화</h2></div><div className="legend"><span><i className="legend-base" />현행</span><span><i className="legend-shifted" />부하이전 후</span></div></div>
            <div className="chart-callout"><StatusDot tone="amber" /> {eventMode === "ACTUAL" ? "10–16시" : `${startHour}–${endHour}시`} 전기예보 발령시간</div>
            <div className="load-line-chart" ref={chartContainerRef} onMouseLeave={() => setHoveredHour(null)}>
              <svg viewBox={`0 0 ${lineChart.width} ${lineChart.height}`} role="img" aria-label="24시간 현행 및 부하이전 후 사용량 꺾은선 그래프">
                {[0, 0.25, 0.5, 0.75, 1].map((ratio) => {
                  const y = lineChart.top + chartPlotHeight * (1 - ratio);
                  return <g className="line-grid" key={ratio}><line x1={lineChart.left} x2={lineChart.width - lineChart.right} y1={y} y2={y} /><text x={lineChart.left - 7} y={y + 4}>{formatOneDecimal(maxProfile * ratio)}</text></g>;
                })}
                {(() => {
                  const windowStart = eventMode === "ACTUAL" ? 10 : startHour;
                  const windowEnd = eventMode === "ACTUAL" ? 16 : endHour;
                  const x1 = chartX(Math.max(0, windowStart - 1)) - chartPlotWidth / 46;
                  const x2 = chartX(Math.min(23, windowEnd - 1)) + chartPlotWidth / 46;
                  return <rect className="forecast-band" x={x1} y={lineChart.top} width={x2 - x1} height={chartPlotHeight} />;
                })()}
                <polyline className="profile-line base-line" points={linePoints(result.baseLoadProfile)} />
                <polyline className="profile-line shifted-line" points={linePoints(result.shiftedLoadProfile)} />
                {result.baseLoadProfile.map((value, index) => <g key={index}>
                  <circle className="profile-point base-point" cx={chartX(index)} cy={chartY(value)} r="3" />
                  <circle className="profile-point shifted-point" cx={chartX(index)} cy={chartY(result.shiftedLoadProfile[index])} r="3" />
                  <rect
                    className="point-hitarea"
                    x={chartX(index) - chartPlotWidth / 46}
                    y={lineChart.top}
                    width={chartPlotWidth / 23}
                    height={chartPlotHeight}
                    tabIndex={0}
                    aria-label={`${index + 1}시 현행 ${formatOneDecimal(value)}kWh, 부하이전 후 ${formatOneDecimal(result.shiftedLoadProfile[index])}kWh`}
                    onMouseEnter={() => setHoveredHour(index)}
                    onFocus={() => setHoveredHour(index)}
                    onBlur={() => setHoveredHour(null)}
                  />
                </g>)}
                {chartHourLabels.map((hour) => <text className="hour-label" x={chartX(hour - 1)} y={lineChart.height - 9} key={hour}>{hour}</text>)}
                <text className="axis-unit" x="4" y="12">kWh/호</text>
                {hoveredHour !== null ? (() => {
                  const x = chartX(hoveredHour);
                  const tooltipWidth = compactChart ? 148 : 166;
                  const boxX = Math.max(4, Math.min(lineChart.width - tooltipWidth - 4, x - tooltipWidth / 2));
                  return <g className="chart-tooltip">
                    <line x1={x} x2={x} y1={lineChart.top} y2={lineChart.top + chartPlotHeight} />
                    <rect x={boxX} y="7" width={tooltipWidth} height="58" rx="8" />
                    <text x={boxX + 10} y="25">{hoveredHour + 1}시</text>
                    <text x={boxX + 10} y="42">현행 {formatOneDecimal(result.baseLoadProfile[hoveredHour])} kWh</text>
                    <text x={boxX + 10} y="57">이전 후 {formatOneDecimal(result.shiftedLoadProfile[hoveredHour])} kWh</text>
                  </g>;
                })() : null}
              </svg>
            </div>
            <p className="chart-note">{scopeLabel} 부하곡선입니다. 점에 커서를 올리거나 키보드로 선택하면 시간별 현행·이전 후 사용량을 확인할 수 있으며, 부하이전 전후의 24시간 에너지 총량은 동일합니다.</p>
          </article>

          <article className="section-card result-card">
            <div className="result-tabs" role="tablist" aria-label="분석 관점 선택">{(["고객", "한전", "계통"] as ResultTab[]).map((tab) => <button key={tab} className={resultTab === tab ? "active" : ""} onClick={() => setResultTab(tab)} role="tab" aria-selected={resultTab === tab}>{tab}</button>)}</div>
            <div className="result-intro"><p>{activeResult.eyebrow}</p><h2>{activeResult.title}</h2></div>
            <div className="result-list">{activeResult.items.map(([label, value]) => <div key={label}><span>{label}</span><strong className="calculated">{value}</strong></div>)}</div>
          </article>
        </section>

        {result.warnings.length ? <section className="assumption-strip"><strong>적용 가정</strong><ul>{result.warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul></section> : null}

        <section className="section-card calendar-card">
          <div className="section-heading compact"><div><p>04 · EVENT CALENDAR</p><h2>{scopeLabel} 월별 전기예보 발령현황</h2></div><span className="total-chip">합계 {result.eventDays}일</span></div>
          <div className="month-chart">{result.monthlyEventDays.map((value, index) => <div className="month-column" key={months[index]}><strong>{value || "-"}</strong><div><i style={{ height: `${Math.max(4, (value / Math.max(15, ...result.monthlyEventDays)) * 100)}%` }} className={value === 0 ? "zero" : ""} /></div><span>{months[index]}</span></div>)}</div>
        </section>

        <section className="method-strip"><div><span>1</span><p><strong>발령조건 판정</strong>SMP·시간대 기준</p></div><i>→</i><div><span>2</span><p><strong>할인 적용</strong>중복할인 우선순위</p></div><i>→</i><div><span>3</span><p><strong>부하 재배분</strong>에너지 총량 보존</p></div><i>→</i><div><span>4</span><p><strong>편익 산정</strong>고객·한전·계통</p></div></section>
          </div>
        </div>
      </div>

      <footer><div className="page-shell footer-inner"><span>PRAS · 탐라는 전기예보제</span><p>시간대별 부하·요금·SMP 재계산 엔진 · 출력제어 회피율 85% 가정</p></div></footer>
    </main>
  );
}
