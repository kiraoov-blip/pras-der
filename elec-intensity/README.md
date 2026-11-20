# 전력원단위 시뮬레이터 (elec-intensity)

배포되는 것은 `index.html`·`favicon.svg` 두 개이고, 나머지는 그 `index.html`을 다시 만들기 위한 원본입니다.

| 파일 | 내용 |
|---|---|
| `src/head.html` | 공용 스타일과 내장 글꼴(Pretendard). 색은 빌드할 때 회색·노란색 계열로 바뀝니다 |
| `src/body.html` | 화면 구성(분석 조건·국내 원단위·가정 부문·해외 비교·데이터 표·적용 기준) |
| `src/app.js` | 계산과 그래프 |
| `build/data.json` | 내장 데이터: 한국전력통계 판매량(1995–2025), 한국은행 실질 부가가치, 원단위 계산값, Ember·세계은행 해외 비교(2000–2025) |
| `scripts/build_page.py` | 위 네 개를 합쳐 `index.html` 한 장을 만듭니다 |

다시 만들기: `python3 scripts/build_page.py` → `index.html`이 새로 생깁니다(지금 배포본과 똑같이 나옵니다).

그림·엑셀 저장 모듈은 `/kepco-stat/vendor/`를 함께 씁니다.

데이터를 새 연도로 갱신할 때는 `build/data.json`을 다시 만들어야 합니다. 필요한 자료는 한국전력통계 새 판, 한국은행 ECOS 「경제활동별 GDP 및 GNI(원계열, 실질, 연간)」 CSV, Ember 연간 자료 CSV, 세계은행 WDI GDP 엑셀입니다.
