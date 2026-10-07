# KEPCO Statistics Simulator (`kepco-stat/`)

한국전력통계 세 판을 이어 판매·요금과 발전·설비를 분석하는 단일 페이지 시뮬레이터입니다.
`ember-sim`, `iea-price` 와 같은 구조(단일 `index.html` + 내장 JSON + `vendor/`)를 따릅니다.

## 구성

| 경로 | 내용 |
|---|---|
| `index.html` | 배포 파일. 데이터·글꼴·스타일·스크립트가 모두 들어 있습니다. |
| `vendor/` | html2canvas, SheetJS (ember-sim 과 같은 파일) |
| `src/app.html` | 화면·계산 원본. 수정은 여기서 합니다. |
| `scripts/build_data.py` | 2006년판 PDF · 2012년판 PDF · 2025년판 엑셀 → `build/data.json`, `build/audit.json` |
| `scripts/build_page.py` | `src/app.html` + `build/data.json` → `index.html` |
| `build/audit.json` | 검증 결과, 판 사이 값 차이, 위치로 맞춘 행, 원자료 보정 내역 |

## 다시 만들기

```bash
python3 scripts/build_data.py <2006.pdf> <2012.pdf> <2025.xlsx> build   # pdftotext, openpyxl 필요
python3 scripts/build_page.py ../ember-sim/index.html                   # 공용 스타일·글꼴을 가져옴
```

원본 통계 파일은 저장소에 넣지 않습니다. 새 판이 나오면 `build_data.py` 의 표 정의에 판을 추가합니다.

## 자료 기준

- 수록 연도: 1961년(참고), 1990–2025년. 같은 연도는 최신 판 값을 씁니다.
- 1990–1993년 일반용·교육용·산업용은 합산값(`gis`)만 있습니다. 1997년까지 주택용에는 심야가 포함됩니다.
- 전력손실 2012년, 전력구입실적 1990–2000·2012–2015년은 세 판 어디에도 없습니다.
- 시도별 판매량 2020년 합계는 원자료 합계 칸 오류로 시도 합으로 바꿨습니다.
