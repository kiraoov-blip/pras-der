"""시도·시군구별 판매실적(2016~2025 연간) + 시도별 발전설비·발전량(한국전력통계 8-2, 2018~) → build/region.json

입력
  <시도 xlsx>   : 한전 영업정보 '계약종별 판매실적' 연간 × 시도 × 계약종(소). 판매량 단위 MWh(표 머리말의 kWh는 오기),
                  고객호수·계약전력·요금적용전력은 12개월 합계.
  <시군구 xlsx> : 같은 표의 시군구 단위. 판매량 단위 kWh.
  <통계 폴더>   : 한국전력통계 연도별 xlsx(제88호 2018 ~ 제95호 2025). 시트 '8-2. 행정구역별 발전설비 및 발전량'.
검증: 시도 × 연도 × 대분류 판매량·수입이 월보 연합계와 일치, 시군구 합계 = 시도(판매수입 0.5% 이내),
      판매수입 = 기본 + 개편전 전력량 + 환경비용차감 + 기후환경 + 연료비조정.
정리: '황해북도'(개성공단)·'기타(매칭에러)' 제외. 군위군은 2023.7 대구 편입(2023년엔 두 곳에 나뉨).
      권역: 설계안(2026.8)의 4개 광역 — 수도권 남부(서울 한강 이남 11구·경기 남부), 수도권 북부(서울 한강 이북 14구·
      경기 북부 10개 시군·인천), 중부권(강원·충청·대전·세종), 남부권(경상·전라·부산·대구·울산·광주), 제주(적용 제외).
      경계의 김포·양평은 한강 이남으로 보아 수도권 남부(11개 지역 구분표 수령 시 교체).
사용: python build_region.py <시도 xlsx> <시군구 xlsx> <통계 폴더> <build 폴더>
"""
import json, re, sys
from pathlib import Path
import pandas as pd

sido_f, sgg_f, kstat, out = Path(sys.argv[1]), Path(sys.argv[2]), Path(sys.argv[3]), Path(sys.argv[4])
SHORT = {"서울특별시": "서울", "부산광역시": "부산", "대구광역시": "대구", "인천광역시": "인천", "광주광역시": "광주", "대전광역시": "대전",
         "울산광역시": "울산", "세종특별자치시": "세종", "경기도": "경기", "강원도": "강원", "충청북도": "충북", "충청남도": "충남",
         "전라북도": "전북", "전라남도": "전남", "경상북도": "경북", "경상남도": "경남", "제주특별자치도": "제주"}
SIDO = list(SHORT.values())
BIGS = ["주택용", "일반용", "교육용", "산업용", "농사용", "가로등", "심야"]
BIGKEY = {"주택용": "res", "일반용": "gen", "교육용": "edu", "산업용": "ind", "농사용": "agr", "가로등": "str", "심야": "night"}
SEOUL_N = {"종로구", "중구", "용산구", "성동구", "광진구", "동대문구", "중랑구", "성북구", "강북구", "도봉구", "노원구", "은평구", "서대문구", "마포구"}
GG_N = {"고양시", "남양주시", "파주시", "의정부시", "양주시", "구리시", "포천시", "동두천시", "가평군", "연천군"}
COLS = {"고객호수": "cust", "계약전력": "kwc", "요금적용전력": "kwa", "판매량": "kwh", "판매수입": "rev", "개편전\n전력량요금": "en_pre",
        "환경비용\n차감": "env", "기후환경\n요금": "clim", "연료비\n조정액": "fuel", "기본요금": "bas"}


def region_of(s, g):
    if s == "서울":
        return "수도권북부" if g in SEOUL_N else "수도권남부"
    if s == "경기":
        return "수도권북부" if g in GG_N else "수도권남부"
    if s == "인천":
        return "수도권북부"
    if s in ("강원", "충북", "충남", "대전", "세종"):
        return "중부권"
    if s == "제주":
        return "제주"
    return "남부권"


def load(f):
    A = pd.read_excel(f, header=4, dtype={"조회기간": str})
    A = A[A["조회기간"].astype(str).str.match(r"^\d{4}$")].copy()
    A = A[A["시도"].isin(SHORT)].copy()
    A["s"] = A["시도"].map(SHORT)
    A["big"] = A["계약종별(대)"].str.replace(" ", "")
    A = A.rename(columns=COLS)
    chk = A.bas + A.en_pre + A.env + A.clim + A.fuel - A.rev
    assert chk.abs().max() <= 2, chk.abs().max()
    return A


S = load(sido_f)
S["kwh"] = S["kwh"] * 1e3   # MWh → kWh
G = load(sgg_f)
years = sorted(S["조회기간"].unique())

# 월보 대조
M = json.loads((out / "monthly.json").read_text(encoding="utf-8"))
worst = 0
for (y, b), r in S.groupby(["조회기간", "big"])[["kwh", "rev"]].sum().iterrows():
    k = BIGKEY[b]
    ms = sum(v for m, v in M["sales"][k].items() if m.startswith(y)) * 1e3
    mr = sum(v for m, v in M["rev"][k].items() if m.startswith(y)) * 1e6
    worst = max(worst, abs(r.kwh / ms - 1), abs(r.rev / mr - 1))
assert worst < 1e-4, worst
# 시군구 합계 = 시도
a = G.groupby(["조회기간", "s", "big"]).rev.sum()
b = S.groupby(["조회기간", "s", "big"]).rev.sum()
rel = (a / b - 1).abs().dropna()
assert rel[b.reindex(rel.index) > 1e8].max() < 5e-3, rel.max()

V = ["cust", "kwc", "kwa", "kwh", "rev", "bas", "en_pre", "env", "clim", "fuel"]
gs = S.groupby(["s", "big", "조회기간"])[V].sum()
sido = {s: {bg: {v: [round(float(gs.at[(s, bg, y), v])) if (s, bg, y) in gs.index else 0 for y in years] for v in V} for bg in BIGS} for s in SIDO}
# 산업용 계약종(소)별 시도
ind_t = sorted(S[S.big == "산업용"]["계약종별(소)"].unique())
gi = S[S.big == "산업용"].groupby(["s", "계약종별(소)", "조회기간"])[["kwh", "rev", "kwa", "cust"]].sum()
sido_ind = {s: {t: {v: [round(float(gi.at[(s, t, y), v])) if (s, t, y) in gi.index else 0 for y in years] for v in ["kwh", "rev", "kwa", "cust"]} for t in ind_t} for s in SIDO}

# 시군구: 대분류별 kwh·rev·cust
G["sg"] = G["s"] + " " + G["시군구"].astype(str)
sggs = sorted(G["sg"].unique(), key=lambda x: (SIDO.index(x.split()[0]), x))
gg = G.groupby(["sg", "big", "조회기간"])[["kwh", "rev", "cust", "bas"]].sum()
sgg = []
for k in sggs:
    s, g = k.split(" ", 1)
    sgg.append({"s": s, "g": g, "region": region_of(s, g),
                **{bg: {v: [round(float(gg.at[(k, bg, y), v])) if (k, bg, y) in gg.index else 0 for y in years] for v in ["kwh", "rev", "cust", "bas"]} for bg in BIGS if any((k, bg, y) in gg.index for y in years)}})

# 발전설비·발전량
KEY = {"원자력": "nuclear", "무연탄": "anthracite", "유연탄": "bituminous", "LNG": "lng", "신재생": "renew", "유류": "oil", "양수": "pumped", "기타": "other", "계": "total"}
gen = {}
for f in sorted(kstat.glob("*.xlsx")):
    x = pd.ExcelFile(f)
    sh = [s for s in x.sheet_names if s.startswith("8-2")]
    if not sh:
        continue
    d = pd.read_excel(f, sheet_name=sh[0], header=None).fillna("")
    yr = re.search(r"\((\d{4})\)", str(d.iat[0, 0])).group(1)
    hr = [i for i in range(1, 8) if any("MWh" in str(c) for c in d.iloc[i])][0]
    gcol = [j for j, c in enumerate(d.iloc[hr]) if "MWh" in str(c)][0]
    lab = []
    for j in range(1, d.shape[1]):
        a_, b_ = str(d.iat[hr + 1, j]), str(d.iat[hr + 2, j])
        t = b_ if ("무연탄" in b_ or "유연탄" in b_) else a_
        lab.append((j, next((v for kk, v in KEY.items() if t.strip().startswith(kk) or kk in t.split("\n")[0]), None)))
    rec = {}
    for i in range(hr + 2, d.shape[0]):
        nm = str(d.iat[i, 0]).strip().split()[0] if str(d.iat[i, 0]).strip() else ""
        if nm in SIDO:
            cap = {k: float(d.iat[i, j] or 0) for j, k in lab if k and k != "total" and j < gcol}
            g_ = {k: float(d.iat[i, j] or 0) for j, k in lab if k and k != "total" and j >= gcol}
            cap["coal"] = cap.pop("anthracite", 0) + cap.pop("bituminous", 0)
            g_["coal"] = g_.pop("anthracite", 0) + g_.pop("bituminous", 0)
            rec[nm] = {"cap_kW": {k: round(v) for k, v in cap.items()}, "gen_MWh": {k: round(v) for k, v in g_.items()}}
    assert len(rec) == 17, (f, len(rec))
    gen[yr] = rec

doc = {
    "source": "한전 영업정보 계약종별 판매실적(시도·시군구, 연간) + 한국전력통계 8-2 행정구역별 발전설비 및 발전량",
    "years": years, "sido": SIDO, "bigs": BIGS, "sido_data": sido, "ind_tariffs": ind_t, "sido_ind": sido_ind,
    "sgg": sgg, "gen": gen, "gen_years": sorted(gen),
    "regions": ["수도권남부", "수도권북부", "중부권", "남부권", "제주"],
    "note": "판매량 kWh(시도 원자료 MWh 환산), 고객호수·요금적용전력은 12개월 합계(÷12 = 월평균). 판매수입 = 기본 + 개편전 전력량 + 환경비용차감 + 기후환경 + 연료비조정. "
            "권역은 설계안의 4개 광역 근사(서울 한강 이북 14구·경기 북부 10개 시군·인천 = 수도권 북부, 김포·양평은 남부로 가정). "
            f"월보와 대분류 연합계 일치(최대 오차 {worst:.5%}). 발전량은 발전단(양수 발전 포함), 전력자급률 = 발전량 ÷ 판매량.",
}
(out / "region.json").write_text(json.dumps(doc, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
print("region.json ok", years[0], "~", years[-1], f"시군구 {len(sggs)}", "발전", sorted(gen), f"월보 최대 오차 {worst:.5%}")
