import SimFrame from "../sim-frame";

// 탭 제목은 app/layout.tsx 의 "PRAS - DER" 하나로 통일한다.
// 라우트별 metadata.title 을 두면 루트 제목을 덮어쓰므로 선언하지 않는다.

export default function Page() {
  return <SimFrame slug="hp" title="히트펌프 요금·편익 분석 시뮬레이터" />;
}
