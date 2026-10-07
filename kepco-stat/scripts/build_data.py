#!/usr/bin/env python3
"""한국전력통계 세 판(2006년판 PDF · 2012년판 PDF · 2025년판 엑셀)을 하나의 JSON으로 정제한다.

사용법:
  python3 build_data.py <2006.pdf> <2012.pdf> <2025.xlsx> <out_dir>

원칙
- 원본 파일은 수정하지 않는다. 브라우저는 엑셀·PDF를 읽지 않고 이 스크립트가 만든 JSON만 쓴다.
- 같은 연도가 여러 판에 있으면 가장 최근 판의 값을 쓴다. 판 사이 차이는 audit.json 에 기록한다.
- 항목명의 공백은 모두 지운다.
- 값이 없는 칸은 null 로 두고 임의로 채우지 않는다.
필요 도구: pdftotext(poppler), openpyxl
"""
import json, re, statistics, subprocess, sys
from pathlib import Path
import openpyxl

PDF06, PDF12, XLSX25, OUT = sys.argv[1:5]
OUT = Path(OUT)

# ───────────────────────── PDF 표 읽기 ─────────────────────────
def pdf_pages(path):
    txt = subprocess.run(['pdftotext', '-layout', path, '-'], capture_output=True).stdout.decode('utf-8', 'replace')
    return txt.split('\f')

PAGES = {'2006': pdf_pages(PDF06), '2012': pdf_pages(PDF12)}
TOK = re.compile(r'\(?-?\d[\d,]*\.?\d*\)?p?|(?<!\S)[-…](?!\S)')

def num(t):
    t = t.strip('()p').replace(',', '')
    if t in ('-', '…', ''):
        return None
    return float(t) if '.' in t else int(t)

def read_rows(ed, pg, side):
    """연도 행과 그 뒤의 월 행을 [(구분, 키, [(값, 끝열)])] 로 돌려준다. side: 연도가 줄 앞(L)·뒤(R)."""
    out, seen_year = [], False
    for line in PAGES[ed][pg - 1].splitlines():
        toks = [(m.group(0), m.end()) for m in TOK.finditer(line)]
        if len(toks) < 2:
            continue
        key_tok = toks[0] if side == 'L' else toks[-1]
        body = toks[1:] if side == 'L' else toks[:-1]
        if not re.fullmatch(r'\d{1,4}', key_tok[0]):
            continue
        k = int(key_tok[0])
        # 본문에 글자가 섞인 줄(머리글·각주)은 버린다
        rest = TOK.sub('', line)
        if re.search(r'[A-Za-z가-힣一-龥]', rest):
            continue
        if 1940 < k < 2030:
            seen_year = True
            out.append(('y', k, body))
        elif seen_year and 1 <= k <= 12:
            out.append(('m', k, body))
    return out

SHORT = []  # 열 수가 모자라 위치로 맞춘 행 기록

def pdf_table(ed, pg, side, cols):
    """cols: 열 이름 목록(None 은 버림). 칸이 빈 행은 숫자의 끝 위치로 열을 맞춘다."""
    rows = read_rows(ed, pg, side)
    full = [b for _, _, b in rows if len(b) == len(cols)]
    if not full:
        raise SystemExit(f'{ed} p{pg}: 열 수 {len(cols)} 와 맞는 행이 없음')
    ends = [statistics.median(b[i][1] for b in full) for i in range(len(cols))]
    yr, mo = {}, {}
    for kind, k, body in rows:
        if len(body) == len(cols):
            vals = [num(t) for t, _ in body]
        elif len(body) < len(cols):
            vals = [None] * len(cols)
            for t, e in body:
                i = min(range(len(cols)), key=lambda j: abs(ends[j] - e))
                vals[i] = num(t)
            SHORT.append(f'{ed}판 p{pg} {k}: {len(body)}/{len(cols)}칸')
        else:
            raise SystemExit(f'{ed} p{pg} {k}: 열이 더 많음 {len(body)}>{len(cols)}')
        d = {c: v for c, v in zip(cols, vals) if c}
        (yr if kind == 'y' else mo)[k] = d
    return yr, mo

def pdf_multi(ed, parts):
    """여러 쪽에 걸친 표를 연도로 합친다. parts: [(쪽, side, cols)]"""
    yr, mo = {}, {}
    for pg, side, cols in parts:
        y, m = pdf_table(ed, pg, side, cols)
        for k, d in y.items():
            yr.setdefault(k, {}).update(d)
        for k, d in m.items():
            mo.setdefault(k, {}).update(d)
    return yr, mo

# ───────────────────────── 엑셀 표 읽기 ─────────────────────────
WB = openpyxl.load_workbook(XLSX25, data_only=True)

def xnum(v):
    if isinstance(v, (int, float)):
        return v
    return None

def xl_table(sheet, cols, first_row=4, key_col=1):
    """cols: {열번호(1부터): 이름}. 첫 열이 연도인 행과 그 뒤 1~12월 행을 읽는다."""
    ws = WB[sheet]
    yr, mo, seen = {}, {}, False
    for r in range(first_row, ws.max_row + 1):
        k = ws.cell(r, key_col).value
        if not isinstance(k, (int, float)):
            continue
        k = int(k)
        d = {name: xnum(ws.cell(r, c).value) for c, name in cols.items()}
        if 1940 < k < 2030:
            seen = True
            yr[k] = d
        elif seen and 1 <= k <= 12:
            mo[k] = d
    return yr, mo

def clean(s):
    """항목명에서 공백·영문·각주번호를 지우고 한글만 남긴다."""
    s = re.sub(r'\d\)', '', str(s))
    return ''.join(re.findall(r'[가-힣·]+', s))

# ───────────────────────── 표 정의 ─────────────────────────
CLS8 = ['res', 'gen', 'edu', 'ind', 'agr', 'str', 'night', 'total']
CLS7 = ['res', 'gen', 'edu', 'ind', 'agr', 'str', 'total']
X8 = {i + 2: c for i, c in enumerate(CLS8)}

GEN_A = ['oth_total', 'h_gen', 'h_pump', 'h_small', 'h_tot', 'anth', 'bitu']
GEN_B = ['heavy', 'lngst', 'steam_tot', 'cc_gen', 'cc_heat', 'cc', 'ic', 'nuc']
USE_A = ['res', None, 'pub', None, 'svc', None, 'agr']
USE_B = [None, 'min', None, 'mfg', None, 'total', None]
LOSS_A = ['net', 'dist', 'tl', 'tr']
LOSS_B = ['sold', 'dl', 'dr', 'ol', 'or']
PERF_A = ['cap', 'gen', 'avg', 'peak', 'lf']
PERF_B = ['pf', 'aux', 'auxr', 'netgen', 'pumpuse']
PUR = ['mv', 'ma', 'mp', 'pv', 'pa', 'pp', 'tv', 'ta', 'tp']

EDS = {}  # 표 → 판 → (연도 dict, 월 dict)

def put(name, ed, res):
    EDS.setdefault(name, {})[ed] = res

# 판매·요금 계열
put('cust', '2006', pdf_table('2006', 91, 'L', CLS7))
put('cust', '2012', pdf_table('2012', 113, 'L', CLS8))
put('cust', '2025', xl_table('21.고객호수 추이', X8))
put('kw', '2006', pdf_table('2006', 92, 'L', CLS7))
put('kw', '2012', pdf_table('2012', 114, 'L', CLS8))
put('kw', '2025', xl_table('22.요금적용전력 추이', X8, first_row=5))
put('sales', '2006', pdf_multi('2006', [(93, 'L', CLS7[:4]), (94, 'R', CLS7[4:])]))
put('sales', '2012', pdf_multi('2012', [(115, 'L', CLS8[:4]), (116, 'R', CLS8[4:])]))
put('sales', '2025', xl_table('23.판매량 추이', X8))
put('rev', '2006', pdf_multi('2006', [(115, 'L', CLS7[:4]), (116, 'R', ['agr', 'str', 'total', None])]))
put('rev', '2012', pdf_multi('2012', [(137, 'L', CLS8[:4]), (138, 'R', CLS8[4:])]))
put('rev', '2025', xl_table('29.전력판매수입 추이', X8))
put('price', '2006', pdf_table('2006', 117, 'L', CLS7))
put('price', '2012', pdf_table('2012', 139, 'L', CLS8))
put('price', '2025', xl_table('30.판매단가 추이', X8))
put('use', '2006', pdf_multi('2006', [(95, 'L', USE_A), (96, 'R', USE_B)]))
put('use', '2012', pdf_multi('2012', [(117, 'L', USE_A), (118, 'R', USE_B)]))
put('use', '2025', xl_table('24.용도별 판매량 추이', {2: 'res', 4: 'pub', 6: 'svc', 8: 'agr', 10: 'min', 12: 'mfg', 14: 'total'}, first_row=5))

# 시도별 판매량
put('region', '2006', pdf_multi('2006', [
    (107, 'L', ['서울', '부산', '대구', '인천']), (108, 'R', ['광주', '대전', '울산', '경기']),
    (109, 'L', ['강원', '충북', '충남', '전북']), (110, 'R', ['전남', '경북', '경남', '제주', '합계'])]))
put('region', '2012', pdf_multi('2012', [
    (129, 'L', ['서울', '부산', '대구', '인천']), (130, 'R', ['광주', '대전', '울산', '경기']),
    (131, 'L', ['강원', '충북', '충남', '전북', '전남']), (132, 'R', ['경북', '경남', '제주', '개성', '합계'])]))
ws = WB['27.행정구역별 판매량 추이']
rcols = {}
for c in range(2, ws.max_column + 1):
    n = clean(ws.cell(3, c).value or '')
    if n and n not in ('시도별연도별',) and n not in rcols.values():
        rcols[c] = n
put('region', '2025', xl_table('27.행정구역별 판매량 추이', rcols))

# 손실·구입·발전실적
put('loss', '2006', pdf_multi('2006', [(89, 'L', LOSS_A), (90, 'R', LOSS_B)]))
put('loss', '2012', pdf_multi('2012', [(111, 'L', LOSS_A), (112, 'R', LOSS_B)]))
put('loss', '2025', xl_table('20.전력손실 추이 ', {i + 2: c for i, c in enumerate(LOSS_A + LOSS_B)}, first_row=6))
put('pur', '2006', pdf_table('2006', 86, 'L', PUR))
put('pur', '2012', pdf_table('2012', 108, 'L', PUR))
put('pur', '2025', xl_table('19.전력구입실적(1.종합)', {i + 2: c for i, c in enumerate(PUR)}, first_row=6))
put('perf', '2006', pdf_multi('2006', [(13, 'L', PERF_A), (14, 'R', PERF_B)]))
put('perf', '2012', pdf_multi('2012', [(25, 'L', PERF_A), (26, 'R', PERF_B)]))
put('perf', '2025', xl_table('2.발전실적 추이', {i + 2: c for i, c in enumerate(PERF_A + PERF_B)}, first_row=6))

# 발전량(사업자 종합) · 발전설비(사업자)
put('gen', '2006', pdf_multi('2006', [(10, 'R', GEN_A), (11, 'L', GEN_B),
    (12, 'R', ['grp', 'ren', 'pu_total', 'purch', 'selfc', 'nonutil', 'tot_a', 'tot'])]))
put('gen', '2012', pdf_multi('2012', [(22, 'R', GEN_A), (23, 'L', GEN_B),
    (24, 'R', ['grpalt', 'pu_total', 'purch', 'selfc', 'nonutil', 'tot_a', 'tot'])]))
put('gen', '2025', xl_table('1.발전량 추이', {
    29: 'h_gen', 30: 'h_pump', 31: 'h_small', 32: 'h_tot', 33: 'anth', 34: 'bitu', 37: 'heavy', 38: 'lngst',
    39: 'steam_tot', 40: 'cc', 41: 'nuc', 42: 'ren', 43: 'grp', 44: 'ic', 45: 'etc', 46: 'pu_total',
    47: 'purch', 48: 'selfc', 49: 'nonutil', 50: 'tot_a', 51: 'tot'}, first_row=6))
CAP_C = ['ic', 'nuc', 'grp', 'ren', 'pu_total', 'nonutil', 'tot']
put('cap', '2006', pdf_multi('2006', [(44, 'R', GEN_A), (45, 'L', GEN_B[:6]), (46, 'R', CAP_C)]))
put('cap', '2012', pdf_multi('2012', [(60, 'R', GEN_A), (61, 'L', GEN_B[:6]), (62, 'R', CAP_C)]))
put('cap', '2025', xl_table('8.발전설비 추이', {
    29: 'h_gen', 30: 'h_pump', 31: 'h_small', 32: 'h_tot', 33: 'anth', 34: 'bitu', 37: 'heavy', 38: 'lngst',
    39: 'steam_tot', 40: 'cc', 41: 'nuc', 42: 'ren', 43: 'grp', 44: 'ic', 45: 'etc', 46: 'pu_total',
    47: 'nonutil', 48: 'tot'}, first_row=6))

# ───────────────────────── 세 판 잇기 ─────────────────────────
ORDER = ['2025', '2012', '2006']  # 최신 판 우선
AUDIT = {'overlap': [], 'short_rows': SHORT, 'checks': []}
Y0, Y1 = 1990, 2025
YEARS = [1961] + list(range(Y0, Y1 + 1))
TABLES, EDITION, MONTHLY = {}, {}, {}

for name, eds in EDS.items():
    keys = []
    for ed in ORDER:
        for d in eds[ed][0].values():
            for k in d:
                if k not in keys:
                    keys.append(k)
    tab = {k: [None] * len(YEARS) for k in keys}
    edi = [None] * len(YEARS)
    for i, y in enumerate(YEARS):
        have = [ed for ed in ORDER if y in eds[ed][0]]
        if not have:
            continue
        edi[i] = have[0]
        for k, v in eds[have[0]][0][y].items():
            tab[k][i] = v
        # 최신 판에 없는 세부 열은 이전 판에서 보충(같은 연도, 값이 있을 때만)
        for ed in have[1:]:
            for k, v in eds[ed][0][y].items():
                new = eds[have[0]][0][y].get(k)
                if new is None and v is not None and k not in eds[have[0]][0][y]:
                    tab[k][i] = v
                elif new is not None and v is not None and new != 0:
                    diff = (v - new) / new * 100
                    if abs(diff) >= 0.05 and y != 1961:
                        AUDIT['overlap'].append({'table': name, 'col': k, 'year': y, 'used_ed': have[0], 'used': new,
                                                 'other_ed': ed, 'other': v, 'diff_pct': round(diff, 2)})
    TABLES[name] = tab
    EDITION[name] = edi
    mo = {}
    for ed in ('2006', '2012', '2025'):
        m = eds[ed][1]
        if len(m) == 12:
            yr_of = {'2006': 2005, '2012': 2011, '2025': 2025}[ed]
            mo[yr_of] = {k: [m[i].get(k) for i in range(1, 13)] for k in m[1]}
    if mo:
        MONTHLY[name] = mo

# 1990~1993년: 일반용·교육용·산업용이 한 칸에 합쳐져 실렸다(요금적용전력은 주택용까지 포함).
# 위치 맞춤으로 교육용 열에 들어간 값을 별도 열 gis(합산)로 옮긴다.
AUDIT['fixes'] = []
for name in ('cust', 'kw', 'sales', 'rev', 'price'):
    t = TABLES[name]
    t['gis'] = [None] * len(YEARS)
    for i, y in enumerate(YEARS):
        if y < 1994 and t['gen'][i] is None and t['ind'][i] is None and t['edu'][i] is not None:
            t['gis'][i], t['edu'][i] = t['edu'][i], None

# 시도별 합계가 시도 합과 0.2% 넘게 다르면 시도 합으로 바꾼다(원자료 합계 칸 오류)
r = TABLES['region']
for i, y in enumerate(YEARS):
    parts = [v[i] for k, v in r.items() if k != '합계' and v[i] is not None]
    if parts and r['합계'][i] and abs(sum(parts) - r['합계'][i]) > r['합계'][i] * 0.002:
        AUDIT['fixes'].append(f'시도별 판매량 {y}년 합계: 원자료 {r["합계"][i]:,.0f} → 시도 합 {sum(parts):,.0f} MWh 로 대체')
        r['합계'][i] = sum(parts)

# 2005년 집단·대체: 2012년판은 합쳐서, 2006년판은 따로 실었다 → 따로 실린 값을 쓴다
g = TABLES['gen']
for i, y in enumerate(YEARS):
    if g['grpalt'][i] is not None and g['grp'][i] is not None and g['ren'][i] is not None:
        if abs(g['grp'][i] + g['ren'][i] - g['grpalt'][i]) <= 1:
            g['grpalt'][i] = None

# ───────────────────────── 2025년 시도별 단면 ─────────────────────────
REG17 = ['서울', '부산', '대구', '인천', '광주', '대전', '울산', '세종', '경기', '강원', '충북', '충남', '전북', '전남', '경북', '경남', '제주']
ws = WB['28.행정구역별 용도별 판매량']
hdr = {}
for c in range(2, ws.max_column + 1):
    n = clean(ws.cell(3, c).value or '')
    if n in REG17 or n == '합계':
        hdr[n] = c
REG_USE = {}
USE_ROWS = {'가정용': 'res', '공공용': 'pub', '서비스업': 'svc', '농림어업': 'agr', '광업': 'min', '제조업': 'mfg', '합계': 'total'}
for r in range(4, ws.max_row + 1):
    n = clean(ws.cell(r, 1).value or '')
    if n in USE_ROWS and USE_ROWS[n] not in REG_USE:
        REG_USE[USE_ROWS[n]] = {reg: xnum(ws.cell(r, c).value) for reg, c in hdr.items()}

ws = WB['8-2. 행정구역별 발전설비 및 발전량']
SRC82 = ['nuc', 'anth', 'bitu', 'lng', 'ren', 'oil', 'pump', 'etc', 'total']
REG_CAP, REG_GEN = {}, {}
for r in range(6, ws.max_row + 1):
    n = clean(ws.cell(r, 1).value or '')
    if n == '총계':
        n = '합계'
    if n in REG17 or n == '합계':
        REG_CAP[n] = {s: xnum(ws.cell(r, 2 + i).value) or 0 for i, s in enumerate(SRC82)}
        REG_GEN[n] = {s: xnum(ws.cell(r, 11 + i).value) or 0 for i, s in enumerate(SRC82)}

# ───────────────────────── 검증 ─────────────────────────
def check(label, ok, detail=''):
    AUDIT['checks'].append({'check': label, 'ok': bool(ok), 'detail': detail})

def sumcheck(name, parts, total, tol=0.002):
    bad = []
    t = TABLES[name]
    for i, y in enumerate(YEARS):
        tv = t[total][i]
        vals = [t[p][i] for p in parts if p in t]
        if tv is None or all(v is None for v in vals):
            continue
        s = sum(v or 0 for v in vals)
        if abs(s - tv) > abs(tv) * tol + 2:
            bad.append(f'{y}: 합 {s:,.0f} ≠ 합계 {tv:,.0f}')
    check(f'{name}: 항목 합 = 합계', not bad, '; '.join(bad[:6]))

for n in ('cust', 'kw', 'sales', 'rev'):
    sumcheck(n, CLS8[:-1] + ['gis'], 'total')
sumcheck('use', ['res', 'pub', 'svc', 'agr', 'min', 'mfg'], 'total')
sumcheck('region', REG17 + ['개성'], '합계')
sumcheck('gen', ['h_tot', 'steam_tot', 'cc', 'ic', 'nuc', 'grp', 'ren', 'grpalt', 'etc'], 'pu_total')
sumcheck('cap', ['h_tot', 'steam_tot', 'cc', 'ic', 'nuc', 'grp', 'ren', 'etc'], 'pu_total')
# 판매단가 = 판매수입 ÷ 판매량 (천원/MWh = 원/kWh)
bad = []
for c in CLS8:
    for i, y in enumerate(YEARS):
        r, s, p = TABLES['rev'][c][i], TABLES['sales'][c][i], TABLES['price'][c][i]
        if r and s and p and abs(r / s - p) > max(0.06, p * 0.005):
            bad.append(f'{y} {c}: {r / s:.2f} vs {p}')
check('price: 판매수입÷판매량 = 판매단가', not bad, '; '.join(bad[:8]))
bad = [f'{y}' for i, y in enumerate(YEARS) if TABLES['sales']['total'][i] and TABLES['region']['합계'][i]
       and abs(TABLES['sales']['total'][i] - TABLES['region']['합계'][i]) > 2]
check('region 합계 = sales 합계', not bad, ', '.join(bad))
missing = {n: [y for i, y in enumerate(YEARS) if y >= Y0 and EDITION[n][i] is None] for n in TABLES}
AUDIT['missing_years'] = {k: v for k, v in missing.items() if v}

# ───────────────────────── 내보내기 ─────────────────────────
def rnd(v):
    if isinstance(v, float):
        return round(v, 3)
    return v

DATA = {
    'meta': {'title': '한국전력통계', 'editions': {'2006': '2006년판(2005년 실적)', '2012': '제81호(2011년 실적)', '2025': '제95호(2025년 실적)'}},
    'years': YEARS,
    'tables': {n: {k: [rnd(v) for v in vs] for k, vs in t.items()} for n, t in TABLES.items()},
    'edition': EDITION,
    'monthly': {n: {str(y): {k: [rnd(v) for v in vs] for k, vs in d.items()} for y, d in m.items()} for n, m in MONTHLY.items()},
    'regions': REG17,
    'reg_use': REG_USE, 'reg_cap': REG_CAP, 'reg_gen': REG_GEN,
}
OUT.mkdir(parents=True, exist_ok=True)
(OUT / 'data.json').write_text(json.dumps(DATA, ensure_ascii=False, separators=(',', ':')), encoding='utf-8')
(OUT / 'audit.json').write_text(json.dumps(AUDIT, ensure_ascii=False, indent=1), encoding='utf-8')
print('data.json', (OUT / 'data.json').stat().st_size, 'bytes')
for c in AUDIT['checks']:
    print('OK ' if c['ok'] else 'NG ', c['check'], c['detail'][:300])
print('overlap diffs:', len(AUDIT['overlap']), '| short rows:', len(SHORT), '| missing:', AUDIT['missing_years'])
