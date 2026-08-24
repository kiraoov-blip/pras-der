import { asset } from "@/lib/base-path";

type Props = {
  /** public/sim 아래 폴더명 */
  slug: string;
  /** 스크린리더용 프레임 제목 */
  title: string;
};

/**
 * 1단계 편입 방식 — 바닐라 시뮬레이터를 원본 그대로 프레임에 싣는다.
 * 계산 코드에 손대지 않으므로 결과값이 변할 여지가 없다.
 * 3단계에서 시뮬레이터를 하나씩 React 컴포넌트로 옮기면서 이 프레임을 걷어낸다.
 */
export default function SimFrame({ slug, title }: Props) {
  return (
    <main className="sim-host">
      <iframe className="sim-frame" src={asset(`/sim/${slug}/index.html`)} title={title} loading="lazy" />
    </main>
  );
}
