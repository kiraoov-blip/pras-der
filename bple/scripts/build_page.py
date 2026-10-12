#!/usr/bin/env python3
"""src/app.html + src/styles.css + src/app.js + src/data/plans.js → index.html (단일 파일).

사용법: python3 scripts/build_page.py

IEA · EMBER · KEPCO Statistics 와 같이 배포물을 index.html 한 장으로 만든다.
외부 파일을 전혀 참조하지 않으므로, 같은 경로에 예전 버전이 올라가 있었더라도
브라우저가 낡은 CSS·JS 를 캐시에서 꺼내 쓰는 일이 생기지 않는다.
"""
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
read = lambda *p: (ROOT.joinpath(*p)).read_text(encoding='utf-8')

# </style> · </script> 가 문자열 안에 들어 있으면 조기 종료되므로 끊어준다
safe = lambda s: s.replace('</style', '<\\/style').replace('</script', '<\\/script')

html = (read('src', 'app.html')
        .replace('/*__BASECSS__*/', safe(read('src', 'styles.css')))
        .replace('/*__DATA__*/', safe(read('src', 'data', 'plans.js')))
        .replace('/*__APP__*/', safe(read('src', 'app.js'))))

for ph in ('/*__BASECSS__*/', '/*__DATA__*/', '/*__APP__*/'):
    assert ph not in html, f'치환되지 않은 자리표시자: {ph}'

(ROOT / 'index.html').write_text(html, encoding='utf-8')
print('index.html', len(html.encode()), 'bytes')
