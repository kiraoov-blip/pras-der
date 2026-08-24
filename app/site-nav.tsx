"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export const SIMULATORS = [
  { href: "/forecast", short: "전기예보", name: "탐라는 전기예보", desc: "주택용 TOU·전기차 고객의 예보 할인 효과" },
  { href: "/hp", short: "히트펌프", name: "히트펌프", desc: "Cosy 요금제 도입 시 고객·한전 손익" },
  { href: "/ev", short: "전기차", name: "전기차 충전", desc: "충전요금 할인과 부하이전 효과" },
  { href: "/pv-ess", short: "PV/ESS", name: "태양광·ESS", desc: "자가소비·계통연계 수익 구조" },
] as const;

export default function SiteNav() {
  const pathname = usePathname();
  const current = pathname?.replace(/\/$/, "") || "/";

  return (
    <nav className="site-nav" aria-label="시뮬레이터">
      <div className="page-shell site-nav-inner">
        <Link href="/" className="site-brand">
          PRAS<span>DER</span>
        </Link>
        <ul>
          {SIMULATORS.map((sim) => (
            <li key={sim.href}>
              <Link
                href={sim.href}
                className={current === sim.href ? "active" : undefined}
                aria-current={current === sim.href ? "page" : undefined}
              >
                {sim.short}
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </nav>
  );
}
