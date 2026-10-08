"""수기 판독(제53호) ↔ 다른 판 OCR 대조 + 표 안의 산식 검증.
usage: verify.py <csv> <ocr_dir_of_other_edition> <page>[,<page>...] "<identity>;<identity>..."
identity 예: light=res+str ; power=small+large+agr ; total=light+power
"""
import csv, re, sys, glob
sys.path.insert(0, __file__.rsplit('/', 1)[0])
from grid import words, cells_of
src, odir, pages, ids = sys.argv[1], sys.argv[2], sys.argv[3].split(','), sys.argv[4]
rows = [r for r in csv.reader(l for l in open(src, encoding='utf-8') if not l.startswith('#'))]
head, data = rows[0], rows[1:]
num = lambda s: None if s == '' else 0 if s == '-' else (float(s) if '.' in s else int(s))
tab = {int(r[0]): {h: num(v) for h, v in zip(head[1:], r[1:])} for r in data}
raw = {int(r[0]): dict(zip(head[1:], r[1:])) for r in data}
# 1) 산식
TOL = float(sys.argv[5]) if len(sys.argv) > 5 else 2.0
idf = [([t.strip() for t in l.split('=')[0].split('+')], [t.strip() for t in l.split('=')[1].split('+')]) for l in ids.split(';') if l.strip()]
arith = {}
for y, d in tab.items():
    ok = True
    for lhs, parts in idf:
        if any(d.get(p) is None for p in parts + lhs):
            continue
        L = sum(d[p] for p in lhs)
        if abs(sum(d[p] for p in parts) - L) > TOL:  # 원자료의 단수(반올림) 차이 ±2 허용
            ok = False
            print(f'  산식 불일치 {y}: {"+".join(lhs)}={L} vs {"+".join(parts)}={sum(d[p] for p in parts)}')
    arith[y] = ok
# 2) 다른 판 OCR: 쪽의 각 줄을 칸 묶음 문자열로
import os
pages_lines = []
for od in odir.split('|'):            # 여러 인식 결과(같은 판의 고품질·일반 인식, 다른 판)를 모두 쓴다
    for pg in pages:
        for pat in (f'{od}/p-{pg}.tsv', f'{od}/p-{pg}.png.tsv'):
            if os.path.exists(pat):
                pages_lines.append([[c[0].replace(',', '') for c in cells_of(ws)] for ws in words(pat)])
                break
def hit(s, groups):
    return any(g == s or (len(s) >= 4 and s in g) for g in groups)
other = {}
if len(sys.argv) > 6:                        # 다른 판 원본을 따로 읽은 표(일부 연도·칸만 있어도 됨)
    orows = [r for r in csv.reader(l for l in open(sys.argv[6], encoding='utf-8') if not l.startswith('#'))]
    other = {int(r[0]): {h: num(v) for h, v in zip(orows[0][1:], r[1:]) if v != ''} for r in orows[1:]}
conf = {}
for y, d in tab.items():
    vals = {k: v for k, v in d.items() if v is not None}
    strs = {k: (f'{v:.2f}'.rstrip('0').rstrip('.') if isinstance(v, float) else str(v)) for k, v in vals.items()}
    bests = [max(L, key=lambda g: sum(hit(s, g) for s in strs.values())) for L in pages_lines if L]
    bests = [g for g in bests if sum(hit(s, g) for s in strs.values()) >= 2]   # 한 쪽에서 두 칸 이상 맞는 줄만 그 연도 줄로 본다
    conf[y] = {k: any(hit(s, g) for g in bests) for k, s in strs.items()}
    for k in conf[y]:                           # '-'(값 없음) 칸은 다른 판에서도 빈칸이면 되므로 산식으로만 확인
        if raw[y].get(k) == '-':
            conf[y][k] = True
    for k, v in (other.get(y) or {}).items():   # 다른 판을 따로 읽은 값과 같으면 확인
        if k in conf[y] and v is not None and v == d.get(k):
            conf[y][k] = True
cols = head[1:]
tot = acc = 0
print('연도 산식 | 다른 판 OCR 확인(칸별)')
for y in sorted(tab):
    c = conf[y]; n = sum(c.values()); tot += len(c); acc += n
    print(y, 'OK' if arith[y] else 'NG', f'{n}/{len(c)}', ''.join('o' if c.get(k) else ('.' if k in c else ' ') for k in cols))
print('확인된 칸', acc, '/', tot)
import json
json.dump({'arith': arith, 'conf': {y: c for y, c in conf.items()}}, open(src + '.check.json', 'w'))
# 3) 받아들이기: OCR 확인된 칸 + 산식으로 하나만 비어 있는 칸을 메우는 칸(반복)
acc_tab, flags = {}, {}
for y, d in tab.items():
    ok = {k for k, v in conf[y].items() if v}
    if not arith[y]:
        # 산식이 맞지 않는 행: 다른 판과 칸마다 직접 일치한 경우에만, '원자료 불일치' 표시를 달아 받아들인다
        flags[y] = '원자료 안에서 항목 합과 합계가 맞지 않음(두 판 모두 같은 값으로 인쇄)'
        if len(ok) < len([k for k in cols if d.get(k) is not None]):
            ok = set()
        acc_tab[y] = {k: d[k] for k in ok}
        continue
    changed = True
    while changed and arith[y]:
        changed = False
        for lhs, parts in idf:
            terms = lhs + parts
            if any(d.get(t) is None for t in terms):
                continue
            miss = [t for t in terms if t not in ok]
            if len(miss) == 1:
                ok.add(miss[0]); changed = True
    acc_tab[y] = {k: d[k] for k in ok}
full = [y for y in sorted(tab) if len(acc_tab[y]) == len([k for k in cols if tab[y].get(k) is not None])]
print('모든 칸 확정된 연도:', full)
print('일부만 확정:', {y: sorted(set(cols) - set(acc_tab[y])) for y in sorted(tab) if y not in full})
json.dump({str(y): acc_tab[y] for y in acc_tab}, open(src + '.accepted.json', 'w'), ensure_ascii=False)
json.dump({str(y): f for y, f in flags.items() if acc_tab.get(y)}, open(src + '.flags.json', 'w'), ensure_ascii=False)
print('표시(원자료 불일치)로 받아들인 연도:', [y for y in flags if acc_tab.get(y)])
