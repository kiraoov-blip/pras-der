import type { SimulatorIcon } from "@/lib/simulators";

/**
 * 시뮬레이터 아이콘 — 선형 SVG.
 *
 * 색은 지정하지 않고 currentColor 를 따른다. 부모(.landing-card-icon)가
 * 색을 정하므로 카드 상태나 테마가 바뀌어도 함께 움직인다.
 *
 * 작성 규칙
 *   - viewBox 24×24, stroke-width 1.6 으로 굵기를 통일
 *   - 22~23px 로 축소해 쓰이므로 요소끼리 최소 1.2 단위 간격을 둔다
 *   - 형상이 겹치면 작은 크기에서 뭉개지므로 겹치지 않게 배치한다
 */
export default function SimIcon({ name }: { name: SimulatorIcon }) {
  const common = {
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.6,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true,
    focusable: false,
  };

  if (name === "forecast") {
    // 예보 — 왼쪽 위 해, 오른쪽 아래 구름. 서로 닿지 않게 분리
    return (
      <svg {...common}>
        <circle cx="7.6" cy="6.6" r="2.5" />
        <path d="M7.6 1.9v1.1M7.6 10.2v1.1M4.3 3.3l.78.78M10.12 9.12l.78.78M2.9 6.6h1.1M11.2 6.6h1.1M4.3 9.9l.78-.78M10.12 4.08l.78-.78" />
        <path d="M10.4 20.4h7.7a3.2 3.2 0 0 0 .35-6.38 4.5 4.5 0 0 0-8.6-1.1 3.75 3.75 0 0 0 .55 7.48Z" />
      </svg>
    );
  }

  if (name === "heatpump") {
    // 히트펌프 — 실외기 본체와 팬, 오른쪽으로 퍼지는 열 파형
    return (
      <svg {...common}>
        <rect x="2.6" y="6.4" width="12.6" height="11.2" rx="1.9" />
        <circle cx="8.9" cy="12" r="3.3" />
        <circle cx="8.9" cy="12" r="0.35" fill="currentColor" stroke="none" />
        <path d="M18.6 8.7c-1.15 1.05-1.15 2.25 0 3.3s1.15 2.25 0 3.3" />
        <path d="M21.7 8.7c-1.15 1.05-1.15 2.25 0 3.3s1.15 2.25 0 3.3" />
      </svg>
    );
  }

  if (name === "ev") {
    // 전기차 충전 — 차체는 아래쪽에, 번개는 위쪽 여백에 분리 배치
    return (
      <svg {...common}>
        <path d="M12.6 4.9 9.7 9.4h2.85l-1.15 3.9 3.9-4.85h-2.9l1.2-3.55Z" />
        <path d="M2.7 18.5v-3.2l1.75-3.95a1.85 1.85 0 0 1 1.7-1.15h2.2" />
        <path d="M21.3 18.5v-3.2l-1.5-3.4" />
        <path d="M16.6 10.2h1.55a1.85 1.85 0 0 1 1.65 1.05" />
        <path d="M2.7 18.5h1.6M19.7 18.5h1.6M9.5 18.5h5" />
        <circle cx="6.9" cy="18.7" r="1.85" />
        <circle cx="17.1" cy="18.7" r="1.85" />
      </svg>
    );
  }

  // 태양광·ESS — 위쪽에 태양광 패널, 아래 오른쪽에 배터리 모듈
  return (
    <svg {...common}>
      <path d="M2.6 11.4 4.75 4.6a1.15 1.15 0 0 1 1.1-.8h8.9a1.15 1.15 0 0 1 1.1.8l1.05 3.3" />
      <path d="M2.6 11.4h9.75M5.2 7.5h9.2M9.9 3.8 8.6 11.4" />
      <path d="M7.55 11.4v2.4M4.9 13.8h5.3" />
      <rect x="13.9" y="13.1" width="7.5" height="7.3" rx="1.6" />
      <path d="M16.1 13.1v-1.15M19.2 13.1v-1.15" />
      <path d="M18.3 15 16.75 17.1h1.95L17.15 19.2" />
    </svg>
  );
}
