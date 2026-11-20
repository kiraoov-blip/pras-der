"""1차 패턴 분석: build/*.json, hourly_tariff.parquet, tariffs.json → build/analysis.json

사용: python3 scripts/analyze.py build
 1. 계약종별 시간대(경·중·최) 사용 비중 — 기존(2016) / 개편(2026) 시간대
 2. 정규화 일부하곡선의 연도별 변화 — 한낮(11~14시) 비중, 저녁(18~21시) 비중
 3. 8760시간 기준 부하율, 연중 최대 발생 월·시
 4. 전력량요금 평균단가 — 같은 부하(최근연도)에 서로 다른 요금표를 적용
"""
import json, sys
from pathlib import Path
import numpy as np
import pandas as pd

B = Path(sys.argv[1])
meta = json.loads((B / "meta.json").read_text())
cube = np.array(json.loads((B / "cube_tariff.json").read_text())["data"])  # T,Y,12,3,24 (MWh)
tar = json.loads((B / "tariffs.json").read_text())
hourly = pd.read_parquet(B / "hourly_tariff.parquet")
T, Y = cube.shape[:2]
years, tariffs = meta["years"], meta["tariffs"]
SOM = np.array(tar["season_of_month"])  # 0 여름 1 봄가을 2 겨울
SK = tar["season_keys"]


def band_map(scheme):
    """(12, 3, 24) 시간대 코드: 토요일 최대→중간, 일·공휴일 전부 경부하"""
    s = tar["tou_schemes"][scheme]
    m = np.zeros((12, 3, 24), int)
    for mo in range(12):
        base = np.array(s[SK[SOM[mo]]])
        m[mo, 0] = base
        m[mo, 1] = np.where(base == 2, 1, base)
        m[mo, 2] = 0
    return m


BANDS = {k: band_map(k) for k in tar["tou_schemes"]}

# ── 계약종 ↔ 요금표 대응 ─────────────────────────────────────────────────────
def tariff_ref(t):
    """(형식, 요금표 키, 선택) — 고압 선택요금은 II를 대표로 사용"""
    v = "고압A" if "고압A" in t else "고압B" if "고압B" in t else "고압C" if "고압C" in t else "저압" if "저압" in t else ""
    if t.startswith("일반용(을)"): return ("tou", "일반용(을)", f"{v}-II")
    if t.startswith("산업용(을)"): return ("tou", "산업용(을)", f"{v}-II")
    if t.startswith("교육용(을)"): return ("tou", "교육용(을)", f"{v}-II")
    if t.startswith("일반용(갑)II"): return ("tou", "일반용(갑)II", f"{v}-II")
    if t.startswith("산업용(갑)II"): return ("tou", "산업용(갑)II", f"{v}-II")
    if t.startswith("일반용(갑)"): return ("flat", "일반용(갑)I", "저압" if v == "저압" else f"{v}-II")
    if t.startswith("산업용(갑)"): return ("flat", "산업용(갑)I", "저압" if v == "저압" else f"{v}-II")
    if t.startswith("교육용(갑)"): return ("flat", "교육용(갑)", "저압" if v == "저압" else f"{v}-II")
    if t == "농사용(갑)": return ("agri", "갑", None)
    if t == "농사용(을)저압": return ("agri", "을저압", None)
    if t.startswith("농사용(을)"): return ("agri", "을고압", None)
    if t == "가로등(을)": return ("street", "을", None)
    if t == "심야전력(갑)": return ("night", "갑", None)
    if t == "심야전력(을)I": return ("night", "을I", None)
    if t == "심야전력(을)II": return ("night", "을II", None)
    if t.startswith("임시전력(을)고압"): return ("tou", "일반용(을)", f"{v}-II")  # 가정: 일반용(을) 준용
    return (None, None, None)  # 주택용(누진, 호수 필요), 가로등(갑), 임시(갑), 임시(을)저압


def price_grid(ver, t, scheme=None):
    """(12,3,24) 원/kWh 전력량요금(기후환경·연료비 제외). 없으면 None"""
    kind, key, opt = tariff_ref(t)
    if kind is None:
        return None
    g = np.zeros((12, 3, 24))
    for mo in range(12):
        s = SOM[mo]
        if kind == "tou":
            o = ver["tou"][key].get(opt)
            if o is None:
                return None
            sch = scheme or ver.get("tou_scheme", "2016")
            if ver.get("tou_scheme_by_class") and key not in ver["tou_scheme_by_class"]:
                sch = scheme or "2016"
            bm = BANDS[sch][mo]
            for d in range(3):
                for h in range(24):
                    g[mo, d, h] = o["energy"][["off", "mid", "peak"][bm[d, h]]][s]
            wd = ver.get("weekend_discount")
            if wd and key in wd["classes"] and SK[s] in wd["seasons"]:
                for d in (1, 2):
                    for h in wd["hours"]:
                        g[mo, d, h] *= wd["rate"]
        elif kind == "flat":
            g[mo] = ver["flat"][key][opt]["energy"][s]
        elif kind == "agri":
            e = ver["agri"][key]["energy"]
            g[mo] = e[s] if isinstance(e, list) else e
        elif kind == "street":
            g[mo] = ver["streetlight"]["을"]["energy"]
        elif kind == "night":
            n = ver["night"][key]
            r = n["winter"] if s == 2 else n["other"]
            if key == "을II":
                night_h = [23, 0, 1, 2, 3, 4, 5, 6, 7, 8]
                g[mo] = n["other_time"]
                g[mo][:, night_h] = r
            else:
                g[mo] = r
    return g


V = {v["effective"]: v for v in tar["versions"]}
res = {"years": years, "tariffs": tariffs, "notes": [
    "고압 선택요금은 선택II를 대표로 적용", "임시전력(을)고압은 일반용(을) 준용 가정",
    "주택용(누진)·가로등(갑)·임시전력(갑/을저압)은 호수·계약 정보가 없어 단가 산정 제외",
    "전력량요금만(기본요금·기후환경·연료비조정 제외)"]}

# 1. 시간대 비중
share = {}
for sch, bm in BANDS.items():
    out = {}
    for ti, t in enumerate(tariffs):
        rows = []
        for yi in range(Y):
            c = cube[ti, yi]
            tot = c.sum()
            rows.append([round(float(c[bm == b].sum() / tot * 100), 2) if tot > 0 else None for b in range(3)])
        out[t] = rows
    share[sch] = out
res["tou_share"] = share

# 2. 정규화 평일 곡선 + 한낮/저녁 비중 (계절별)
prof, midday, evening = {}, {}, {}
for ti, t in enumerate(tariffs):
    P, MD, EV = [], [], []
    for yi in range(Y):
        row, md, ev = [], [], []
        for s in range(3):
            c = cube[ti, yi][SOM == s][:, 0].sum(0)  # 평일
            tot = c.sum()
            p = (c / tot * 24) if tot > 0 else np.zeros(24)
            row.append(np.round(p, 4).tolist())
            md.append(round(float(c[11:14].sum() / tot * 100), 2) if tot > 0 else None)
            ev.append(round(float(c[18:21].sum() / tot * 100), 2) if tot > 0 else None)
        P.append(row); MD.append(md); EV.append(ev)
    prof[t], midday[t], evening[t] = P, MD, EV
res["weekday_profile"] = prof          # [year][season][24] (평균=1)
res["midday_share"] = midday           # [year][season] %
res["evening_share"] = evening

# 3. 부하율·최대 시점 (8760)
lf = {}
for t in tariffs:
    rows = []
    for y in years:
        s = hourly.loc[str(y), t]
        if s.sum() <= 0:
            rows.append(None); continue
        mx = s.idxmax()
        rows.append({"lf": round(float(s.mean() / s.max() * 100), 1), "peak_month": int(mx.month), "peak_hour": int(mx.hour),
                     "peak_dow": int(mx.dayofweek)})
    lf[t] = rows
res["load_factor"] = lf

# 4. 전력량요금 평균단가: 최근연도 부하에 요금표 적용
yi = Y - 1
cases = {
    "2021-01-01": ("2021-01-01", None), "2022-10-01": ("2022-10-01", None), "2023-05-16": ("2023-05-16", None),
    "2023-11-09": ("2023-11-09", None), "2025-04-01": ("2025-04-01", None),
    "2026-04-16": ("2026-04-16", "2026"),
    "2026-04-16(기존시간대)": ("2026-04-16", "2016"),
}
unit = {}
for t_i, t in enumerate(tariffs):
    c = cube[t_i, yi]
    tot = c.sum()
    row = {}
    for name, (ver, sch) in cases.items():
        g = price_grid(V[ver], t, sch)
        row[name] = round(float((c * g).sum() / tot), 2) if g is not None and tot > 0 else None
    unit[t] = row
res["unit_price_latest_load"] = {"load_year": years[yi], "cases": list(cases), "data": unit}

# 개편 영향: 2025.4 요금(기존 시간대) → 2026.4 요금(개편 시간대) 같은 부하
impact = {}
for t in tariffs:
    a, b = unit[t]["2025-04-01"], unit[t]["2026-04-16"]
    if a and b:
        impact[t] = round((b / a - 1) * 100, 2)
res["reform_2026_impact_pct"] = impact
(B / "analysis.json").write_text(json.dumps(res, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
print("analysis.json", (B / "analysis.json").stat().st_size / 1e6, "MB")
