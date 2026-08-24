/**
 * GitHub Pages 프로젝트 페이지는 /<저장소명> 하위에 배포된다.
 * Next.js의 basePath는 <Link>와 next/image에만 자동 적용되고
 * iframe src 같은 원시 속성에는 적용되지 않으므로 직접 붙여준다.
 */
export const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

export function asset(path: string): string {
  return `${BASE_PATH}${path.startsWith("/") ? path : `/${path}`}`;
}
