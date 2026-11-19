"""한전 재무: 별도 재무상태표(분기, 2016.1Q~2026.1Q PDF) + 연결 손익·재무상태(한국전력통계 34·35) → build/fin.json

입력
  <별도 BS 폴더>  : 분기별 별도 재무상태표 PDF(사용자 제공, DART 공시본). 기말 값은 4분기 파일 또는 다음 분기 파일의 전기말 열에서 읽음.
                    스캔본(텍스트 없음)인 2020년 말은 2021.1Q 분기재무상태표의 전기말 열을 사람이 읽어 MANUAL에 기록.
  <통계 폴더>     : 한국전력통계 xlsx — 35.손익계산서(연결), 34.재무상태표(연결). 제88호(2011~2018) + 제95호(2018~2025).
쓰임: 시뮬레이터 원가 기준 '영업비용 + 순금융원가'(연결 금융원가 − 금융수익; 시뮬레이터 영업비용도 연결 기준이라 일관),
      재무 상태 패널(별도 금융부채·부채비율·이익잉여금).
사용: python build_fin.py <별도 BS 폴더> <통계 폴더> <build 폴더>
"""
import json, re, subprocess, sys
from pathlib import Path
import pandas as pd

bs_dir, kstat, out = Path(sys.argv[1]), Path(sys.argv[2]), Path(sys.argv[3])
KEYS = {"assets": r"자\s*산\s*총\s*계", "liab": r"부\s*채\s*총\s*계", "fin_cur": r"(?<!비)유동금융부채", "fin_non": r"비유동금융부채",
        "re": r"이익잉여금", "equity": r"자\s*본\s*총\s*계", "liab_cur": r"^\s*(I|Ⅰ)\.\s*유동부채"}


def nums(line):
    out_ = []
    for x in re.findall(r"\(?-?[\d,]{5,}\)?", line):
        v = int(re.sub(r"[^\d]", "", x))
        out_.append(-v if x.startswith(("(", "-")) else v)
    return out_


def parse_pdf(f):
    t = subprocess.run(["pdftotext", "-layout", str(f), "-"], capture_output=True, text=True).stdout
    if len(t) < 500:
        return None
    unit = 1e6 if "백만원" in t[:800] else 1.0
    dates = re.findall(r"(20\d\d)년\s*(\d+)월\s*(\d+)일", t[:800])
    res = {}
    for line in t.splitlines():
        s = line.strip()
        for k, pat in KEYS.items():
            if k in res or not re.search(pat, s):
                continue
            n = nums(s)
            if len(n) >= 2:
                res[k] = (n[-2] * unit / 1e8, n[-1] * unit / 1e8)   # 억원
    if len(dates) < 2 or len(res) < 6:
        return None
    return dates[0], dates[1], res


ye = {}   # 연도 → 기말 값(억원)
q = {}    # 'YYYY-Qn' → 분기말 값
for f in sorted(bs_dir.glob("*.pdf")):
    r = parse_pdf(f)
    if not r:
        continue
    (y1, m1, _), (y0, m0, _), res = r
    cur = {k: round(v[0]) for k, v in res.items()}
    prev = {k: round(v[1]) for k, v in res.items()}
    q[f"{y1}-Q{int(m1) // 3}"] = cur
    if m1 == "12":
        ye[y1] = cur
    if m0 == "12":
        ye.setdefault(y0, prev)
MANUAL = {"2020": {"assets": 1131034.76, "liab_cur": 190349.98, "fin_cur": 43433.23, "fin_non": 268484.51, "liab": 597720.45, "re": 356683.56}}
for y, v in MANUAL.items():
    if y not in ye:
        v = dict(v); v["equity"] = v["assets"] - v["liab"]
        ye[y] = {k: round(x) for k, x in v.items()}
years = sorted(ye)
for y in years:
    v = ye[y]
    assert abs(v["assets"] - v["liab"] - v["equity"]) < 5, (y, v)

# 연결 손익·재무상태
IS = {"매      출      액": "sales", "매   출   원   가": "cogs", "판매비와 관리비": "sga", "영업이익": "op", "금융수익": "fin_inc", "금융원가": "fin_cost", "당기순이익": "net"}
BS = {"부    채    계": "liab", "자    본    총    계": "equity", "자  산  총  계": "assets"}
con = {}
for f in sorted(kstat.glob("*.xlsx")):
    x = pd.ExcelFile(f)
    for sh, M in [([s for s in x.sheet_names if "손익" in s], IS), ([s for s in x.sheet_names if "재무상태" in s], BS)]:
        if not sh:
            continue
        d = pd.read_excel(f, sheet_name=sh[0], header=None).fillna("")
        hr = [i for i in range(8) if sum(str(c).startswith("20") for c in d.iloc[i]) >= 3]
        if not hr:
            continue
        cols = {j: str(int(float(c))) for j, c in enumerate(d.iloc[hr[0]]) if re.match(r"^20\d\d(\.0)?$", str(c))}
        for row in d.values.tolist():
            lab = str(row[0])
            k = next((v for kk, v in M.items() if kk in lab), None)
            if not k:
                continue
            for j, y in cols.items():
                try:
                    con.setdefault(y, {})[k] = round(float(row[j]) / 100)   # 백만원 → 억원
                except (TypeError, ValueError):
                    pass
cyears = sorted(y for y in con if "fin_cost" in con[y])
for y in cyears:
    c = con[y]; c["opex"] = c["cogs"] + c["sga"]; c["net_fin"] = c["fin_cost"] - c["fin_inc"]

# 별도 손익계산서(연간, 억원). 출처: 사용자 제공 분기 손익계산서 PDF의 4분기(누계) 열 — 2016·2017 = 각 4Q(원 단위, 이자비용 표기),
# 2018 = 2019.4Q 전기 열, 2019 = 2019.4Q, 2020 = 2021.4Q 전기 열(스캔본 판독), 2021 = 2021.4Q(스캔본 판독), 2022 = 2023.4Q 전기 열,
# 2023 = 2024.4Q 전기 열, 2024 = 2024.4Q, 2025 = 2025.4Q(스캔본 판독). 영업비용 = 매출원가 + 판매비와관리비.
SEP_IS = {
    "2016": dict(sales=602895.81, cogs=537077.63, sga=17002.78, fin_inc=14166.60, fin_cost=10633.12, net=42619.86, interest=8441.99),
    "2017": dict(sales=599657.39, cogs=567286.83, sga=16835.02, fin_inc=13563.24, fin_cost=10703.39, net=15068.52, interest=7379.71),
    "2018": dict(sales=602715.00, cogs=607737.98, sga=16909.70, fin_inc=8605.71, fin_cost=8557.40, net=-10952.13),
    "2019": dict(sales=589331.80, cogs=599078.52, sga=18736.75, fin_inc=5648.01, fin_cost=12255.98, net=-25949.57),
    "2020": dict(sales=579894.10, cogs=533961.06, sga=18081.59, fin_inc=6649.91, fin_cost=10010.69, net=19514.98),
    "2021": dict(sales=596606.00, cogs=651488.88, sga=19372.88, fin_inc=8002.31, fin_cost=9946.75, net=-56077.32),
    "2022": dict(sales=689515.46, cogs=1008833.54, sga=19767.67, fin_inc=9328.50, fin_cost=18998.86, net=-252977.12),
    "2023": dict(sales=858255.93, cogs=903380.56, sga=19914.55, fin_inc=37331.74, fin_cost=30581.86, net=-32492.33),
    "2024": dict(sales=916465.82, cogs=864905.74, sga=19893.50, fin_inc=15796.94, fin_cost=40774.92, net=8293.39),
    "2025": dict(sales=955361.64, cogs=849341.67, sga=20619.97, fin_inc=26136.74, fin_cost=28694.46, net=72499.00),
}
for y, v in SEP_IS.items():
    v["opex"] = round(v["cogs"] + v["sga"], 2); v["op"] = round(v["sales"] - v["opex"], 2)
    if y in ye and str(int(y) - 1) in ye:
        avg = (ye[y]["fin_cur"] + ye[y]["fin_non"] + ye[str(int(y) - 1)]["fin_cur"] + ye[str(int(y) - 1)]["fin_non"]) / 2
        v["fin_rate"] = round(v["fin_cost"] / avg * 100, 2)   # 금융원가 ÷ 평균 금융부채(%)
# 검증: 2024 손익계산서 영업이익 3,166,658백만원
assert abs(SEP_IS["2024"]["op"] - 31666.58) < 1, SEP_IS["2024"]["op"]

doc = {
    "source": "한전 별도 재무상태표(분기, DART 공시본, 사용자 제공) · 한국전력통계 34·35(연결)",
    "unit": "억원",
    "sep_years": years, "sep": {y: ye[y] for y in years}, "sep_q": dict(sorted(q.items())),
    "sep_is": SEP_IS,
    "con_years": cyears, "con": {y: con[y] for y in cyears},
    "note": "별도: 금융부채 = 유동금융부채 + 비유동금융부채(사채·차입금·파생상품 등), 부채비율 = 부채총계 ÷ 자본총계. 2020년 말은 스캔본이라 2021.1Q 분기재무상태표의 전기말 열을 판독. "
            "별도 손익: 금융원가 = 이자비용 + 외환·파생 손실 등(2016·2017 이자비용 비중 79·69%), fin_rate = 금융원가 ÷ 평균 금융부채. 2020·2021·2025는 스캔본 판독. "
            "연결: 영업비용 = 매출원가 + 판매비와관리비, 순금융원가 = 금융원가 − 금융수익(외환·파생 손익 포함, 해마다 변동이 큼).",
}
(out / "fin.json").write_text(json.dumps(doc, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
print("fin.json ok 별도", years, "분기", len(q), "연결", cyears)
for y in years:
    v = ye[y]; print(y, "금융부채", round((v["fin_cur"] + v["fin_non"]) / 1e4, 1), "조 부채비율", round(v["liab"] / v["equity"] * 100), "% 이익잉여금", round(v["re"] / 1e4, 1), "조")
for y in cyears:
    c = con[y]; print(y, "연결 영업비용", round(c["opex"] / 1e4, 1), "순금융원가", round(c["net_fin"] / 1e4, 2), "순이익", round(c["net"] / 1e4, 1))
