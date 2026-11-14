"""두 정확 판본(2021-01-01, 2024-07-01) 사이 불확실 판본을 '누적 인상분 경로'로 확정.

각 묶음 g 에 대해
  - 총 인상분 D_g = (2024-07-01 값 - 2021-01-01 값)  (묶음 안에서 균일해야 함; 아니면 경고)
  - 단계 s 마다 문서 숫자와 80% 이상 맞는 누적 인상분 후보 C_s
  - 동적계획: c_0 = 0, c_last = D_g, 각 c_s ∈ C_s, 단계 증분이 '그 단계의 대표 증분'에 들면 가점
대표 증분은 1차 추정(infer.py)에서 다수 묶음이 고른 값.
"""
import copy, json
from collections import Counter
from infer import cells, setp, docnums

STEPS = ["2022-04-01", "2022-07-01", "2022-10-01", "2023-01-01", "2023-05-16", "2023-11-09", "2024-01-01", "2024-04-01"]
base = json.load(open("out/2021-01-01.json"))
end = json.load(open("out/2024-07-01.json"))
rep1 = json.load(open("infer_report.json"))
typical = {s: {float(d) for d, n in rep1[s]["deltas"].items() if n >= 2} | {0.0} for s in STEPS}
# 2023.11.9 산업용(을) 차등 인상(고압A, 고압B·C) — 2024-07 정확 판본과의 총 인상분으로도 확인됨
typical["2023-11-09"] |= {6.7}
docs = {s: docnums(s) for s in STEPS}

bpath = {p: (g, x) for g, p, x in cells(base)}
epath = {p: x for g, p, x in cells(end)}
groups = {}
for g, p, x in cells(base):
    groups.setdefault(g, []).append((p, x))

result = {s: copy.deepcopy(base) for s in STEPS}
for s in STEPS:
    result[s]["effective"] = s
log = {}
for g, items in groups.items():
    tot = Counter(round(epath[p] - x, 1) for p, x in items)
    D, n = tot.most_common(1)[0]
    warn = None if n == len(items) else f"총 인상분 비균일 {dict(tot)}"
    cand = []
    for s in STEPS:
        have = docs[s]
        cs = {}
        for k in range(-100, 600):
            c = k / 10
            r = sum(1 for _, x in items if round(x + c, 1) in have) / len(items)
            if r >= 0.8:
                cs[c] = r
        cand.append(cs)
    # DP
    best = {0.0: (0, 0.0, [])}
    for si, s in enumerate(STEPS):
        nb = {}
        opts = dict(cand[si])
        for c_prev, (sc, rs, path) in best.items():
            # 문서에 후보가 없으면 직전 값 유지 허용(감점)
            choices = opts if opts else {c_prev: 0.0}
            for c, r in choices.items():
                inc = round(c - c_prev, 1)
                if inc < -0.05:
                    continue
                gain = (2 if inc in typical[s] else 0)
                key = c
                val = (sc + gain, rs + r, path + [inc])
                if key not in nb or val[:2] > nb[key][:2]:
                    nb[key] = val
        best = nb
    final = {c: v for c, v in best.items() if abs(c - D) < 0.05}
    if not final:
        log[g] = {"status": "FAIL", "D": D, "warn": warn}
        continue
    c, (sc, rs, incs) = max(final.items(), key=lambda kv: kv[1][:2])
    cum = 0.0
    for s, inc in zip(STEPS, incs):
        cum = round(cum + inc, 1)
        for p, x in items:
            setp(result[s], p, round(x + cum, 1))
    atyp = [(s, i) for s, i in zip(STEPS, incs) if i not in typical[s]]
    log[g] = {"status": "ok" if not atyp and not warn else "check", "D": D, "steps": incs, "atypical": atyp, "warn": warn}

# 2차: 'check' 묶음은 정상 묶음들에서 관측된 대표 경로 중 총합이 맞는 것으로 대체(문서 일치율 기록)
paths = Counter(tuple(r["steps"]) for r in log.values() if r.get("status") == "ok")
for g, r in log.items():
    if r["status"] == "ok":
        continue
    items = groups[g]
    best = None
    for path, cnt in paths.items():
        if abs(sum(path) - r["D"]) > 0.05:
            continue
        cum, rates = 0.0, []
        for s, inc in zip(STEPS, path):
            cum = round(cum + inc, 1)
            rates.append(sum(1 for _, x in items if round(x + cum, 1) in docs[s]) / len(items))
        key = (min(rates), sum(rates), cnt)
        if best is None or key > best[0]:
            best = (key, path, rates)
    if best and best[0][0] >= 0.6:
        (_, path, rates) = best
        cum = 0.0
        for s, inc in zip(STEPS, path):
            cum = round(cum + inc, 1)
            for p, x in items:
                setp(result[s], p, round(x + cum, 1))
        log[g] = {"status": "ok(typical-path)", "D": r["D"], "steps": list(path), "min_match": round(best[0][0], 2),
                  "step_match": [round(x, 2) for x in rates], "was": r.get("steps")}

for s in STEPS:
    json.dump(result[s], open(f"out/{s}.json", "w"), ensure_ascii=False, indent=1)
json.dump(log, open("anchor_report.json", "w"), ensure_ascii=False, indent=1)
print("typical:", {s: sorted(v) for s, v in typical.items()})
for g, r in log.items():
    if r["status"] != "ok":
        print(g, {k: r.get(k) for k in ("status", "steps", "min_match", "step_match", "was")})
print("ok groups:", sum(r["status"].startswith("ok") for r in log.values()), "/", len(log))
# 단계별 증분 요약(묶음 유형별)
summary = Counter()
for g, r in log.items():
    if "steps" in r:
        summary[(g.split("|")[0] + "|" + g.split("|")[1], tuple(r["steps"]))] += 1
for (k, st), n in sorted(summary.items()):
    print(f"{k:22s} x{n}: {st}")
