"""불확실한 판본(스캔·양식 어긋남)을 '직전 판본 + 묶음별 인상분'으로 추정하고 문서 숫자와 대조.

사용: python infer.py
  - out/*.json (깔끔한 판본) 을 기준점으로, 연대순 사슬을 따라 추정
  - 각 묶음(계약종×선택 / 주택용 저·고압 / 농사용 / 가로등 / 심야)마다 d 를 0.1 단위로 탐색해
    '기준값 + d' 가 문서 숫자집합에 가장 많이 나타나는 d 를 고른다. 일치율을 함께 기록.
"""
import copy, json, glob, re
from collections import Counter

ROWS = {"2023-05-16": "rows/34_23.05.16_________________________.json",
        "2024-01-01": "rows/08_2024_____1___1____________________________________.json",
        "2024-04-01": "rows/02_2024_____4___1____________________________________.json"}
OCR = {"2022-04-01": "ocr/82fe3cb2.ocr.json", "2022-07-01": "ocr/d6576c90.ocr.json", "2022-10-01": "ocr/29a0c55a.ocr.json",
       "2023-01-01": "ocr/6c80fe70.ocr.json", "2023-11-09": "ocr/6fe9298b.ocr.json"}
CHAIN = ["2021-01-01", "2022-04-01", "2022-07-01", "2022-10-01", "2023-01-01", "2023-05-16", "2023-11-09",
         "2024-01-01", "2024-04-01", "2024-07-01", "2024-10-24", "2025-01-01", "2025-04-01", "2026-04-16"]


def cells(T):
    """(묶음키, 경로, 값) 목록. 경로는 값을 다시 써넣기 위한 접근자."""
    out = []
    for cls, opts in T["flat"].items():
        for o, v in opts.items():
            for i, x in enumerate(v["energy"]):
                out.append((f"F|{cls}|{o}", ("flat", cls, o, "energy", i), x))
    for cls, opts in T["tou"].items():
        for o, v in opts.items():
            for band in ("off", "mid", "peak"):
                for i, x in enumerate(v["energy"][band]):
                    out.append((f"T|{cls}|{o}", ("tou", cls, o, "energy", band, i), x))
    for vol in ("low", "high"):
        for i, x in enumerate(T["residential"][vol]["other"]["energy"]):
            out.append((f"R|{vol}", ("residential", vol, "other", "energy", i), x))
        out.append((f"R|{vol}", ("residential", vol, "super"), T["residential"][vol]["super"]))
    out.append(("A|갑", ("agri", "갑", "energy"), T["agri"]["갑"]["energy"]))
    out.append(("A|을저압", ("agri", "을저압", "energy"), T["agri"]["을저압"]["energy"]))
    for i, x in enumerate(T["agri"]["을고압"]["energy"]):
        out.append(("A|을고압", ("agri", "을고압", "energy", i), x))
    out.append(("S|을", ("streetlight", "을", "energy"), T["streetlight"]["을"]["energy"]))
    for k in ("갑", "을I"):
        for s in ("winter", "other"):
            out.append((f"N|{k}", ("night", k, s), T["night"][k][s]))
    for s_ in ("winter", "other"):
        out.append(("N|을II", ("night", "을II", s_), T["night"]["을II"][s_]))
    out.append(("N|을II", ("night", "을II", "other_time"), T["night"]["을II"]["other_time"]))
    return out


def setp(T, path, val):
    o = T
    for p in path[:-1]:
        o = o[p]
    o[path[-1]] = val
    # 주택용 하계·기타계절 단가 동일 유지
    if path[0] == "residential" and path[2] == "other":
        T["residential"][path[1]]["summer"]["energy"][path[4]] = val


def docnums(date):
    if date in ROWS:
        nums = [n for r in json.load(open(ROWS[date])) for n in r["nums"]]
    else:
        nums = [float(x.replace(",", "")) for v in json.load(open(OCR[date])).values() for x in v["nums"]]
    return Counter(round(n, 1) for n in nums)


def infer(ref, date):
    have = docnums(date)
    T = copy.deepcopy(ref)
    T["effective"] = date
    groups = {}
    for g, path, x in cells(ref):
        groups.setdefault(g, []).append((path, x))
    cand = {}
    for g, items in groups.items():
        rates = {}
        for k in range(-100, 451):
            d = k / 10
            rates[d] = sum(1 for _, x in items if round(x + d, 1) in have) / len(items)
        cand[g] = rates
    pop = Counter(d for g, r in cand.items() for d, v in r.items() if v >= 0.8)
    report = {}
    for g, items in groups.items():
        r = cand[g]
        ok = [d for d, v in r.items() if v >= 0.8]
        if ok:
            d = max(ok, key=lambda d: (pop[d], r[d], -abs(d)))
        else:
            d = max(r, key=lambda d: (r[d], pop[d], -abs(d)))
        for path, x in items:
            setp(T, path, round(x + d, 1))
        report[g] = {"delta": d, "match": f"{round(r[d]*len(items))}/{len(items)}", "ok": bool(ok),
                     "alternatives": sorted(ok, key=lambda d: -pop[d])[:4]}
    return T, report


if __name__ == "__main__":
    known = {p.split("/")[-1][:-5]: json.load(open(p)) for p in glob.glob("out/*.json")}
    reports = {}
    prev = known["2021-01-01"]
    for date in CHAIN[1:]:
        if date in known and date not in ROWS:
            # 깔끔한 판본: 추정 사슬과 대조만
            T = known[date]
            pv = {p: (g, x) for g, p, x in cells(prev)}
            diff = [(g, pv[p][1], y) for g, p, y in cells(T) if p in pv and abs(pv[p][1] - y) > 1e-6]
            reports[date] = {"source": "extracted", "changed_cells_vs_prev": len(diff),
                             "changed_groups": sorted({g for g, _, _ in diff})}
        else:
            T, rep = infer(prev, date)
            bad = {g: r for g, r in rep.items() if not r["ok"]}
            deltas = Counter((r["delta"]) for r in rep.values())
            reports[date] = {"source": "inferred", "groups": len(rep), "not_ok": bad, "deltas": dict(deltas.most_common()),
                             "detail": rep}
            json.dump(T, open(f"out/{date}.json", "w"), ensure_ascii=False, indent=1)
        prev = T
    json.dump(reports, open("infer_report.json", "w"), ensure_ascii=False, indent=1)
    for d, r in reports.items():
        if r["source"] == "inferred":
            print(d, "deltas", r["deltas"], "| NOT OK:", {g: (v["delta"], v["match"]) for g, v in r["not_ok"].items()})
        else:
            print(d, "extracted; changed vs chain:", r["changed_cells_vs_prev"], r["changed_groups"][:12])
