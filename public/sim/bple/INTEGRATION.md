# PRAS-BPLE 편입 안내

`pras-der` 저장소에 전력수급기본계획 시뮬레이터를 1단계 방식(바닐라 원본을 `public/sim/`
아래 그대로 싣고 `SimFrame` 으로 감싸기)으로 추가합니다. 기존 네 시뮬레이터의 계산
코드에는 손대지 않습니다.

## 1. 그대로 복사할 파일

압축을 푼 뒤 아래 두 경로를 저장소 루트에 덮어씁니다. 모두 **새로 생기는 파일**이라
기존 파일과 충돌하지 않습니다.

```
public/sim/bple/index.html
public/sim/bple/styles.css
public/sim/bple/app.js
public/sim/bple/data/plans.js
app/bple/page.tsx
```

```bash
# 저장소 루트에서
cp -r pras-bple/public/sim/bple public/sim/
cp -r pras-bple/app/bple        app/
```

## 2. 손으로 고칠 파일 — 2곳

### 2-1. `lib/simulators.ts`

`SimulatorIcon` 유니온에 `"bple"` 을 더하고, `SIMULATORS` 배열 끝에 항목을 추가합니다.

```diff
-export type SimulatorIcon = "forecast" | "heatpump" | "ev" | "pv-ess";
+export type SimulatorIcon = "forecast" | "heatpump" | "ev" | "pv-ess" | "bple";
```

```diff
   {
     href: "/pv-ess",
     short: "PV/ESS",
     tag: "PV/ESS",
     name: "태양광·ESS",
     desc: "자가소비·계통연계 수익 구조",
     icon: "pv-ess",
   },
+  {
+    href: "/bple",
+    short: "전기본",
+    tag: "BPLE 1-11",
+    name: "전력수급기본계획",
+    desc: "1~11차 계획 비교와 설비·전원구성 시나리오",
+    icon: "bple",
+  },
 ];
```

> 랜딩(`app/page.tsx`)과 상단 네비(`app/site-nav.tsx`)는 이 배열 하나만 읽으므로
> 따로 고칠 필요가 없습니다.

### 2-2. `app/sim-icon.tsx`

`pv-ess` 분기 **뒤**, 마지막 `return` 앞에 분기를 하나 추가합니다.
작성 규칙(viewBox 24×24, stroke-width 1.6, 요소 간 1.2 단위 간격)을 지켰습니다.

```tsx
  if (name === "bple") {
    // 전력수급기본계획 — 왼쪽 송전철탑, 오른쪽 위로 올라가는 수요전망 꺾은선
    return (
      <svg {...common}>
        <path d="M4.3 20.4 6.6 4.2l2.3 16.2" />
        <path d="M5.2 14.6h3.1M5.6 11.2h2.3M6.0 7.9h1.5" />
        <path d="M13.1 20.4v-4.0M16.5 20.4v-7.1M19.9 20.4v-10.6" />
        <path d="M12.4 8.2l3.4-2.6 4.8 1.1" />
      </svg>
    );
  }
```

## 3. 확인

```bash
npm run typecheck
npm run dev          # http://localhost:3000/bple
```

빌드·배포는 기존 워크플로(`.github/workflows/deploy-pages.yml`)가 그대로 처리합니다.
`public/` 아래는 Next.js 가 정적 내보내기에 자동 포함하므로 워크플로 수정은 없습니다.
배포되면 `simulator-kepco.co.kr/pras/bple/` 에서 열립니다.

## 4. 골든 테스트

이 시뮬레이터는 요금표를 쓰지 않아 기존 16개 시나리오와 겹치는 계산이 없습니다.
`tests/golden/scenarios.mjs` 에 추가하지 않아도 기존 테스트는 그대로 통과합니다.
회귀 고정이 필요하면 KPI 8개(목표수요·목표설비·실효용량·과부족·실현예비율·총발전량·
무탄소비중·온실가스)를 스냅샷 대상으로 잡는 것을 권합니다.

## 5. README 표에 한 줄

```diff
 | `/pv-ess` | 태양광·ESS | 자가소비·계통연계 수익 구조 |
+| `/bple` | 전력수급기본계획 | 1~11차 계획 비교와 설비·전원구성 시나리오 |
```
