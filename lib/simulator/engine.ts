import type {
  AnalysisYear,
  ApplianceCode,
  CustomerTypeCode,
  EvTariffVoltage,
  RevenueNeutralDiscountResult,
  SimulationInput,
  SimulationResult,
} from "./types";
import { SELECTABLE_APPLIANCES } from "./appliances";
import {
  REFERENCE_DATA,
  type ReferenceDayType,
  type ReferenceEvent,
  type ReferenceSeason,
} from "./reference-data.generated";

export const ENGINE_VERSION = "2.7.0-ev-representative-alignment";

type BaseCustomerType = Exclude<CustomerTypeCode, "EV_TOTAL">;
type ResolvedEvTariffVoltage = Exclude<EvTariffVoltage, "AUTO">;
type Components = Array<{ type: BaseCustomerType; weight: number }>;
type HourlyRoute = {
  base: number[];
  shifted: number[];
  movedKwh: number;
  /**
   * 해당 발령일에 대표고객의 충전이 배정되는지 여부(0 또는 1).
   * 2-1은 모든 발령일에 충전한다고 보아 항상 1이고,
   * 2-2는 주 2회 충전 한도 안에서 배정된 날만 1이다.
   */
  occurrenceWeight?: number;
};
type SelectedEvent = ReferenceEvent & { hours: number[] };
type LoadProfileMap = Record<BaseCustomerType, Record<ReferenceSeason, readonly number[]>>;
type ApplianceProfileMap = Record<string, Record<ApplianceCode, readonly number[]>>;
type EventMap = Record<`${AnalysisYear}`, readonly ReferenceEvent[]>;

const LOAD_PROFILES = REFERENCE_DATA.loadProfiles as unknown as LoadProfileMap;
const APPLIANCE_PROFILES = REFERENCE_DATA.applianceProfiles as unknown as ApplianceProfileMap;
const EVENTS = REFERENCE_DATA.events as unknown as EventMap;

const EV_SLOW_USAGE = 1_949_025.8806533858;
const EV_FAST_USAGE = 576_504.612;
export const EV_TOTAL_SLOW_WEIGHT = EV_SLOW_USAGE / (EV_SLOW_USAGE + EV_FAST_USAGE);
export const EV_TOTAL_FAST_WEIGHT = 1 - EV_TOTAL_SLOW_WEIGHT;

export const EV_BASIC_CHARGE_WON_PER_KW = {
  LOW: 2_390,
  HIGH: 2_580,
} as const;

export const EV_ENERGY_RATE_TABLE = {
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
} as const;

// EV energy-only values are independently reproduced from the annual workbook.
// Residential is corrected to the official tariff table: the detailed workbook
// incorrectly applied EV weekend time bands to residential TOU.
const ENERGY_CHARGE_2025_WON: Record<BaseCustomerType, number> = {
  RESIDENTIAL_TOU: 1_127_265.02449335,
  EV_SLOW_LOW_VOLTAGE: 491_772.6626142673,
  EV_FAST_HIGH_VOLTAGE: 584_640.2439547501,
};

const APPLIANCE_TO_CUSTOMER_SCALE = 0.625;
const CURTAILMENT_AVOIDANCE_FACTOR = 0.85;
const PEAK_HOURS = [16, 17, 18, 19, 20, 21] as const;
const EV_SLOW_CHARGE_HOURS = [23, 0, 1, 2, 3, 4] as const;

export const EV_CONTRACT_POWER_THRESHOLD_KW = 50;
export const EV_REPRESENTATIVE_BASIS = {
  slow: { contractPowerKw: 7, monthlyUsageKwh: 336, chargeHours: 6, sessionsPerMonth: 8 },
  fast: { contractPowerKw: 50, monthlyUsageKwh: 400, chargeHours: 1, sessionsPerMonth: 8 },
} as const;
/** 대표고객은 주 2회(평일 1회·주말 1회) 충전한다. */
export const EV_REPRESENTATIVE_SESSIONS_PER_WEEK = 2;

function repeated(value: number, count: number): number[] {
  return Array.from({ length: count }, () => value);
}

function defaultEvTariffVoltage(type: BaseCustomerType): ResolvedEvTariffVoltage {
  return type === "EV_FAST_HIGH_VOLTAGE" ? "HIGH" : "LOW";
}

function resolveEvTariffVoltage(
  type: BaseCustomerType,
  requested: EvTariffVoltage,
): ResolvedEvTariffVoltage {
  return requested === "AUTO" ? defaultEvTariffVoltage(type) : requested;
}

function weekdayRates(
  type: BaseCustomerType,
  season: ReferenceSeason,
  evTariffVoltage: EvTariffVoltage = "AUTO",
): number[] {
  if (type === "RESIDENTIAL_TOU") {
    return season === "SHOULDER"
      ? [...repeated(125.8, 8), ...repeated(153.8, 8), ...repeated(172.4, 6), ...repeated(125.8, 2)]
      : [...repeated(138.7, 8), ...repeated(184.7, 8), ...repeated(220.5, 6), ...repeated(138.7, 2)];
  }
  const voltage = resolveEvTariffVoltage(type, evTariffVoltage);
  const [low, middle, peak] = EV_ENERGY_RATE_TABLE[voltage][season];
  return [...repeated(low, 8), ...repeated(middle, 8), ...repeated(peak, 6), ...repeated(low, 2)];
}

function tariffRates(
  type: BaseCustomerType,
  season: ReferenceSeason,
  dayType: ReferenceDayType,
  evTariffVoltage: EvTariffVoltage = "AUTO",
): number[] {
  const weekday = weekdayRates(type, season, evTariffVoltage);
  if (type === "RESIDENTIAL_TOU" || dayType === "WEEKDAY") return weekday;
  const low = weekday[0];
  const middle = weekday[8];
  const rates = dayType === "SATURDAY"
    ? [...repeated(low, 8), ...repeated(middle, 14), ...repeated(low, 2)]
    : repeated(low, 24);
  if (season === "SHOULDER") {
    for (let hour = 11; hour <= 13; hour += 1) rates[hour] *= 0.5;
  }
  return rates;
}

export function getEvTariffRates(
  voltage: ResolvedEvTariffVoltage,
  season: ReferenceSeason,
  dayType: ReferenceDayType,
): number[] {
  return tariffRates("EV_SLOW_LOW_VOLTAGE", season, dayType, voltage);
}

function existingEvWeekendDiscount(
  type: BaseCustomerType,
  season: ReferenceSeason,
  dayType: ReferenceDayType,
  hour: number,
): boolean {
  return type !== "RESIDENTIAL_TOU"
    && season === "SHOULDER"
    && dayType !== "WEEKDAY"
    && hour >= 11
    && hour <= 13;
}

function selectedEvents(input: SimulationInput): SelectedEvent[] {
  const source = EVENTS[String(input.analysisYear) as `${AnalysisYear}`];
  return source.flatMap((event) => {
    const matchesSeason = input.seasonFilter === "ALL" || event.season === input.seasonFilter;
    const matchesDayType = input.dayTypeFilter === "ALL"
      || (input.dayTypeFilter === "WEEKDAY" && event.dayType === "WEEKDAY")
      || (input.dayTypeFilter === "WEEKEND" && event.dayType !== "WEEKDAY");
    if (!matchesSeason || !matchesDayType) return [];
    const hours = input.eventRule.mode === "ACTUAL"
      ? [...event.actualHours]
      : event.smp.flatMap((smp, hour) => {
        const endingHour = hour + 1;
        return endingHour >= input.eventRule.startHour
          && endingHour <= input.eventRule.endHour
          && smp <= input.eventRule.smpThresholdWonPerKwh
          ? [hour]
          : [];
      });
    return hours.length > 0 ? [{ ...event, hours }] : [];
  });
}

function emptyApplianceRecord(): Record<ApplianceCode, number> {
  return Object.fromEntries(SELECTABLE_APPLIANCES.map(({ code }) => [code, 0])) as Record<ApplianceCode, number>;
}

function applianceSettingRate(input: SimulationInput, code: ApplianceCode): number {
  const applianceRate = input.applianceShiftRates?.[code] ?? 1;
  return Math.max(0, Math.min(1, applianceRate));
}

function applianceMaximumShares(events: readonly SelectedEvent[]): Record<ApplianceCode, number> {
  const maximumKwh = emptyApplianceRecord();
  events.forEach((event) => {
    const profileKey = `${event.season}_${event.dayType === "WEEKDAY" ? "WEEKDAY" : "WEEKEND"}`;
    const eventSet = new Set(event.hours);
    SELECTABLE_APPLIANCES.forEach(({ code }) => {
      maximumKwh[code] += APPLIANCE_PROFILES[profileKey][code].reduce(
        (sum, kwh, hour) => sum + (!eventSet.has(hour) ? kwh * APPLIANCE_TO_CUSTOMER_SCALE : 0),
        0,
      );
    });
  });
  const total = Object.values(maximumKwh).reduce((sum, value) => sum + value, 0);
  return Object.fromEntries(
    SELECTABLE_APPLIANCES.map(({ code }) => [code, total > 0 ? maximumKwh[code] / total : 0]),
  ) as Record<ApplianceCode, number>;
}

function componentsFor(customerType: CustomerTypeCode): Components {
  if (customerType === "EV_TOTAL") {
    return [
      { type: "EV_SLOW_LOW_VOLTAGE", weight: EV_TOTAL_SLOW_WEIGHT },
      { type: "EV_FAST_HIGH_VOLTAGE", weight: EV_TOTAL_FAST_WEIGHT },
    ];
  }
  return [{ type: customerType, weight: 1 }];
}

function copyProfile(type: BaseCustomerType, season: ReferenceSeason): number[] {
  return [...LOAD_PROFILES[type][season]];
}

function distribute(shifted: number[], destinationHours: readonly number[], energy: number): void {
  if (energy <= 0 || destinationHours.length === 0) return;
  const addition = energy / destinationHours.length;
  destinationHours.forEach((hour) => { shifted[hour] += addition; });
}

function aggregateScenarioOne(
  type: BaseCustomerType,
  season: ReferenceSeason,
  eventHours: readonly number[],
  shiftRate: number,
): HourlyRoute {
  const base = copyProfile(type, season);
  const shifted = [...base];
  const count = Math.min(eventHours.length, PEAK_HOURS.length);
  const sourceHours = PEAK_HOURS.slice(PEAK_HOURS.length - count);
  let movedKwh = 0;
  sourceHours.forEach((hour) => {
    const removed = base[hour] * shiftRate;
    shifted[hour] -= removed;
    movedKwh += removed;
  });
  distribute(shifted, eventHours, movedKwh);
  return { base, shifted, movedKwh };
}

function residentialApplianceScenario(
  season: ReferenceSeason,
  dayType: ReferenceDayType,
  eventHours: readonly number[],
  input: SimulationInput,
  selectedAppliances: ReadonlySet<ApplianceCode>,
): HourlyRoute {
  const base = copyProfile("RESIDENTIAL_TOU", season);
  const shifted = [...base];
  const rates = tariffRates("RESIDENTIAL_TOU", season, dayType);
  const eventSet = new Set(eventHours);
  const profileKey = `${season}_${dayType === "WEEKDAY" ? "WEEKDAY" : "WEEKEND"}`;
  let movedKwh = 0;

  selectedAppliances.forEach((code) => {
    const appliance = APPLIANCE_PROFILES[profileKey][code];
    const sourceHours = appliance
      .map((kwh, hour) => ({ hour, kwh, rate: rates[hour] }))
      .filter(({ hour, kwh }) => !eventSet.has(hour) && kwh > 0)
      .sort((left, right) => right.rate - left.rate || right.hour - left.hour);
    let remaining = sourceHours.reduce((sum, item) => sum + item.kwh, 0)
      * applianceSettingRate(input, code);
    let applianceMoved = 0;
    sourceHours.forEach(({ hour, kwh }) => {
      const removed = Math.min(kwh, remaining);
      shifted[hour] -= removed * APPLIANCE_TO_CUSTOMER_SCALE;
      remaining -= removed;
      applianceMoved += removed * APPLIANCE_TO_CUSTOMER_SCALE;
    });
    movedKwh += applianceMoved;
    distribute(shifted, eventHours, applianceMoved);
  });

  shifted.forEach((value, hour) => {
    if (value >= 0) return;
    const correction = -value;
    shifted[hour] = 0;
    movedKwh -= correction;
    eventHours.forEach((destination) => { shifted[destination] -= correction / eventHours.length; });
  });
  const responseRate = Math.max(0, Math.min(1, input.shiftRate));
  const responseShifted = shifted.map((value, hour) => base[hour] + (value - base[hour]) * responseRate);
  return { base, shifted: responseShifted, movedKwh: Math.max(0, movedKwh) * responseRate };
}

function moveEnergy(
  base: readonly number[],
  sourceHours: readonly number[],
  destinationHours: readonly number[],
  shiftRate: number,
): HourlyRoute {
  const shifted = [...base];
  let movedKwh = 0;
  sourceHours.forEach((hour) => {
    const removed = base[hour] * shiftRate;
    shifted[hour] -= removed;
    movedKwh += removed;
  });
  distribute(shifted, destinationHours, movedKwh);
  return { base: [...base], shifted, movedKwh };
}

function evScenario21(
  type: BaseCustomerType,
  season: ReferenceSeason,
  eventHours: readonly number[],
  shiftRate: number,
): HourlyRoute {
  const base = copyProfile(type, season);
  if (type === "RESIDENTIAL_TOU") return { base, shifted: [...base], movedKwh: 0 };
  if (type === "EV_SLOW_LOW_VOLTAGE") {
    const hourCount = Math.min(EV_SLOW_CHARGE_HOURS.length, eventHours.length);
    return moveEnergy(
      base,
      EV_SLOW_CHARGE_HOURS.slice(0, hourCount),
      eventHours.slice(0, hourCount),
      shiftRate,
    );
  }
  const sourceHour = PEAK_HOURS.reduce(
    (best, hour) => (base[hour] > base[best] ? hour : best),
    PEAK_HOURS[0],
  );
  return moveEnergy(base, [sourceHour], [eventHours[0]], shiftRate);
}

function isoWeekStart(date: string): string {
  const time = Date.UTC(
    Number(date.slice(0, 4)),
    Number(date.slice(5, 7)) - 1,
    Number(date.slice(8, 10)),
  );
  const mondayOffset = (new Date(time).getUTCDay() + 6) % 7;
  return new Date(time - mondayOffset * 24 * 60 * 60 * 1_000).toISOString().slice(0, 10);
}

/**
 * 주 2회(평일 1회·주말 1회) 충전하는 대표고객이 실제로 발령일에 충전하게 되는 날.
 *
 * 발령이 난 주에는 그 주의 충전을 발령일로 옮긴다고 보고, 주(월~일)마다
 * 평일 발령일 1일과 주말·공휴일 발령일 1일에 충전을 배정한다. 한쪽 요일유형만
 * 발령된 주는 같은 유형에서 두 번째 날까지 채운다. 주당 충전 횟수를 이미
 * 소진한 나머지 발령일은 충전이 없으므로 편익 계산에서 제외한다.
 *
 * 기존 워크북(주 2회 대표고객 기준)도 같은 한도로 2025년 발령 56일 중 40일만
 * 집계에 반영한다. 이 규칙은 주 경계를 ISO 기준(월~일)으로 잡아 39일이 된다.
 */
function representativeChargingDates(events: readonly ReferenceEvent[]): ReadonlySet<string> {
  const weeks = new Map<string, { weekday: string[]; weekend: string[] }>();
  events.forEach((event) => {
    const key = isoWeekStart(event.date);
    let bucket = weeks.get(key);
    if (!bucket) {
      bucket = { weekday: [], weekend: [] };
      weeks.set(key, bucket);
    }
    (event.dayType === "WEEKDAY" ? bucket.weekday : bucket.weekend).push(event.date);
  });

  const selected = new Set<string>();
  weeks.forEach(({ weekday, weekend }) => {
    weekday.sort();
    weekend.sort();
    const picks: string[] = [];
    [weekday, weekend].forEach((pool) => { if (pool.length > 0) picks.push(pool[0]); });
    [weekday, weekend].forEach((pool) => {
      pool.slice(1).forEach((date) => {
        if (picks.length < EV_REPRESENTATIVE_SESSIONS_PER_WEEK) picks.push(date);
      });
    });
    picks.slice(0, EV_REPRESENTATIVE_SESSIONS_PER_WEEK).forEach((date) => selected.add(date));
  });
  return selected;
}

const EV_REPRESENTATIVE_CHARGING_DATES: Record<`${AnalysisYear}`, ReadonlySet<string>> = {
  2024: representativeChargingDates(EVENTS["2024"]),
  2025: representativeChargingDates(EVENTS["2025"]),
  2026: representativeChargingDates(EVENTS["2026"]),
};

function chargesOnEventDay(year: AnalysisYear, date: string): boolean {
  return EV_REPRESENTATIVE_CHARGING_DATES[String(year) as `${AnalysisYear}`].has(date);
}

/**
 * 시나리오 2-2는 2-1과 같은 계약종별 부하곡선·이전규칙을 쓰되,
 * 주 2회 충전 한도 안에서 배정된 발령일에만 충전이 일어난다고 본다.
 */
function evScenario22(
  type: BaseCustomerType,
  season: ReferenceSeason,
  eventHours: readonly number[],
  shiftRate: number,
  charging: boolean,
): HourlyRoute {
  return { ...evScenario21(type, season, eventHours, shiftRate), occurrenceWeight: charging ? 1 : 0 };
}

function routeForEvent(
  type: BaseCustomerType,
  input: SimulationInput,
  event: ReferenceEvent & { hours: number[] },
  selectedAppliances: ReadonlySet<ApplianceCode>,
): HourlyRoute {
  if (input.shiftMode === "SCENARIO_1") {
    return aggregateScenarioOne(type, event.season, event.hours, input.shiftRate);
  }
  if (input.shiftMode === "RES_SCENARIO_2" && type === "RESIDENTIAL_TOU") {
    return residentialApplianceScenario(event.season, event.dayType, event.hours, input, selectedAppliances);
  }
  if (input.shiftMode === "EV_SCENARIO_2_1") return evScenario21(type, event.season, event.hours, input.shiftRate);
  if (input.shiftMode === "EV_SCENARIO_2_2") {
    return evScenario22(
      type,
      event.season,
      event.hours,
      input.shiftRate,
      chargesOnEventDay(input.analysisYear, event.date),
    );
  }
  const base = copyProfile(type, event.season);
  return { base, shifted: [...base], movedKwh: 0 };
}

function discountedRates(
  type: BaseCustomerType,
  event: ReferenceEvent & { hours: number[] },
  discountRate: number,
  weekendPriority: boolean,
  evTariffVoltage: EvTariffVoltage,
): number[] {
  const current = tariffRates(type, event.season, event.dayType, evTariffVoltage);
  const eventSet = new Set(event.hours);
  return current.map((rate, hour) => {
    if (!eventSet.has(hour)) return rate;
    if (weekendPriority && existingEvWeekendDiscount(type, event.season, event.dayType, hour)) return rate;
    return rate * (1 - discountRate);
  });
}

function dot(left: readonly number[], right: readonly number[]): number {
  return left.reduce((sum, value, index) => sum + value * right[index], 0);
}

const PUBLIC_HOLIDAYS_2025 = new Set([
  "2025-01-01",
  "2025-01-28", "2025-01-29", "2025-01-30",
  "2025-03-01", "2025-03-03",
  "2025-05-05", "2025-05-06",
  "2025-06-06",
  "2025-08-15",
  "2025-10-03", "2025-10-05", "2025-10-06", "2025-10-07", "2025-10-08", "2025-10-09",
  "2025-12-25",
]);

function dateKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function seasonForMonth(month: number): ReferenceSeason {
  if (month >= 6 && month <= 8) return "SUMMER";
  if (month === 11 || month === 12 || month <= 2) return "WINTER";
  return "SHOULDER";
}

function dayTypeFor2025(date: Date): ReferenceDayType {
  if (PUBLIC_HOLIDAYS_2025.has(dateKey(date))) return "HOLIDAY";
  if (date.getUTCDay() === 6) return "SATURDAY";
  if (date.getUTCDay() === 0) return "HOLIDAY";
  return "WEEKDAY";
}

function annualTariffIndex2025(
  type: Exclude<BaseCustomerType, "RESIDENTIAL_TOU">,
  voltage: ResolvedEvTariffVoltage,
): number {
  let total = 0;
  for (
    let time = Date.UTC(2025, 0, 1);
    time <= Date.UTC(2025, 11, 31);
    time += 24 * 60 * 60 * 1_000
  ) {
    const date = new Date(time);
    const season = seasonForMonth(date.getUTCMonth() + 1);
    total += dot(LOAD_PROFILES[type][season], tariffRates(type, season, dayTypeFor2025(date), voltage));
  }
  return total;
}

const EV_TARIFF_INDEX_2025 = {
  EV_SLOW_LOW_VOLTAGE: {
    LOW: annualTariffIndex2025("EV_SLOW_LOW_VOLTAGE", "LOW"),
    HIGH: annualTariffIndex2025("EV_SLOW_LOW_VOLTAGE", "HIGH"),
  },
  EV_FAST_HIGH_VOLTAGE: {
    LOW: annualTariffIndex2025("EV_FAST_HIGH_VOLTAGE", "LOW"),
    HIGH: annualTariffIndex2025("EV_FAST_HIGH_VOLTAGE", "HIGH"),
  },
} as const;

function currentEnergyBill(
  type: BaseCustomerType,
  year: AnalysisYear,
  evTariffVoltage: EvTariffVoltage,
): number {
  let energyCharge = ENERGY_CHARGE_2025_WON[type];
  if (type !== "RESIDENTIAL_TOU") {
    const defaultVoltage = defaultEvTariffVoltage(type);
    const selectedVoltage = resolveEvTariffVoltage(type, evTariffVoltage);
    energyCharge *= EV_TARIFF_INDEX_2025[type][selectedVoltage]
      / EV_TARIFF_INDEX_2025[type][defaultVoltage];
  }
  if (year === 2026) return energyCharge * (135 / 365);
  const dayScale = year === 2024 ? 366 / 365 : 1;
  return energyCharge * dayScale;
}

export function validateSimulationInput(input: SimulationInput): string[] {
  const errors: string[] = [];
  if (!Number.isFinite(input.customerCount) || input.customerCount < 1) errors.push("대상 고객 수는 1 이상이어야 합니다.");
  if (!Number.isFinite(input.discountRate) || input.discountRate < 0 || input.discountRate > 1) errors.push("할인율은 0과 1 사이여야 합니다.");
  if (!Number.isFinite(input.shiftRate) || input.shiftRate < 0 || input.shiftRate > 1) errors.push("수요이전율은 0과 1 사이여야 합니다.");
  if (input.applianceShiftRates && Object.values(input.applianceShiftRates).some(
    (value) => value !== undefined && (!Number.isFinite(value) || value < 0 || value > 1),
  )) errors.push("가전별 이전 설정률은 0과 1 사이여야 합니다.");
  if (!Number.isFinite(input.eventRule.smpThresholdWonPerKwh)) errors.push("SMP 임계값은 숫자여야 합니다.");
  if (input.eventRule.startHour > input.eventRule.endHour) errors.push("발령 시작시간은 종료시간보다 늦을 수 없습니다.");
  return errors;
}

export function runSimulation(input: SimulationInput): SimulationResult {
  const warnings = validateSimulationInput(input);
  const events = selectedEvents(input);
  const components = componentsFor(input.customerType);
  const selectedCodes = new Set(input.selectedAppliances);
  const selectedApplianceCount = SELECTABLE_APPLIANCES.filter(({ code }) => selectedCodes.has(code)).length;
  const maximumShares = applianceMaximumShares(events);
  const configuredShares = Object.fromEntries(SELECTABLE_APPLIANCES.map(({ code }) => [
    code,
    selectedCodes.has(code) ? maximumShares[code] * applianceSettingRate(input, code) * input.shiftRate : 0,
  ])) as Record<ApplianceCode, number>;
  const selectedApplianceShare = input.shiftMode === "RES_SCENARIO_2" && input.customerType === "RESIDENTIAL_TOU"
    ? Object.values(configuredShares).reduce((sum, value) => sum + value, 0)
    : 1;
  const targetCustomers = Math.round(input.customerCount);
  const monthlyEventDays = Array.from({ length: 12 }, () => 0);
  events.forEach((event) => { monthlyEventDays[event.month - 1] += 1; });
  const evChargingEventDays = input.shiftMode === "EV_SCENARIO_2_1"
    ? events.length
    : input.shiftMode === "EV_SCENARIO_2_2"
      ? events.filter((event) => chargesOnEventDay(input.analysisYear, event.date)).length
      : 0;

  let benefitPerCustomer = 0;
  let movedKwhPerCustomer = 0;
  let smpCostChangePerCustomer = 0;
  let annualCurrentBill = 0;
  const chartBase = Array.from({ length: 24 }, () => 0);
  const chartShifted = Array.from({ length: 24 }, () => 0);

  components.forEach(({ type, weight }) => {
    annualCurrentBill += currentEnergyBill(type, input.analysisYear, input.evTariffVoltage) * weight;
    events.forEach((event) => {
      const route = routeForEvent(type, input, event, selectedCodes);
      const occurrenceWeight = route.occurrenceWeight ?? 1;
      const currentRates = tariffRates(type, event.season, event.dayType, input.evTariffVoltage);
      const newRates = discountedRates(
        type,
        event,
        input.discountRate,
        input.weekendDiscountPriority,
        input.evTariffVoltage,
      );
      benefitPerCustomer += (dot(route.base, currentRates) - dot(route.shifted, newRates))
        * occurrenceWeight * weight;
      movedKwhPerCustomer += route.movedKwh * occurrenceWeight * weight;
      smpCostChangePerCustomer += route.shifted.reduce(
        (sum, value, hour) => sum + (value - route.base[hour]) * event.smp[hour],
        0,
      ) * occurrenceWeight * weight;
      for (let hour = 0; hour < 24; hour += 1) {
        chartBase[hour] += route.base[hour] * weight;
        chartShifted[hour] += route.shifted[hour] * weight;
      }
    });
  });

  if (events.length > 0) {
    for (let hour = 0; hour < 24; hour += 1) {
      chartBase[hour] /= events.length;
      chartShifted[hour] /= events.length;
    }
  } else {
    const fallbackSeason = input.seasonFilter === "ALL" ? "SHOULDER" : input.seasonFilter;
    components.forEach(({ type, weight }) => {
      const profile = copyProfile(type, fallbackSeason);
      profile.forEach((value, hour) => {
        chartBase[hour] += value * weight;
        chartShifted[hour] += value * weight;
      });
    });
  }

  const shiftedEnergyMwh = movedKwhPerCustomer * targetCustomers / 1_000;
  const totalBenefit = benefitPerCustomer * targetCustomers;
  const currentSales = annualCurrentBill * targetCustomers;
  const salesChange = -totalBenefit;
  const smpCostChange = smpCostChangePerCustomer * targetCustomers;

  if (input.shiftMode === "RES_SCENARIO_2" && input.customerType === "RESIDENTIAL_TOU" && selectedApplianceCount === 0) {
    warnings.push("선택된 가전이 없어 할인 효과만 계산하고 부하이전량은 0으로 계산했습니다.");
  }
  if (input.shiftMode === "EV_SCENARIO_2_1") {
    warnings.push("EV 시나리오 2-1은 전기예보 발령일에만 충전하는 계약종별 부하를 적용합니다. 완속은 6시간 충전구간 중 발령시간 수만큼 경부하에서, 급속은 최대부하 1시간을 발령시간으로 이전합니다.");
  }
  if (input.shiftMode === "EV_SCENARIO_2_2") {
    warnings.push(`EV 시나리오 2-2는 대표고객이 주 2회(평일 1회·주말 1회) 충전하고, 발령이 난 주에는 그 주의 충전을 발령일로 옮긴다고 가정합니다. 선택 발령일 ${events.length}일 중 주당 충전한도 안에서 배정되는 날은 ${evChargingEventDays}일입니다.`);
    warnings.push("대표고객 기준은 완속 7kW·6시간·월 336kWh, 급속 50kW·1시간·월 400kWh이며 시간대별 형상은 계약종별 부하곡선(완속 42kWh/회·급속 50kWh/회)을 따릅니다.");
    warnings.push("2-1은 모든 발령일에 충전한다고 보는 상한, 2-2는 주 2회 충전한도를 적용한 값입니다. 발령일 대응이 100%가 아니면 실제 편익은 2-2보다 작습니다.");
  }
  if (input.customerType !== "RESIDENTIAL_TOU") {
    warnings.push("EV는 계약전력 50kW 미만을 완속, 50kW 이상을 급속으로 구분합니다.");
    warnings.push(input.evTariffVoltage === "AUTO"
      ? "공급전압 자동값은 완속 저압·급속 고압이며, 충전방식과 별도로 저압·고압 요금종별을 선택할 수 있습니다."
      : `충전방식과 별개로 ${input.evTariffVoltage === "LOW" ? "저압" : "고압"} 전기자동차 충전전력요금을 적용했습니다.`);
  }
  if (input.customerType === "EV_TOTAL") {
    warnings.push("전기차 전체는 2025년 사용량 기준 완속 77.2%·급속 22.8%를 가중 합산합니다.");
  }
  if (input.eventRule.mode === "ACTUAL" && input.analysisYear === 2025) {
    warnings.push("2025년 실적은 56일·195시간의 시나리오 발령구간을 적용했습니다. SMP≤0인 개별 시간은 150시간으로 별도 집계됩니다.");
  }
  if (input.eventRule.mode === "RULE") {
    warnings.push("SMP 자동판정은 원자료의 시간대별 SMP가 입력 임계값 이하인 시간만 다시 선택합니다.");
  }
  if (input.seasonFilter !== "ALL" || input.dayTypeFilter !== "ALL") {
    warnings.push("계절·요일 선택은 해당 조건의 발령·부하이전 효과만 필터링하며, 현행 고객요금은 분석연도 전체 기준입니다.");
  }
  if (events.length === 0) {
    warnings.push("선택한 연도·계절·요일·발령조건에 해당하는 발령실적이 없어 할인 및 부하이전 효과는 0으로 계산했습니다.");
  }
  if (input.analysisYear === 2026) {
    warnings.push("2026년은 5월 15일까지의 YTD 발령자료와 135일 전력량요금을 적용했습니다.");
  }
  warnings.push("고객요금과 판매수입은 기존 PRAS-EV 기준에 따라 기본요금·부가가치세·전력산업기반기금 등을 제외한 전력량요금 기준입니다.");
  warnings.push("할인은 대상 고객 전체의 발령시간대 사용량에 적용하며, 수요이전율은 이전 가능한 부하 중 실제로 발령시간대로 이동하는 비율입니다.");
  warnings.push("출력제어 회피 가능량은 발령시간 부하 증가량의 85%가 실제 출력제어를 대체한다는 가정값입니다.");

  return {
    engineVersion: ENGINE_VERSION,
    eventDays: events.length,
    eventHours: events.reduce((sum, event) => sum + event.hours.length, 0),
    evChargingEventDays,
    targetCustomers,
    selectedApplianceCount,
    selectableApplianceCount: SELECTABLE_APPLIANCES.length,
    selectedApplianceShare,
    applianceMaximumShares: maximumShares,
    applianceConfiguredShares: configuredShares,
    monthlyEventDays,
    baseLoadProfile: chartBase,
    shiftedLoadProfile: chartShifted,
    customer: {
      currentAnnualBillWon: annualCurrentBill,
      newAnnualBillWon: annualCurrentBill - benefitPerCustomer,
      annualBenefitPerCustomerWon: benefitPerCustomer,
      totalAnnualBenefitWon: totalBenefit,
    },
    utility: {
      currentSalesRevenueWon: currentSales,
      newSalesRevenueWon: currentSales + salesChange,
      salesRevenueChangeWon: salesChange,
      smpPurchaseCostChangeWon: smpCostChange,
      shortTermNetImpactWon: salesChange - smpCostChange,
    },
    grid: {
      shiftedEnergyMwh,
      eventWindowLoadIncreaseMwh: shiftedEnergyMwh,
      curtailmentReductionMwh: shiftedEnergyMwh * CURTAILMENT_AVOIDANCE_FACTOR,
    },
    warnings,
  };
}

/**
 * 현재 분석조건에서 한전의 단기 순재무영향이 0원에 가장 가까워지는
 * 발령시간 할인율을 0.1%p 단위로 산정한다.
 *
 * 할인율은 판매수입 변화에 선형으로 작용하고 SMP 구입비 변화에는
 * 영향을 주지 않으므로 0%와 100% 결과로 이론 중립점을 계산한 뒤,
 * 화면에 적용 가능한 0.1%p 후보 중 절대 잔여 영향이 최소인 값을 선택한다.
 */
export function findRevenueNeutralDiscount(input: SimulationInput): RevenueNeutralDiscountResult {
  const impactAt = (discountRate: number) => runSimulation({
    ...input,
    discountRate,
  }).utility.shortTermNetImpactWon;

  const impactAtZero = impactAt(0);
  const impactAtFull = impactAt(1);
  const slope = impactAtFull - impactAtZero;
  const hasDiscountSensitivity = Math.abs(slope) >= 1e-9;
  const rawNeutralRate = hasDiscountSensitivity ? -impactAtZero / slope : 0;
  const neutralPointWithinRange = hasDiscountSensitivity
    ? rawNeutralRate >= 0 && rawNeutralRate <= 1
    : Math.abs(impactAtZero) < 0.5;
  const clampedRate = Math.max(0, Math.min(1, rawNeutralRate));
  const roundedRate = Math.round(clampedRate * 1_000) / 1_000;
  const candidateRates = [...new Set([
    0,
    1,
    roundedRate,
    Math.max(0, roundedRate - 0.001),
    Math.min(1, roundedRate + 0.001),
  ])];

  const best = candidateRates
    .map((discountRate) => ({ discountRate, shortTermNetImpactWon: impactAt(discountRate) }))
    .sort((left, right) => (
      Math.abs(left.shortTermNetImpactWon) - Math.abs(right.shortTermNetImpactWon)
      || left.discountRate - right.discountRate
    ))[0];

  return {
    discountRate: best.discountRate,
    shortTermNetImpactWon: best.shortTermNetImpactWon,
    neutralPointWithinRange,
  };
}
