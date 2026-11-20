"""시간별 SMP 엑셀(육지·제주, 연도별) → build/smp_hourly.parquet + 점검 요약

사용: python3 scripts/build_smp.py <xlsx_dir> build
파일명: smpInLand_YYYY.xlsx / smpJeju_YYYY.xlsx (앞에 붙은 접두어는 무시)
형식: 2행부터 날짜(YYYYMMDD), 1h~24h(원/kWh), 최대·최소·평균. 1h = 00~01시로 해석(사용량 H01과 동일)
"""
import re, sys, json, warnings
from pathlib import Path
import pandas as pd, numpy as np
warnings.simplefilter("ignore")
src, out = Path(sys.argv[1]), Path(sys.argv[2])
frames, report = [], []
for f in sorted(src.glob("*smp*_*.xlsx")):
    m = re.search(r"smp(InLand|Jeju)_(\d{4})", f.name)
    if not m:
        continue
    region = "inland" if m.group(1) == "InLand" else "jeju"
    df = pd.read_excel(f, header=None, skiprows=2)
    df = df[pd.to_numeric(df[0], errors="coerce").notna()]
    dates = pd.to_datetime(df[0].astype(int).astype(str), format="%Y%m%d")
    vals = df.iloc[:, 1:25].apply(pd.to_numeric, errors="coerce").to_numpy(float)
    avg_given = pd.to_numeric(df.iloc[:, 27], errors="coerce").to_numpy(float)
    long = pd.DataFrame({"ts": np.repeat(dates.values, 24) + np.tile(np.arange(24), len(dates)).astype("timedelta64[h]"),
                         "region": region, "smp": vals.ravel()})
    frames.append(long)
    y = int(m.group(2))
    full = pd.date_range(f"{y}-01-01", f"{y}-12-31")
    report.append({"region": region, "year": y, "days": int(len(dates)), "first": str(dates.min().date()), "last": str(dates.max().date()),
                   "missing_days": int(len(full[(full <= dates.max())].difference(dates))), "nan_hours": int(np.isnan(vals).sum()),
                   "zero_or_neg": int((vals <= 0).sum()), "mean": round(float(np.nanmean(vals)), 2),
                   "avg_check_maxdiff": round(float(np.nanmax(np.abs(np.nanmean(vals, 1) - avg_given))), 3)})
smp = pd.concat(frames).sort_values(["region", "ts"]).reset_index(drop=True)
assert not smp.duplicated(["region", "ts"]).any(), "중복 시각"
smp.to_parquet(out / "smp_hourly.parquet", compression="zstd", index=False)
rep = pd.DataFrame(report).sort_values(["region", "year"])
print(rep.to_string(index=False))
(out / "smp_audit.json").write_text(json.dumps(report, ensure_ascii=False, indent=1), encoding="utf-8")
