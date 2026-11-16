"""복지할인 가구 사용량 구간별 분포(2025 월별) → build/welfare_bins.json

입력: 한전 영업정보 '복지할인 구간별 분포 출력' xlsx (요금년월 × 저/고압 × 아파트유형[일반·단일·종합]).
  열: 순번, 사용량구간(kWh, 가구당), 고객호수, 가구수, 판매전력량, 할인액[필수사용량보장공제, 200kWh이하감액,
      요금동결할인액, 복지할인액], 총할인액, 할인 전 요금, 할인 후 요금.
  - 구간은 가구당 사용량 기준(단일계약은 세대 평균). 총할인 = 네 항목 합, 할인 후 = 할인 전 + 총할인 (전 행 검증).
  - 단일계약(아파트 일괄)은 '할인 전 요금'이 거의 비어 있어(단지 단위 청구) 할인율 계산에서 제외.
사용: python build_welfare_bins.py <xlsx 폴더> <build 폴더>
"""
import json, re, sys
from pathlib import Path
import pandas as pd

src, out = Path(sys.argv[1]), Path(sys.argv[2])
V = ["hh", "kwh", "ess", "le200", "frz", "wel", "disc", "pre", "post"]
COLS = ["bin", "cust"] + V


def num(s):
    return pd.to_numeric(s.astype(str).str.replace(",", ""), errors="coerce").fillna(0)


frames = []
for f in sorted(src.glob("*.xlsx")):
    df = pd.read_excel(f, header=None)
    assert "복지할인" in str(df.iat[0, 0]), f
    first = df.index[df.iloc[:, 1].astype(str).str.match(r"^\d+~\d+$")][0]
    d = df.iloc[first:, 1:12].copy()
    d.columns = COLS
    for c in COLS[1:]:
        d[c] = num(d[c])
    assert (d.disc - d[["ess", "le200", "frz", "wel"]].sum(axis=1)).abs().max() == 0, f
    assert (d.pre + d.disc - d.post).abs().max() == 0, f
    ym, ym2 = str(df.iat[2, 7]), str(df.iat[2, 9])
    assert ym == ym2 and re.match(r"^\d{4}-\d{2}$", ym), f
    d["ym"], d["volt"], d["apt"] = ym, str(df.iat[2, 3])[2:], str(df.iat[3, 1])[2:]
    frames.append(d)
A = pd.concat(frames, ignore_index=True)
bins = list(dict.fromkeys(A.bin))
assert len(bins) == 170
months = sorted(A.ym.unique())
groups = sorted({(v, a) for v, a in zip(A.volt, A.apt)})
assert len(frames) == len(months) * len(groups), (len(frames), months, groups)

A["bi"] = A.bin.map({b: i for i, b in enumerate(bins)})
A["mi"] = A.ym.map({m: i for i, m in enumerate(months)})
rate_ok = A.apt != "단일"   # 할인 전 요금이 채워진 군


def cube(sub, vars_):
    g = sub.groupby(["mi", "bi"])[vars_].sum()
    res = {}
    for v in vars_:
        arr = [[0] * len(bins) for _ in months]
        for (mi, bi), x in g[v].items():
            arr[mi][bi] = int(round(x))
        res[v] = arr
    return res


doc = {
    "source": "한전 영업정보 복지할인 구간별 분포(요금년월 기준, 사용자 제공)",
    "unit": {"hh": "가구", "kwh": "kWh", "amount": "원"},
    "months": months,
    "bins": bins,
    "lo": [int(b.split("~")[0]) for b in bins],
    "hi": [int(b.split("~")[1]) for b in bins],
    "all": cube(A, ["hh", "kwh", "le200", "frz", "wel", "disc"]),
    "rate": cube(A[rate_ok], ["hh", "disc", "pre"]),
    "groups": [],
    "note": "구간 = 가구당 월 사용량. 총할인 = 필수사용량보장공제 + 200kWh이하감액 + 요금동결할인 + 복지할인(음수). "
            "할인율은 단일계약(할인 전 요금 미기재) 제외 군 기준. 할인 전 요금은 부가세·기금 포함 여부 미확인.",
}
for v, a in groups:
    s = A[(A.volt == v) & (A.apt == a)].groupby("mi")[["cust"] + V].sum()
    doc["groups"].append({"volt": v, "apt": a, **{k: [int(round(s.at[i, k])) if i in s.index else 0 for i in range(len(months))] for k in ["cust", "hh", "kwh", "disc", "wel", "pre"]}})

(out / "welfare_bins.json").write_text(json.dumps(doc, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
tot = A[V].sum()
print("welfare_bins.json ok", months[0], "~", months[-1], f"{len(frames)} files",
      f"할인 {-tot.disc / 1e8:,.0f}억 (복지 {-tot.wel / 1e8:,.0f} · 200kWh이하 {-tot.le200 / 1e8:,.0f} · 동결 {-tot.frz / 1e8:,.0f})",
      f"월평균 {A.groupby('ym').hh.sum().mean():,.0f}가구")
