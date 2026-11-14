#!/usr/bin/env python3
"""src/app.html + build/*.json → index.html + data/*.json

사용법: python3 scripts/build_page.py [ember-sim/index.html 경로]
- 공용 스타일·내장 글꼴은 ember-sim/index.html 에서 가져와 한전 CI 색으로 바꾼다(kepco-stat 과 동일).
- 데이터는 용량(약 12MB)이 커서 index.html 에 넣지 않고 data/ 로 분리해 필요할 때 불러온다.
  파일 이름 뒤에 내용 해시(?v=)를 붙여 브라우저 캐시가 낡은 데이터를 쓰지 않게 한다.
"""
import hashlib, json, re, shutil, sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
ember = Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT.parent / "ember-sim" / "index.html"
src = ember.read_text(encoding="utf-8")
css = re.search(r"<body>\s*<style>(.*?)</style>", src, re.S).group(1)
for a, b in [("#9f1239", "#003b8e"), ("#881337", "#002a66"), ("#f8eef1", "#eaf1fb"), ("#fbf3f5", "#f2f6fc"), ("#c98a9b", "#8fb0de"),
             ("#e3b9c4", "#bcd2ef"), ("#e8c4cd", "#c5d8f0"), ("#f3dfe5", "#dbe7f7"), ("#d9a9b6", "#a9c3e6"), ("rgba(159,18,57", "rgba(0,59,142")]:
    css = css.replace(a, b)

DATA = ["meta", "tariffs", "analysis", "cube_tariff", "cube_industry", "cube_region", "cube_cross", "daily_tariff", "kepco_ref", "audit", "cost", "fuel"]
out = ROOT / "data"
out.mkdir(exist_ok=True)
h = hashlib.sha1()
for n in DATA:
    p = ROOT / "build" / f"{n}.json"
    obj = json.loads(p.read_text(encoding="utf-8"))
    txt = json.dumps(obj, ensure_ascii=False, separators=(",", ":"))
    (out / f"{n}.json").write_text(txt, encoding="utf-8")
    h.update(txt.encode())
ver = h.hexdigest()[:10]
html = (ROOT / "src" / "app.html").read_text(encoding="utf-8").replace("/*__BASECSS__*/", css).replace("__VER__", ver)
(ROOT / "index.html").write_text(html, encoding="utf-8")
total = sum((out / f"{n}.json").stat().st_size for n in DATA)
print(f"index.html {len(html.encode()):,} bytes · data/ {total / 1e6:.1f} MB · v={ver}")
