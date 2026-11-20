"""연료비조정단가 산정내역(분기별 PDF 텍스트) → build/fuel.json

사용: python3 scripts/build_fuel.py <산정내역 txt 폴더> build
 - 각 문서에서 기간, 실적연료비, 변동연료비, 변환계수, 필요조정단가, 상하한 적용단가, 최종 적용단가를 읽는다.
 - 2022.1Q~2023.2Q는 '미조정분 차감' 재산정본을 우선(2023.5 약관 개정 방식으로 일관). 원 게시값은 함께 기록.
 - 글자층이 없는 판(2022.3Q·2026.3Q·2026.4Q 이미지)과 자료에 없는 2021년은 아래 MANUAL 값(원문 이미지 판독·보도자료 확인).
"""
import json, re, sys
from pathlib import Path

src, out = Path(sys.argv[1]), Path(sys.argv[2])
NUM = r"(-?[\d,]+\.?\d*)"
recs = {}
for f in sorted(src.glob("*.txt")):
    t = re.sub(r"[ \t]+", " ", f.read_text(encoding="utf-8", errors="ignore"))
    # 합본·OCR 파일은 제외(개별 문서 사용)
    if "합본" in f.name or "_ocr" in f.name:
        continue
    m = re.search(r"(\d{4})년 (\d{1,2})\s*~\s*(\d{1,2})월분 연료비조정단가 산정내역", t)
    if not m:
        continue
    y, m1 = int(m.group(1)), int(m.group(2))
    q = f"{y}Q{(m1 - 1) // 3 + 1}"
    req = re.search(r"연료비 조정단가 = " + NUM + r"원/kg × " + NUM + r" kg/kWh = " + NUM + r" 원/kWh", t)
    arrow = re.findall(r"(-?[\d.]+) 원/kWh ▶", t)
    after = re.findall(r"▶ (-?[\d.]+) 원/kWh", t)
    fin = re.search(r"연료비조정단가는\s*(-?[\d.]+)\s*원/kWh\s*[를을]\s*적용", t)
    actual = re.search(r"실적연료비 " + NUM + r" ?원/kg", t)
    rec = {"q": q, "file": f.name, "revised": "미조정분 차감" in f.name,
           "actual_fuel": float(actual.group(1).replace(",", "")) if actual else None,
           "var_fuel": float(req.group(1).replace(",", "")) if req else None,
           "conv": float(req.group(2)) if req else None,
           "required": float(req.group(3)) if req else None,
           "rule": float(after[-1]) if after else None,
           "applied": float(fin.group(1)) if fin else (float(after[-1]) if after else None),
           "gov_note": bool(re.search(r"정부로부터 통보받은 적용사유|유보", t))}
    alt = re.search(r"5\.16 기준\(차감 후 적용 기준연료비 [\d.]+원/kg\) 연료비조정단가는 (-?[\d.]+)원/kWh", t)
    if alt:
        rec["required_after_0516"] = float(alt.group(1))
    prev = recs.get(q)
    if prev is None or (rec["revised"] and not prev["revised"]):
        if prev is not None:
            rec["original_posting"] = {k: prev[k] for k in ("required", "rule", "applied", "file")}
        recs[q] = rec
    elif prev is not None and not rec["revised"]:
        prev.setdefault("original_posting", {k: rec[k] for k in ("required", "rule", "applied", "file")})

# 2022.1Q·2Q 최종값: 원문 4항은 '0원/kWh 적용'(정부 유보). 정규식이 '적용*하기로' 표기를 놓친 경우 보정
for q in ("2022Q1", "2022Q2"):
    if q in recs:
        recs[q]["applied"] = 0.0
        recs[q]["gov_note"] = True

MANUAL = {
    "2021Q1": {"required": None, "rule": -3.0, "applied": -3.0, "source": "연료비 연동제 첫 적용(보도: 산업부·한전 2020.12)"},
    "2021Q2": {"required": -0.2, "rule": -0.2, "applied": -3.0, "gov_note": True, "source": "보도(산업일보 2021.3, 뉴스토마토 2021.3.22): 산정 -0.2원, 비상시 유보로 -3원 유지"},
    "2021Q3": {"required": 1.7, "rule": 0.0, "applied": -3.0, "gov_note": True, "source": "보도(뉴시스 2021.6.21): 산정 1.7원, 분기 조정폭 3원 → 0원이나 유보로 -3원 유지"},
    "2021Q4": {"required": 10.8, "rule": 0.0, "applied": 0.0, "source": "보도(파이낸셜뉴스·뉴시스 2021.9.23): 산정 10.8원, 분기 조정폭 3원 → 0원 (산업부 설명자료: 2021년 월평균 -2.25원)"},
    "2022Q3": {"required": 38.5, "rule": 5.0, "applied": 5.0, "source": "재산정본(미조정분 차감) 38.5원, 원 게시 이미지 33.6원"},
    "2026Q3": {"actual_fuel": 469.03, "var_fuel": -25.60, "conv": 0.1335, "required": -3.4, "rule": -3.4, "applied": 5.0, "gov_note": True, "source": "원문 이미지 판독"},
    "2026Q4": {"actual_fuel": 549.64, "var_fuel": 55.01, "conv": 0.1335, "required": 7.3, "rule": 5.0, "applied": 5.0, "source": "원문 PDF(이미지) OCR 판독"},
}
for q, v in MANUAL.items():
    r = recs.setdefault(q, {"q": q, "file": None})
    for k, x in v.items():
        if k not in r or r[k] is None or k in ("source", "required", "rule", "applied"):
            r[k] = x

quarters = sorted(recs.values(), key=lambda r: (int(r["q"][:4]), int(r["q"][-1])))
# 2023.2Q: 5.16 기준연료비 차감 변경 → 분기 대표 필요단가 = 4.1~5.15(40.7)·5.16~6.30(32.7) 일수 가중
for r in quarters:
    if "required_after_0516" in r:
        r["required_effective"] = round((r["required"] * 45 + r["required_after_0516"] * 46) / 91, 1)
for r in quarters:
    r.setdefault("required_effective", r.get("required"))
doc = {
    "unit": "원/kWh",
    "definition": {"required": "산식 필요조정단가(상하한 적용 전)", "rule": "약관 규칙(상하한·분기 조정폭) 적용단가",
                   "applied": "최종 적용단가(정부 유보·동결 반영)"},
    "notes": ["2022.1Q~2023.2Q 필요조정단가는 '미조정분 차감' 재산정본 기준(기준연료비 미반영분을 차감해 2023.5 이후 방식과 일관)",
              "2023.2Q는 5.16 기준연료비 차감 변경 전후(40.7 / 32.7)를 일수 가중한 36.7을 대표값으로 사용"],
    "quarters": quarters,
}
(out / "fuel.json").write_text(json.dumps(doc, ensure_ascii=False, indent=1), encoding="utf-8")
print(f"{'분기':7s} {'필요':>6s} {'규칙':>6s} {'적용':>6s}  비고")
for r in quarters:
    f = lambda v: "  -  " if v is None else f"{v:6.1f}"
    print(f"{r['q']:7s} {f(r.get('required_effective'))} {f(r.get('rule'))} {f(r.get('applied'))}  {'유보/정부결정' if r.get('gov_note') else ''} {('원게시 ' + str(r['original_posting']['required'])) if r.get('original_posting') else ''}")
