import type { NextConfig } from "next";

const isGitHubPages = process.env.GITHUB_PAGES === "true";
const repositoryName = process.env.GITHUB_REPOSITORY?.split("/")[1] ?? "";
const isAccountPage = repositoryName.endsWith(".github.io");
const repositoryBasePath =
  isGitHubPages && repositoryName && !isAccountPage ? `/${repositoryName}` : "";

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
