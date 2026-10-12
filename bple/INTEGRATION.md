# BPLE 편입 안내 — 허브 직속 제품 방식

전력수급기본계획 시뮬레이터를 `/pras` 안이 아니라 **도메인 루트 허브의 일곱 번째 제품**으로
싣습니다. `kepco-stat/`, `ember-sim/`, `iea-price/` 와 똑같은 "루트에 커밋된 정적 폴더" 구조라
Next.js 빌드와 무관하게 동작합니다.

```
simulator-kepco.co.kr/            → hub/index.html   (카드 7장)
simulator-kepco.co.kr/bple/       → bple/index.html  ← 새로 추가
```

---

## 1단계 — `/pras` 에 넣었던 것 되돌리기

**먼저 이것부터 하세요.** 순서를 지키지 않으면 타입체크가 깨져 배포가 중단됩니다.

### 1-1. 폴더 두 개 삭제

```
public/sim/bple/      ← 폴더째 삭제
app/bple/             ← 폴더째 삭제
```

### 1-2. `lib/simulators.ts` 원복

`revert/lib-simulators.ts` 의 내용으로 통째로 되돌립니다. 손으로 지우실 거라면
`SimulatorIcon` 유니온의 `| "bple"` 와 `SIMULATORS` 배열의 `/bple` 항목 두 군데입니다.

### 1-3. `app/sim-icon.tsx` 의 `bple` 분기 삭제

> **중요.** 1-2 만 하고 이걸 빠뜨리면 **빌드가 실패합니다.** `SimulatorIcon` 에서 `"bple"` 가
> 빠진 뒤에도 `if (name === "bple")` 가 남아 있으면 TypeScript 가 "비교 대상 타입이 겹치지
> 않는다"는 오류를 냅니다. `npm run typecheck` 가 빌드 앞에 있어서 배포가 거기서 멈춥니다.
>
> 반대로 1-3 만 하고 1-2 를 안 하면 빌드는 통과하지만 카드 아이콘이 태양광·ESS 로 나옵니다.
> **두 개를 같은 커밋에 함께 넣으세요.**

아이콘 분기를 아예 추가하지 않으셨다면 1-3 은 건너뛰면 됩니다.

---

## 2단계 — 새로 추가할 것

### 2-1. 기존 `bple/` 를 지우고 새로 올리기

> **이미 `bple/` 를 올리셨다면 폴더를 통째로 지운 뒤 새로 올려주세요.** 예전 구조의
> `bple/styles.css` · `bple/app.js` · `bple/data/` 가 남아 있으면 저장소가 지저분해지고,
> 그 경로를 캐시에 들고 있는 브라우저가 낡은 화면을 계속 보여줄 수 있습니다.
> 새 `index.html` 은 그 파일들을 아예 참조하지 않으므로, 지우고 나면 재발하지 않습니다.

```bash
rm -rf bple
cp -r pras-bple-hub/bple ./bple
```

레포 루트에 `bple/` 가 생깁니다. `kepco-stat/` 와 같은 층입니다.

```
bple/
├ index.html            배포되는 단일 파일 (글꼴·CSS·JS·데이터 모두 내장)
├ favicon.svg
├ README.md
├ src/                  소스 — 고칠 때는 여기를 고친다
│  ├ app.html  styles.css  app.js  data/plans.js
└ scripts/build_page.py  src/ → index.html
```

IEA · EMBER · KEPCO Statistics 와 같이 **배포물이 `index.html` 한 장**이다. 외부
네트워크 요청이 0건이고, 같은 경로에 예전 버전이 올라가 있었더라도 브라우저가 낡은
CSS·JS 를 캐시에서 꺼내 쓰는 일이 없다. `src/` 와 `scripts/` 는 저장소에만 두고
배포에는 싣지 않는다(kepco-stat 와 동일).

### 2-2. 파일 두 개 교체

둘 다 **전체 교체**입니다. 기존 파일을 열고 전체 선택 후 붙여넣으세요.

| 교체할 파일 | 바뀐 내용 |
|---|---|
| `hub/index.html` | 7곳 수정 — 로컬 브랜드 토큰, 카드 CSS, 카드 마크업, 그리드 열 수, meta/intro/footer 문구 |
| `.github/workflows/deploy-pages.yml` | 2곳 수정 — 상단 주석에 경로 한 줄, 조립 단계에 `bple/index.html` · `favicon.svg` 복사 |

---

## 바뀐 내용 상세

### `hub/index.html`

1. **로컬 브랜드 토큰** — `--bple-brand` 계열(그래파이트). 기존 여섯 제품이
   파랑·세이지·주황·보라·와인·네이비를 쓰고 있어 무채색이 유일하게 비어 있는 자리입니다.
2. **카드 CSS** — `.landing-card.bple` 블록. 구조와 spacing 은 건드리지 않고 색만 덮어씁니다.
3. **카드 마크업** — KEPCO Statistics 바로 다음, 그리드의 마지막.
4. **그리드 열 수** — 3열 → **4열**. 카드가 7장이 되면 3열에서 `3+3+1` 로 마지막 줄에 한 장만
   남습니다. 4열이면 `4+3` 이라 외톨이가 없습니다. 카드 4장이던 시절과 같은 폭
   (1480px 컨테이너에서 약 345px)이라 이미 검증된 배치이고, 1250px 아래 2열 /
   820px 아래 1열 분기는 그대로입니다.
5. **meta description · intro 문구 · footer 문구** — 제품 목록에 BPLE 추가.

### `.github/workflows/deploy-pages.yml`

조립 단계 끝에 한 줄입니다. `bple/` 는 외부 의존성이 CDN 의 Chart.js 하나뿐이라
`kepco-stat` 처럼 vendor 폴더를 가려 담을 필요가 없어 폴더째 복사합니다.

```yaml
          # bple(전력수급기본계획)도 같은 방식의 정적 폴더다. kepco-stat 처럼
          # src/ 와 scripts/ 는 소스일 뿐이고 배포에는 빌드 산출물인 index.html 과
          # favicon 만 싣는다. 글꼴·CSS·JS·데이터가 모두 그 한 장 안에 들어 있다.
          mkdir -p public-root/bple
          cp bple/index.html bple/favicon.svg public-root/bple/
```

---

## 3단계 — 확인

main 에 push 하면 Actions 가 돌고 2~3분 뒤 반영됩니다.

```
https://simulator-kepco.co.kr/?cb=1        ← 카드 7장, 마지막이 전력수급기본계획
https://simulator-kepco.co.kr/bple/?cb=1   ← 시뮬레이터 본체
```

GitHub Pages 는 HTML 에 10분짜리 캐시 헤더를 붙입니다. 바로 안 보이면 주소 끝에
`?cb=1` 처럼 아무 쿼리나 붙여 캐시를 우회하거나 강력 새로고침(`Ctrl/Cmd+Shift+R`)하세요.

`/pras/bple/` 와 `/pras/sim/bple/` 는 1단계를 거치면 사라집니다. 혹시 그 주소를 공유하신
적이 있다면 `/bple/` 로 안내해 주세요.

---

## 검증 결과

로컬에서 Chromium 으로 실제 렌더해 확인했습니다.

- 허브 카드 **7장**, 순서 PRAS-DER → PRAS-TOU → CARE-Jeju → IEA → EMBER → KEPCO → **전력수급기본계획**
- 데스크톱 **4열**(4+3), 1480px·400px 모두 가로 스크롤 0px
- 시뮬레이터: 1480 / 760 / 400px 세 폭에서 콘솔 에러 0건, 가로 스크롤 0px
- 7개 섹션 모두 하단 여백 **0px** (고정 높이 차트를 없앤 결과)
- 글꼴 `document.fonts.check('700 16px Pretendard')` = true, 외부 네트워크 요청 **0건**
- 11개 계획 전부 목표수요·실효용량이 공표치와 일치 (오차 0.06GW 이내)
- KPI 카드 높이 **126px** — IEA·EMBER·KEPCO 와 동일 규격
- 범례 토글 왕복 동작 확인, 버튼 조작 시 토스트·입력 강조 표시 확인
- 렌더된 본문 전체에 반말 문장 0건
- "처음으로" 버튼 `href="/"` — 다른 독립 시뮬레이터와 같은 규약
- 워크플로 YAML 파싱 및 조립 단계 명령 확인
