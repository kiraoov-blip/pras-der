import type { EventRule, SimulationInput } from "./types";
import { ALL_APPLIANCE_CODES } from "./appliances";

export const DEFAULT_CUSTOMER_COUNTS = {
  RESIDENTIAL_TOU: 1_200,
  EV_TOTAL: 18_327,
  EV_SLOW_LOW_VOLTAGE: 18_327,
  EV_FAST_HIGH_VOLTAGE: 18_327,
  /** 도내 운행 전기차 45,467대('25.12) − 자가소비용 18,327명 */
  EV_CHARGING_OPERATOR: 27_140,
} as const;

export const DEFAULT_EVENT_RULE: EventRule = {
  mode: "ACTUAL",
  startHour: 10,
  endHour: 16,
  smpThresholdWonPerKwh: 0,
};

export const DEFAULT_SIMULATION_INPUT: SimulationInput = {
  analysisYear: 2025,
  seasonFilter: "ALL",
  dayTypeFilter: "ALL",
  customerType: "RESIDENTIAL_TOU",
  evTariffVoltage: "AUTO",
  customerCount: DEFAULT_CUSTOMER_COUNTS.RESIDENTIAL_TOU,
  discountRate: 0.5,
  shiftRate: 0.5,
  shiftMode: "SCENARIO_1",
  selectedAppliances: [...ALL_APPLIANCE_CODES],
  weekendDiscountPriority: true,
  eventRule: DEFAULT_EVENT_RULE,
};

export const REFERENCE_MONTHLY_USAGE_KWH = {
  RESIDENTIAL_TOU: 584,
  EV_TOTAL: 351,
  EV_SLOW_LOW_VOLTAGE: 336,
  EV_FAST_HIGH_VOLTAGE: 400,
  /** 충전소 실측 연 60,240,384kWh ÷ 27,140대 ÷ 12개월 */
  EV_CHARGING_OPERATOR: 185,
} as const;
