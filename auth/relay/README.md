# 접근 승인 중계 주소 (auth.simulator-kepco.co.kr)

회사망에서는 `script.google.com`(승인 서버)이 막혀 로그인이 안 된다. 우리 도메인 아래에 중계 주소를 두면
브라우저는 `auth.simulator-kepco.co.kr`에만 접속하고, 구글과의 통신은 Cloudflare가 대신한다.

```
브라우저 ──▶ auth.simulator-kepco.co.kr (Cloudflare Worker) ──▶ Apps Script 승인 서버 ──▶ 시트
```

- 비용: Cloudflare Workers 무료 플랜(하루 10만 건)으로 충분하다.
- 저장하는 데이터는 없다. 받은 요청을 그대로 전달하고 답을 돌려줄 뿐이다.
- `gate.js`는 중계 주소로 먼저 보내고, 연결이 안 되면 기존 Apps Script 주소로 바로 보낸다.
  그래서 중계가 멈춰도 회사망 밖에서는 지금처럼 로그인된다.

## 설정 순서

### 1. 도메인을 Cloudflare에 연결 (처음 한 번)
1. https://dash.cloudflare.com 가입 → **Add a domain** → `simulator-kepco.co.kr` 입력 → **Free** 플랜.
2. 기존 DNS 레코드를 자동으로 가져온다. 아래가 그대로 있는지 확인한다(GitHub Pages).
   - `A  @  185.199.108.153` / `.109.153` / `.110.153` / `.111.153`
   - `CNAME  www  kiraoov-blip.github.io` (있는 경우)
   - 그 밖에 메일(MX) 등 쓰던 레코드가 있으면 모두 있는지 확인
   - GitHub Pages 레코드는 **프록시 끔(회색 구름, DNS only)** 으로 둔다. 켜 두면 GitHub의 HTTPS 인증서 갱신이 꼬일 수 있다.
3. Cloudflare가 알려 주는 네임서버 2개를 도메인을 산 곳(가비아·후이즈 등)의 **네임서버 설정**에 넣는다.
4. Cloudflare 화면에 **Active**가 뜰 때까지 기다린다(보통 수십 분~몇 시간). 그동안 사이트는 그대로 열린다.

### 2. 중계 Worker 만들기
1. Cloudflare 왼쪽 메뉴 **Workers & Pages → Create → Create Worker** → 이름 `sim-auth-relay` → **Deploy**.
2. **Edit code**에서 기본 코드를 지우고 이 폴더의 `worker.js` 내용을 그대로 붙여 넣은 뒤 **Deploy**.

### 3. 우리 도메인 주소 붙이기
1. 만든 Worker → **Settings → Domains & Routes → Add → Custom domain**.
2. `auth.simulator-kepco.co.kr` 입력 → **Add domain**. DNS 레코드와 HTTPS 인증서는 Cloudflare가 자동으로 만든다(몇 분).

### 4. 확인
1. 브라우저에서 `https://auth.simulator-kepco.co.kr` 를 연다 → "시뮬레이터 접근 승인 중계가 동작 중입니다."
2. **회사망 PC에서도** 같은 주소가 열리는지 확인한다. 열리면 회사망에서도 로그인된다.
   새 하위 주소를 보안 장비가 "미분류"로 막는 경우가 있으면 전산 부서에 이 주소 하나만 허용 요청한다.
3. 시뮬레이터에서 로그인해 본다.

## 바꿔야 할 때
- Apps Script를 **새 배포**로 올려 `/exec` 주소가 바뀌면: `worker.js`의 `TARGET`과 `auth/gate.js`의 `API`를 함께 고친다.
  (기존 배포를 "버전 수정"으로 올리면 주소가 그대로라 고칠 것이 없다.)
- 중계를 끄려면 `auth/gate.js`의 `RELAY`를 `''`로 비운다.
