import type { NextConfig } from "next";

const isGitHubPages = process.env.GITHUB_PAGES === "true";
const repositoryName = process.env.GITHUB_REPOSITORY?.split("/")[1] ?? "";
const isAccountPage = repositoryName.endsWith(".github.io");

/**
 * 커스텀 도메인(예: simulator-kepco.co.kr)은 저장소 이름 없이 루트에서 서비스된다.
 * 이때 basePath에 /<저장소명>이 남아 있으면 모든 링크·에셋·iframe 경로가
 * /pras-der 아래를 가리켜 전부 깨지므로, 커스텀 도메인 배포에서는 basePath를 비운다.
 *
 * 워크플로에서 PAGES_CUSTOM_DOMAIN=true 로 켠다.
 * 기본 github.io 주소로만 배포할 때는 이 변수를 지우면 된다.
 */
const hasCustomDomain = process.env.PAGES_CUSTOM_DOMAIN === "true";
const repositoryBasePath =
  isGitHubPages && repositoryName && !isAccountPage && !hasCustomDomain
    ? `/${repositoryName}`
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
    }
  : { env: { NEXT_PUBLIC_BASE_PATH: "" } };

export default nextConfig;
