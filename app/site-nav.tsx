"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { SIMULATORS } from "@/lib/simulators";

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
        {/*
          도메인 루트(허브: PRAS-DER/CARE-Jeju 선택 화면)로 돌아가는 버튼.
          next/link의 <Link>는 basePath(/pras)를 자동으로 붙이므로 href="/"를
          써도 실제로는 "/pras"로 이동해버린다 — 허브는 그 바깥(진짜 도메인 루트)에
          있으므로 반드시 순수 <a> 태그로 basePath를 우회한다.
        */}
        <a href="/" className="site-home-btn" aria-label="처음 화면으로">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" aria-hidden focusable={false}>
            <path d="M3.6 11.4 12 4.4l8.4 7" />
            <path d="M5.7 10.2V19a1 1 0 0 0 1 1H9.6v-5.3h4.8V20h2.9a1 1 0 0 0 1-1v-8.8" />
          </svg>
          <span>처음으로</span>
        </a>
      </div>
    </nav>
  );
}
