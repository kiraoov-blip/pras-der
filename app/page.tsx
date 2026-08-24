import Link from "next/link";
import { SIMULATORS } from "@/lib/simulators";
import SimIcon from "./sim-icon";

export default function Home() {
  return (
    <main>
      <header className="hero">
        <div className="page-shell hero-grid">
          <div className="hero-title">
            <div>
              <h1>제주 분산에너지자원 요금·편익 분석 시뮬레이터(PRAS-DER)</h1>
              <p>Pricing and Revenue Analysis Simulator — Distributed Energy Resources</p>
            </div>
          </div>
        </div>
      </header>

      <div className="page-shell workspace">
        <div className="landing-intro">
          <p>시뮬레이터</p>
          <h2>분석 대상을 선택하세요</h2>
          <span>
            네 개 시뮬레이터가 같은 요금 체계와 SMP 데이터를 기준으로 각각의 분산자원이 고객·한전·계통에 미치는 영향을
            산출합니다.
          </span>
        </div>

        <div className="landing-grid">
          {SIMULATORS.map((sim) => (
            <Link key={sim.href} href={sim.href} className="landing-card">
              <span className="landing-card-tag">{sim.tag}</span>
              <span className="landing-card-head">
                <span className="landing-card-icon">
                  <SimIcon name={sim.icon} />
                </span>
                <strong>{sim.name}</strong>
              </span>
              <p>{sim.desc}</p>
              <span className="landing-card-go" aria-hidden="true">
                분석 열기 →
              </span>
            </Link>
          ))}
        </div>
      </div>

      <footer>
        <div className="page-shell footer-inner">
          <span>PRAS · 분산에너지자원</span>
          <p>시간대별 부하·요금·SMP 재계산 엔진 · 제주 계통 기준</p>
        </div>
      </footer>
    </main>
  );
}
