"""주택용 사용량 구간별 분포(전체 가구, 2025 월별 청구) → build/res_bins.json

입력: 한전 영업정보 '사용량 구간별 분포 출력' xlsx (요금년월 × 저/고압 × 아파트유형[일반·단일·종합]).
  열: 순번, 사용량구간(kWh, 가구당), 고객호수, 가구수, 판매전력량, 기본요금, 전력량요금, 기후환경요금, 연료비조정요금, 총액, 판매단가.
  총액 = 기본 + 전력량 + 기후 + 연료 (복지할인 차감 전).

검증·정제 규칙
  1) 복지할인유형이 '-전체-'로 뽑힌 파일은 복지할인 가구만 담긴다(같은 달 복지할인 분포와 호수·kWh 일치) → 제외하고
     같은 군의 직전 달 분포로 대체(replaced 에 기록).
  2) 고압 종합 2025.1~3월에는 가구당 기본요금이 누진 3단계 상한(7,300원)을 크게 넘는 비주거 계약(가구당 수천 kWh,
     기본요금 수십만~백만 원대)이 섞여 있다가 4월부터 사라진다 → 구간 평균 기본요금이 1.5 × 7,300원을 넘는 행 제외(dropped).
  3) 적용 요금표: 구간별 '가구당 평균 사용량'으로 누진 계산해 실제 기본+전력량요금과 맞춰 보면
     저압 전체와 고압 종합(세대별 계약)은 저압 요금표, 고압 단일·고압 일반·저압 단일은 고압 요금표와 일치 → rate 에 기록.
  4) 하계(7·8월 사용분) 누진 구간은 검침 주기 때문에 청구월 7·8·9월에 나뉘어 반영 → 청구월별 하계 비중을 최소제곱으로 추정.
사용: python build_resbins.py <xlsx 폴더> <build 폴더> [복지할인 분포 폴더(검증용)]
"""
import json, re, sys
from pathlib import Path
import numpy as np
import pandas as pd

src, out = Path(sys.argv[1]), Path(sys.argv[2])
wel_src = Path(sys.argv[3]) if len(sys.argv) > 3 else None
COLS = ["bin", "cust", "hh", "kwh", "bas", "en", "clim", "fuel", "tot", "up"]
RATE = {("저압", "일반"): "low", ("저압", "종합"): "low", ("고압", "종합"): "low", ("고압", "단일"): "high", ("고압", "일반"): "high", ("저압", "단일"): "high"}


def num(s):
    return pd.to_numeric(s.astype(str).str.replace(",", ""), errors="coerce").fillna(0)


def read(f):
    df = pd.read_excel(f, header=None)
    first = df.index[df.iloc[:, 1].astype(str).str.match(r"^\d+~\d+$")][0]
    d = df.iloc[first:, 1:11].copy()
    d.columns = COLS
    for c in COLS[1:]:
        d[c] = num(d[c])
    meta = dict(title=str(df.iat[0, 0]), ym=str(df.iat[2, 7]), ym2=str(df.iat[2, 9]), volt=str(df.iat[2, 3])[2:], apt=str(df.iat[3, 1])[2:], wel=str(df.iat[3, 3]))
    return d.reset_index(drop=True), meta


files = {}
for f in sorted(src.glob("*.xlsx")):
    d, m = read(f)
    assert "사용량 구간별" in m["title"] and m["ym"] == m["ym2"] and re.match(r"^\d{4}-\d{2}$", m["ym"]), f
    assert (d.tot - d[["bas", "en", "clim", "fuel"]].sum(axis=1)).abs().max() == 0, f
    files[(m["ym"], m["volt"], m["apt"])] = (d, m, f.name)
months = sorted({k[0] for k in files})
groups = sorted({(k[1], k[2]) for k in files}, key=lambda g: (g[0] != "저압", g[1]))
assert len(files) == len(months) * len(groups)
bins = list(files[next(iter(files))][0].bin)
lo = np.array([int(b.split("~")[0]) for b in bins])
hi = np.array([int(b.split("~")[1]) for b in bins])

# 1) 복지할인 가구만 뽑힌 파일 대체
replaced = []
wel = {}
if wel_src:
    for f in sorted(wel_src.glob("*.xlsx")):
        df = pd.read_excel(f, header=None)
        first = df.index[df.iloc[:, 1].astype(str).str.match(r"^\d+~\d+$")][0]
        wel[(str(df.iat[2, 7]), str(df.iat[2, 3])[2:], str(df.iat[3, 1])[2:])] = num(df.iloc[first:, 3]).sum()
for k in sorted(files):
    d, m, name = files[k]
    if m["wel"] != "-전체-":
        continue
    prev = months[months.index(k[0]) - 1]
    note = {"file": name, "month": k[0], "group": f"{k[1]}·{k[2]}", "hh": int(d.hh.sum()), "welfare_hh": int(wel.get(k, 0)), "used": prev}
    files[k] = (files[(prev, k[1], k[2])][0].copy(), m, name + f" → {prev} 대체")
    replaced.append(note)

# 2) 비주거 계약 혼입 행 제외
dropped = []
for k, (d, m, name) in files.items():
    per = np.where(d.hh > 0, d.bas / d.hh.where(d.hh > 0, 1), 0)
    bad = per > 1.5 * 7300
    if bad.any():
        dropped.append({"month": k[0], "group": f"{k[1]}·{k[2]}", "rows": int(bad.sum()), "hh": int(d.hh[bad].sum()), "kwh": int(d.kwh[bad].sum()), "basic": int(d.bas[bad].sum()), "energy": int(d.en[bad].sum())})
        d.loc[bad, ["cust", "hh", "kwh", "bas", "en", "clim", "fuel", "tot"]] = 0

# 3)·4) 요금표 검증과 하계 비중
T = json.loads((out / "tariffs.json").read_text(encoding="utf-8"))
ver = lambda ym: [v for v in T["versions"] if v["effective"] <= ym + "-01"][-1]


def bill(q, R, summer, sup):
    sec = R["summer" if summer else "other"]
    th, e, b = sec["thresholds"], sec["energy"], sec["basic"]
    t1, t2, t3 = np.minimum(q, th[0]), np.clip(q - th[0], 0, th[1] - th[0]), np.maximum(q - th[1], 0)
    en = t1 * e[0] + t2 * e[1] + t3 * e[2] + (np.maximum(q - 1000, 0) * (R["super"] - e[2]) if sup else 0)
    bas = np.where(q <= th[0], b[0], np.where(q <= th[1], b[1], b[2]))
    return bas, en


SUPER = {12, 1, 2, 7, 8}
summer_w, check = [], []
for ym in months:
    mo = int(ym[5:])
    act = model_o = model_s = 0
    rows = []
    for g in groups:
        d = files[(ym, *g)][0]
        q = np.where(d.hh > 0, d.kwh / d.hh.where(d.hh > 0, 1), 0)
        R = ver(ym)["residential"][RATE[g]]
        bo, eo = bill(q, R, False, mo in SUPER)
        bs, es = bill(q, R, True, mo in SUPER)
        o, s, a = ((bo + eo) * d.hh).sum(), ((bs + es) * d.hh).sum(), (d.bas + d.en).sum()
        act += a; model_o += o; model_s += s
        rows.append((g, a, o, s))
    w = 0.0
    if mo in (6, 7, 8, 9) and abs(model_s - model_o) > 1:
        w = float(np.clip((act - model_o) / (model_s - model_o), 0, 1))
    summer_w.append(round(w, 3))
    check.append({"month": ym, "summer_w": round(w, 3), "ratio": round((w * model_s + (1 - w) * model_o) / act, 4),
                  "groups": {f"{g[0]}·{g[1]}": round((w * s + (1 - w) * o) / a, 4) if a else None for g, a, o, s in rows}})

doc = {
    "source": "한전 영업정보 사용량 구간별 분포(요금년월 기준, 사용자 제공)",
    "unit": {"hh": "가구", "kwh": "kWh", "amount": "원"},
    "months": months, "bins": bins, "lo": lo.tolist(), "hi": hi.tolist(),
    "groups": [], "summer_w": summer_w, "super_months": sorted(SUPER), "check": check,
    "replaced": replaced, "dropped": dropped,
    "note": "구간 = 가구당 월 사용량(단일계약은 세대 평균). 총액 = 기본+전력량+기후+연료(복지할인 차감 전). "
            "요금표: 저압 전체·고압 종합 = 저압, 고압 단일·고압 일반·저압 단일 = 고압 (구간별 재계산으로 확인).",
}
for g in groups:
    D = [files[(ym, *g)][0] for ym in months]
    doc["groups"].append({
        "volt": g[0], "apt": g[1], "rate": RATE[g],
        "hh": [d.hh.astype(int).tolist() for d in D], "kwh": [d.kwh.astype(int).tolist() for d in D],
        **{k: [int(d[k].sum()) for d in D] for k in ["cust", "bas", "en", "clim", "fuel", "tot"]},
    })
(out / "res_bins.json").write_text(json.dumps(doc, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
print("res_bins.json ok", months[0], "~", months[-1], f"{len(files)} files")
print(" 대체:", [(r["file"], r["hh"], r["welfare_hh"]) for r in replaced])
print(" 제외:", [(r["month"], r["group"], r["rows"], r["hh"], round(r["kwh"] / 1e6, 1)) for r in dropped])
print(" 하계 비중:", dict(zip(months, summer_w)))
print(" 재계산÷실제:", {c["month"]: c["ratio"] for c in check})
