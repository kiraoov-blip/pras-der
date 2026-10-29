import type {
  AnalysisYear,
  ApplianceCode,
  ChargingOperatorTariffOption,
  CustomerTypeCode,
  EvTariffVoltage,
  RevenueNeutralDiscountResult,
  SimulationInput,
  SimulationResult,
  TargetBenefitSolution,
  TargetBenefitSolveOptions,
} from "./types";
import { SELECTABLE_APPLIANCES } from "./appliances";
import {
  REFERENCE_DATA,
  type ReferenceDayType,
  type ReferenceEvent,
  type ReferenceSeason,
} from "./reference-data.generated";
import { CHARGING_OPERATOR_DATA } from "./charging-operator-data.generated";

export const ENGINE_VERSION = "2.9.0-seasonal-appliance-scale";

type BaseCustomerType = Exclude<CustomerTypeCode, "EV_TOTAL">;
/** 계절별 대표 부하곡선을 쓰는 고객유형. 충전사업자는 날짜별 실측부하를 쓴다. */
type RepresentativeCustomerType = Exclude<BaseCustomerType, "EV_CHARGING_OPERATOR">;
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
  /** 충전사업자 충전일 이동: 같은 주 다른 날에서 발령시간으로 옮겨 온 양(kWh, 1대당). */
  dayShiftedKwh?: number;
  /** 옮겨 온 양이 원래 날에 냈을 요금(원, 현행단가) — 고객편익에 더한다. */
  sourceSavingWon?: number;
  /** 옮겨 온 양의 원래 날 SMP 구입비(원) — 구입비 변화에서 뺀다. */
  sourceSmpCostWon?: number;
};
type SelectedEvent = ReferenceEvent & { hours: number[] };
type LoadProfileMap = Record<RepresentativeCustomerType, Record<ReferenceSeason, readonly number[]>>;
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

/**
 * 전기자동차 충전전력요금(충전서비스 제공사업자용) — '26.4.16 시행, [경부하, 중간부하, 최대부하] 원/kWh.
 * 선택IV는 전체시간 단일요금이므로 세 값이 같다. 봄·가을 주말 11~14시 50% 할인은 자가소비용과 같이 적용된다.
 */
export const EV_OPERATOR_ENERGY_RATE_TABLE = {
  LOW: {
    I: { SHOULDER: [85.4, 97.2, 102.1], SUMMER: [95.9, 162.2, 203.5], WINTER: [110.6, 143.1, 172.0] },
    II: { SHOULDER: [85.4, 97.2, 102.1], SUMMER: [83.1, 140.0, 270.8], WINTER: [105.8, 126.7, 227.0] },
    III: { SHOULDER: [85.4, 97.2, 102.1], SUMMER: [90.1, 138.6, 236.0], WINTER: [115.5, 125.4, 198.4] },
    IV: { SHOULDER: [97.2, 97.2, 97.2], SUMMER: [172.0, 172.0, 172.0], WINTER: [154.9, 154.9, 154.9] },
  },
  HIGH: {
    I: { SHOULDER: [80.2, 91.0, 94.9], SUMMER: [89.8, 129.9, 151.2], WINTER: [99.4, 118.4, 132.4] },
    II: { SHOULDER: [80.2, 91.0, 94.9], SUMMER: [78.2, 113.0, 198.6], WINTER: [95.2, 105.5, 172.4] },
    III: { SHOULDER: [80.2, 91.0, 94.9], SUMMER: [84.5, 111.9, 174.0], WINTER: [103.6, 104.5, 151.6] },
    IV: { SHOULDER: [91.0, 91.0, 91.0], SUMMER: [137.4, 137.4, 137.4], WINTER: [127.7, 127.7, 127.7] },
  },
} as const;

/**
 * 충전사업자 이용 전기차 대수 = 도내 실제 운행 전기차 − 자가소비용 고객.
 * 운행대수는 제주특별자치도 전기자동차 등록현황('25년 12월, 타지역 운행 리스차량 제외) 기준.
 */
export const EV_CHARGING_OPERATOR_BASIS = {
  operatingEvCount: 45_467,
  selfConsumptionCustomers: 18_327,
  operatorUserCount: 45_467 - 18_327,
  siteCount: CHARGING_OPERATOR_DATA.siteCount,
  annualKwh: CHARGING_OPERATOR_DATA.annualKwh,
  dataYear: CHARGING_OPERATOR_DATA.year,
} as const;

// EV energy-only values are independently reproduced from the annual workbook.
// Residential is corrected to the official tariff table: the detailed workbook
// incorrectly applied EV weekend time bands to residential TOU.
const ENERGY_CHARGE_2025_WON: Record<RepresentativeCustomerType, number> = {
  RESIDENTIAL_TOU: 1_127_265.02449335,
  EV_SLOW_LOW_VOLTAGE: 491_772.6626142673,
  EV_FAST_HIGH_VOLTAGE: 584_640.2439547501,
};

/**
 * 주택용 시나리오 2 가전 환산계수(계절별).
 *
 * 가전 부하곡선 시나리오 원자료는 4인 가구(공동주택, 전기취사·건조기·에어컨·
 * 전기보조난방 보유) 기준 41종 가전의 하루 사용량이다. 이를 대표 주택 고객
 * (월 584kWh, 제주 주택용 2024년 부하 모양)에 결합할 때 계절별로
 *
 *   계수 = 대표 고객 계절 하루 사용량 ÷ 가전 모델 계절 하루 사용량(평일 5일·주말 2일 가중)
 *
 * 를 곱해 규모를 맞춘다. 종전에는 출처가 확인되지 않는 단일값 0.625를 썼다.
 * 가전 모델은 히트펌프 난방 때문에 겨울 사용량이 가장 크지만 실제 제주 주택은
 * 겨울이 여름보다 적으므로, 계절별 계수가 이 차이를 바로잡는다.
 */
export const APPLIANCE_MODEL_DAILY_KWH: Record<ReferenceSeason, { weekday: number; weekend: number }> = {
  // 원자료: 260527 가전 부하곡선 시나리오 6개 파일, 각 파일 첫 시트(10~12시) 41종 하루 합계
  SHOULDER: { weekday: 13.932, weekend: 24.082 },
  SUMMER: { weekday: 23.082, weekend: 40.082 },
  WINTER: { weekday: 25.192, weekend: 39.512 },
};
export const APPLIANCE_TO_CUSTOMER_SCALE: Record<ReferenceSeason, number> = Object.fromEntries(
  (["SHOULDER", "SUMMER", "WINTER"] as const).map((season) => {
    const customerDaily = LOAD_PROFILES.RESIDENTIAL_TOU[season].reduce((total, kwh) => total + kwh, 0);
    const { weekday, weekend } = APPLIANCE_MODEL_DAILY_KWH[season];
    return [season, customerDaily / ((weekday * 5 + weekend * 2) / 7)];
  }),
) as Record<ReferenceSeason, number>;
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

function evEnergyRates(
  type: BaseCustomerType,
  season: ReferenceSeason,
  evTariffVoltage: EvTariffVoltage,
  operatorOption: ChargingOperatorTariffOption,
): readonly number[] {
  const voltage = resolveEvTariffVoltage(type, evTariffVoltage);
  return type === "EV_CHARGING_OPERATOR"
    ? EV_OPERATOR_ENERGY_RATE_TABLE[voltage][operatorOption][season]
    : EV_ENERGY_RATE_TABLE[voltage][season];
}

function weekdayRates(
  type: BaseCustomerType,
  season: ReferenceSeason,
  evTariffVoltage: EvTariffVoltage = "AUTO",
  operatorOption: ChargingOperatorTariffOption = "I",
): number[] {
  if (type === "RESIDENTIAL_TOU") {
    return season === "SHOULDER"
      ? [...repeated(125.8, 8), ...repeated(153.8, 8), ...repeated(172.4, 6), ...repeated(125.8, 2)]
      : [...repeated(138.7, 8), ...repeated(184.7, 8), ...repeated(220.5, 6), ...repeated(138.7, 2)];
  }
  const [low, middle, peak] = evEnergyRates(type, season, evTariffVoltage, operatorOption);
  return [...repeated(low, 8), ...repeated(middle, 8), ...repeated(peak, 6), ...repeated(low, 2)];
}

function tariffRates(
  type: BaseCustomerType,
  season: ReferenceSeason,
  dayType: ReferenceDayType,
  evTariffVoltage: EvTariffVoltage = "AUTO",
  operatorOption: ChargingOperatorTariffOption = "I",
): number[] {
  const weekday = weekdayRates(type, season, evTariffVoltage, operatorOption);
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
        (sum, kwh, hour) => sum + (!eventSet.has(hour) ? kwh * APPLIANCE_TO_CUSTOMER_SCALE[event.season] : 0),
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
  if (type === "EV_CHARGING_OPERATOR") return operatorAverageProfile(season, "ALL");
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
  return shiftPeakToEvent(copyProfile(type, season), eventHours, shiftRate);
}

/** 시나리오 1: 최대부하 시간대 끝에서부터 발령시간 수만큼의 부하를 발령시간대로 균등 이전한다. */
function shiftPeakToEvent(
  base: number[],
  eventHours: readonly number[],
  shiftRate: number,
): HourlyRoute {
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
  const scale = APPLIANCE_TO_CUSTOMER_SCALE[season];
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
      shifted[hour] -= removed * scale;
      remaining -= removed;
      applianceMoved += removed * scale;
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
  if (type === "EV_CHARGING_OPERATOR") {
    // 충전소 합산부하에는 시나리오 1 + 충전일 이동만 적용한다(runSimulation 에서 정규화).
    return operatorEventRoute(event, input, input.operatorTariffOption ?? "I");
  }
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
  operatorOption: ChargingOperatorTariffOption,
): number[] {
  const current = tariffRates(type, event.season, event.dayType, evTariffVoltage, operatorOption);
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

// ── 충전사업자 실측부하 ─────────────────────────────────────────────
// 원자료는 전체 충전소의 날짜별 합산부하다. 이를 이용 전기차 대수로 나눠
// '충전사업자 이용 EV 1대당' 부하로 쓰고, 결과는 대상 고객 수를 곱해 전체로 환산한다.
const OPERATOR_DAILY_KWH = CHARGING_OPERATOR_DATA.dailyHourlyKwh;

function perOperatorUser(load: readonly number[]): number[] {
  return load.map((kwh) => kwh / EV_CHARGING_OPERATOR_BASIS.operatorUserCount);
}

let operatorAverageCache: Map<string, number[]> | null = null;

/** 실측연도의 계절×요일유형(및 계절 전체) 평균 일부하, 1대당 kWh. 실측이 없는 날의 대체값. */
function operatorAverageProfile(season: ReferenceSeason, dayType: ReferenceDayType | "ALL"): number[] {
  if (!operatorAverageCache) {
    const sums = new Map<string, { total: number[]; days: number }>();
    const add = (key: string, load: readonly number[]) => {
      const entry = sums.get(key) ?? { total: Array.from({ length: 24 }, () => 0), days: 0 };
      load.forEach((kwh, hour) => { entry.total[hour] += kwh; });
      entry.days += 1;
      sums.set(key, entry);
    };
    Object.entries(OPERATOR_DAILY_KWH).forEach(([date, load]) => {
      const day = new Date(`${date}T00:00:00Z`);
      const daySeason = seasonForMonth(day.getUTCMonth() + 1);
      add(`${daySeason}_${dayTypeFor2025(day)}`, load);
      add(`${daySeason}_ALL`, load);
    });
    operatorAverageCache = new Map([...sums].map(([key, { total, days }]) => [
      key,
      perOperatorUser(total.map((kwh) => kwh / days)),
    ]));
  }
  const profile = operatorAverageCache.get(`${season}_${dayType}`)
    ?? operatorAverageCache.get(`${season}_ALL`);
  return profile ? [...profile] : Array.from({ length: 24 }, () => 0);
}

/** 발령일 당일 실측부하(1대당). 실측연도 밖의 날짜는 같은 계절·요일유형 평균으로 대체한다. */
function operatorProfileForEvent(event: ReferenceEvent): number[] {
  const actual = OPERATOR_DAILY_KWH[event.date];
  return actual ? perOperatorUser(actual) : operatorAverageProfile(event.season, event.dayType);
}

/** 실측연도에 전체 충전망이 실제로 기록한 최대 시간당 부하(kWh). 충전일 이동의 처리용량 상한이다. */
export const EV_CHARGING_OPERATOR_PEAK_HOURLY_KWH = Math.max(...Object.values(OPERATOR_DAILY_KWH).flat());
export const DEFAULT_OPERATOR_DAY_SHIFT_RATE = 0.5;

function addDays(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * 24 * 60 * 60 * 1_000).toISOString().slice(0, 10);
}

/** 실측연도는 공휴일까지 반영하고, 그 밖의 연도는 토·일만 구분한다. */
function operatorDayType(date: string): ReferenceDayType {
  const day = new Date(`${date}T00:00:00Z`);
  if (date.startsWith(String(EV_CHARGING_OPERATOR_BASIS.dataYear))) return dayTypeFor2025(day);
  if (day.getUTCDay() === 6) return "SATURDAY";
  return day.getUTCDay() === 0 ? "HOLIDAY" : "WEEKDAY";
}

/**
 * 충전일 이동의 출발지: 발령일과 같은 주(월~일)의 비발령일.
 * 실측연도는 해당 날짜의 실측부하를, 그 밖의 연도는 계절·요일유형 평균부하를 쓴다.
 * 실측연도인데 자료 범위를 벗어난 날(연초·연말 주의 전년·다음 해 날짜)은 제외한다.
 * 반환값은 1대당 kWh와, 그 양을 원래 날에 썼을 때의 현행 요금(원)이다.
 */
function operatorWeekSource(
  event: ReferenceEvent,
  year: AnalysisYear,
  evTariffVoltage: EvTariffVoltage,
  operatorOption: ChargingOperatorTariffOption,
): { kwh: number; billWon: number; eventDaysInWeek: number } {
  const eventDates = new Set(EVENTS[String(year) as `${AnalysisYear}`].map((item) => item.date));
  const monday = isoWeekStart(event.date);
  let kwh = 0;
  let billWon = 0;
  let eventDaysInWeek = 0;
  for (let offset = 0; offset < 7; offset += 1) {
    const date = addDays(monday, offset);
    if (eventDates.has(date)) { eventDaysInWeek += 1; continue; }
    const actual = OPERATOR_DAILY_KWH[date];
    if (!actual && year === EV_CHARGING_OPERATOR_BASIS.dataYear) continue;
    const season = seasonForMonth(Number(date.slice(5, 7)));
    const dayType = operatorDayType(date);
    const load = actual ? perOperatorUser(actual) : operatorAverageProfile(season, dayType);
    kwh += load.reduce((sum, value) => sum + value, 0);
    billWon += dot(load, tariffRates("EV_CHARGING_OPERATOR", season, dayType, evTariffVoltage, operatorOption));
  }
  return { kwh, billWon, eventDaysInWeek: Math.max(1, eventDaysInWeek) };
}

/**
 * 충전사업자 발령일 경로: ① 시나리오 1 시간 이동 → ② 충전일 이동.
 * ②는 발령시간마다 (실측 최대 시간당 부하 − ①후 부하)의 여유에 이동률을 곱해 채운다.
 * 채운 양은 같은 주 비발령일 충전에서 그 날들의 부하 모양대로 빼 온 것으로 보며,
 * 주의 비발령일 충전량을 그 주 발령일 수로 나눈 몫을 넘지 못한다.
 */
function operatorEventRoute(
  event: SelectedEvent,
  input: SimulationInput,
  operatorOption: ChargingOperatorTariffOption,
): HourlyRoute {
  const route = shiftPeakToEvent(operatorProfileForEvent(event), event.hours, input.shiftRate);
  const dayShiftRate = Math.max(0, Math.min(1, input.operatorDayShiftRate ?? DEFAULT_OPERATOR_DAY_SHIFT_RATE));
  if (dayShiftRate === 0 || event.hours.length === 0) return route;

  const capacity = EV_CHARGING_OPERATOR_PEAK_HOURLY_KWH / EV_CHARGING_OPERATOR_BASIS.operatorUserCount;
  const room = event.hours.map((hour) => Math.max(0, capacity - route.shifted[hour]) * dayShiftRate);
  const wanted = room.reduce((sum, value) => sum + value, 0);
  const source = operatorWeekSource(event, input.analysisYear, input.evTariffVoltage, operatorOption);
  const added = Math.min(wanted, source.kwh / source.eventDaysInWeek);
  if (added <= 0) return route;

  const scale = added / wanted;
  event.hours.forEach((hour, index) => { route.shifted[hour] += room[index] * scale; });
  // 원래 날의 SMP는 기준자료에 없어, 발령일 SMP를 그날 부하 모양으로 가중한 평균을 대리값으로 쓴다.
  const baseKwh = route.base.reduce((sum, value) => sum + value, 0);
  const typicalSmp = baseKwh > 0 ? dot(route.base, event.smp) / baseKwh : 0;
  return {
    ...route,
    movedKwh: route.movedKwh + added,
    dayShiftedKwh: added,
    sourceSavingWon: source.billWon * (added / source.kwh),
    sourceSmpCostWon: added * typicalSmp,
  };
}

const operatorAnnualBillCache = new Map<string, number>();

/** 실측연도 365일 부하에 현행 충전사업자 요금을 적용한 1대당 연간 전력량요금. */
function operatorAnnualEnergyBill(
  evTariffVoltage: EvTariffVoltage,
  operatorOption: ChargingOperatorTariffOption,
): number {
  const key = `${evTariffVoltage}_${operatorOption}`;
  const cached = operatorAnnualBillCache.get(key);
  if (cached !== undefined) return cached;
  let total = 0;
  Object.entries(OPERATOR_DAILY_KWH).forEach(([date, load]) => {
    const day = new Date(`${date}T00:00:00Z`);
    const season = seasonForMonth(day.getUTCMonth() + 1);
    const rates = tariffRates("EV_CHARGING_OPERATOR", season, dayTypeFor2025(day), evTariffVoltage, operatorOption);
    total += dot(perOperatorUser(load), rates);
  });
  operatorAnnualBillCache.set(key, total);
  return total;
}

function annualTariffIndex2025(
  type: Exclude<RepresentativeCustomerType, "RESIDENTIAL_TOU">,
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
  operatorOption: ChargingOperatorTariffOption,
): number {
  let energyCharge = type === "EV_CHARGING_OPERATOR"
    ? operatorAnnualEnergyBill(evTariffVoltage, operatorOption)
    : ENERGY_CHARGE_2025_WON[type];
  if (type !== "RESIDENTIAL_TOU" && type !== "EV_CHARGING_OPERATOR") {
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
  if (input.operatorDayShiftRate !== undefined
    && (!Number.isFinite(input.operatorDayShiftRate) || input.operatorDayShiftRate < 0 || input.operatorDayShiftRate > 1)) {
    errors.push("충전일 이동률은 0과 1 사이여야 합니다.");
  }
  if (input.operatorTariffOption !== undefined && !["I", "II", "III", "IV"].includes(input.operatorTariffOption)) {
    errors.push("충전사업자 선택요금은 I~IV 중 하나여야 합니다.");
  }
  return errors;
}

export function runSimulation(rawInput: SimulationInput): SimulationResult {
  const warnings = validateSimulationInput(rawInput);
  const isOperator = rawInput.customerType === "EV_CHARGING_OPERATOR";
  if (isOperator && rawInput.shiftMode !== "SCENARIO_1") {
    warnings.push("충전사업자는 충전소 합산부하 기준이라 시나리오 1(최대부하 균등이전)만 적용합니다.");
  }
  // 충전사업자는 대표고객 충전 시나리오(2-1·2-2)가 성립하지 않으므로 시나리오 1로 정규화한다.
  const input: SimulationInput = isOperator && rawInput.shiftMode !== "SCENARIO_1"
    ? { ...rawInput, shiftMode: "SCENARIO_1" }
    : rawInput;
  const operatorOption = input.operatorTariffOption ?? "I";
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
  let dayShiftedKwhPerCustomer = 0;
  let smpCostChangePerCustomer = 0;
  let annualCurrentBill = 0;
  const chartBase = Array.from({ length: 24 }, () => 0);
  const chartShifted = Array.from({ length: 24 }, () => 0);

  components.forEach(({ type, weight }) => {
    annualCurrentBill += currentEnergyBill(type, input.analysisYear, input.evTariffVoltage, operatorOption) * weight;
    events.forEach((event) => {
      const route = routeForEvent(type, input, event, selectedCodes);
      const occurrenceWeight = route.occurrenceWeight ?? 1;
      const currentRates = tariffRates(type, event.season, event.dayType, input.evTariffVoltage, operatorOption);
      const newRates = discountedRates(
        type,
        event,
        input.discountRate,
        input.weekendDiscountPriority,
        input.evTariffVoltage,
        operatorOption,
      );
      // 충전일 이동분은 원래 날에 낼 요금(sourceSavingWon)을 아끼고 발령시간 할인단가로 다시 낸다.
      benefitPerCustomer += (dot(route.base, currentRates) - dot(route.shifted, newRates) + (route.sourceSavingWon ?? 0))
        * occurrenceWeight * weight;
      movedKwhPerCustomer += route.movedKwh * occurrenceWeight * weight;
      dayShiftedKwhPerCustomer += (route.dayShiftedKwh ?? 0) * occurrenceWeight * weight;
      smpCostChangePerCustomer += (route.shifted.reduce(
        (sum, value, hour) => sum + (value - route.base[hour]) * event.smp[hour],
        0,
      ) - (route.sourceSmpCostWon ?? 0)) * occurrenceWeight * weight;
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
  if (isOperator) {
    const basis = EV_CHARGING_OPERATOR_BASIS;
    const optionLabel = { I: "선택Ⅰ", II: "선택Ⅱ", III: "선택Ⅲ", IV: "선택Ⅳ(전체시간)" }[operatorOption];
    warnings.push(`충전사업자 부하는 ${basis.dataYear}년 충전소 ${basis.siteCount.toLocaleString("ko-KR")}개소의 시간대별 실측 사용량(연 ${(basis.annualKwh / 1e6).toFixed(1)}GWh)이며, 발령일 당일 부하를 그대로 씁니다. 실측연도가 아닌 날은 같은 계절·요일유형 평균부하로 대체합니다.`);
    warnings.push(`고객 1명은 충전사업자를 이용하는 전기차 1대이며, 기본 ${basis.operatorUserCount.toLocaleString("ko-KR")}대는 도내 운행 전기차 ${basis.operatingEvCount.toLocaleString("ko-KR")}대('25.12)에서 자가소비용 ${basis.selfConsumptionCustomers.toLocaleString("ko-KR")}명을 뺀 값입니다.`);
    warnings.push(`요금은 전기자동차 충전전력요금(충전서비스 제공사업자용) ${resolveEvTariffVoltage("EV_CHARGING_OPERATOR", input.evTariffVoltage) === "HIGH" ? "고압" : "저압"} ${optionLabel}을 적용했습니다.`);
    const dayShiftRate = Math.max(0, Math.min(1, input.operatorDayShiftRate ?? DEFAULT_OPERATOR_DAY_SHIFT_RATE));
    warnings.push(`충전일 이동률 ${(dayShiftRate * 100).toFixed(1)}%: 같은 주 비발령일 충전을 발령일 발령시간으로 옮기며, 100%는 발령시간 부하를 ${basis.dataYear}년 실측 최대 시간당 부하(${(EV_CHARGING_OPERATOR_PEAK_HOURLY_KWH / 1_000).toFixed(1)}MWh)까지 채우는 것입니다. 옮긴 양은 원래 날의 현행단가로 아끼고 발령시간 할인단가로 다시 냅니다.`);
    warnings.push("충전일 이동분의 원래 날 SMP는 기준자료에 없어, 발령일 SMP를 그날 부하 모양으로 가중한 평균으로 대신합니다.");
    warnings.push("1대당 편익은 사업자에게 돌아가는 요금 할인이 충전요금 인하로 이용자에게 전부 전가된다고 볼 때의 값입니다.");
  } else if (input.customerType !== "RESIDENTIAL_TOU") {
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
      dayShiftedEnergyMwh: dayShiftedKwhPerCustomer * targetCustomers / 1_000,
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

/**
 * 발령 1회당 고객 편익(원)을 계산한다.
 * 1회당 편익 = 기준기간 편익 ÷ 발령일수.
 * 발령일수는 할인율·수요이전율과 무관하므로, 역산 과정에서 분모는 고정된다.
 */
export function perEventBenefitWon(input: SimulationInput): number {
  const result = runSimulation(input);
  if (!result.eventDays) return 0;
  return result.customer.annualBenefitPerCustomerWon / result.eventDays;
}

/**
 * 목표 1회당 편익을 달성하는 (할인율, 수요이전율) 조합을 찾는다.
 *
 * 미지수가 둘이고 식이 하나이므로 해는 하나로 정해지지 않는다.
 * 따라서 호출자가 조절을 허용할 변수를 지정한다.
 *  - 한쪽만 허용: 나머지를 현재값으로 고정하고 허용 변수만 이분법으로 탐색
 *  - 둘 다 허용: 현재 두 값의 비율을 유지한 채 같은 배율로 확대(비율 유지 확대)
 *                현재 두 값이 모두 0이면 두 변수를 동일한 값으로 함께 올린다
 *
 * 편익은 두 변수에 대해 단조증가하므로 이분법으로 안정적으로 수렴한다.
 */
export function findTargetBenefitSettings(
  input: SimulationInput,
  options: TargetBenefitSolveOptions,
): TargetBenefitSolution {
  const { targetPerEventBenefitWon, solveDiscount, solveShift } = options;

  const baseDiscount = input.discountRate;
  const baseShift = input.shiftRate;
  const currentPerEvent = perEventBenefitWon(input);

  const baseResult = {
    discountRate: baseDiscount,
    shiftRate: baseShift,
    achievedPerEventBenefitWon: currentPerEvent,
    currentPerEventBenefitWon: currentPerEvent,
    maxReachablePerEventBenefitWon: currentPerEvent,
  };

  if (!runSimulation(input).eventDays) {
    return { ...baseResult, status: "NO_EVENTS" };
  }
  if (!solveDiscount && !solveShift) {
    return { ...baseResult, status: "NO_VARIABLE" };
  }

  // 탐색 파라미터 t(0~1)를 실제 (할인율, 수요이전율)로 변환한다.
  const bothScalable = solveDiscount && solveShift && (baseDiscount > 0 || baseShift > 0);
  const settingsAt = (t: number): { discountRate: number; shiftRate: number } => {
    if (solveDiscount && solveShift) {
      if (bothScalable) {
        // 현재 비율 유지: 큰 쪽이 100%에 닿는 배율을 상한으로 삼는다.
        const maxScale = 1 / Math.max(baseDiscount, baseShift);
        const scale = t * maxScale;
        return {
          discountRate: Math.min(1, baseDiscount * scale),
          shiftRate: Math.min(1, baseShift * scale),
        };
      }
      return { discountRate: t, shiftRate: t };
    }
    if (solveDiscount) return { discountRate: t, shiftRate: baseShift };
    return { discountRate: baseDiscount, shiftRate: t };
  };

  const benefitAt = (t: number) => perEventBenefitWon({ ...input, ...settingsAt(t) });

  const maxReachable = benefitAt(1);
  if (targetPerEventBenefitWon > maxReachable) {
    const at100 = settingsAt(1);
    return {
      ...baseResult,
      ...at100,
      status: "UNREACHABLE",
      achievedPerEventBenefitWon: maxReachable,
      maxReachablePerEventBenefitWon: maxReachable,
    };
  }
  if (targetPerEventBenefitWon <= currentPerEvent) {
    return { ...baseResult, status: "ALREADY_MET", maxReachablePerEventBenefitWon: maxReachable };
  }

  // 이분법 탐색 (편익의 단조증가성 이용)
  let low = 0;
  let high = 1;
  for (let i = 0; i < 40; i += 1) {
    const mid = (low + high) / 2;
    if (benefitAt(mid) < targetPerEventBenefitWon) low = mid;
    else high = mid;
  }

  // 0.1%p 단위로 올림 정렬해 목표를 확실히 충족시킨다.
  const solved = settingsAt(high);
  const round = (value: number) => Math.min(1, Math.ceil(value * 1_000) / 1_000);
  const discountRate = solveDiscount ? round(solved.discountRate) : baseDiscount;
  const shiftRate = solveShift ? round(solved.shiftRate) : baseShift;

  return {
    status: "OK",
    discountRate,
    shiftRate,
    achievedPerEventBenefitWon: perEventBenefitWon({ ...input, discountRate, shiftRate }),
    currentPerEventBenefitWon: currentPerEvent,
    maxReachablePerEventBenefitWon: maxReachable,
  };
}
