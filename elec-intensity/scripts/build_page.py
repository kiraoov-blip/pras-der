#!/usr/bin/env python3
"""src/head.html + src/body.html + build/data.json + src/app.js → index.html (단일 파일).

head.html 에는 공용 스타일과 내장 글꼴(Pretendard)이 들어 있다(KEPCO Statistics 와 같은 디자인).
그림·엑셀 저장 모듈은 KEPCO Statistics 의 vendor 폴더(/kepco-stat/vendor/)를 함께 쓴다.
"""
import json
from pathlib import Path
ROOT = Path(__file__).resolve().parent.parent
rd = lambda p: (ROOT / p).read_text(encoding='utf-8')
# 색 테마: 공용 스타일의 한전 CI(네이비·레드)를 어두운 회색 + 노란색으로 바꾼다
THEME = [
    ('rgba(0,59,142', 'rgba(58,63,71'), ('rgba(143,176,222,.2)', 'rgba(245,184,0,.16)'), ('rgba(170,198,236,.5)', 'rgba(245,184,0,.55)'),
    ('rgba(230,0,18,.30)', 'rgba(245,184,0,.30)'), ('rgba(230,0,18,.22)', 'rgba(245,184,0,.18)'), ('rgba(255,140,150,.6)', 'rgba(245,184,0,.6)'),
    ('--red:#e60012', '--red:#b98300'), ('#ffd9dc', '#ffe28a'),
    ('#003b8e', '#3a3f47'), ('#002a66', '#2b2f35'), ('#0a2350', '#24282e'), ('#061a3d', '#1b1d21'), ('#0a2a63', '#2c3036'),
    ('#eaf1fb', '#fdf4d8'), ('#f2f6fc', '#fcf8ea'), ('#eef3fb', '#f8f1d8'), ('#8fb0de', '#e0bd4f'), ('#bcd2ef', '#eed78a'),
    ('#c5d8f0', '#f0db96'), ('#dbe7f7', '#f5e8bb'), ('#a9c3e6', '#e7cb72'), ('#e6edf8', '#f1f2f3'), ('#dbe6f6', '#e4e5e8'),
    ('#b9c6dc', '#b7bbc2'), ('#f6f8fb', '#f6f6f7'), ('#e9edf3', '#ececee'), ('#dfe5ef', '#e3e4e7'), ('#fdecee', '#fff3cc'),
]
def theme(t):
    for a, b in THEME: t = t.replace(a, b)
    return t
data = json.dumps(json.loads(rd('build/data.json')), ensure_ascii=False, separators=(',', ':')).replace('</', '<\\/')
html = (theme(rd('src/head.html')) + theme(rd('src/body.html'))
        + '\n<script async src="/kepco-stat/vendor/html2canvas.min.js"></script>\n<script async src="/kepco-stat/vendor/xlsx.full.min.js"></script>\n'
        + '<script type="application/json" id="data">' + data + '</script>\n<script>\n' + rd('src/app.js') + '</script>\n</body>\n</html>\n')
(ROOT / 'index.html').write_text(html, encoding='utf-8')
print('index.html', len(html.encode()), 'bytes')
