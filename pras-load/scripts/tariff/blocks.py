"""rows/*.json → 요금 블록(TOU 3행 묶음, 계절 평면 요금 행) 추출 및 요약 출력"""
import json, sys, re

TOU = {"경부하": 0, "중간부하": 1, "최대부하": 2}


def blocks(recs):
    out = []
    cur = None
    for r in recs:
        lab = [l for l in r["lab"] if l in TOU]
        nums = r["nums"]
        key = (r["p"], r["c"])
        if lab and len(nums) >= 3:
            vals = [n for n in nums if n < 1000][-3:]
            basic = next((n for n in nums if n >= 1000), None)
            if cur is None or cur["key"] != key or cur["type"] != "tou" or len(cur["rows"]) % 3 == 0 and TOU[lab[0]] != 0 and False:
                cur = {"key": key, "type": "tou", "rows": [], "basics": []}
                out.append(cur)
            cur["rows"].append((TOU[lab[0]], vals))
            if basic:
                cur["basics"].append(basic)
        elif len(nums) == 4 and nums[0] >= 1000 and all(n < 1000 for n in nums[1:]):
            if cur is None or cur["key"] != key or cur["type"] != "flat":
                cur = {"key": key, "type": "flat", "rows": [], "basics": []}
                out.append(cur)
            cur["rows"].append((None, nums[1:]))
            cur["basics"].append(nums[0])
        else:
            if cur is not None and cur["type"] == "tou" and len(cur["rows"]) % 3 != 0:
                continue  # TOU 블록 안의 줄바꿈(선택/Ⅰ 등)은 무시
            cur = None
    return out


if __name__ == "__main__":
    recs = json.load(open(sys.argv[1]))
    for b in blocks(recs):
        print(b["key"], b["type"], len(b["rows"]), "basics=", [int(x) for x in b["basics"]],
              "first=", b["rows"][0][1], "last=", b["rows"][-1][1])
