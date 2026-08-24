export type AnalysisYear = 2024 | 2025 | 2026;
export type AnalysisSeason = "ALL" | "SHOULDER" | "SUMMER" | "WINTER";
export type AnalysisDayType = "ALL" | "WEEKDAY" | "WEEKEND";
export type EvTariffVoltage = "AUTO" | "LOW" | "HIGH";

export type CustomerTypeCode =
  | "RESIDENTIAL_TOU"
  | "EV_TOTAL"
  | "EV_SLOW_LOW_VOLTAGE"
  | "EV_FAST_HIGH_VOLTAGE";

export type LoadShiftMode =
  | "SCENARIO_1"
  | "RES_SCENARIO_2"
  | "EV_SCENARIO_2_1"
  | "EV_SCENARIO_2_2";
export type EventMode = "ACTUAL" | "RULE";
export type ApplianceCode =
  | "MOBILE_IT"
  | "GAME_CONSOLE"
  | "DISHWASHER"
  | "FOOD_WASTE_PROCESSOR"
  | "WASHER"
  | "CLOTHES_DRYER"
  | "CLOTHING_CARE"
  | "ROBOT_VACUUM"
  | "CORDLESS_VACUUM"
  | "IRON"
  | "LIVING_ROOM_AC"
  | "HEAT_PUMP_HEATING"
  | "BOILER_CIRCULATION_PUMP";

export interface EventRule {
  mode: EventMode;
  startHour: number;
  endHour: number;
  smpThresholdWonPerKwh: number;
}

export interface SimulationInput {
  analysisYear: AnalysisYear;
  seasonFilter: AnalysisSeason;
  dayTypeFilter: AnalysisDayType;
  customerType: CustomerTypeCode;
  /** EV charging speed and tariff supply voltage are separate dimensions. */
  evTariffVoltage: EvTariffVoltage;
  customerCount: number;
  discountRate: number;
  /** Share of technically movable load that actually responds (0-1). */
  shiftRate: number;
  shiftMode: LoadShiftMode;
  selectedAppliances: ApplianceCode[];
  /** Appliance-specific realization ratio (0-1) against each appliance's maximum movable load. */
  applianceShiftRates?: Partial<Record<ApplianceCode, number>>;
  weekendDiscountPriority: boolean;
  eventRule: EventRule;
}

export interface CustomerResult {
  currentAnnualBillWon: number;
  newAnnualBillWon: number;
  annualBenefitPerCustomerWon: number;
  totalAnnualBenefitWon: number;
}

export interface UtilityResult {
  currentSalesRevenueWon: number;
  newSalesRevenueWon: number;
  salesRevenueChangeWon: number;
  smpPurchaseCostChangeWon: number;
  shortTermNetImpactWon: number;
}

export interface RevenueNeutralDiscountResult {
  /** 0.1%p 단위로 선택된 발령시간 할인율(0-1). */
  discountRate: number;
  /** 선택 할인율 적용 후 단기 순재무영향. */
  shortTermNetImpactWon: number;
  /** 0-100% 범위 안에서 이론상 매출중립점이 존재하는지 여부. */
  neutralPointWithinRange: boolean;
}

export interface GridResult {
  shiftedEnergyMwh: number;
  eventWindowLoadIncreaseMwh: number;
  curtailmentReductionMwh: number;
}

export interface SimulationResult {
  engineVersion: string;
  eventDays: number;
  eventHours: number;
  /** EV 시나리오에서 충전일과 발령일이 겹치는 계산상 기대일수. */
  evChargingEventDays: number;
  targetCustomers: number;
  selectedApplianceCount: number;
  selectableApplianceCount: number;
  selectedApplianceShare: number;
  applianceMaximumShares: Record<ApplianceCode, number>;
  applianceConfiguredShares: Record<ApplianceCode, number>;
  monthlyEventDays: number[];
  baseLoadProfile: number[];
  shiftedLoadProfile: number[];
  customer: CustomerResult;
  utility: UtilityResult;
  grid: GridResult;
  warnings: string[];
}
