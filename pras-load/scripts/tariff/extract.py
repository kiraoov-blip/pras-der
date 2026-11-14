"""글자층 있는 '깔끔한' 요금표 → 구조화 JSON.  사용: python extract.py ROWS_JSON EFFECTIVE OUT_JSON"""
import json, re, sys
from blocks import blocks

rows_path, effective, out = sys.argv[1:4]
recs = json.load(open(rows_path))

FLAT = {
    (6160, 7170, 8230, 7170, 8230): ("일반용(갑)I", ["저압", "고압A-I", "고압A-II", "고압B-I", "고압B-II"]),
    (5550, 6490, 7470, 6000, 6900): ("산업용(갑)I", ["저압", "고압A-I", "고압A-II", "고압B-I", "고압B-II"]),
    (5230, 5550, 6370, 5550, 6370): ("교육용(갑)", ["저압", "고압A-I", "고압A-II", "고압B-I", "고압B-II"]),
}
TOU = {
    (7170, 8230, 7170, 8230): ("일반용(갑)II", ["고압A-I", "고압A-II", "고압B-I", "고압B-II"]),
    (6490, 7470, 6000, 6900): ("산업용(갑)II", ["고압A-I", "고압A-II", "고압B-I", "고압B-II"]),
    (6090, 6980, 6090, 6980): ("교육용(을)", ["고압A-I", "고압A-II", "고압B-I", "고압B-II"]),
    (7220, 8320, 9810, 6630, 7380, 8190): ("일반용(을)", ["고압A-I", "고압A-II", "고압A-III", "고압B-I", "고압B-II", "고압B-III"]),
    (7220, 8320, 9810, 6630, 7380, 8190, 6590, 7520, 8090): ("산업용(을)", ["고압A-I", "고압A-II", "고압A-III", "고압B-I", "고압B-II", "고압B-III", "고압C-I", "고압C-II", "고압C-III"]),
}
T = {"effective": effective, "flat": {}, "tou": {}, "source_rows": rows_path.split("/")[-1]}

for b in blocks(recs):
    sig = tuple(int(x) for x in b["basics"])
    if b["type"] == "flat" and sig in FLAT:
        name, opts = FLAT[sig]
        T["flat"][name] = {o: {"basic": sig[i], "energy": b["rows"][i][1]} for i, o in enumerate(opts)}
    elif b["type"] == "tou" and sig in TOU:
        name, opts = TOU[sig]
        assert len(b["rows"]) == 3 * len(opts), (name, len(b["rows"]))
        d = {}
        for i, o in enumerate(opts):
            tri = b["rows"][3 * i:3 * i + 3]
            assert [t[0] for t in tri] == [0, 1, 2], (name, o, tri)
            d[o] = {"basic": sig[i], "energy": {"off": tri[0][1], "mid": tri[1][1], "peak": tri[2][1]}}  # [여름, 봄가을, 겨울]
        T["tou"][name] = d
if "산업용(을)" in T["tou"] and "일반용(을)" not in T["tou"]:
    # 2021년판: 일반용(을)·산업용(을) 공통표
    T["tou"]["일반용(을)"] = {k: v for k, v in T["tou"]["산업용(을)"].items() if not k.startswith("고압C")}
    T["note_common_eul"] = "일반용(을)·산업용(을) 공통 요금표"

# ── 주택용 누진 ───────────────────────────────────────────────────────────────
res_lines = [r for r in recs if re.search(r"처음|다음|초과", r["text"]) and re.search(r"kWh", r["text"]) and "슈퍼" not in r["text"] and "요금" not in r["text"]]
assert len(res_lines) == 12, len(res_lines)
secs = []
for k in range(4):
    L = res_lines[3 * k:3 * k + 3]
    basic = [int(next(n for n in l["nums"] if n >= 700 and float(n).is_integer() and n not in (1000,))) for l in L]
    rate = [l["nums"][-1] for l in L]
    th = [int(L[0]["nums"][0]), int(L[2]["nums"][0])]
    secs.append({"thresholds": th, "basic": basic, "energy": rate})
sup = [r["nums"][-1] for r in recs if "슈퍼유저" in r["text"] and r["nums"] and r["nums"][-1] > 300]
T["residential"] = {"low": {"other": secs[0], "summer": secs[1], "super": sup[0]},
                    "high": {"other": secs[2], "summer": secs[3], "super": next(s for s in sup if s < sup[0])}}

# ── 농사용·가로등·심야 ───────────────────────────────────────────────────────
def find(pat, n=None):
    for r in recs:
        if re.search(pat, r["text"]) and (n is None or len(r["nums"]) >= n):
            return r
    return None

ag = find(r"^갑\s+360"); agl = find(r"^저압\s+1,150")
agh_rows = [r for r in recs if re.search(r"^(여름철|겨울철)\s+[\d.]+$|1,210\s+봄·가을철", r["text"])]
agh = {}
for r in agh_rows:
    t = r["text"]
    key = "여름" if t.startswith("여름") else ("겨울" if t.startswith("겨울") else "봄가을")
    agh[key] = r["nums"][-1]
T["agri"] = {"갑": {"basic": ag["nums"][0], "energy": ag["nums"][1]},
             "을저압": {"basic": agl["nums"][0], "energy": agl["nums"][1]},
             "을고압": {"basic": 1210, "energy": [agh.get("여름"), agh.get("봄가을"), agh.get("겨울")]}}
sl_a = find(r"W당"); sl_b = find(r"을\s*\(종량등\)")
T["streetlight"] = {"갑_W당": sl_a["nums"][0], "을": {"basic": sl_b["nums"][0], "energy": sl_b["nums"][-1]}}
w = [float(m) for r in recs for m in re.findall(r"겨\s*울\s*철\s*:\s*([\d.]+)", r["text"])]
others = [float(m) for r in recs for m in re.findall(r"기타계절\s*:\s*(\d+\.\d)", r["text"])]
T["night"] = {"갑": {"winter": w[0], "other": others[0]}, "을I": {"winter": w[1], "other": others[1]},
              "을II": {"winter": w[-1], "other": others[-1], "basic_factor": 7160,
                       "other_time": next(r["nums"][-1] for r in recs if re.search(r"기타시간\s+[\d.]+$", r["text"]))}}
json.dump(T, open(out, "w"), ensure_ascii=False, indent=1)
print(effective, "flat:", list(T["flat"]), "tou:", list(T["tou"]))
