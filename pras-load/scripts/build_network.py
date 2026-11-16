"""송배전 이용요금 총괄원가(사용자 제공 표) → build/network.json

사용: python3 scripts/build_network.py build
 - 송전 총괄원가 추이표의 연도 = 결산연도('19 = '20 개정단가의 기준 결산, '24 = '25 단가 기준).
 - 배전 추이표의 연도 = 요금 적용연도('25 = '24 결산 기준) → 결산연도 = 표 연도 − 1.
 - 송전 적정원가(A) 비중은 상세표('20·'25)에서 0.79로 같아 연도별 총액에 적용.
 - 비어 있는 결산연도(송전 2020, 배전 2018·2020)는 앞뒤 선형보간, 2025 결산은 2024 값 사용.
단위: 억원, 배전이용요금 기본 원/kW(월), 전력량 원/kWh.
"""
import json, sys
from pathlib import Path

out = Path(sys.argv[1])
TX_TOTAL = {2015: 29489, 2016: 32865, 2017: 36376, 2018: 37781, 2019: 38097, 2021: 43692, 2022: 37951, 2023: 40595, 2024: 42367}  # 결산연도
TX_DETAIL = {"2006": {"A": 18714, "B": 7316, "total": 26030}, "2019결산": {"A": 30123, "B": 7974, "total": 38097},
             "2024결산": {"A": 33515, "B": 8852, "total": 42367, "opex": 33754, "rate_base": 278359, "roi": 3.18}}
# 배전: 표 연도(적용연도) → (A, B, A+B, 저압 기본, 저압 전력량, 고압 기본, 고압 전력량)
DX = {2014: (28720, 8564, 37284, 931, 10.38, 827, 3.15), 2015: (27536, 9091, 36627, 807, 10.50, 944, 3.13),
      2016: (29978, 7910, 37888, 797, 10.70, 978, 3.19), 2017: (35572, 8957, 44529, 1113, 12.27, 813, 3.62),
      2018: (36776, 7226, 44003, 925, 12.12, 1007, 3.48), 2020: (34832, 5969, 40801, 1066, 11.33, 548, 3.05),
      2022: (35762, 7839, 43601, 909, 11.81, 842, 3.11), 2023: (36078, 5345, 41424, 843, 10.98, 756, 2.86),
      2024: (36266, 6281, 42547, 852, 11.20, 611, 2.97), 2025: (37210, 6790, 44000, 984, 12.28, 742, 3.04)}
TX_RATE = {"현행(2020)": {"basic_demand": 667.61, "usage_demand": {"수도권": 2.44, "비수도권": 1.42, "제주": 6.95}},
           "2025": {"basic_demand": 760.58, "usage_demand": {"수도권": 2.71, "비수도권": 1.66, "제주": 9.31}}}
A_SHARE_TX = round(TX_DETAIL["2024결산"]["A"] / TX_DETAIL["2024결산"]["total"], 4)


def interp(d, years):
    ks = sorted(d)
    res = {}
    for y in years:
        if y in d:
            res[y] = d[y]
        elif y > ks[-1]:
            res[y] = d[ks[-1]]
        elif y < ks[0]:
            res[y] = d[ks[0]]
        else:
            lo = max(k for k in ks if k < y); hi = min(k for k in ks if k > y)
            w = (y - lo) / (hi - lo)
            res[y] = tuple(a + (b - a) * w for a, b in zip(d[lo], d[hi])) if isinstance(d[lo], tuple) else d[lo] + (d[hi] - d[lo]) * w
    return res


years = list(range(2016, 2026))
tx = interp(TX_TOTAL, years)
dx = interp({k - 1: v for k, v in DX.items()}, years)   # 결산연도 기준으로 이동
doc = {"unit": "억원 (요금 원/kW·월, 원/kWh)", "years": years,
       "tx": {str(y): {"total": round(tx[y]), "A": round(tx[y] * A_SHARE_TX), "B": round(tx[y] * (1 - A_SHARE_TX)),
                       "interpolated": y not in TX_TOTAL} for y in years},
       "dx": {str(y): {"A": round(dx[y][0]), "B": round(dx[y][1]), "total": round(dx[y][2]),
                       "low": {"basic": round(dx[y][3], 1), "energy": round(dx[y][4], 2)}, "high": {"basic": round(dx[y][5], 1), "energy": round(dx[y][6], 2)},
                       "interpolated": (y + 1) not in DX} for y in years},
       "tx_detail": TX_DETAIL, "tx_rate": TX_RATE, "tx_A_share": A_SHARE_TX,
       "notes": ["송전 추이표 연도=결산연도, 배전 추이표 연도=적용연도(결산+1)로 해석해 결산연도 기준으로 정렬",
                 "송전 A/B는 연도별 총액에 '24결산 상세 비중(A 79.1%) 적용", "결측 결산연도는 선형보간, 2025 결산은 2024 값",
                 "배전 고압 단가는 22.9kV(고압A) 기준 — 154kV 이상(고압B·C)은 배전망 미이용으로 배전원가 배분 제외"]}
(out / "network.json").write_text(json.dumps(doc, ensure_ascii=False, indent=1), encoding="utf-8")
for y in years:
    print(y, "송전", doc["tx"][str(y)], "| 배전", {k: doc["dx"][str(y)][k] for k in ("A", "B", "total", "low", "high")})
