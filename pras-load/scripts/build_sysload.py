"""계통부하·태양광 엑셀(시트: KPX, PPA, BTM, PPA+BTM, 시장수요(후), 계통수요(후), 총수요(후)) → build/sysload_hourly.parquet

사용: python3 scripts/build_sysload.py <xlsx> build
단위 MW. 1시 = 00~01시로 해석. 계통수요 = 시장수요 + PPA 태양광, 총수요 = 계통수요 + 자가용(BTM) 태양광.
"""
import sys, json, warnings
from pathlib import Path
import numpy as np, pandas as pd
warnings.simplefilter("ignore")
src, out = Path(sys.argv[1]), Path(sys.argv[2])
SHEETS = {"시장수요(후)": "market", "계통수요(후)": "grid", "총수요(후)": "total", "KPX": "pv_kpx", "PPA": "pv_ppa", "BTM": "pv_btm"}
cols = {}
cap = {}
for sh, key in SHEETS.items():
    df = pd.read_excel(src, sheet_name=sh, header=None)
    hdr = [str(x) for x in df.iloc[0]]
    h1 = hdr.index("1시")
    body = df.iloc[1:]
    dates = pd.to_datetime(body[0], errors="coerce")
    body, dates = body[dates.notna()], dates[dates.notna()]
    vals = body.iloc[:, h1:h1 + 24].apply(pd.to_numeric, errors="coerce").to_numpy(float)
    ts = np.repeat(dates.values, 24) + np.tile(np.arange(24), len(dates)).astype("timedelta64[h]")
    cols[key] = pd.Series(vals.ravel(), index=pd.DatetimeIndex(ts))
    if "설비용량" in hdr:
        cap[key] = pd.Series(pd.to_numeric(body.iloc[:, hdr.index("설비용량")], errors="coerce").to_numpy(), index=dates.values)
S = pd.DataFrame(cols).sort_index()
assert not S.index.duplicated().any()
# 항등식 점검
chk = {"grid-market-ppa_maxabs": float((S.grid - S.market - S.pv_ppa).abs().max()),
       "total-grid-btm_maxabs": float((S.total - S.grid - S.pv_btm).abs().max())}
S.astype("float32").to_parquet(out / "sysload_hourly.parquet", compression="zstd")
capdf = pd.DataFrame(cap)
capdf.to_parquet(out / "pv_capacity_daily.parquet")
info = {"start": str(S.index.min()), "end": str(S.index.max()), "hours": int(len(S)), "nan": int(S.isna().sum().sum()), "identity": chk,
        "annual_peak_total_MW": {str(y): float(g.total.max()) for y, g in S.groupby(S.index.year)},
        "btm_capacity_MW_last": {k: float(v.dropna().iloc[-1]) for k, v in capdf.items()}}
(out / "sysload_audit.json").write_text(json.dumps(info, ensure_ascii=False, indent=1), encoding="utf-8")
print(json.dumps(info, ensure_ascii=False, indent=1))
