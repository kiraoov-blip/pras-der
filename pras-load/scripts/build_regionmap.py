"""본부(사용량 데이터) ↔ 시도(전력통계월보) 대응 → build/region_map.json

사용: python3 scripts/build_regionmap.py build
한전 조직표(2차사업소 229개)상 본부 관할이 시도 경계와 어긋나는 곳이 있어 경계가 일치하는 10개 권역으로 묶는다.
 - 인천본부: 인천 + 부천·김포·시흥(경기)          → 수도권(인천·경기)
 - 경기북부본부: 경기 북부 + 개성(월보 '개성(황북)')  → 수도권(인천·경기)
 - 대구본부: 대구 + 경주·포항·경산·김천 등(경북)      → 대구·경북
 - 부산울산본부: 부산·울산 + 김해·양산(경남)          → 부산·울산·경남
 - 광주·전남은 2026.7부터 월보에 '전남광주'로 통합 표기
"""
import json, sys
from pathlib import Path
import numpy as np

B = Path(sys.argv[1])
ZONES = {
    "서울": (["서울본부", "남서울본부"], ["서울"]),
    "인천·경기": (["인천본부", "경기본부", "경기북부본부"], ["인천", "경기", "개성(황북)"]),
    "강원": (["강원본부"], ["강원"]),
    "충북": (["충북본부"], ["충북"]),
    "대전·세종·충남": (["대전세종충남본부"], ["대전", "세종", "충남"]),
    "전북": (["전북본부"], ["전북"]),
    "광주·전남": (["광주전남본부"], ["광주", "전남", "전남광주"]),
    "대구·경북": (["대구본부", "경북본부"], ["대구", "경북"]),
    "부산·울산·경남": (["부산울산본부", "경남본부"], ["부산", "울산", "경남"]),
    "제주": (["제주본부"], ["제주"]),
}
meta = json.loads((B / "meta.json").read_text())
mon = json.loads((B / "monthly.json").read_text())
cube = np.array(json.loads((B / "cube_region.json").read_text())["data"])   # region, year, 12, 3, 24 (MWh)
hq_of = {h: z for z, (hs, _) in ZONES.items() for h in hs}
assert set(hq_of) == set(meta["regions"]), set(meta["regions"]) ^ set(hq_of)
BIG = ["res", "gen", "edu", "ind", "agr", "str", "night", "total"]

cov = {}
for z, (hs, sds) in ZONES.items():
    rows = []
    for yi, y in enumerate(meta["years"]):
        sample = sum(float(cube[meta["regions"].index(h), yi].sum()) for h in hs)
        actual = sum(v for sd in sds for k, v in mon["region_sales"].get(sd, {}).get("total", {}).items() if k.startswith(str(y)))
        rows.append(round(sample / actual * 100, 1) if actual else None)
    cov[z] = rows
doc = {"zones": {z: {"hq": hs, "sido": sds} for z, (hs, sds) in ZONES.items()}, "hq_to_zone": hq_of,
       "coverage_pct": cov, "years": meta["years"],
       "note": "표본 비중 = 시간별 사용량(보정 후) ÷ 월보 시도별 판매량 합. 본부-시도 경계가 맞는 10개 권역 기준."}
(B / "region_map.json").write_text(json.dumps(doc, ensure_ascii=False, indent=1), encoding="utf-8")
print(f"{'권역':12s}", meta["years"])
for z, r in cov.items():
    print(f"{z:12s}", r)
