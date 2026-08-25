import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_CUSTOMER_COUNTS, DEFAULT_SIMULATION_INPUT } from "../lib/simulator/defaults.ts";
import {
  EV_BASIC_CHARGE_WON_PER_KW,
  EV_ENERGY_RATE_TABLE,
  EV_REPRESENTATIVE_BASIS,
  EV_REPRESENTATIVE_SESSIONS_PER_WEEK,
  EV_TOTAL_FAST_WEIGHT,
  EV_TOTAL_SLOW_WEIGHT,
  findRevenueNeutralDiscount,
  getEvTariffRates,
  runSimulation,
} from "../lib/simulator/engine.ts";
import { ALL_APPLIANCE_CODES } from "../lib/simulator/appliances.ts";
import { REFERENCE_DATA } from "../lib/simulator/reference-data.generated.ts";
import type { SimulationInput } from "../lib/simulator/types.ts";

function simulate(overrides: Partial<SimulationInput> = {}) {
  return runSimulation({
    ...DEFAULT_SIMULATION_INPUT,
    ...overrides,
    eventRule: { ...DEFAULT_SIMULATION_INPUT.eventRule, ...overrides.eventRule },
  });
}

function sum(values: number[]) {
  return values.reduce((total, value) => total + value, 0);
}

function nearly(actual: number, expected: number, tolerance = 0.001) {
  assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} != ${expected}`);
}

test("2025 실적 발령구간과 SMP 자동판정 시간을 서로 구분한다", () => {
  const actual = simulate();
  const rule = simulate({ eventRule: { ...DEFAULT_SIMULATION_INPUT.eventRule, mode: "RULE" } });
  assert.equal(actual.eventDays, 56);
  assert.equal(actual.eventHours, 195);
  assert.equal(rule.eventDays, 56);
  assert.equal(rule.eventHours, 149);
  assert.equal(sum(actual.monthlyEventDays), 56);
});

test("원자료 시간축은 0시=00:00~01:00 기준으로 정규화되어 있다", () => {
  // 주택용 워크북은 시간축이 한 칸 왼쪽으로 회전된 상태로 저장돼 있어
  // extract-reference-data.py 에서 우측 1칸 회전으로 정규화한다.
  // 회전이 빠지면 발령시간대가 10:00~16:00 대신 09:00~15:00으로 계산된다.
  const event = REFERENCE_DATA.events["2025"].find((item) => item.date === "2025-12-11");
  assert.ok(event);
  assert.deepEqual([...event.actualHours], [12, 13, 14]);
  assert.equal(event.smp[0], 105.14);
  assert.equal(event.smp[12], 0);
  assert.equal(event.smp[13], 0);

  const hours = Object.values(REFERENCE_DATA.events).flat().flatMap((item) => item.actualHours);
  assert.equal(Math.min(...hours), 10);
  assert.equal(Math.max(...hours), 15);
});

test("고객유형별 초기 대상 고객 수를 적용한다", () => {
  assert.equal(DEFAULT_CUSTOMER_COUNTS.RESIDENTIAL_TOU, 1_200);
  assert.equal(DEFAULT_CUSTOMER_COUNTS.EV_TOTAL, 18_327);
  assert.equal(DEFAULT_CUSTOMER_COUNTS.EV_SLOW_LOW_VOLTAGE, 18_327);
  assert.equal(DEFAULT_CUSTOMER_COUNTS.EV_FAST_HIGH_VOLTAGE, 18_327);
});

test("계절·요일 전체 선택은 연간 결과를 유지하고 세부 선택은 해당 발령일만 필터링한다", () => {
  const all = simulate({ seasonFilter: "ALL", dayTypeFilter: "ALL" });
  const shoulder = simulate({ seasonFilter: "SHOULDER", dayTypeFilter: "ALL" });
  const winter = simulate({ seasonFilter: "WINTER", dayTypeFilter: "ALL" });
  const summer = simulate({ seasonFilter: "SUMMER", dayTypeFilter: "ALL" });
  const weekday = simulate({ seasonFilter: "ALL", dayTypeFilter: "WEEKDAY" });
  const weekend = simulate({ seasonFilter: "ALL", dayTypeFilter: "WEEKEND" });

  assert.equal(all.eventDays, 56);
  assert.equal(shoulder.eventDays + winter.eventDays + summer.eventDays, all.eventDays);
  assert.equal(shoulder.eventHours + winter.eventHours + summer.eventHours, all.eventHours);
  assert.equal(weekday.eventDays + weekend.eventDays, all.eventDays);
  assert.equal(weekday.eventHours + weekend.eventHours, all.eventHours);
  assert.equal(summer.eventDays, 0);
  assert.equal(summer.customer.annualBenefitPerCustomerWon, 0);
  assert.notDeepEqual(shoulder.baseLoadProfile, winter.baseLoadProfile);
});

test("할인만 적용한 기준점과 기본요금 제외 전력량요금을 재현한다", () => {
  const scenarioOne = simulate({ shiftMode: "SCENARIO_1", shiftRate: 0 });
  const scenarioTwo = simulate({ shiftMode: "RES_SCENARIO_2", shiftRate: 0 });
  nearly(scenarioOne.customer.annualBenefitPerCustomerWon, 10_113.991012003851);
  nearly(scenarioTwo.customer.annualBenefitPerCustomerWon, scenarioOne.customer.annualBenefitPerCustomerWon);
  nearly(scenarioOne.customer.currentAnnualBillWon, 1_127_265.02449335);
  assert.equal(scenarioOne.grid.shiftedEnergyMwh, 0);
  assert.equal(scenarioOne.utility.smpPurchaseCostChangeWon, 0);
});

test("2026년 전기자동차 저압·고압 요금표와 제주 시간대를 정확히 적용한다", () => {
  assert.deepEqual(EV_BASIC_CHARGE_WON_PER_KW, { LOW: 2_390, HIGH: 2_580 });
  assert.deepEqual(EV_ENERGY_RATE_TABLE.LOW.SUMMER, [84.3, 172.0, 259.2]);
  assert.deepEqual(EV_ENERGY_RATE_TABLE.LOW.SHOULDER, [85.4, 97.2, 102.1]);
  assert.deepEqual(EV_ENERGY_RATE_TABLE.LOW.WINTER, [107.4, 154.9, 217.5]);
  assert.deepEqual(EV_ENERGY_RATE_TABLE.HIGH.SUMMER, [79.2, 137.4, 190.4]);
  assert.deepEqual(EV_ENERGY_RATE_TABLE.HIGH.SHOULDER, [80.2, 91.0, 94.9]);
  assert.deepEqual(EV_ENERGY_RATE_TABLE.HIGH.WINTER, [96.6, 127.7, 165.5]);

  const weekday = getEvTariffRates("LOW", "SUMMER", "WEEKDAY");
  assert.deepEqual(weekday.slice(0, 8), Array(8).fill(84.3));
  assert.deepEqual(weekday.slice(8, 16), Array(8).fill(172.0));
  assert.deepEqual(weekday.slice(16, 22), Array(6).fill(259.2));
  assert.deepEqual(weekday.slice(22), Array(2).fill(84.3));

  const saturday = getEvTariffRates("HIGH", "WINTER", "SATURDAY");
  assert.equal(saturday[16], 127.7);
  const holiday = getEvTariffRates("HIGH", "WINTER", "HOLIDAY");
  assert.deepEqual(holiday, Array(24).fill(96.6));
  const shoulderSunday = getEvTariffRates("LOW", "SHOULDER", "HOLIDAY");
  assert.deepEqual(shoulderSunday.slice(11, 14), Array(3).fill(85.4 * 0.5));
});

test("충전방식과 공급전압 요금종별을 분리한다", () => {
  const slowLow = simulate({ customerType: "EV_SLOW_LOW_VOLTAGE", evTariffVoltage: "LOW" });
  const slowHigh = simulate({ customerType: "EV_SLOW_LOW_VOLTAGE", evTariffVoltage: "HIGH" });
  const fastLow = simulate({ customerType: "EV_FAST_HIGH_VOLTAGE", evTariffVoltage: "LOW" });
  const fastHigh = simulate({ customerType: "EV_FAST_HIGH_VOLTAGE", evTariffVoltage: "HIGH" });
  assert.notEqual(slowLow.customer.currentAnnualBillWon, slowHigh.customer.currentAnnualBillWon);
  assert.notEqual(fastLow.customer.currentAnnualBillWon, fastHigh.customer.currentAnnualBillWon);
  assert.ok(slowLow.customer.currentAnnualBillWon > slowHigh.customer.currentAnnualBillWon);
  assert.ok(fastLow.customer.currentAnnualBillWon > fastHigh.customer.currentAnnualBillWon);
});

test("임시공휴일 제외와 2026 법정공휴일 요금분류를 반영한다", () => {
  const eventByDate = new Map(
    Object.values(REFERENCE_DATA.events).flat().map((event) => [event.date, event]),
  );
  assert.equal(eventByDate.get("2025-01-27")?.dayType, "WEEKDAY");
  assert.equal(eventByDate.get("2026-02-17")?.dayType, "HOLIDAY");
  assert.equal(eventByDate.get("2026-02-18")?.dayType, "HOLIDAY");
  assert.equal(eventByDate.get("2026-05-05")?.dayType, "HOLIDAY");
});

test("대상 고객 수는 줄이지 않고 수요이전율만 이전 가능한 부하에 적용한다", () => {
  const noResponse = simulate({ customerCount: 1_200, shiftMode: "SCENARIO_1", shiftRate: 0 });
  const halfResponse = simulate({ customerCount: 1_200, shiftMode: "SCENARIO_1", shiftRate: 0.5 });
  const fullResponse = simulate({ customerCount: 1_200, shiftMode: "SCENARIO_1", shiftRate: 1 });

  assert.equal(noResponse.targetCustomers, 1_200);
  assert.equal(halfResponse.targetCustomers, 1_200);
  assert.equal(fullResponse.targetCustomers, 1_200);
  nearly(noResponse.customer.totalAnnualBenefitWon, noResponse.customer.annualBenefitPerCustomerWon * 1_200);
  nearly(halfResponse.grid.shiftedEnergyMwh * 2, fullResponse.grid.shiftedEnergyMwh, 1e-9);
  assert.equal(noResponse.grid.shiftedEnergyMwh, 0);
  assert.ok(noResponse.customer.annualBenefitPerCustomerWon > 0, "수요이전율 0%에서도 발령시간대 전체 사용량 할인은 유지되어야 함");
});

test("시나리오 1은 1% 입력에 연속 반응하고 최대부하 여섯 시간 이내에서 에너지를 보존한다", () => {
  const at10 = simulate({ shiftMode: "SCENARIO_1", shiftRate: 0.1 });
  const at11 = simulate({ shiftMode: "SCENARIO_1", shiftRate: 0.11 });
  const at100 = simulate({ shiftMode: "SCENARIO_1", shiftRate: 1 });
  assert.ok(at11.customer.annualBenefitPerCustomerWon > at10.customer.annualBenefitPerCustomerWon);
  assert.ok(at11.grid.shiftedEnergyMwh > at10.grid.shiftedEnergyMwh);
  assert.ok(at100.shiftedLoadProfile.every((value) => value >= -1e-12));
  nearly(sum(at100.baseLoadProfile), sum(at100.shiftedLoadProfile), 1e-9);
});

test("주택용 13개 가전 선택은 실제 이동경로를 바꾸며 선택하지 않으면 이전하지 않는다", () => {
  const allSelected = simulate({ shiftMode: "RES_SCENARIO_2", selectedAppliances: [...ALL_APPLIANCE_CODES] });
  const noneSelected = simulate({ shiftMode: "RES_SCENARIO_2", selectedAppliances: [] });
  const noShift = simulate({ shiftMode: "RES_SCENARIO_2", shiftRate: 0 });
  assert.ok(allSelected.grid.shiftedEnergyMwh > 0);
  assert.equal(noneSelected.grid.shiftedEnergyMwh, 0);
  nearly(noneSelected.customer.annualBenefitPerCustomerWon, noShift.customer.annualBenefitPerCustomerWon);

  const withoutHeatPump = simulate({
    shiftMode: "RES_SCENARIO_2",
    selectedAppliances: ALL_APPLIANCE_CODES.filter((code) => code !== "HEAT_PUMP_HEATING"),
  });
  assert.ok(withoutHeatPump.grid.shiftedEnergyMwh < allSelected.grid.shiftedEnergyMwh);
  nearly(sum(allSelected.baseLoadProfile), sum(allSelected.shiftedLoadProfile), 1e-9);
  assert.ok(allSelected.shiftedLoadProfile.every((value) => value >= -1e-12));
});

test("가전별 이전비중은 최대치에서 0까지 독립적으로 조절되고 즉시 결과에 반영된다", () => {
  const fullRates = Object.fromEntries(ALL_APPLIANCE_CODES.map((code) => [code, 1]));
  const zeroRates = Object.fromEntries(ALL_APPLIANCE_CODES.map((code) => [code, 0]));
  const maximum = simulate({
    shiftMode: "RES_SCENARIO_2",
    shiftRate: 1,
    selectedAppliances: [...ALL_APPLIANCE_CODES],
    applianceShiftRates: fullRates,
  });
  const none = simulate({
    shiftMode: "RES_SCENARIO_2",
    shiftRate: 1,
    selectedAppliances: [...ALL_APPLIANCE_CODES],
    applianceShiftRates: zeroRates,
  });
  nearly(Object.values(maximum.applianceMaximumShares).reduce((sum, value) => sum + value, 0), 1, 1e-9);
  nearly(maximum.selectedApplianceShare, 1, 1e-9);
  assert.equal(none.grid.shiftedEnergyMwh, 0);
  assert.ok(maximum.grid.shiftedEnergyMwh > none.grid.shiftedEnergyMwh);
  assert.equal(maximum.applianceMaximumShares.LIVING_ROOM_AC, 0);
  assert.ok(maximum.applianceMaximumShares.ROBOT_VACUUM > 0);

  const halfResponse = simulate({
    shiftMode: "RES_SCENARIO_2",
    shiftRate: 0.5,
    selectedAppliances: [...ALL_APPLIANCE_CODES],
    applianceShiftRates: fullRates,
  });
  nearly(halfResponse.grid.shiftedEnergyMwh * 2, maximum.grid.shiftedEnergyMwh, 1e-9);
});

test("EV 2-1과 2-2는 완속·급속을 모두 계산하고 충전빈도를 구분한다", () => {
  const slow21 = simulate({ customerType: "EV_SLOW_LOW_VOLTAGE", shiftMode: "EV_SCENARIO_2_1" });
  const slow22 = simulate({ customerType: "EV_SLOW_LOW_VOLTAGE", shiftMode: "EV_SCENARIO_2_2" });
  const fast21 = simulate({ customerType: "EV_FAST_HIGH_VOLTAGE", shiftMode: "EV_SCENARIO_2_1" });
  const fast22 = simulate({ customerType: "EV_FAST_HIGH_VOLTAGE", shiftMode: "EV_SCENARIO_2_2" });
  assert.ok(slow21.grid.shiftedEnergyMwh > 0);
  assert.ok(slow22.grid.shiftedEnergyMwh > 0);
  assert.ok(fast21.grid.shiftedEnergyMwh > 0);
  assert.ok(fast22.grid.shiftedEnergyMwh > 0);
  assert.equal(slow21.evChargingEventDays, slow21.eventDays);
  assert.equal(slow22.evChargingEventDays, 39);
  assert.equal(fast22.evChargingEventDays, slow22.evChargingEventDays);
  nearly(sum(slow21.baseLoadProfile), sum(slow21.shiftedLoadProfile), 1e-9);
  nearly(sum(fast21.baseLoadProfile), sum(fast21.shiftedLoadProfile), 1e-9);
  nearly(sum(slow22.baseLoadProfile), sum(slow22.shiftedLoadProfile), 1e-9);
  nearly(sum(fast22.baseLoadProfile), sum(fast22.shiftedLoadProfile), 1e-9);
});

test("EV 2-2는 2-1과 같은 부하곡선을 쓰고 주 2회 충전한도만 추가로 적용한다", () => {
  const slow = simulate({ customerType: "EV_SLOW_LOW_VOLTAGE", shiftMode: "EV_SCENARIO_2_2", shiftRate: 1 });
  const fast = simulate({ customerType: "EV_FAST_HIGH_VOLTAGE", shiftMode: "EV_SCENARIO_2_2", shiftRate: 1 });
  const slow21 = simulate({ customerType: "EV_SLOW_LOW_VOLTAGE", shiftMode: "EV_SCENARIO_2_1", shiftRate: 1 });

  // 대표고객 월 사용량 336kWh(완속 8회) · 400kWh(급속 8회)와 1회 충전량이 일치한다.
  nearly(sum(slow.baseLoadProfile), EV_REPRESENTATIVE_BASIS.slow.monthlyUsageKwh / EV_REPRESENTATIVE_BASIS.slow.sessionsPerMonth, 1e-6);
  nearly(sum(fast.baseLoadProfile), EV_REPRESENTATIVE_BASIS.fast.monthlyUsageKwh / EV_REPRESENTATIVE_BASIS.fast.sessionsPerMonth, 1e-6);
  assert.deepEqual(slow.baseLoadProfile, slow21.baseLoadProfile);
  assert.ok(slow.customer.annualBenefitPerCustomerWon < slow21.customer.annualBenefitPerCustomerWon);

  // 주(월~일)마다 최대 2일까지만 충전일로 배정한다.
  const weekday = simulate({
    customerType: "EV_SLOW_LOW_VOLTAGE",
    shiftMode: "EV_SCENARIO_2_2",
    dayTypeFilter: "WEEKDAY",
  });
  const weekend = simulate({
    customerType: "EV_SLOW_LOW_VOLTAGE",
    shiftMode: "EV_SCENARIO_2_2",
    dayTypeFilter: "WEEKEND",
  });
  assert.equal(weekday.evChargingEventDays + weekend.evChargingEventDays, slow.evChargingEventDays);
  assert.ok(slow.evChargingEventDays < slow.eventDays);

  const weeks = new Set(
    REFERENCE_DATA.events["2025"].map((event) => {
      const time = Date.parse(`${event.date}T00:00:00Z`);
      const monday = time - ((new Date(time).getUTCDay() + 6) % 7) * 24 * 60 * 60 * 1_000;
      return new Date(monday).toISOString().slice(0, 10);
    }),
  );
  assert.ok(slow.evChargingEventDays <= weeks.size * EV_REPRESENTATIVE_SESSIONS_PER_WEEK);
});

test("EV 전체는 완속·급속 실적 비중을 합산한다", () => {
  const total = simulate({ customerType: "EV_TOTAL", shiftMode: "SCENARIO_1" });
  const slow = simulate({ customerType: "EV_SLOW_LOW_VOLTAGE", shiftMode: "SCENARIO_1" });
  const fast = simulate({ customerType: "EV_FAST_HIGH_VOLTAGE", shiftMode: "SCENARIO_1" });
  nearly(
    total.customer.annualBenefitPerCustomerWon,
    slow.customer.annualBenefitPerCustomerWon * EV_TOTAL_SLOW_WEIGHT
      + fast.customer.annualBenefitPerCustomerWon * EV_TOTAL_FAST_WEIGHT,
  );

  const total21 = simulate({ customerType: "EV_TOTAL", shiftMode: "EV_SCENARIO_2_1" });
  const total22 = simulate({ customerType: "EV_TOTAL", shiftMode: "EV_SCENARIO_2_2" });
  assert.ok(total21.grid.shiftedEnergyMwh > 0);
  assert.ok(total22.grid.shiftedEnergyMwh > 0);
  assert.notEqual(total21.grid.shiftedEnergyMwh, total22.grid.shiftedEnergyMwh);
});

test("기존 EV 주말할인을 우선하면 중복할인 방식보다 편익이 작다", () => {
  const priority = simulate({
    customerType: "EV_SLOW_LOW_VOLTAGE",
    shiftMode: "EV_SCENARIO_2_2",
    weekendDiscountPriority: true,
  });
  const stacked = simulate({
    customerType: "EV_SLOW_LOW_VOLTAGE",
    shiftMode: "EV_SCENARIO_2_2",
    weekendDiscountPriority: false,
  });
  assert.ok(priority.customer.annualBenefitPerCustomerWon < stacked.customer.annualBenefitPerCustomerWon);
});

test("SMP 구입비 변화는 고정단가가 아니라 시간별 부하차와 SMP의 내적으로 계산한다", () => {
  const noShift = simulate({ shiftMode: "SCENARIO_1", shiftRate: 0 });
  const shifted = simulate({ shiftMode: "SCENARIO_1", shiftRate: 0.5 });
  assert.equal(noShift.utility.smpPurchaseCostChangeWon, 0);
  assert.ok(shifted.utility.smpPurchaseCostChangeWon < 0);
  assert.notEqual(
    shifted.utility.smpPurchaseCostChangeWon,
    -(shifted.grid.shiftedEnergyMwh * 1_000 * 130),
  );
});

test("SMP 임계값을 낮추면 음수 SMP 시간만 남아 발령범위가 축소된다", () => {
  const atZero = simulate({ eventRule: { ...DEFAULT_SIMULATION_INPUT.eventRule, mode: "RULE", smpThresholdWonPerKwh: 0 } });
  const belowZero = simulate({ eventRule: { ...DEFAULT_SIMULATION_INPUT.eventRule, mode: "RULE", smpThresholdWonPerKwh: -1 } });
  assert.ok(belowZero.eventDays > 0);
  assert.ok(belowZero.eventDays < atZero.eventDays);
  assert.ok(belowZero.eventHours < atZero.eventHours);
});

test("연도별 원자료와 2026 YTD 청구기간을 적용한다", () => {
  const y2024 = simulate({ analysisYear: 2024 });
  const y2026 = simulate({ analysisYear: 2026 });
  assert.equal(y2024.eventDays, 18);
  assert.equal(y2024.eventHours, 68);
  assert.equal(y2026.eventDays, 39);
  assert.equal(y2026.eventHours, 100);
  assert.ok(y2026.customer.currentAnnualBillWon < y2024.customer.currentAnnualBillWon);
});

test("한전 매출중립 할인율은 0.1%p 단위에서 단기 순재무영향을 최소화한다", () => {
  const input = {
    ...DEFAULT_SIMULATION_INPUT,
    shiftRate: 0.5,
  };
  const neutral = findRevenueNeutralDiscount(input);
  const rateStep = neutral.discountRate * 1_000;
  nearly(rateStep, Math.round(rateStep), 1e-9);
  assert.ok(neutral.neutralPointWithinRange);

  const selectedImpact = Math.abs(runSimulation({
    ...input,
    discountRate: neutral.discountRate,
  }).utility.shortTermNetImpactWon);
  const adjacentRates = [
    Math.max(0, neutral.discountRate - 0.001),
    Math.min(1, neutral.discountRate + 0.001),
  ];
  adjacentRates.forEach((discountRate) => {
    const adjacentImpact = Math.abs(runSimulation({ ...input, discountRate }).utility.shortTermNetImpactWon);
    assert.ok(selectedImpact <= adjacentImpact + 1e-6);
  });
});

test("부하이전과 할인이 모두 없으면 0.0%가 정확한 매출중립 할인율이다", () => {
  const neutral = findRevenueNeutralDiscount({
    ...DEFAULT_SIMULATION_INPUT,
    shiftRate: 0,
  });
  assert.equal(neutral.discountRate, 0);
  nearly(neutral.shortTermNetImpactWon, 0, 1e-9);
  assert.ok(neutral.neutralPointWithinRange);
});
