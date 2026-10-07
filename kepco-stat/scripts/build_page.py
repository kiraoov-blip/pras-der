#!/usr/bin/env python3
"""src/app.html + build/data.json → index.html (단일 파일).

사용법: python3 build_page.py [ember-sim/index.html 경로]
공용 스타일과 내장 글꼴(Pretendard)은 ember-sim/index.html 에서 그대로 가져와 색만 한전 CI 계열로 바꾼다.
"""
import json, re, sys
from pathlib import Path
ROOT = Path(__file__).resolve().parent.parent
ember = Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT.parent / 'ember-sim' / 'index.html'
src = ember.read_text(encoding='utf-8')
css = re.search(r'<body>\s*<style>(.*?)</style>', src, re.S).group(1)
for a, b in [('#9f1239', '#003b8e'), ('#881337', '#002a66'), ('#f8eef1', '#eaf1fb'), ('#fbf3f5', '#f2f6fc'), ('#c98a9b', '#8fb0de'),
             ('#e3b9c4', '#bcd2ef'), ('#e8c4cd', '#c5d8f0'), ('#f3dfe5', '#dbe7f7'), ('#d9a9b6', '#a9c3e6'), ('rgba(159,18,57', 'rgba(0,59,142')]:
    css = css.replace(a, b)
data = json.dumps(json.loads((ROOT / 'build' / 'data.json').read_text(encoding='utf-8')), ensure_ascii=False, separators=(',', ':')).replace('</', '<\\/')
html = (ROOT / 'src' / 'app.html').read_text(encoding='utf-8').replace('/*__BASECSS__*/', css).replace('__DATA__', data)
(ROOT / 'index.html').write_text(html, encoding='utf-8')
print('index.html', len(html.encode()), 'bytes')
