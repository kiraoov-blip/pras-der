import SimFrame from "../sim-frame";

export const metadata = { title: "전기차 충전 · PRAS-DER" };

export default function Page() {
  return <SimFrame slug="ev" title="전기차 충전요금 분석 시뮬레이터" />;
}
