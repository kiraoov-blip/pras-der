import type { ApplianceCode } from "./types";

export interface SelectableAppliance {
  code: ApplianceCode;
  label: string;
  category: string;
}

export const SELECTABLE_APPLIANCES: readonly SelectableAppliance[] = [
  { code: "MOBILE_IT", label: "노트북·태블릿·휴대폰 충전", category: "IT·충전" },
  { code: "GAME_CONSOLE", label: "게임콘솔", category: "AV" },
  { code: "DISHWASHER", label: "식기세척기", category: "주방" },
  { code: "FOOD_WASTE_PROCESSOR", label: "음식물처리기", category: "주방" },
  { code: "WASHER", label: "세탁기", category: "세탁·청소" },
  { code: "CLOTHES_DRYER", label: "의류건조기", category: "세탁·청소" },
  { code: "CLOTHING_CARE", label: "의류관리기", category: "세탁·청소" },
  { code: "ROBOT_VACUUM", label: "로봇청소기", category: "세탁·청소" },
  { code: "CORDLESS_VACUUM", label: "무선청소기·충전", category: "세탁·청소" },
  { code: "IRON", label: "다리미·스팀다리미", category: "세탁·청소" },
  { code: "LIVING_ROOM_AC", label: "거실 에어컨", category: "냉방" },
  { code: "HEAT_PUMP_HEATING", label: "히트펌프 난방", category: "난방" },
  { code: "BOILER_CIRCULATION_PUMP", label: "보일러 순환펌프", category: "난방보조" },
] as const;

export const ALL_APPLIANCE_CODES: ApplianceCode[] = SELECTABLE_APPLIANCES.map(({ code }) => code);
