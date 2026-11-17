"""계약종별 판매실적(본부 × 계약전력구간 × 계약종, 월별) → build/contract.json

입력: 한전 영업정보 '계약전력구간별 판매실적' xlsx (연도별 1개, 6만5천 행 제한으로 시트가 둘로 나뉨 → 모두 이어 붙임).
  열: 조회기간(YYYY.MM, 문자로 읽어야 10월이 2022.1로 바뀌지 않음), 본부, 계약전력구간(대/소), 계약종별(대/중/소),
      고객호수, 계약전력(kW), 요금적용전력(kW), 판매량(kWh), 판매수입(원), 판매단가, 기본요금, 사용량요금 (+증감 열).
  판매수입 = 기본요금 + 사용량요금 (사용량요금에 기후환경·연료비조정 포함, 복지할인 차감 후). 전 행 검증.
검증: 대분류 × 월 판매량·판매수입·월말 고객호수가 전력통계월보와 일치해야 함(오차 0.01% 초과 시 중단).
정리: 주택용저압 + 주택용고압 → 주택용전력(시간별 자료의 34개 계약종과 맞춤, 저·고압 분리값은 res_split에 보존),
      '구 농사용(을)' → 농사용(을)저압, 같은 키의 중복 행은 합산.
사용: python build_contract.py <xlsx 폴더> <build 폴더>
"""
import json, re, sys
from pathlib import Path
import pandas as pd

src, out = Path(sys.argv[1]), Path(sys.argv[2])
NUM = {"고객호수": "cust", "계약전력": "kwc", "요금적용전력": "kwa", "판매량": "kwh", "판매수입": "rev", "기본요금": "bas", "사용량요금": "en"}
RENAME = {"주택용저압": "주택용전력", "주택용고압": "주택용전력", "구 농사용(을)": "농사용(을)저압"}
BIGKEY = {"주택용": "res", "일반용": "gen", "교육용": "edu", "산업용": "ind", "농사용": "agr", "가로등": "str", "심야": "night"}

frames = []
for f in sorted(src.glob("*.xlsx")):
    xs = pd.read_excel(f, sheet_name=None, header=4, dtype={"조회기간": str})
    A = pd.concat(xs.values(), ignore_index=True)
    A = A[A["조회기간"].astype(str).str.match(r"^\d{4}\.\d{2}$")].copy()
    assert (A["판매수입"] - A["기본요금"] - A["사용량요금"]).abs().max() == 0, f
    frames.append(A)
A = pd.concat(frames, ignore_index=True)
A["ym"] = A["조회기간"].str.replace(".", "-", regex=False)
A["big"] = A["계약종별(대)"].str.replace(" ", "")
A["raw"] = A["계약종별(소)"]
A["t"] = A["raw"].replace(RENAME)
A = A.rename(columns={k: v for k, v in NUM.items()})
A["size"] = A["계약전력구간(대)"]
A["hq"] = A["본부"]

# 월보 대조
M = json.loads((out / "monthly.json").read_text(encoding="utf-8"))
g = A.groupby(["big", "ym"])[["kwh", "rev", "cust"]].sum()
worst = 0
for (b, ym), r in g.iterrows():
    k = BIGKEY[b]
    for col, ref, unit in [("kwh", M["sales"][k].get(ym), 1e3), ("rev", M["rev"][k].get(ym), 1e6), ("cust", M["cust"][k].get(ym), 1)]:
        if ref:
            worst = max(worst, abs(r[col] / (ref * unit) - 1))
assert worst < 1e-4, f"월보 불일치 {worst:.4%}"

months = sorted(A.ym.unique())
years = sorted({m[:4] for m in months})
assert len(months) == 12 * len(years), months
tariffs = json.loads((out / "meta.json").read_text(encoding="utf-8"))["tariffs"]
extra = sorted(set(A.t) - set(tariffs))
assert not extra, extra
SIZES = list(dict.fromkeys(A["size"]))
SIZES.sort(key=lambda s: int(re.match(r"\d+", s).group()))
HQS = list(dict.fromkeys(A["hq"]))
V = ["cust", "kwc", "kwa", "kwh", "rev", "bas", "en"]


def arr(sub, keys, shape_keys):
    gg = sub.groupby(keys)[V].sum()
    return gg


# 계약종 × 연도 × 월
gm = A.groupby(["t", "ym"])[V].sum()
monthly = {}
for t in tariffs:
    monthly[t] = {v: [[int(gm.at[(t, f"{y}-{m:02d}"), v]) if (t, f"{y}-{m:02d}") in gm.index else 0 for m in range(1, 13)] for y in years] for v in V}

# 연간 요약: 본부별·규모별 (고객호수는 12월 말, 요금적용전력은 월 합계)
def annual(keycol, keys):
    s = A.groupby(["t", keycol, A.ym.str[:4]])[["kwh", "rev", "bas", "kwa", "kwc"]].sum()
    c = A[A.ym.str.endswith("-12")].groupby(["t", keycol, A.ym.str[:4]])["cust"].sum()
    res = {}
    for t in tariffs:
        res[t] = {}
        for v in ["kwh", "rev", "bas", "kwa", "kwc", "cust"]:
            src_ = c if v == "cust" else s[v]
            res[t][v] = [[int(src_.get((t, k, y), 0)) for k in keys] for y in years]
    return res


rs = A[A.raw.isin(["주택용저압", "주택용고압"])].groupby(["raw", A.ym.str[:4]])[V].sum()
res_split = {raw: {v: [int(rs.at[(raw, y), v]) if (raw, y) in rs.index else 0 for y in years] for v in V} for raw in ["주택용저압", "주택용고압"]}
dups = int(A.duplicated(["ym", "hq", "계약전력구간(소)", "raw"]).sum())

doc = {
    "source": "한전 영업정보 계약전력구간별 판매실적(월별, 본부 × 계약전력구간 × 계약종, 사용자 제공)",
    "unit": {"cust": "호(월말)", "kwc": "kW", "kwa": "kW(월)", "kwh": "kWh", "rev": "원", "bas": "원", "en": "원"},
    "years": years, "tariffs": tariffs, "sizes": SIZES, "hqs": HQS,
    "monthly": monthly, "by_size": annual("size", SIZES), "by_hq": annual("hq", HQS), "res_split": res_split,
    "note": f"판매수입 = 기본 + 사용량요금(기후·연료 포함, 복지할인 차감 후). 월보와 대분류 × 월 판매량·수입·고객호수 일치(최대 오차 {worst:.5%}). "
            f"주택용저압+고압 → 주택용전력, '구 농사용(을)' → 농사용(을)저압, 중복 키 {dups}행 합산. 요금적용전력·계약전력은 월 합계(kW·월).",
}
(out / "contract.json").write_text(json.dumps(doc, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
print("contract.json ok", years, f"{len(A):,}행", f"월보 최대 오차 {worst:.5%}", f"중복 {dups}")
