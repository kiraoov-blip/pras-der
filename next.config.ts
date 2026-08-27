import type { NextConfig } from "next";

const isGitHubPages = process.env.GITHUB_PAGES === "true";
const repositoryName = process.env.GITHUB_REPOSITORY?.split("/")[1] ?? "";
const isAccountPage = repositoryName.endsWith(".github.io");

/**
 * basePath 결정 순서 (우선순위 높은 것부터):
 *
 * 1. PAGES_BASE_PATH 를 명시적으로 지정한 경우 그 값을 그대로 쓴다.
 *    커스텀 도메인(simulator-kepco.co.kr) 루트를 PRAS-DER 전용 허브가 차지하고,
 *    이 앱은 그 아래 /pras 경로에서 서비스되는 지금 배포 구조가 여기 해당한다
 *    (deploy-pages.yml 에서 PAGES_BASE_PATH=/pras 로 켠다).
 * 2. PAGES_CUSTOM_DOMAIN=true 이면서 PAGES_BASE_PATH 가 없으면 basePath를 비운다
 *    — "이 저장소가 다시 도메인 루트를 통째로 차지"하던 이전 배포 방식과의
 *    하위 호환용으로 남겨둔다.
 * 3. 둘 다 없으면 저장소 이름으로 자동 계산한다(project page 기본값, 예: /pras-der).
 */
const explicitBasePath = process.env.PAGES_BASE_PATH ?? "";
const hasCustomDomain = process.env.PAGES_CUSTOM_DOMAIN === "true";
const repositoryBasePath = isGitHubPages
  ? explicitBasePath
    ? explicitBasePath
    : hasCustomDomain
      ? ""
      : repositoryName && !isAccountPage
        ? `/${repositoryName}`
        : ""
  : "";

const nextConfig: NextConfig = isGitHubPages
  ? {
      output: "export",
      trailingSlash: true,
      basePath: repositoryBasePath,
      assetPrefix: repositoryBasePath || undefined,
      images: { unoptimized: true },
      // basePath는 <Link>/next-image에만 자동 적용된다. public/sim 아래
      // 바닐라 시뮬레이터를 가리키는 iframe src는 직접 붙여야 하므로 노출한다.
      env: { NEXT_PUBLIC_BASE_PATH: repositoryBasePath },
      // The shared repository also contains Cloudflare Worker-only source.
      // GitHub Pages application types are checked separately before this build.
      typescript: { ignoreBuildErrors: true },
      headers: async () => [
        {
          source: "/manifest.json",
          headers: [
            { key: "Content-Type", value: "application/manifest+json" },
            { key: "Cache-Control", value: "public, max-age=3600" },
          ],
        },
        {
          source: "/icon-:size(192|512)x:size.png",
          headers: [
            { key: "Content-Type", value: "image/png" },
            { key: "Cache-Control", value: "public, max-age=31536000, immutable" },
          ],
        },
        {
          source: "/icon-maskable-:size(192|512)x:size.png",
          headers: [
            { key: "Content-Type", value: "image/png" },
            { key: "Cache-Control", value: "public, max-age=31536000, immutable" },
          ],
        },
      ],
    }
  : { env: { NEXT_PUBLIC_BASE_PATH: "" } };

export default nextConfig;
