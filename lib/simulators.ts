/**
 * 시뮬레이터 목록 — 네비게이션과 랜딩이 공유하는 단일 출처.
 *
 * 이 파일에 "use client" 를 붙이면 안 된다.
 * 서버 컴포넌트(app/page.tsx)와 클라이언트 컴포넌트(app/site-nav.tsx)가 함께 쓰는데,
 * 클라이언트 모듈에서 값을 내보내면 서버 쪽에는 실제 배열 대신 클라이언트 참조가 넘어가
 * 정적 빌드 중 렌더가 실패한다.
 */
export type SimulatorIcon = "forecast" | "heatpump" | "ev" | "pv-ess";

export type Simulator = {
  href: string;
  /** 상단 네비게이션 라벨 (국문) */
  short: string;
  /** 랜딩 카드 태그 (영문) */
  tag: string;
  name: string;
  desc: string;
  icon: SimulatorIcon;
};

export const SIMULATORS: readonly Simulator[] = [
  {
    href: "/forecast",
    short: "전기예보",
    tag: "Electricity Forecast",
    name: "탐라는 전기예보",
    desc: "주택용 TOU·전기차 고객의 예보 할인 효과",
    icon: "forecast",
  },
  {
    href: "/hp",
    short: "히트펌프",
    tag: "Heatpump",
    name: "히트펌프",
    desc: "Octopus 요금제 도입시 고객과 한전의 요금·편익 분석",
    icon: "heatpump",
  },
  {
    href: "/ev",
    short: "전기차",
    tag: "Electric Vehicle",
    name: "전기차 충전",
    desc: "충전요금 할인과 부하이전 효과",
    icon: "ev",
  },
  {
    href: "/pv-ess",
    short: "PV/ESS",
    tag: "PV/ESS",
    name: "태양광·ESS",
    desc: "자가소비·계통연계 수익 구조",
    icon: "pv-ess",
  },
];
