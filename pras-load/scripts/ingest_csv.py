"""ZIP(CSV, cp949) -> 연도별 Parquet 변환. 사용: python ingest.py ZIP_DIR RAW_DIR OUT_DIR"""
import sys, zipfile, time
from pathlib import Path
import pandas as pd

zip_dir, raw_dir, out_dir = map(Path, sys.argv[1:4])
raw_dir.mkdir(parents=True, exist_ok=True)
out_dir.mkdir(parents=True, exist_ok=True)
H = [f"H{i:02d}" for i in range(1, 25)]
EXPECTED = ["계약종", "본부", "산업종", "검침일"] + H

for z in sorted(zip_dir.glob("계약종_*.zip")):
    year = int(z.stem.split("_")[1])
    out = out_dir / f"year={year}.parquet"
    if out.exists():
        print(f"[skip] {year}")
        continue
    t = time.time()
    with zipfile.ZipFile(z) as zf:
        name = zf.namelist()[0]
        zf.extract(name, raw_dir)
    csv = raw_dir / name
    enc = "cp949"
    try:
        df = pd.read_csv(csv, encoding=enc, dtype={"계약종": "string", "본부": "string", "산업종": "string", "검침일": "int32",
                                                  "CNTR_CLAS_NM": "string", "HDQR_NM": "string", "INDU_CLASS_NM": "string", "MR_YMD": "int32"})
    except UnicodeDecodeError:
        enc = "utf-8-sig"
        df = pd.read_csv(csv, encoding=enc, dtype={"계약종": "string", "본부": "string", "산업종": "string", "검침일": "int32"})
    df = df.rename(columns={"CNTR_CLAS_NM": "계약종", "HDQR_NM": "본부", "INDU_CLASS_NM": "산업종", "MR_YMD": "검침일"})  # 2025년 영문 열 이름
    assert list(df.columns) == EXPECTED, f"{year}: 열 구조 다름 {list(df.columns)}"
    df[H] = df[H].astype("float32")
    for c in ["계약종", "본부", "산업종"]:
        df[c] = df[c].str.strip().astype("category")
    df.to_parquet(out, compression="zstd", index=False)
    csv.unlink()
    print(f"[ok] {year}: {len(df):,} rows, enc={enc}, {out.stat().st_size/1e6:.0f}MB, {time.time()-t:.0f}s")
