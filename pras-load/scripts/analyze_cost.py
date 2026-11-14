"""원가 신호 분석: SMP·계통부하 × 계약종 시간별 부하 → build/cost.json

사용: python3 scripts/analyze_cost.py build
 - smp_cube      : 연(2016~) × 월 × 날짜유형 × 시 평균 SMP (육지·제주)
 - band_smp      : 기존/개편 시간대별 평균 SMP (단순평균, 계통수요 가중평균)
 - sys_cube      : 연 × 월 × 날짜유형 × 시 평균 총수요(MW). 2016~2020은 표본합 대리(모양만 유효)
 - class_smp     : 계약종별 부하가중 SMP (시간별 정확 계산, 2016~2022)
 - top_load      : 계통 상위 N시간의 계약종별 표본 부하 합(MWh) — 시뮬레이터가 확대계수를 곱해 피크기여율 산정
 - pv            : 태양광(시장·PPA·자가용) 연간 발전량·설비, 순수요 피크 시각 분포
"""
import json, sys
from pathlib import Path
import numpy as np, pandas as pd, holidays

B = Path(sys.argv[1])
meta = json.loads((B / "meta.json").read_text())
tar = json.loads((B / "tariffs.json").read_text())
hourly = pd.read_parquet(B / "hourly_tariff.parquet")            # kWh/h (표본)
smp = pd.read_parquet(B / "smp_hourly.parquet")
sysl = pd.read_parquet(B / "sysload_hourly.parquet")
tariffs = meta["tariffs"]

kr = holidays.KR(years=range(2016, 2027))
HOL = set(pd.to_datetime(list(kr.keys())).normalize())


def dtype_of(idx):
    d = idx.normalize()
    hol = d.isin(list(HOL)) | (idx.dayofweek == 6)
    return np.where(hol, 2, np.where(idx.dayofweek == 5, 1, 0))


def cube_of(series):
    """시간 시계열 → {year: [12][3][24] 평균}"""
    s = series.dropna()
    df = pd.DataFrame({"v": s.values, "y": s.index.year, "m": s.index.month - 1, "d": dtype_of(s.index), "h": s.index.hour})
    g = df.groupby(["y", "m", "d", "h"]).v.mean()
    out = {}
    for y in sorted(df.y.unique()):
        a = np.full((12, 3, 24), np.nan)
        for (m, d, h), v in g.loc[y].items():
            a[m, d, h] = v
        # 비어 있는 칸(예: 해당 월에 그 날짜유형이 없음, 연말 미도래)은 같은 월 다른 유형 → 그대로 None
        out[int(y)] = a
    return out


def r(a, d=2):
    return [[[None if not np.isfinite(x) else round(float(x), d) for x in row] for row in M] for M in a]


res = {"notes": ["SMP 1h = 00~01시, 사용량 H01과 정렬 확인(시간 차분 상관 0.968, ±1시간 0.70~0.73)",
                 "2016~2020 계통부하는 시간별 사용량 표본합으로 대리(2021~22 대조: 총수요의 77.6%, 시간대별 76~79%로 안정)"]}

# ── SMP 큐브 ───────────────────────────────────────────────────────────────
smp_cube = {}
for reg in ("inland", "jeju"):
    s = smp[smp.region == reg].set_index("ts").smp
    smp_cube[reg] = {str(y): r(a) for y, a in cube_of(s).items()}
res["smp_cube"] = smp_cube
res["smp_years"] = sorted(int(y) for y in smp_cube["inland"])

# ── 계통부하 큐브 (2021~ 총수요, 2016~2020 대리) ─────────────────────────────
sample_tot = hourly.sum(axis=1) / 1e3  # MWh/h = MW (표본)
ov = sample_tot.index.intersection(sysl.index)
ratio = float((sample_tot.loc[ov] / sysl.total.loc[ov]).mean())
proxy = sample_tot / ratio
sys_series = pd.concat([proxy[proxy.index < sysl.index.min()], sysl.total])
res["sys_cube"] = {str(y): r(a, 0) for y, a in cube_of(sys_series).items()}
res["sys_source"] = {str(y): ("KPX 총수요" if y >= 2021 else "표본합 대리") for y in sorted(set(sys_series.index.year))}
res["sample_to_total_ratio"] = round(ratio, 4)
res["sample_ratio_by_hour"] = (sample_tot.loc[ov] / sysl.total.loc[ov]).groupby(ov.hour).mean().round(4).tolist()

# ── 시간대별 평균 SMP ───────────────────────────────────────────────────────
SOM = tar["season_of_month"]; SK = tar["season_keys"]


def band_series(idx, scheme):
    sch = tar["tou_schemes"][scheme]
    m, h, d = idx.month - 1, idx.hour, dtype_of(idx)
    base = np.array([[sch[SK[SOM[mm]]][hh] for hh in range(24)] for mm in range(12)])
    b = base[m, h]
    b = np.where(d == 1, np.where(b == 2, 1, b), b)
    b = np.where(d == 2, 0, b)
    return b


band = {}
for reg in ("inland", "jeju"):
    s = smp[smp.region == reg].set_index("ts").smp
    w = sys_series.reindex(s.index)
    out = {}
    for sch in ("2016", "2026"):
        bs = band_series(s.index, sch)
        df = pd.DataFrame({"smp": s.values, "w": w.values, "b": bs, "y": s.index.year})
        rows = {}
        for y, g in df.groupby("y"):
            simple = [float(g[g.b == k].smp.mean()) for k in range(3)]
            gw = g.dropna(subset=["w"])
            wavg = [float((gw[gw.b == k].smp * gw[gw.b == k].w).sum() / gw[gw.b == k].w.sum()) if len(gw[gw.b == k]) else None for k in range(3)]
            rows[str(y)] = {"simple": [round(x, 2) for x in simple], "weighted": [round(x, 2) if x else None for x in wavg]}
        out[sch] = rows
    band[reg] = out
res["band_smp"] = band

# 시간대별(24h) 연평균 SMP 곡선 — 낮 시간 SMP 하락(태양광) 확인용
res["smp_hour_profile"] = {reg: {str(y): g.groupby(g.index.hour).mean().round(2).tolist()
                                 for y, g in smp[smp.region == reg].set_index("ts").smp.groupby(lambda t: t.year)} for reg in ("inland", "jeju")}

# ── 계약종별 부하가중 SMP (정확, 육지 SMP) ─────────────────────────────────
s_in = smp[smp.region == "inland"].set_index("ts").smp.reindex(hourly.index)
sysw = sys_series.reindex(hourly.index)
cls = {}
for t in tariffs:
    rows = []
    for y in meta["years"]:
        L = hourly.loc[str(y), t]; S = s_in.loc[str(y)]
        rows.append(round(float((L * S).sum() / L.sum()), 2) if L.sum() > 0 else None)
    cls[t] = rows
res["class_smp"] = cls
res["system_smp"] = [round(float((sysw.loc[str(y)] * s_in.loc[str(y)]).sum() / sysw.loc[str(y)].sum()), 2) for y in meta["years"]]
res["simple_smp"] = [round(float(s_in.loc[str(y)].mean()), 2) for y in meta["years"]]

# 큐브 근사 오차 점검: 셀 평균 SMP × 셀 부하 vs 시간별 정확
cube_err = []
for yi, y in enumerate(meta["years"]):
    sc = np.array([[[np.nan if v is None else v for v in row] for row in M] for M in smp_cube["inland"][str(y)]])
    idx = hourly.loc[str(y)].index
    m, d, h = idx.month - 1, dtype_of(idx), idx.hour
    approx_smp = sc[m, d, h]
    for t in ("주택용전력", "산업용(을)고압A", "일반용(갑)저압", "심야전력(갑)"):
        L = hourly.loc[str(y), t].values
        exact = (L * s_in.loc[str(y)].values).sum() / L.sum(); appr = np.nansum(L * approx_smp) / L.sum()
        cube_err.append(abs(appr / exact - 1) * 100)
res["cube_approx_max_err_pct"] = round(float(max(cube_err)), 3)

# ── 계통 상위 N시간 계약종 부하 ─────────────────────────────────────────────
top = {}
market_series = pd.concat([proxy[proxy.index < sysl.index.min()], sysl.market])
for key, N, base in (("100", 100, sys_series), ("300", 300, sys_series), ("100m", 100, market_series), ("300m", 300, market_series)):
    d = {t: [] for t in tariffs}
    hours = {}
    for y in meta["years"]:
        sy = base.loc[str(y)]
        th = sy.nlargest(N).index
        hours[str(y)] = {"months": pd.Series(th.month).value_counts().sort_index().to_dict(),
                         "hours": pd.Series(th.hour).value_counts().sort_index().to_dict()}
        for t in tariffs:
            d[t].append(round(float(hourly.loc[th, t].sum() / 1e3), 2))   # MWh (표본)
    top[key] = {"load": d, "when": {k: {kk: {str(a): int(b) for a, b in vv.items()} for kk, vv in v.items()} for k, v in hours.items()}}
res["top_load"] = top

# ── 태양광·순수요 피크 ──────────────────────────────────────────────────────
pv = {}
for y, g in sysl.groupby(sysl.index.year):
    pv[str(y)] = {"gen_TWh": {k: round(float(g[k].sum()) / 1e6, 2) for k in ("pv_kpx", "pv_ppa", "pv_btm")},
                  "total_TWh": round(float(g.total.sum()) / 1e6, 1),
                  "peak_hour_total": int(g.total.idxmax().hour), "peak_hour_market": int(g.market.idxmax().hour),
                  "peak_total_MW": round(float(g.total.max())), "peak_market_MW": round(float(g.market.max())),
                  "top100_market_hours": pd.Series(g.market.nlargest(100).index.hour).value_counts().sort_index().to_dict(),
                  "top100_total_hours": pd.Series(g.total.nlargest(100).index.hour).value_counts().sort_index().to_dict(),
                  "hour_profile_market": g.market.groupby(g.index.hour).mean().round(0).tolist(),
                  "hour_profile_total": g.total.groupby(g.index.hour).mean().round(0).tolist()}
    for k in ("top100_market_hours", "top100_total_hours"):
        pv[str(y)][k] = {str(a): int(b) for a, b in pv[str(y)][k].items()}
res["pv"] = pv

(B / "cost.json").write_text(json.dumps(res, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
print("cost.json", round((B / "cost.json").stat().st_size / 1e6, 2), "MB · cube approx max err", res["cube_approx_max_err_pct"], "%")
