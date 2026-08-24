# 입력자료 표준

계산엔진에 연결할 자료는 원본 엑셀을 직접 참조하지 않고, 아래 CSV 형식으로 변환하여 관리합니다. 시간은 `Asia/Seoul` 기준을 원칙으로 합니다.

## event_calendar.csv

시간별 제주 SMP와 발령 여부를 관리합니다.

| 열 | 형식 | 설명 |
|---|---|---|
| timestamp | ISO 8601 | 시간 시작 시각 |
| smp_won_per_kwh | number | 제주 SMP |
| is_event | 0 또는 1 | 실제 발령 여부 |
| source | text | 자료 출처 또는 버전 |

## load_profile.csv

고객유형별 시간당 기준 사용량을 관리합니다.

| 열 | 형식 | 설명 |
|---|---|---|
| timestamp | ISO 8601 | 시간 시작 시각 |
| customer_type | code | 고객유형 코드 |
| usage_kwh | number | 고객당 또는 표본 합계 사용량 |
| sample_count | integer | 표본 고객 수 |

## tariff.csv

현행 및 신규 요금 단가를 관리합니다.

| 열 | 형식 | 설명 |
|---|---|---|
| tariff_id | text | 요금제 식별자 |
| season | text | 계절 구분 |
| day_type | text | 평일·토요일·공휴일 구분 |
| time_band | text | 경부하·중간부하·최대부하 구분 |
| start_hour | integer | 적용 시작 시각 |
| end_hour | integer | 적용 종료 시각 |
| energy_rate_won_per_kwh | number | 전력량요금 단가 |

템플릿 파일의 예시 행은 열 형식을 설명하기 위한 값이므로 실제 분석 전에 공식 자료로 교체해야 합니다.
