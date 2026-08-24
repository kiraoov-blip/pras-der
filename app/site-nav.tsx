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
      </div>
    </nav>
  );
}
