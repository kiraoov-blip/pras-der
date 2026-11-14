"""
PRAS-LOAD 데이터 빌드: 계약종·본부·산업종별 시간별 사용량(연도별 parquet) → 시뮬레이터용 집계

사용:
    python3 scripts/build_data.py <parquet_dir> build

<parquet_dir> 에는 year=YYYY.parquet 파일을 둔다(원본 CSV를 변환한 것, 저장소에 넣지 않음).
열: 계약종, 본부, 산업종, 검침일(YYYYMMDD), H01..H24 (kWh, H01 = 00~01시)

처리 순서
 1. 날짜 유형: 평일(wd) / 토요일(sat) / 일요일·공휴일(hol)  — holidays.KR 기준
 2. 전국 단위 수집장애일 판정 (결측 비중, 같은 요일유형 이동중앙값 대비 총량, 행 수)
 3. 조합(계약종×본부×산업종)-일 단위 유효성: 결측 시간 없음 & 장애일 아님
 4. 조합별 (월, 날짜유형) 평균 일부하곡선을 유효일로 계산
 5. 조합이 존재한 달의 모든 날짜를 채운 격자 생성: 유효일은 실측, 나머지는 평균곡선으로 대체
 6. 격자에서 각종 집계 산출

산출물(build/)
 - meta.json          차원 목록, 계약종 분류, 날짜유형 일수, 장애일 목록
 - cube_tariff.json   계약종 × 연 × 월 × 날짜유형 × 시 (합계 kWh)
 - cube_industry.json 산업종 × (동일)
 - cube_region.json   본부 × (동일)
 - cube_cross.json    중분류×산업종, 중분류×본부 : 연 × 계절 × 날짜유형 × 시
 - daily_tariff.json  계약종 × 날짜 일사용량
 - audit.json         보정 내역(장애일, 연도·계약종별 실측 대비 보정 총량)
 - hourly_tariff.parquet  계약종 × 8760시간 (SMP·계통부하 연계용, 배포 안 함)
"""
import json
import sys
from pathlib import Path

import holidays
import numpy as np
import pandas as pd

SRC, OUT = Path(sys.argv[1]), Path(sys.argv[2])
OUT.mkdir(parents=True, exist_ok=True)
H = [f"H{i:02d}" for i in range(1, 25)]
KEYS = ["계약종", "본부", "산업종"]
DTYPES = ["wd", "sat", "hol"]
SEASON_OF_MONTH = {1: 2, 2: 2, 3: 1, 4: 1, 5: 1, 6: 0, 7: 0, 8: 0, 9: 1, 10: 1, 11: 2, 12: 2}  # 0 여름 1 봄가을 2 겨울
SEASONS = ["여름", "봄가을", "겨울"]

# ── 계약종 분류 ───────────────────────────────────────────────────────────────
def classify(t: str) -> tuple[str, str]:
    """(대분류, 중분류). 중분류는 갑I/갑II 같은 선택요금 구분을 합쳐 연도간 비교가 되게 한다."""
    for g in ["주택용", "일반용", "교육용", "산업용", "농사용", "가로등", "심야전력", "임시전력"]:
        if t.startswith(g):
            big = g.replace("전력", "") if g in ("심야전력", "임시전력") else g
            break
    else:
        big = "기타"
    mid = t
    if big in ("일반용", "산업용", "교육용", "농사용", "임시"):
        kind = "을" if "(을)" in t else "갑"
        volt = "저압" if "저압" in t else ("고압" if "고압" in t else "")
        mid = f"{big}({kind}){volt}" if big != "농사용" or kind == "을" else "농사용(갑)"
    elif big == "심야":
        mid = "심야전력(갑)" if "(갑)" in t else "심야전력(을)"
    elif big == "가로등":
        mid = "가로등"
    return big, mid


# ── 1. 날짜 ─────────────────────────────────────────────────────────────────
years = sorted(int(p.stem.split("=")[1]) for p in SRC.glob("year=*.parquet"))
kr = holidays.KR(years=years)
cal = pd.DataFrame({"date": pd.date_range(f"{years[0]}-01-01", f"{years[-1]}-12-31", freq="D")})
cal["year"], cal["month"] = cal.date.dt.year, cal.date.dt.month
cal["dtype"] = np.where(cal.date.isin(pd.to_datetime(list(kr.keys()))) | (cal.date.dt.dayofweek == 6), 2,
                        np.where(cal.date.dt.dayofweek == 5, 1, 0))
cal["ymd"] = cal.date.dt.strftime("%Y%m%d").astype(int)
cal_days = cal.groupby(["year", "month", "dtype"]).size()  # 날짜유형별 일수

# ── 1차 패스: 차원 수집 + 전국 일별 통계 ─────────────────────────────────────
cats = {k: set() for k in KEYS}
nat = []
for y in years:
    df = pd.read_parquet(SRC / f"year={y}.parquet")
    for k in KEYS:
        cats[k] |= set(df[k].astype(str).unique())
    v = df[H].to_numpy()
    nat.append(pd.DataFrame({"ymd": df["검침일"].to_numpy(), "rows": 1, "nullh": np.isnan(v).sum(1),
                             "kwh": np.nansum(v, 1)}).groupby("ymd").sum())
    print(f"pass1 {y}", flush=True)
cats = {k: sorted(v) for k, v in cats.items()}
cats["계약종"] = sorted(cats["계약종"], key=lambda t: (["주택용", "일반용", "교육용", "산업용", "농사용", "가로등", "심야", "임시"].index(classify(t)[0]) if classify(t)[0] in ["주택용", "일반용", "교육용", "산업용", "농사용", "가로등", "심야", "임시"] else 99, t))
tclass = {t: classify(t) for t in cats["계약종"]}
mids = list(dict.fromkeys(tclass[t][1] for t in cats["계약종"]))

nat = pd.concat(nat).join(cal.set_index("ymd")[["dtype"]])
nat["null_share"] = nat.nullh / (nat.rows * 24)
for col in ("kwh", "rows"):
    nat[col + "_exp"] = nat.groupby("dtype")[col].transform(lambda x: x.rolling(11, center=True, min_periods=5).median())
nat["ratio"] = nat.kwh / nat.kwh_exp
nat["row_ratio"] = nat.rows / nat.rows_exp
is_hol = nat.dtype == 2
bad = (nat.null_share > 0.03) | (nat.row_ratio < 0.9) | \
      (~is_hol & ((nat.ratio < 0.8) | (nat.ratio > 1.2))) | (is_hol & ((nat.ratio < 0.6) | (nat.ratio > 1.4)))
bad_days = set(nat.index[bad])
print(f"수집장애일 {len(bad_days)}일", flush=True)

# ── 2차 패스: 격자 보정 + 집계 ──────────────────────────────────────────────
tid = {t: i for i, t in enumerate(cats["계약종"])}
iid = {t: i for i, t in enumerate(cats["산업종"])}
rid = {t: i for i, t in enumerate(cats["본부"])}
mid_of_t = np.array([mids.index(tclass[t][1]) for t in cats["계약종"]])
NY = len(years)
cube_t = np.zeros((len(tid), NY, 12, 3, 24))
cube_i = np.zeros((len(iid), NY, 12, 3, 24))
cube_r = np.zeros((len(rid), NY, 12, 3, 24))
cross_mi = np.zeros((len(mids), len(iid), NY, 3, 3, 24))
cross_mr = np.zeros((len(mids), len(rid), NY, 3, 3, 24))
daily_t = {}
hourly = []
audit_years = []

for yi, y in enumerate(years):
    df = pd.read_parquet(SRC / f"year={y}.parquet")
    c = cal[cal.year == y].reset_index(drop=True)
    ndays = len(c)
    d_index = pd.Series(np.arange(ndays), index=c.ymd)
    di = d_index.loc[df["검침일"].to_numpy()].to_numpy()
    seg = df.groupby(KEYS, observed=True).ngroup().to_numpy()
    segs = df[KEYS].astype(str).drop_duplicates().assign(_s=0)
    segs = df.assign(_s=seg)[KEYS + ["_s"]].drop_duplicates("_s").sort_values("_s")
    nseg = len(segs)
    v = df[H].to_numpy(dtype=np.float32)
    valid = ~np.isnan(v).any(1) & ~df["검침일"].isin(bad_days).to_numpy()
    month = c.month.to_numpy()[di] - 1
    dt = c.dtype.to_numpy()[di]

    # 4. 조합 × 월 × 날짜유형 평균곡선 (유효일)
    cell = (seg * 12 + month) * 3 + dt
    ncell = nseg * 36
    s = np.zeros((ncell, 24)); n = np.zeros(ncell)
    np.add.at(s, cell[valid], v[valid]); np.add.at(n, cell[valid], 1)
    # 해당 날짜유형 유효일이 없으면 같은 달 다른 유형 → 같은 계절 평균으로 대체
    avg = np.divide(s, n[:, None], out=np.full_like(s, np.nan), where=n[:, None] > 0).reshape(nseg, 12, 3, 24)
    with np.errstate(all="ignore"):
        import warnings; warnings.simplefilter("ignore", RuntimeWarning)
        month_avg = np.nanmean(avg, axis=2)  # nseg,12,24
    fill_dt = np.isnan(avg[..., 0])
    avg = np.where(fill_dt[..., None], month_avg[:, :, None, :], avg)

    # 5. 격자
    #  - 그 달 유효일이 50% 이상인 조합(상시 계량)은 행이 없는 날도 평균곡선으로 채움
    #  - 드문드문 들어오는 조합은 실제 들어온 행만 반영 (없는 날 = 0)
    #  - 장애일이 아닌 날의 일부 결측 시간은 그 시간만 평균곡선으로 채움
    #  - 장애일 행은 평균곡선으로 대체 (평균이 없으면 실측값, 결측은 0)
    cm, cd = c.month.to_numpy() - 1, c.dtype.to_numpy()
    # 분모에서 장애일 제외: 장애일이 많은 달(2020.3 등)에도 상시 계량 조합을 놓치지 않게
    bad_in_year = np.array([d in bad_days for d in c.ymd.to_numpy()])
    days_in_m = np.maximum(np.bincount(cm[~bad_in_year], minlength=12), 1)
    nvalid_m = np.zeros((nseg, 12)); np.add.at(nvalid_m, (seg[valid], month[valid]), 1)
    dense = nvalid_m / days_in_m >= 0.5
    grid = np.full((nseg, ndays, 24), np.nan, dtype=np.float32)
    for m in range(12):
        days_m = np.where(cm == m)[0]
        sm = np.where(dense[:, m])[0]
        if len(sm):
            grid[np.ix_(sm, days_m)] = avg[sm, m][:, cd[days_m], :]
    avg_row = avg[seg, month, dt].astype(np.float32)
    on_bad = df["검침일"].isin(bad_days).to_numpy()
    filled = np.where(np.isnan(v), avg_row, v)
    filled = np.where(on_bad[:, None] & ~np.isnan(avg_row), avg_row, filled)
    filled = np.where(np.isnan(filled), np.nan_to_num(v), filled)
    grid[seg, di] = filled
    still = np.isnan(grid)
    grid[still] = 0.0

    present_any = np.zeros((nseg, 12), bool); present_any[seg, month] = True

    # 실측 대비 보정 총량
    raw_t = pd.Series(np.nansum(v, 1)).groupby(df["계약종"].astype(str).to_numpy()).sum()
    sti = segs["계약종"].astype(str).map(tid).to_numpy()
    sii = segs["산업종"].astype(str).map(iid).to_numpy()
    sri = segs["본부"].astype(str).map(rid).to_numpy()
    seg_day = grid.sum(2)  # nseg, ndays
    adj_t = pd.Series(seg_day.sum(1)).groupby(segs["계약종"].astype(str).to_numpy()).sum()
    audit_years.append({
        "year": y, "rows": int(len(df)), "segments": int(nseg),
        "valid_rows_pct": round(float(valid.mean() * 100), 2),
        "bad_days": int(sum(1 for d in bad_days if d // 10000 == y)),
        "dense_segment_months_pct": round(float(dense[present_any].mean() * 100), 1),
        "partial_rows_filled": int((np.isnan(v).any(1) & ~on_bad).sum()),
        "raw_GWh": round(float(np.nansum(v)) / 1e6, 1), "adjusted_GWh": round(float(grid.sum()) / 1e6, 1),
        "by_tariff_pct_change": {t: round(float(adj_t[t] / raw_t[t] * 100 - 100), 2) for t in raw_t.index if raw_t[t] > 0},
    })

    # 6. 집계
    md = (cm * 3 + cd)  # 날짜별 (월,유형) 인덱스
    seg_md = np.zeros((nseg, 36, 24))
    for k in range(36):
        dd = np.where(md == k)[0]
        if len(dd):
            seg_md[:, k] = grid[:, dd].sum(1)
    seg_md = seg_md.reshape(nseg, 12, 3, 24)
    np.add.at(cube_t[:, yi], sti, seg_md)
    np.add.at(cube_i[:, yi], sii, seg_md)
    np.add.at(cube_r[:, yi], sri, seg_md)
    seas = np.array([SEASON_OF_MONTH[m + 1] for m in range(12)])
    seg_sd = np.zeros((nseg, 3, 3, 24))
    for si in range(3):
        seg_sd[:, si] = seg_md[:, seas == si].sum(1)
    smi = mid_of_t[sti]
    np.add.at(cross_mi[:, :, yi], (smi, sii), seg_sd)
    np.add.at(cross_mr[:, :, yi], (smi, sri), seg_sd)

    # 일별·시간별 (계약종)
    t_hour = np.zeros((len(tid), ndays, 24))
    for i in np.unique(sti):
        t_hour[i] = grid[sti == i].sum(0)
    for t, i in tid.items():
        daily_t.setdefault(t, []).extend(np.round(t_hour[i].sum(1) / 1e3, 1).tolist())  # MWh
    hourly.append(pd.DataFrame(t_hour.transpose(1, 2, 0).reshape(ndays * 24, len(tid)), columns=cats["계약종"],
                               index=pd.date_range(f"{y}-01-01", periods=ndays * 24, freq="h")))
    del grid, df, v
    print(f"pass2 {y}: valid {valid.mean():.1%}", flush=True)


# ── 저장 ────────────────────────────────────────────────────────────────────
def q(a, scale=1e3):
    """kWh → MWh, 소수 둘째 자리."""
    return np.round(a / scale, 2).tolist()


def q4(a, scale=1e3):
    """kWh → MWh, 유효숫자 4자리 (용량 절감용: 산업종·교차 집계)."""
    x = np.asarray(a, dtype=float) / scale
    with np.errstate(divide="ignore", invalid="ignore"):
        e = np.where(x > 0, np.floor(np.log10(np.abs(x))) - 3, 0)
    return (np.round(x / 10 ** e) * 10 ** e).round(6).tolist()


def dump(name, obj):
    p = OUT / name
    p.write_text(json.dumps(obj, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"  {name}: {p.stat().st_size / 1e6:.2f} MB")


meta = {
    "unit": "MWh (집계 값), 원자료 kWh",
    "hour": "0 = 00~01시 (원자료 H01)",
    "years": years, "dtypes": DTYPES, "dtype_labels": ["평일", "토요일", "일요일·공휴일"],
    "seasons": SEASONS, "season_of_month": [SEASON_OF_MONTH[m] for m in range(1, 13)],
    "tariffs": cats["계약종"], "industries": cats["산업종"], "regions": cats["본부"], "mids": mids,
    "tariff_class": {t: {"big": b, "mid": m} for t, (b, m) in tclass.items()},
    "days": {str(y): cal_days.loc[y].unstack(fill_value=0).reindex(index=range(1, 13), columns=range(3), fill_value=0).to_numpy().tolist() for y in years},
    "dates_start": str(cal.date.iloc[0].date()),
    "bad_days": sorted(int(d) for d in bad_days),
    "holidays": sorted(int(d.strftime("%Y%m%d")) for d in kr.keys()),
}
dump("meta.json", meta)
dump("cube_tariff.json", {"dims": ["tariff", "year", "month", "dtype", "hour"], "data": q(cube_t)})
dump("cube_industry.json", {"dims": ["industry", "year", "month", "dtype", "hour"], "data": q4(cube_i)})
dump("cube_region.json", {"dims": ["region", "year", "month", "dtype", "hour"], "data": q(cube_r)})


def sparse_cross(arr, names_b, min_share=0.005):
    """중분류 안에서 마지막 연도 비중이 min_share 미만인 조합은 '기타'로 합친다(용량 절감)."""
    out = {}
    for a in range(arr.shape[0]):
        tot = arr[a, :, -1].sum()
        if tot <= 0:
            continue
        rest = np.zeros(arr.shape[2:])
        for b in range(arr.shape[1]):
            if arr[a, b].sum() <= 0:
                continue
            if arr[a, b, -1].sum() / tot >= min_share:
                out[f"{mids[a]}|{names_b[b]}"] = q4(arr[a, b])
            else:
                rest += arr[a, b]
        if rest.sum() > 0:
            out[f"{mids[a]}|기타(소규모 합계)"] = q4(rest)
    return out


dump("cube_cross.json", {"dims": ["year", "season", "dtype", "hour"],
                         "mid_industry": sparse_cross(cross_mi, cats["산업종"]),
                         "mid_region": sparse_cross(cross_mr, cats["본부"])})
dump("daily_tariff.json", {"unit": "MWh/일", "start": meta["dates_start"], "data": daily_t})

nat_out = nat.reset_index()[["ymd", "dtype", "rows", "null_share", "ratio", "row_ratio"]]
nat_bad = nat_out[nat_out.ymd.isin(bad_days)].round(3)
dump("audit.json", {
    "rule": "장애일 = 결측비중>3% 또는 행수<이동중앙값90% 또는 총량이 같은 날짜유형 11일 이동중앙값 대비 "
            "평일·토 0.8~1.2배, 일·공휴일 0.6~1.4배를 벗어남",
    "imputation": "장애일·결측 포함일·누락일은 같은 조합의 같은 달·같은 날짜유형 유효일 평균곡선으로 대체",
    "years": audit_years,
    "bad_days": nat_bad.to_dict(orient="records"),
})
pd.concat(hourly).astype("float32").to_parquet(OUT / "hourly_tariff.parquet", compression="zstd")
print("done")
