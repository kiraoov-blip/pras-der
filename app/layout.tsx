import type { Metadata, Viewport } from "next";
import "./globals.css";
import SiteNav from "./site-nav";

export const metadata: Metadata = {
  title: "PRAS - DER",
  description: "제주 분산에너지자원 요금·편익 분석 시뮬레이터 — 전기예보·히트펌프·전기차·태양광/ESS",
  other: {
    "codex-preview": "development",
  },
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
    apple: "/icon-192x192.png",
  },
  manifest: "/manifest.json",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ko">
      <head>
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
        <meta name="apple-mobile-web-app-title" content="PRAS-DER" />
        <link rel="apple-touch-icon" href="/icon-192x192.png" />
        <link rel="apple-touch-icon" sizes="192x192" href="/icon-192x192.png" />
        <link rel="apple-touch-icon" sizes="512x512" href="/icon-512x512.png" />
      </head>
      <body>
        <SiteNav />
        {children}
      </body>
    </html>
  );
}
