"""전력통계월보(속보) 엑셀 → build/monthly.json (월별 시계열)

사용: python3 scripts/build_monthly.py <월보_폴더(연도별 하위폴더)> build
파일명 앞 4자리 YYMM = 호의 기준월. 시트는 번호가 해마다 달라 이름 키워드로 찾는다.
한 호에 최근 약 13개월이 실리므로 호를 모아 월별 시계열을 만들고, 겹치는 달은 나중 호(수정치)를 쓴다.
엑셀에 10월이 'YYYY.1'(숫자)로 저장된 문제는 행 순서를 기준월에서 거꾸로 세어 해결한다.
"""
import json, re, sys, warnings
from pathlib import Path
import numpy as np, pandas as pd

warnings.simplefilter("ignore")
SRC, OUT = Path(sys.argv[1]), Path(sys.argv[2])
BIG = {"주택용": "res", "일반용": "gen", "교육용": "edu", "산업용": "ind", "농사용": "agr", "가로등": "str", "심야": "night", "계": "total"}
clean = lambda s: re.sub(r"\s+", "", str(s)) if s is not None and str(s) != "nan" else ""


def ym_back(n, y, m):
    """기준월(y,m)에서 n개월 전"""
    k = y * 12 + (m - 1) - n
    return f"{k // 12}-{k % 12 + 1:02d}"


def monthly_label(v):
    s = clean(v)
    return bool(re.fullmatch(r"\d{4}\.\d{1,2}", s)) and "~" not in s


def find_sheet(xl, must, avoid=()):
    for s in xl.sheet_names:
        c = clean(s)
        if all(k in c for k in must) and not any(a in c for a in avoid):
            return s
    return None


def rows_time_table(df, issue):
    """행=월인 표: 헤더(구분 행)의 열 이름 → {열이름: {YYYY-MM: 값}}"""
    hdr_i = next(i for i in range(min(10, len(df))) if clean(df.iat[i, 0]).startswith("구분"))
    cols = {}
    for j in range(1, df.shape[1]):
        name = clean(df.iat[hdr_i, j])
        if name and "증감률" not in name:
            cols[j] = name
    # 헤더가 두 줄인 경우(가격표: S M P / SEP+MEP / CP ...)
    if len(cols) < 3:
        for j in range(1, df.shape[1]):
            name = clean(df.iat[hdr_i + 1, j])
            if name and "증감률" not in name:
                cols[j] = name
    mrows = [i for i in range(hdr_i + 1, len(df)) if monthly_label(df.iat[i, 0])]
    out = {c: {} for c in cols.values()}
    y, m = issue
    for k, i in enumerate(reversed(mrows)):
        key = ym_back(k, y, m)
        for j, name in cols.items():
            v = pd.to_numeric(str(df.iat[i, j]).replace(",", ""), errors="coerce")
            if pd.notna(v):
                out[name][key] = float(v)
    annual = {}
    for i in range(hdr_i + 1, len(df)):
        s = clean(df.iat[i, 0])
        if re.fullmatch(r"\d{4}", s):
            annual[s] = {name: float(pd.to_numeric(str(df.iat[i, j]).replace(",", ""), errors="coerce")) for j, name in cols.items()}
    return out, annual


files = sorted(SRC.glob("*/*.xlsx"))
S = {}           # 판매량·호수·수입: kind → big → {ym: v}
CAND = {}        # (kind, big, ym) → [(issue, v)] : 여러 호에 실린 같은 달 값
ANN = {}         # 연간 행(검증용)
PRICE, SUPPLY, PV, REGION, INDUSTRY = {}, {}, {}, {}, {}
log = []
for f in files:
    yy, mm = int(f.name[:2]), int(f.name[2:4])
    issue = (2000 + yy, mm)
    xl = pd.ExcelFile(f)
    want = [x for x in (find_sheet(xl, ("계약종별판매전력량",), ("추이", "행정구역")), find_sheet(xl, ("계약종별수용호수",), ("추이", "행정구역")),
                        find_sheet(xl, ("계약종별판매수입",), ("추이", "행정구역")), find_sheet(xl, ("가격", "단가")), find_sheet(xl, ("태양광", "추계")),
                        find_sheet(xl, ("전력수급실적", "월별")), find_sheet(xl, ("행정구역별계약종별",)), find_sheet(xl, ("산업분류별판매전력량",), ("행정구역",))) if x]
    SHEETS = pd.read_excel(xl, sheet_name=want, header=None, dtype=object)
    rec = {"file": f.name}
    # 계약종별 판매량·호수·수입
    for kind, must in (("sales", ("계약종별판매전력량",)), ("cust", ("계약종별수용호수",)), ("rev", ("계약종별판매수입",))):
        sh = find_sheet(xl, must, avoid=("추이", "행정구역"))
        if not sh:
            continue
        df = SHEETS[sh]
        out, annual = rows_time_table(df, issue)
        for name, series in out.items():
            b = BIG.get(name.replace("심야", "심야"))
            if b:
                for ym, v in series.items():
                    CAND.setdefault((kind, b, ym), []).append((issue, v))
        for yr, row in annual.items():
            for name, v in row.items():
                if BIG.get(name):
                    ANN.setdefault(kind, {}).setdefault(BIG[name], {})[yr] = v
        rec[kind] = len(next(iter(out.values()), {}))
    # 정산단가
    sh = find_sheet(xl, ("가격", "단가"))
    if sh:
        df = SHEETS[sh]
        out, _ = rows_time_table(df, issue)
        for name, series in out.items():
            key = {"SMP": "smp", "SEP+MEP": "sep_mep", "CP": "cp", "기타": "etc", "계": "settle"}.get(name.replace(" ", ""))
            if key:
                PRICE.setdefault(key, {}).update(series)
    # 태양광 추계
    sh = find_sheet(xl, ("태양광", "추계"))
    if sh:
        df = SHEETS[sh]
        out, _ = rows_time_table(df, issue)
        for name, series in out.items():
            key = "market" if "시장" in name else "ppa" if "PPA" in name else "btm" if "자가용" in name else None
            if key:
                PV.setdefault(key, {}).update(series)
    # 월별 수급실적
    sh = find_sheet(xl, ("전력수급실적", "월별"))
    if sh:
        df = SHEETS[sh]
        year = None
        for i in range(len(df)):
            s = clean(df.iat[i, 0])
            mY = re.fullmatch(r"(\d{4})(1-12|1-\d{1,2})?", s)
            if mY and mY.group(2):
                year = int(mY.group(1)); continue
            if year and re.fullmatch(r"\d{1,2}", s) and 1 <= int(s) <= 12:
                mo = int(s)
                # 전년 12월이 연간 행보다 먼저 오는 배치: 직전 블록이 해당 연도의 '1-12'
                key = f"{year}-{mo:02d}"
                vals = [pd.to_numeric(df.iat[i, j], errors="coerce") for j in (1, 2, 3, 6)]
                SUPPLY.setdefault(key, {}).update({"cap_MW": vals[0], "supply_MW": vals[1], "peak_MW": vals[2], "avg_MW": vals[3],
                                                   "peak_when": f"{clean(df.iat[i, 4])} {str(df.iat[i, 5])[:5]}"})
    # 행정구역별 계약종별 (월 블록)
    sh = find_sheet(xl, ("행정구역별계약종별",))
    if sh:
        df = SHEETS[sh]
        hdr = next(i for i in range(8) if clean(df.iat[i, 0]).startswith("구"))
        regions = {j: clean(df.iat[hdr, j]) for j in range(2, df.shape[1]) if clean(df.iat[hdr, j])}
        cur = None
        for i in range(hdr + 1, len(df)):
            s = str(df.iat[i, 0]) if df.iat[i, 0] is not None else "nan"
            if s != "nan" and s.strip():
                c = clean(s)
                mM = re.fullmatch(r"(\d{4})\.(\d{1,2})", c)
                cur = f"{mM.group(1)}-{int(mM.group(2)):02d}" if mM and "누계" not in c else None
            b = BIG.get(clean(df.iat[i, 1]))
            if cur and b:
                for j, r in regions.items():
                    v = pd.to_numeric(df.iat[i, j], errors="coerce")
                    if pd.notna(v):
                        REGION.setdefault(r, {}).setdefault(b, {})[cur] = float(v)
    # 산업분류별 (열=월)
    sh = find_sheet(xl, ("산업분류별판매전력량",), avoid=("행정구역",))
    if sh:
        df = SHEETS[sh]
        hdr = next(i for i in range(8) if clean(df.iat[i, 0]).startswith("구"))
        mcols = [j for j in range(2, df.shape[1]) if pd.notna(pd.to_numeric(df.iat[hdr, j], errors="coerce"))]
        keys = {j: ym_back(len(mcols) - 1 - k, *issue) for k, j in enumerate(mcols)}
        parent = ""
        for i in range(hdr + 1, len(df)):
            a, b2 = clean(df.iat[i, 0]), clean(df.iat[i, 1])
            if a and not b2:
                name = a
            else:
                if a:
                    parent = a
                name = b2
            if not name or name.startswith("주)"):
                continue
            for j, key in keys.items():
                v = pd.to_numeric(df.iat[i, j], errors="coerce")
                if pd.notna(v):
                    INDUSTRY.setdefault(name, {})[key] = float(v)
    log.append(rec)

# 같은 달 값이 호마다 다르면 최빈값(동률이면 나중 호). 예: 2023.1월호 '2022.01' 일반용은 누계값이 잘못 들어감
conflicts = []
for (kind, b, ym), lst in CAND.items():
    vals = [round(v) for _, v in lst]          # 소수 표기 차이(정수 반올림본)는 같은 값으로
    counts = {v: vals.count(v) for v in set(vals)}
    best = max(counts.values())
    pick = [v for _, v in sorted(lst) if counts[round(v)] == best][-1]
    if len(counts) > 1:
        conflicts.append({"kind": kind, "big": b, "ym": ym, "values": counts, "picked": pick})
    S.setdefault(kind, {}).setdefault(b, {})[ym] = pick
# 2016년 1월: 2016년 1월호는 PDF뿐 → 한국전력통계 2016년 연간값 − 2~12월 합 (판매량·수입), 호수는 2월 값 사용
REF = json.loads((OUT / "kepco_ref.json").read_text(encoding="utf-8"))
i16 = REF["years"].index(2016)
for kind, refk, scale in (("sales", "sales", 1.0), ("rev", "rev", 1e-3)):   # 월보 수입 = 백만원, 한국전력통계 = 천원
    for b in S[kind]:
        if "2016-01" not in S[kind][b] and b in REF[refk]:
            rest = sum(S[kind][b].get(f"2016-{m:02d}", 0) for m in range(2, 13))
            S[kind][b]["2016-01"] = REF[refk][b][i16] * scale - rest
for b in S.get("cust", {}):
    S["cust"][b].setdefault("2016-01", S["cust"][b].get("2016-02"))
merged = {}
for r, v in REGION.items():
    name = "세종" if r.startswith("세종") else "개성(황북)" if r == "황북" else r
    for b, series in v.items():
        merged.setdefault(name, {}).setdefault(b, {}).update(series)
REGION = merged
INDUSTRY = {k: v for k, v in INDUSTRY.items() if len(k) > 1}

# 정리·검증
months = sorted({k for b in S["sales"].values() for k in b})
check = {}
for kind in ("sales", "rev"):
    for b, series in S[kind].items():
        for yr, v in ANN.get(kind, {}).get(b, {}).items():
            ms = [series.get(f"{yr}-{m:02d}") for m in range(1, 13)]
            if all(x is not None for x in ms):
                check.setdefault(kind, {}).setdefault(b, {})[yr] = round(sum(ms) / v * 100 - 100, 4)
missing = {b: [f"{y}-{m:02d}" for y in range(2016, 2027) for m in range(1, 13)
               if f"{y}-{m:02d}" <= months[-1] and f"{y}-{m:02d}" not in S["sales"][b]] for b in S["sales"]}
doc = {"unit": {"sales": "MWh", "cust": "호(월말)", "rev": "백만원", "price": "원/kWh", "supply": "MW", "pv": "MWh"},
       "source": "전력통계속보(2016~2020)·전력통계월보(2021~) 엑셀, 겹치는 달은 나중 호 값",
       "months": months, "sales": S["sales"], "cust": S.get("cust", {}), "rev": S.get("rev", {}),
       "price": PRICE, "supply": SUPPLY, "pv": PV, "region_sales": REGION, "industry_sales": INDUSTRY,
       "annual_check_pct": check, "missing": {b: v for b, v in missing.items() if v}, "conflicts": conflicts,
       "notes": ["2016-01 판매량·수입 = 한국전력통계 2016 연간 − 2~12월 합(2016.1월호는 PDF), 호수는 2월 값",
                 "호마다 다른 같은 달 값은 최빈값 채택(conflicts 기록)", "개성(황북) = 개성공단 공급분(2016년 중단)", "전남광주 = 2026.7 이후 광주·전남 통합 표기"]}
(OUT / "monthly.json").write_text(json.dumps(doc, ensure_ascii=False, separators=(",", ":"), default=lambda x: None if x != x else x), encoding="utf-8")
print("files", len(files), "| months", months[0], "~", months[-1], len(months))
print("missing:", doc["missing"] or "없음", "| conflicts:", [(c["kind"], c["big"], c["ym"], c["values"]) for c in conflicts][:10])
print("연간합 vs 연간행 최대오차(%):", {k: max(abs(x) for b in v.values() for x in b.values()) for k, v in check.items()})
print("price months", min(PRICE.get("smp", {"-": 0})), "~", max(PRICE.get("smp", {"-": 0})), len(PRICE.get("smp", {})))
print("supply months", min(SUPPLY), "~", max(SUPPLY), len(SUPPLY), "| pv", {k: (min(v), max(v)) for k, v in PV.items()})
print("regions", len(REGION), list(REGION)[:20], "| region months", len(next(iter(REGION.values()))["total"]))
print("industries", len(INDUSTRY), "| months", len(next(iter(INDUSTRY.values()))))
