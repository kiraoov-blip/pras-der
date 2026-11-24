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
# EMBER의 와인 포인트를 이 시뮬레이터의 녹색 팔레트(#2D7E2E 기준)로 바꾼다
for a, b in [("#9f1239", "#2d7e2e"), ("#881337", "#1e5d20"), ("#f8eef1", "#eef6e6"), ("#fbf3f5", "#f5faf0"), ("#c98a9b", "#89c17e"),
             ("#e3b9c4", "#c5e1b5"), ("#e8c4cd", "#cfe6c0"), ("#f3dfe5", "#e3f0d8"), ("#d9a9b6", "#a9d39a"), ("rgba(159,18,57", "rgba(45,126,46")]:
    css = css.replace(a, b)

DATA = ["meta", "tariffs", "analysis", "cube_tariff", "cube_industry", "cube_region", "cube_cross", "daily_tariff", "kepco_ref", "audit", "cost", "fuel", "monthly", "region_map", "discount", "network", "welfare_bins", "res_bins", "contract", "region", "fin"]
out = ROOT / "data"
out.mkdir(exist_ok=True)
h = hashlib.sha1()
for n in DATA:
    p = ROOT / "build" / f"{n}.json"
    obj = json.loads(p.read_text(encoding="utf-8"))
    txt = json.dumps(obj, ensure_ascii=False, separators=(",", ":"))
    (out / f"{n}.json").write_text(txt, encoding="utf-8")
    h.update(txt.encode())
src_html = (ROOT / "src" / "app.html").read_text(encoding="utf-8").replace("/*__BASECSS__*/", css)
h.update(src_html.encode())   # 화면 코드가 바뀌어도 버전이 바뀌게
ver = h.hexdigest()[:10]
html = src_html.replace("__VER__", ver)
# 페이지가 캐시된 옛 버전이면 이 파일을 보고 스스로 새로 고친다
(out / "version.json").write_text(json.dumps({"v": ver}), encoding="utf-8")
(ROOT / "index.html").write_text(html, encoding="utf-8")
total = sum((out / f"{n}.json").stat().st_size for n in DATA)
print(f"index.html {len(html.encode()):,} bytes · data/ {total / 1e6:.1f} MB · v={ver}")
