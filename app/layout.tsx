import type { Metadata, Viewport } from "next";
import "./globals.css";
import SiteNav from "./site-nav";

export const metadata: Metadata = {
  title: "PRAS-DER",
  description: "제주 분산에너지자원 요금·편익 분석 시뮬레이터 — 전기예보·히트펌프·전기차·태양광/ESS",
  other: { "codex-preview": "development" },
  icons: { icon: "/favicon.svg", shortcut: "/favicon.svg" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ko">
      <body>
        <SiteNav />
        {children}
      </body>
    </html>
  );
}
