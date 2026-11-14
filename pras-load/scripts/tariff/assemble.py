"""out/*.json(판본별) → tariffs.json (시뮬레이터 입력)"""
import json, glob, sys

OUT = sys.argv[1]
SOURCES = {
    "2021-01-01": ("20210101total.pdf", "extracted"),
    "2022-04-01": ("20220401total.pdf (스캔)", "anchored"),
    "2022-07-01": ("20220701total.pdf (스캔)", "anchored"),
    "2022-10-01": ("22.10.01 전기요금표 (스캔)", "anchored"),
    "2023-01-01": ("20230101total.pdf (스캔)", "anchored"),
    "2023-05-16": ("23.05.16 전기요금표", "anchored"),
    "2023-11-09": ("2023년 11월 9일 전기요금표 (스캔)", "anchored"),
    "2024-01-01": ("2024년 1월 1일 전기요금표", "anchored"),
    "2024-04-01": ("2024년 4월 1일 전기요금표", "anchored"),
    "2024-07-01": ("2024년 7월 1일 전기요금표", "extracted"),
    "2024-10-24": ("2024년 10월 24일 전기요금표", "extracted"),
    "2025-01-01": ("2025년 1월 1일 전기요금표", "extracted"),
    "2025-04-01": ("2025년 4월 1일 전기요금표", "extracted"),
    "2026-04-16": ("2026년 4월 16일 전기요금표", "extracted"),
}
CLIMATE = [("2021-01-01", 5.3), ("2022-04-01", 7.3), ("2023-01-01", 9.0)]  # 원/kWh
FUEL = [("2021-01-01", -3.0), ("2021-04-01", 0.0), ("2022-04-01", 0.0), ("2022-07-01", 5.0)]  # 표시값 기준, 분기 변동

O, M, P = 0, 1, 2


def bands(spec):
    a = [O] * 24
    for band, ranges in spec.items():
        for s, e in ranges:
            h = s
            while h != e:
                a[h] = band
                h = (h + 1) % 24
    return a


TOU_SCHEMES = {
    "2016": {
        "label": "기존 시간대 (~2026.4.15 산업용(을) / ~2026.5.31 그 외)",
        "summer": bands({M: [(9, 10), (12, 13), (17, 23)], P: [(10, 12), (13, 17)]}),
        "springfall": bands({M: [(9, 10), (12, 13), (17, 23)], P: [(10, 12), (13, 17)]}),
        "winter": bands({M: [(9, 10), (12, 17), (20, 22)], P: [(10, 12), (17, 20), (22, 23)]}),
    },
    "2026": {
        "label": "개편 시간대 (2026.4.16 산업용(을)·EV, 2026.6.1 그 외)",
        "summer": bands({M: [(8, 15), (21, 22)], P: [(15, 21)]}),
        "springfall": bands({M: [(8, 15), (21, 22)], P: [(15, 21)]}),
        "winter": bands({M: [(8, 9), (12, 16), (19, 22)], P: [(9, 12), (16, 19)]}),
    },
}


def asof(table, d):
    v = None
    for k, x in table:
        if k <= d:
            v = x
    return v


versions = []
for p in sorted(glob.glob("out/*.json")):
    T = json.load(open(p))
    d = T["effective"]
    T.pop("source_rows", None)
    src, method = SOURCES[d]
    T["source"] = src
    T["method"] = method
    T["climate"] = asof(CLIMATE, d)
    T["fuel_adj_shown"] = asof(FUEL, d)
    T["tou_scheme"] = "2026" if d >= "2026-04-16" else "2016"
    if d >= "2026-04-16":
        T["weekend_discount"] = {"classes": ["산업용(을)"], "seasons": ["springfall"], "hours": [11, 12, 13], "dtypes": ["sat", "hol"], "rate": 0.5}
        T["tou_scheme_by_class"] = {"산업용(을)": "2026", "_default": "2016", "_default_from": "2026-06-01"}
    versions.append(T)

doc = {
    "unit": {"energy": "원/kWh", "basic_tou_flat": "원/kW", "basic_residential": "원/호"},
    "season_of_month": [2, 2, 1, 1, 1, 0, 0, 0, 1, 1, 2, 2],
    "season_keys": ["summer", "springfall", "winter"],
    "energy_index": "계절 배열 순서 [여름, 봄가을, 겨울]",
    "tou_band_codes": {"0": "경부하", "1": "중간부하", "2": "최대부하"},
    "tou_schemes": TOU_SCHEMES,
    "dtype_rules": {"sat": "최대부하 → 중간부하", "hol": "일요일·공휴일 전 시간 경부하"},
    "pre2021_rule": "2021.1 이전(2016.12~2020.12)은 2021.1 전력량요금 + 5.3원/kWh(기후환경요금 분리 전)로 재구성. "
                    "주택용 하계 누진구간(300/450kWh)은 2019.7부터, 그 이전은 200/400kWh(2018년 하계 한시 완화 제외).",
    "methods": {
        "extracted": "글자층에서 직접 추출",
        "anchored": "스캔·양식 불일치 판본: 2021.1과 2024.7 정확 판본 사이 총 인상분을 기준으로, 단계별 인상분 경로를 "
                    "문서 숫자(OCR/글자층)와 대조해 확정. 51개 묶음 모두 확정(일부 OCR 일치율 67~78%는 대표 경로 적용)."},
    "gaps": ["임시전력 요금은 요금표에 없음(약관상 별도 기준) — 시뮬레이터에서는 일반용(을) 준용 여부 확인 필요",
             "기후환경요금 2024년 이후 단가는 요금표 글자층에 없어 9.0원 유지로 가정 — 확인 필요",
             "연료비조정단가는 분기 변동 — 판본 표시값만 기록, 시뮬레이터에서는 입력값"],
    "versions": versions,
}
json.dump(doc, open(OUT, "w"), ensure_ascii=False, separators=(",", ":"))
print(OUT, len(versions), "versions")
for v in versions:
    print(v["effective"], v["method"], "climate", v["climate"], "tou", v["tou_scheme"],
          "산업(을)A-I 여름 경/중/최", [v["tou"]["산업용(을)"]["고압A-I"]["energy"][b][0] for b in ("off", "mid", "peak")],
          "주택 저압", v["residential"]["low"]["other"]["energy"])
