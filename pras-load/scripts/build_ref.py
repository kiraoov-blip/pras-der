"""kepco-stat/build/data.json(한국전력통계) → build/kepco_ref.json : 계약종 대분류별 판매·수입·호수·요금적용전력, 구입단가, 손익

사용: python3 scripts/build_ref.py ../kepco-stat/build/data.json build
단위(원자료): 판매량 MWh, 판매수입 천원, 요금적용전력 kW, 단가 원/kWh, 손익 백만원
"""
import json, sys
from pathlib import Path

src, out = Path(sys.argv[1]), Path(sys.argv[2])
d = json.loads(src.read_text(encoding="utf-8"))
ys = d["years"]
i0 = ys.index(2016)
years = ys[i0:]
cut = lambda a: a[i0:]
groups = {"res": "주택용", "gen": "일반용", "edu": "교육용", "ind": "산업용", "agr": "농사용", "str": "가로등", "night": "심야"}
ref = {"years": years, "groups": groups,
       "unit": {"sales": "MWh", "rev": "천원", "cust": "호", "kw": "kW", "price": "원/kWh", "pur_price": "원/kWh", "fin": "백만원"},
       "source": "한국전력통계(kepco-stat/build/data.json)"}
for t in ("sales", "rev", "cust", "kw", "price"):
    ref[t] = {k: cut(d["tables"][t][k]) for k in list(groups) + ["total"]}
ref["pur_price"] = cut(d["tables"]["pur"]["tp"])     # 전력구입 평균단가
ref["pur_amount"] = cut(d["tables"]["pur"]["ta"])    # 전력구입비 (백만원)
ref["pur_volume"] = cut(d["tables"]["pur"]["tv"])    # 구입전력량 (MWh)
ref["fin"] = {k: cut(d["tables"]["fin"][k]) for k in ("rev", "cost", "opinc")}
ref["sold"] = cut(d["tables"]["loss"]["sold"])
(out / "kepco_ref.json").write_text(json.dumps(ref, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
print("kepco_ref.json", years[0], "-", years[-1])
