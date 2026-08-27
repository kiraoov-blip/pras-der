import type { Metadata, Viewport } from "next";
import "./globals.css";
import SiteNav from "./site-nav";
import { asset } from "@/lib/base-path";

/**
 * icons/manifest는 Next의 <Link>/next-image와 달리 basePath가 항상 자동으로
 * 붙는다고 보장할 수 없어(버전에 따라 동작이 갈렸던 이력이 있음) lib/base-path.ts의
 * asset()으로 명시적으로 붙인다. public/manifest.json 자체의 경로(start_url,
 * icons, screenshots, shortcuts)도 이 앱이 항상 /pras 아래에서 서비스된다는
 * 전제로 같이 고쳐뒀다(public/manifest.json 참고).
 */
export const metadata: Metadata = {
  title: "PRAS - DER",
  description: "제주 분산에너지자원 요금·편익 분석 시뮬레이터 — 전기예보·히트펌프·전기차·태양광/ESS",
  other: {
    "codex-preview": "development",
    "apple-mobile-web-app-capable": "yes",
    "apple-mobile-web-app-status-bar-style": "black-translucent",
    "apple-mobile-web-app-title": "PRAS-DER",
  },
  icons: {
    icon: asset("/favicon.svg"),
    shortcut: asset("/favicon.svg"),
    apple: [
      { url: asset("/icon-192x192.png"), sizes: "192x192" },
      { url: asset("/icon-512x512.png"), sizes: "512x512" },
    ],
  },
  manifest: asset("/manifest.json"),
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "PRAS-DER",
  },
  formatDetection: {
    telephone: false,
  },
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
