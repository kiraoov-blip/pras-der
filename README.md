# PRAS-DER — 제주 분산에너지자원 요금·편익 분석 시뮬레이터

제주지역 분산에너지자원(DER)이 고객·한전·계통에 미치는 요금·편익 영향을 분석하는 통합 웹 시뮬레이터입니다.
네 개의 시뮬레이터가 하나의 저장소, 하나의 배포 파이프라인으로 운영됩니다.

| 경로 | 시뮬레이터 | 내용 |
|------|-----------|------|
| `/forecast` | 탐라는 전기예보 | 주택용 TOU·전기차 고객의 예보 할인 효과 |
| `/hp` | 히트펌프 | Cosy 요금제 도입 시 고객·한전 손익 |
| `/ev` | 전기차 충전 | 충전요금 할인과 부하이전 효과 |
| `/pv-ess` | 태양광·ESS | 자가소비·계통연계 수익 구조 |

---

## 통합 단계

이 저장소는 **B안(단일 앱 통합)** 을 단계적으로 진행하는 중입니다.

- **1단계 — 완료.** 네 시뮬레이터가 한 주소·한 배포 파이프라인 아래로 들어왔습니다.
  탐라는 Next.js 라우트로, 나머지 셋은 `public/sim/` 아래 원본 그대로 실려 공용 셸이 감쌉니다.
  **계산 코드는 한 줄도 바뀌지 않았습니다.**
- **2단계 — 완료.** 옮기기 전 계산 결과를 골든 테스트 기준선으로 고정했습니다.
- **3단계 — 진행 예정.** 시뮬레이터를 하나씩 React 컴포넌트로 이관하면서 프레임을 걷어냅니다.
  히트펌프 → 전기차 → 태양광·ESS 순서. 매 단계마다 골든 테스트로 결과 동일성을 확인합니다.

### 1단계에서 바닐라 시뮬레이터를 프레임으로 실은 이유

세 시뮬레이터는 각자 완결된 HTML 문서입니다. 원본을 수정하지 않고 Next.js 안에 넣는 방법은 프레임뿐이며,
목적은 **계산 결과를 건드리지 않은 채 통합 구조를 먼저 세우는 것**입니다.
이 프레임은 3단계에서 시뮬레이터별로 순차 제거될 임시 장치입니다.

---

## 골든 테스트 — 계산 결과 동일성 검증

요금표가 탐라 엔진·전기차·히트펌프에 각각 들어 있어, 통합 과정에서 값이 조용히 달라질 위험이 큽니다.
골든 테스트는 **화면에 실제로 렌더된 계산 결과**를 스냅샷으로 고정해 이를 막습니다.

```bash
npm run test:golden        # 현재 코드를 기준선과 대조 (CI 게이트)
npm run golden:capture     # 기준선 재생성 — 계산을 의도적으로 고쳤을 때만
```

- 대상: 히트펌프 5개 · 전기차 6개 · 태양광 ESS 5개 = **총 16개 시나리오**
- 시나리오 정의: `tests/golden/scenarios.mjs`
- 기준선: `tests/golden/snapshots/*.golden.json`
- 결과가 다르면 **어느 영역의 어느 값이 어떻게 달라졌는지** 출력합니다.

기준선을 다시 뜨는 것은 계산을 의도적으로 변경했을 때뿐입니다.
테스트가 빨간불이라고 해서 습관적으로 `golden:capture`를 돌리면 안전망이 사라집니다.

### 검증 이력

- 이관 전 원본에서 기준선 캡처 → 이관 후 사본과 대조: **16/16 일치**
- 하네스 자체 점검: 충전효율에 0.1% 오차를 일부러 넣었을 때 6개 결과 영역에서 정상 검출
- 태양광·ESS의 `engine.js`·`app.js`·`data.js`·`styles.css`가 `index.html`에서 참조되지 않는 죽은 파일임을 확인해 제거
  (실제 코드는 `index.html` 인라인). 전기차의 미참조 중복 데이터 `*.json` 468KB도 제거

---

## 저장소 구조

```text
app/
  layout.tsx                 공용 셸 — 전역 네비게이션
  site-nav.tsx               시뮬레이터 목록 (여기가 단일 출처)
  sim-frame.tsx              바닐라 시뮬레이터 프레임 호스트 (1단계 임시)
  page.tsx                   랜딩
  forecast/page.tsx          탐라는 전기예보 (React)
  hp|ev|pv-ess/page.tsx      바닐라 시뮬레이터 라우트
  globals.css                PRAS 디자인 시스템 토큰 + 셸 스타일
lib/
  simulator/                 탐라 계산엔진·기준자료·타입
  base-path.ts               GitHub Pages basePath 처리
public/sim/
  hp|ev|pv-ess/              바닐라 시뮬레이터 원본 (무수정)
tests/
  engine-reference.test.ts   탐라 엔진 참조 테스트
  golden/                    바닐라 시뮬레이터 계산 결과 대조
docs/CALCULATION_ENGINE.md   계산방법·기준점·가정
docs/LOGIC_AUDIT.md          원자료 오류와 수정조치
.github/workflows/           골든 테스트 → 빌드 → 배포
```

---

## 로컬 실행

Node.js 22.13 이상이 필요합니다.

```bash
npm ci
npm install --no-save playwright@1.56.0   # 골든 테스트용
npx playwright install chromium
npm run dev
```

> `npm run dev`(Vite)는 `.openai/hosting.json`을 참조합니다. 이 파일은 저장소에 포함되지 않는
> 로컬 전용 설정이라, 없으면 개발 서버가 뜨지 않습니다. GitHub Pages 빌드(`next build`)는
> 이 파일을 쓰지 않으므로 **배포에는 영향이 없습니다.** 개발 서버가 필요하면
> `{"d1":null,"r2":null}` 내용으로 `.openai/hosting.json`을 만들어 두면 됩니다.

검증 명령:

```bash
npm run lint
npm run typecheck
npm run test:engine      # 탐라 엔진 참조 테스트
npm run test:golden      # 바닐라 시뮬레이터 계산 결과 대조
```

정적 빌드:

```bash
GITHUB_PAGES=true npm run build:github-pages   # 결과물은 out/
```

---

## 배포

`main` 브랜치 푸시 시 자동 배포됩니다. 파이프라인은 세 단계입니다.

```
골든 테스트 → 정적 빌드 → Pages 배포
```

계산 결과가 기준선과 다르면 **빌드도 배포도 진행되지 않습니다.**
Pull Request에서는 검증까지만 실행하고 배포는 건너뜁니다.

저장소 `Settings > Pages`에서 배포 소스를 반드시 **GitHub Actions**로 지정하십시오.
`Deploy from a branch`를 선택하면 시뮬레이터 대신 이 README가 표시됩니다.

주소 형식: `https://<계정명>.github.io/pras-der/`
저장소 이름이 달라져도 워크플로가 경로에 자동 반영합니다.

---

## 남은 정리 항목

3단계 착수 전에 처리하면 좋을 것들입니다.

- **히트펌프 인라인 데이터 3.34MB 외부화.** `index.html` 3.4MB 중 97%가 `RAW`·`SMP_BY_YEAR` 데이터입니다.
  JSON으로 분리하고 지연 로딩하면 첫 진입 속도가 크게 개선됩니다.
- **요금표·SMP 단일화.** 제주 TOU 시간대와 EV 단가가 탐라 `lib/simulator/engine.ts`, 전기차, 히트펌프에
  각각 들어 있습니다. 값이 서로 다를 경우 어느 쪽이 옳은지 원 산출 근거로 판정해야 합니다.
- **템플릿 잔여 코드 정리.** `worker/`, `db/`, `drizzle/`, `examples/`는 프로젝트 생성 템플릿의 흔적이고
  앱 코드에서 D1을 참조하지 않습니다. 다만 `vite.config.ts`의 개발 서버가 `worker/`를 물고 있어
  제거 시 `npm run dev` 경로를 함께 손봐야 합니다.
- **차트 방식 통일.** 현재 네 가지입니다 — Chart.js(전기차) · canvas 직접(히트펌프) ·
  SVG 문자열(태양광 ESS) · React SVG(탐라). 3단계 이관과 함께 정리하는 것이 효율적입니다.

---

## 자료 관리 원칙

- 원본자료는 변경하지 않고 별도 보관합니다.
- 시뮬레이터 입력자료는 `data/`의 표준 열 이름으로 변환합니다.
- 원 단위, kWh 단위, 시간대 기준과 부가세·기금 포함 여부를 명시합니다.
- 계산 결과에는 적용한 데이터 기준연도와 엔진 버전을 함께 기록합니다.
