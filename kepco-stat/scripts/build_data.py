#!/usr/bin/env python3
"""한국전력통계 여러 판(PDF·엑셀)을 하나의 JSON으로 정제한다.

사용법:
  python3 build_data.py <src_dir> <out_dir>

src_dir 에는 아래 이름으로 원본을 둔다(링크도 가능).
  e69.pdf  제69호(1999년 실적)     e75.pdf  2006년판(2005년 실적)
  e81.pdf  제81호(2011년 실적)     e82.pdf  제82호(2012년 실적)
  e86.pdf  제86호(2016년 실적)     e87.xlsx 제87호(2017년 실적)
  e95.xlsx 제95호(2025년 실적)

원칙
- 원본 파일은 수정하지 않는다. 브라우저는 엑셀·PDF를 읽지 않고 이 스크립트가 만든 JSON만 쓴다.
- 같은 연도가 여러 판에 있으면 가장 최근 판의 값을 쓴다. 판 사이 차이는 audit.json 에 기록한다.
- 항목명의 공백은 모두 지운다. 값이 없는 칸은 null 로 두고 임의로 채우지 않는다.
필요 도구: pdftotext(poppler), openpyxl
"""
import json, re, statistics, subprocess, sys, unicodedata
from pathlib import Path
import openpyxl

SRC, OUT = Path(sys.argv[1]), Path(sys.argv[2])
EDN = {'69': '제69호(1999년 실적)', '75': '2006년판(2005년 실적)', '81': '제81호(2011년 실적)', '82': '제82호(2012년 실적)',
       '86': '제86호(2016년 실적)', '87': '제87호(2017년 실적)', '95': '제95호(2025년 실적)'}
ORDER = ['95', '87', '86', '82', '81', '75', '69']  # 최신 판 우선
LAST_YEAR = {'69': 1999, '75': 2005, '81': 2011, '82': 2012, '86': 2016, '87': 2017, '95': 2025}

# ───────────────────────── PDF 표 읽기 ─────────────────────────
def pdf_pages(path):
    txt = subprocess.run(['pdftotext', '-layout', str(path), '-'], capture_output=True).stdout.decode('utf-8', 'replace')
    return txt.split('\f')

PAGES = {ed: pdf_pages(SRC / f'e{ed}.pdf') for ed in ('69', '75', '81', '82', '86')}
TOK = re.compile(r'\(?[-△]?\d[\d,]*\.?\d*\)?p?|(?<!\S)[-…](?!\S)')

def num(t):
    neg = t.startswith('△')
    t = t.strip('()p△').replace(',', '')
    if t in ('-', '…', ''):
        return None
    v = float(t) if '.' in t else int(t)
    return -v if neg else v

def toks(line):
    """숫자 토큰 [(문자열, 끝열)]. 괄호 안 값(재게·부기)은 버린다."""
    line = re.sub(r'\(\s*[\d,.]+\s*\)', lambda m: ' ' * len(m.group(0)), line)
    return [(m.group(0), m.end()) for m in TOK.finditer(line) if not m.group(0).startswith('(')]

def read_rows(ed, pg, side):
    """연도 행과 그 뒤의 월 행을 [(구분, 키, [(값, 끝열)])] 로 돌려준다. side: 연도가 줄 앞(L)·뒤(R)."""
    out, seen_year = [], False
    for line in PAGES[ed][pg - 1].splitlines():
        tk = toks(line)
        if len(tk) < 2:
            continue
        key_tok = tk[0] if side == 'L' else tk[-1]
        body = tk[1:] if side == 'L' else tk[:-1]
        if not re.fullmatch(r'\d{1,4}', key_tok[0]):
            continue
        k = int(key_tok[0])
        if re.search(r'[A-Za-z가-힣一-龥]', TOK.sub('', line)):  # 머리글·각주
            continue
        if 1940 < k < 2030:
            seen_year = True
            out.append(('y', k, body))
        elif seen_year and 1 <= k <= 12:
            out.append(('m', k, body))
    return out

SHORT, EXTRA = [], []  # 열 수가 모자라거나 넘쳐 위치로 맞춘 행 기록

def pdf_table(ed, pg, side, cols):
    """cols: 열 이름 목록(None 은 버림). 칸이 빈 행은 숫자의 끝 위치로 열을 맞춘다."""
    rows = read_rows(ed, pg, side)
    full = [b for _, _, b in rows if len(b) == len(cols)]
    if not full:
        raise SystemExit(f'{ed}판 p{pg}: 열 수 {len(cols)} 와 맞는 행이 없음 (행별 칸 수 {sorted(set(len(b) for _, _, b in rows))})')
    ends = [statistics.median(b[i][1] for b in full) for i in range(len(cols))]
    yr, mo = {}, {}
    for kind, k, body in rows:
        if len(body) == len(cols):
            vals = [num(t) for t, _ in body]
        else:  # 칸이 비었거나(적음) 괄호 없는 부기값이 섞임(많음) → 끝 위치가 가장 가까운 열에 넣는다
            vals, dist = [None] * len(cols), [1e9] * len(cols)
            for t, e in body:
                j = min(range(len(cols)), key=lambda j: abs(ends[j] - e))
                if abs(ends[j] - e) < dist[j]:
                    vals[j], dist[j] = num(t), abs(ends[j] - e)
            (SHORT if len(body) < len(cols) else EXTRA).append(f'{ed}판 p{pg} {k}: {len(body)}/{len(cols)}칸')
        d = {c: v for c, v in zip(cols, vals) if c}
        (yr if kind == 'y' else mo)[k] = d
    return yr, mo

def pdf_multi(ed, parts):
    yr, mo = {}, {}
    for pg, side, cols in parts:
        y, m = pdf_table(ed, pg, side, cols)
        for k, d in y.items():
            yr.setdefault(k, {}).update(d)
        for k, d in m.items():
            mo.setdefault(k, {}).update(d)
    return yr, mo

# ───────────────────────── 엑셀 표 읽기 ─────────────────────────
WB = {ed: openpyxl.load_workbook(SRC / f'e{ed}.xlsx', data_only=True) for ed in ('87', '95')}

def xnum(v):
    return v if isinstance(v, (int, float)) else None

def xl_table(sheet, cols, first_row=4, ed='95', scale=None):
    """cols: {열번호(1부터): 이름}. 첫 열이 연도인 행과 그 뒤 1~12월 행을 읽는다."""
    ws = WB[ed][sheet]
    yr, mo, seen = {}, {}, False
    for r in range(first_row, ws.max_row + 1):
        k = ws.cell(r, 1).value
        if not isinstance(k, (int, float)):
            continue
        k = int(k)
        d = {name: xnum(ws.cell(r, c).value) for c, name in cols.items()}
        for name, f in (scale or {}).items():
            if d.get(name) is not None and k != 1961:
                d[name] *= f
        if 1940 < k < 2030:
            seen = True
            yr[k] = d
        elif seen and 1 <= k <= 12:
            mo[k] = d
    return yr, mo

def clean(s):
    s = re.sub(r'\d\)', '', str(s))
    return ''.join(re.findall(r'[가-힣·]+', s))

# ───────────────────────── 표 정의 ─────────────────────────
CLS8 = ['res', 'gen', 'edu', 'ind', 'agr', 'str', 'night', 'total']
CLS7 = ['res', 'gen', 'edu', 'ind', 'agr', 'str', 'total']
X8 = {i + 2: c for i, c in enumerate(CLS8)}
seq = lambda names, start=2: {i + start: c for i, c in enumerate(names)}

GEN_A = ['oth_total', 'h_gen', 'h_pump', 'h_small', 'h_tot', 'anth', 'bitu']
GEN_B = ['heavy', 'lngst', 'steam_tot', 'cc_gen', 'cc_heat', 'cc', 'ic', 'nuc']
USE_A = ['res', None, 'pub', None, 'svc', None, 'agr']
USE_B = [None, 'min', None, 'mfg', None, 'total', None]
LOSS_A = ['net', 'dist', 'tl', 'tr']
LOSS_B = ['sold', 'dl', 'dr', 'ol', 'or']
PERF_A = ['cap', 'gen', 'avg', 'peak', 'lf']
PERF_B = ['pf', 'aux', 'auxr', 'netgen', 'pumpuse']
PUR = ['mv', 'ma', 'mp', 'pv', 'pa', 'pp', 'tv', 'ta', 'tp']
FUEL_A = ['bc', 'hoth', 'heavy', 'hcal', 'diesel', 'dcal']
FUEL_B = ['anth', 'acal', 'bitu', 'bcal', 'lng', 'lcal', 'heat']
EFF_A = ['ag', 'an', 'bg', 'bn', 'hg', 'hn', 'lg', 'ln', 'sg', 'sn']
EFF_B = ['ccg', 'ccn', 'icg', 'icn', 'kg', 'kn', 'og', 'on', 'tg', 'tn']
TR_A = ['c765', 'c345', 'c154', 'c66', 'c22', 'cdc', 'ctot', 'l765', 'l345']
TR_B = ['l154', 'l66', 'l22', 'ldc', 'ltot', 'tower', 'spole', 'cpole', 'wpole', 'ppole']
SS_B = ['t345', 't154', 't66', 't22', 'ttot', 'cond']
DS_A = ['rh', 'rl', 'rtot', 'lh', 'll', 'ltot']
DS_B = ['dtower', 'dspole', 'dcpole', 'dwpole', 'dtpole', 'stot', 'trn', 'trcap']
PROD = ['gen', 'sold', 'avgemp', 'pgen', 'ginc', 'psold', 'sinc']
OLD_S, OLD_L = '_small', '_large'  # 구 요금체계: 소동력·대동력

EDS = {}  # 표 → 판 → (연도 dict, 월 dict)
def put(name, ed, res):
    EDS.setdefault(name, {})[ed] = res

# ── 판매·요금 ──
put('cust', '69', pdf_table('69', 81, 'L', ['res', 'str', None, OLD_S, OLD_L, 'agr', None, 'total']))
put('cust', '75', pdf_table('75', 91, 'L', CLS7))
put('cust', '81', pdf_table('81', 113, 'L', CLS8))
put('cust', '95', xl_table('21.고객호수 추이', X8))
put('kw', '69', pdf_table('69', 82, 'L', ['str', OLD_S, OLD_L, 'agr', 'total']))
put('kw', '75', pdf_table('75', 92, 'L', CLS7))
put('kw', '81', pdf_table('81', 114, 'L', CLS8))
put('kw', '95', xl_table('22.요금적용전력 추이', X8, first_row=5))
put('sales', '69', pdf_multi('69', [(83, 'L', ['res', 'str', None, OLD_S]), (84, 'R', [OLD_L, 'agr', None, 'total'])]))
put('sales', '75', pdf_multi('75', [(93, 'L', CLS7[:4]), (94, 'R', CLS7[4:])]))
put('sales', '81', pdf_multi('81', [(115, 'L', CLS8[:4]), (116, 'R', CLS8[4:])]))
put('sales', '95', xl_table('23.판매량 추이', X8))
put('rev', '69', pdf_multi('69', [(105, 'L', ['res', 'str', None, OLD_S]), (106, 'R', [OLD_L, 'agr', None, 'total'])]))
put('rev', '75', pdf_multi('75', [(115, 'L', CLS7[:4]), (116, 'R', ['agr', 'str', 'total'])]))
put('rev', '81', pdf_multi('81', [(137, 'L', CLS8[:4]), (138, 'R', CLS8[4:])]))
put('rev', '95', xl_table('29.전력판매수입 추이', X8))
put('price', '69', pdf_table('69', 107, 'L', ['res', 'str', None, None, None, 'agr', None, 'total']))
put('price', '75', pdf_table('75', 117, 'L', CLS7))
put('price', '81', pdf_table('81', 139, 'L', CLS8))
put('price', '95', xl_table('30.판매단가 추이', X8))
put('use', '69', pdf_multi('69', [(85, 'L', USE_A[:6]), (86, 'R', ['agr'] + USE_B)]))
put('use', '75', pdf_multi('75', [(95, 'L', USE_A), (96, 'R', USE_B)]))
put('use', '81', pdf_multi('81', [(117, 'L', USE_A), (118, 'R', USE_B)]))
put('use', '95', xl_table('24.용도별 판매량 추이', {2: 'res', 4: 'pub', 6: 'svc', 8: 'agr', 10: 'min', 12: 'mfg', 14: 'total'}, first_row=5))

# ── 시도별 판매량 ──
put('region', '69', pdf_multi('69', [
    (97, 'L', ['서울', '부산', '대구', '인천']), (98, 'R', ['광주', '대전', '경기', '강원']),
    (99, 'L', ['충북', '충남', '전북', '전남']), (100, 'R', ['경북', '경남', '제주', '합계'])]))
put('region', '75', pdf_multi('75', [
    (107, 'L', ['서울', '부산', '대구', '인천']), (108, 'R', ['광주', '대전', '울산', '경기']),
    (109, 'L', ['강원', '충북', '충남', '전북']), (110, 'R', ['전남', '경북', '경남', '제주', '합계'])]))
put('region', '81', pdf_multi('81', [
    (129, 'L', ['서울', '부산', '대구', '인천']), (130, 'R', ['광주', '대전', '울산', '경기']),
    (131, 'L', ['강원', '충북', '충남', '전북', '전남']), (132, 'R', ['경북', '경남', '제주', '개성', '합계'])]))
ws = WB['95']['27.행정구역별 판매량 추이']
rcols = {}
for c in range(2, ws.max_column + 1):
    n = clean(ws.cell(3, c).value or '')
    if n and n != '시도별연도별' and n not in rcols.values():
        rcols[c] = n
put('region', '95', xl_table('27.행정구역별 판매량 추이', rcols))

# ── 손실·구입·발전실적 ──
put('loss', '69', pdf_multi('69', [(79, 'L', ['net', None, None, None, None, None, None]), (80, 'R', ['tl', 'tr', 'sold', 'dl', 'dr', 'ol', 'or'])]))
put('loss', '75', pdf_multi('75', [(89, 'L', LOSS_A), (90, 'R', LOSS_B)]))
put('loss', '81', pdf_multi('81', [(111, 'L', LOSS_A), (112, 'R', LOSS_B)]))
put('loss', '82', pdf_multi('82', [(99, 'L', LOSS_A), (100, 'R', LOSS_B)]))
put('loss', '95', xl_table('20.전력손실 추이 ', seq(LOSS_A + LOSS_B), first_row=6))
put('pur', '75', pdf_table('75', 86, 'L', PUR))
put('pur', '81', pdf_table('81', 108, 'L', PUR))
put('pur', '86', pdf_table('86', 120, 'L', PUR))
put('pur', '95', xl_table('19.전력구입실적(1.종합)', seq(PUR), first_row=6))
put('perf', '69', pdf_multi('69', [(16, 'L', PERF_A), (17, 'R', PERF_B)]))
put('perf', '75', pdf_multi('75', [(13, 'L', PERF_A), (14, 'R', PERF_B)]))
put('perf', '81', pdf_multi('81', [(25, 'L', PERF_A), (26, 'R', PERF_B)]))
put('perf', '95', xl_table('2.발전실적 추이', seq(PERF_A + PERF_B), first_row=6))

# ── 발전량(사업자 종합) · 발전설비(사업자) ──
G6 = ['h_gen', 'h_pump', 'h_small', 'h_tot', 'anth', 'bitu']
put('gen', '69', pdf_multi('69', [(13, 'R', G6), (14, 'L', GEN_B[:7]), (15, 'R', ['nuc', 'pu_total', 'purch', 'selfc', 'nonutil', 'tot_a', 'tot'])]))
put('gen', '75', pdf_multi('75', [(10, 'R', GEN_A), (11, 'L', GEN_B), (12, 'R', ['grp', 'ren', 'pu_total', 'purch', 'selfc', 'nonutil', 'tot_a', 'tot'])]))
put('gen', '81', pdf_multi('81', [(22, 'R', GEN_A), (23, 'L', GEN_B), (24, 'R', ['grpalt', 'pu_total', 'purch', 'selfc', 'nonutil', 'tot_a', 'tot'])]))
XG = {29: 'h_gen', 30: 'h_pump', 31: 'h_small', 32: 'h_tot', 33: 'anth', 34: 'bitu', 37: 'heavy', 38: 'lngst',
      39: 'steam_tot', 40: 'cc', 41: 'nuc', 42: 'ren', 43: 'grp', 44: 'ic', 45: 'etc', 46: 'pu_total'}
put('gen', '95', xl_table('1.발전량 추이', {**XG, 47: 'purch', 48: 'selfc', 49: 'nonutil', 50: 'tot_a', 51: 'tot'}, first_row=6))
CAP_C = ['ic', 'nuc', 'grp', 'ren', 'pu_total', 'nonutil', 'tot']
put('cap', '69', pdf_multi('69', [(40, 'R', G6), (41, 'L', GEN_B[:6]), (42, 'R', ['ic', 'nuc', 'pu_total', 'nonutil', 'tot'])]))
put('cap', '75', pdf_multi('75', [(44, 'R', GEN_A), (45, 'L', GEN_B[:6]), (46, 'R', CAP_C)]))
put('cap', '81', pdf_multi('81', [(60, 'R', GEN_A), (61, 'L', GEN_B[:6]), (62, 'R', CAP_C)]))
put('cap', '95', xl_table('8.발전설비 추이', {**XG, 47: 'nonutil', 48: 'tot'}, first_row=6))

# ── 연료 사용량 · 열효율 ──
put('fuel', '69', pdf_multi('69', [(28, 'L', FUEL_A), (29, 'R', ['anth', 'acal', 'bitu', 'bcal', 'lng', 'lcal', None, None, 'heat'])]))
put('fuel', '75', pdf_multi('75', [(31, 'L', FUEL_A), (32, 'R', FUEL_B)]))
put('fuel', '81', pdf_multi('81', [(45, 'L', FUEL_A), (46, 'R', FUEL_B)]))
put('fuel', '95', xl_table('5.연료 사용량 추이', seq(FUEL_A + FUEL_B), first_row=5))
put('eff', '69', pdf_multi('69', [(34, 'L', EFF_A), (35, 'R', EFF_B)]))
put('eff', '75', pdf_multi('75', [(39, 'L', EFF_A), (40, 'R', EFF_B)]))
put('eff', '81', pdf_multi('81', [(55, 'L', EFF_A), (56, 'R', EFF_B)]))
put('eff', '95', xl_table('7.화력 열효율 추이', seq(EFF_A + EFF_B), first_row=5))

# ── 송전·변전·배전 설비 ──
put('trans', '69', pdf_multi('69', [(59, 'L', TR_A), (60, 'R', TR_B)]))
put('trans', '81', pdf_multi('81', [(89, 'L', TR_A), (90, 'R', TR_B)]))
put('trans', '95', xl_table('11.송전설비 추이', {2: 'c765', 3: 'c345', 4: 'c154', 5: 'c66', 6: 'c22', 7: 'cdc500', 8: 'cdc250', 9: 'cdc', 10: 'cdc150', 11: 'ctot', 12: 'l765', 13: 'l345',
                                             14: 'l154', 15: 'l66', 16: 'l22', 21: 'ltot', 22: 'tower', 23: 'spole', 24: 'cpole', 25: 'wpole', 26: 'ppole'}, first_row=5))
put('subst', '69', pdf_multi('69', [(63, 'L', ['n345', 'n154', 'n66', 'n22', 'ntot']), (64, 'R', SS_B)]))
put('subst', '81', pdf_multi('81', [(93, 'L', ['n765', 'n345', 'n154', 'n66', 'n22', 'ntot', 't765']), (94, 'R', SS_B)]))
k = 1000  # 제95호는 MVA·MVAR → kVA·kVAR
put('subst', '95', xl_table('13.변전설비 추이', {2: 'n765', 3: 'n345', 4: 'n154', 5: 'n66', 6: 'n22', 7: 'ntot', 8: 't765', 9: 't345', 10: 't154', 11: 't66', 12: 't22', 13: 'ttot', 14: 'cond'},
                            first_row=5, scale={c: k for c in ['t765', 't345', 't154', 't66', 't22', 'ttot', 'cond']}))
put('distf', '69', pdf_multi('69', [(67, 'L', DS_A), (68, 'R', DS_B)]))
put('distf', '81', pdf_multi('81', [(97, 'L', DS_A), (98, 'R', DS_B)]))
put('distf', '95', xl_table('15.배전설비 추이', {2: 'rh', 3: 'rl', 4: 'rtot', 5: 'lh', 6: 'll', 7: 'ltot', 8: 'dtower', 9: 'dspole', 10: 'dcpole', 11: 'dwpole', 12: 'dtpole', 14: 'stot', 15: 'trn', 16: 'trcap'}, first_row=5))

# ── 종업원 · 노동생산성 ──
put('emp', '69', pdf_table('69', 112, 'L', ['office', 'eng', 'skilled', 'total']))
put('emp', '75', pdf_table('75', 121, 'L', ['admin', 'office', 'eng', 'skilled', 'total']))
put('emp', '81', pdf_table('81', 144, 'L', ['admin', 'office', 'eng', 'skilled', 'total']))
put('emp', '95', xl_table('32.종업원수', {2: 'admin', 3: 'office', 4: 'eng', 5: 'skilled', 6: 'total'}))
put('prod', '69', pdf_table('69', 113, 'L', PROD))
put('prod', '75', pdf_table('75', 122, 'L', PROD))
put('prod', '81', pdf_table('81', 145, 'L', PROD))
put('prod', '95', xl_table('33.노동생산성', seq(PROD), first_row=5))

# ───────────────────────── 손익계산서(계정과목이 행, 연도가 열) ─────────────────────────
FIN_KEYS = [  # (키, 정규식) — 번호·공백을 지운 계정명에 맞춘다
    ('rev', r'^(營業收益|賣出額|매출액|operatingrevenues|sales)$'),
    ('opex', r'^(營業費用|operatingexpenses)$'),
    ('cos', r'^(賣出原價|매출원가|costofsales)$'),
    ('sga', r'^(販賣費와管理費|판매비와관리비|selling)'),
    ('opinc', r'^(營業利益|영업이익|operatingincome)'),
    ('net', r'^(當期純利益|당기순이익|netincome)'),
    ('fuel', r'^(燃料費|fuel)$'), ('pp', r'^(購入電力費|purchasedpower)$'),
    ('labor', r'^(人件費|salaries|labor|personnel|wages)'), ('retire', r'^(退職金)$'), ('maint', r'^(修繕維持費|maintenance)'),
    ('dep', r'^(減價償却費|depreciation)$'),
]
def fin_label(s):
    s = unicodedata.normalize('NFKC', s)                 # 호환용 한자(利 U+F9DD 등)를 표준 글자로
    s = re.sub(r'\([^)]*\)', '', s)                      # (1-2) 같은 산식
    s = re.sub(r'^\s*([0-9]{1,2}|[ⅠⅡⅢⅣⅤⅥⅦⅧⅨⅩ]+|[가나다라마a-e])\s*\.', '', s)
    return re.sub(r'[\s.·]', '', s).lower()

def fin_pdf(ed, pg, KEYS=None):
    """연도 머리줄 아래의 (계정명, 값…) 행을 읽는다. 계정명이 앞 줄에 따로 있으면 이어 붙인다."""
    KEYS = KEYS or FIN_KEYS
    years, out, pending = None, {}, ''
    for line in PAGES[ed][pg - 1].splitlines():
        if not line.strip():
            continue
        ys = re.findall(r'(?<![\d,.])(19[89]\d|20[012]\d)(?![\d,.])', line)
        if years is None:
            if len(ys) >= 2 and not re.search(r'[가-힣一-龥]{2}', TOK.sub('', line).replace('年', '')):
                years = [int(y) for y in ys]
            continue
        line = re.sub(r'\([^)]*\)', lambda m: ' ' * len(m.group(0)), line)          # (3 - 4) 같은 산식
        line = re.sub(r'(?<![\d,.])\d{1,2}\s*\.(?=\s*[^\d\s,])', lambda m: ' ' * len(m.group(0)), line)  # 계정 번호
        tk = toks(line)
        text = TOK.sub(' ', line)
        left = fin_label(line[:line.find(tk[0][0])] if tk else line)
        right = fin_label(line[tk[-1][1]:] if tk else '')
        if len(tk) == len(years):
            for lab in (left, pending + left, pending, right):
                for key, pat in KEYS:
                    if lab and key not in out and re.search(pat, lab):
                        out[key] = [num(t) for t, _ in tk]
            pending = ''
        elif not tk:
            pending = left
    if years is None:
        raise SystemExit(f'{ed}판 p{pg}: 손익계산서 연도 줄을 찾지 못함')
    return years, out

def fin_xlsx(ed, sheet, KEYS=None):
    ws = WB[ed][sheet]
    years = {c: int(str(ws.cell(3, c).value).strip()) for c in range(2, ws.max_column + 1) if re.fullmatch(r'\s*(19|20)\d\d(\.0)?\s*', str(ws.cell(3, c).value))}
    out = {}
    for r in range(4, ws.max_row + 1):
        lab = fin_label(re.sub(r'[A-Za-z].*$', '', str(ws.cell(r, 1).value or '')))
        for key, pat in (KEYS or FIN_KEYS):
            if lab and key not in out and re.search(pat, lab):
                out[key] = [xnum(ws.cell(r, c).value) for c in years]
    return list(years.values()), out

fin_src = {}
def add_fin(ed, years, vals):
    d = fin_src.setdefault(ed, {})
    for i, y in enumerate(years):
        row = d.setdefault(y, {})
        for k, v in vals.items():
            row[k] = v[i]
for ed, pgs in (('69', (120, 121, 124)), ('75', (125, 126)), ('81', (148,))):
    for pg in pgs:
        add_fin(ed, *fin_pdf(ed, pg))
add_fin('87', *fin_xlsx('87', '35.손익계산서'))
add_fin('95', *fin_xlsx('95', '35.손익계산서'))
for ed, d in fin_src.items():
    for y, row in d.items():  # 영업비용 = 매출원가 + 판매비와관리비
        row['cost'] = row['opex'] if row.get('opex') is not None else (row['cos'] + row['sga'] if row.get('cos') is not None and row.get('sga') is not None else None)
        if row.get('fuel') is None:  # 새 양식의 인건비는 판매비와관리비 안의 일부라 이어 붙이지 않는다
            row.pop('labor', None)
        for k in ('opex', 'cos', 'sga'):
            row.pop(k, None)
    put('fin', ed, (d, {}))

# ── 재무상태표(자산·부채·자본) ──
BAL_KEYS = [('assets', r'^(資産總計|자산총계|totalassets)$'), ('liab', r'^(負債計|부채계|부채총계|totalliabilities)$'),
            ('equity', r'^(資本計|자본계|자본총계|totalstockholders.?equity)$')]
bal_src = {}
def add_bal(ed, years, vals):
    d = bal_src.setdefault(ed, {})
    for i, y in enumerate(years):
        d.setdefault(y, {}).update({k: v[i] for k, v in vals.items()})
for ed, pgs in (('69', (114, 115, 116, 117, 118)), ('75', (123, 124)), ('81', (146,))):
    for pg in pgs:
        add_bal(ed, *fin_pdf(ed, pg, BAL_KEYS))
add_bal('87', *fin_xlsx('87', '34.재무상태표', BAL_KEYS))
add_bal('95', *fin_xlsx('95', '34.재무상태표', BAL_KEYS))
for ed, d in bal_src.items():
    for y, row in d.items():  # 자본 = 자산 − 부채 로 빈 칸 보충
        if row.get('equity') is None and row.get('assets') is not None and row.get('liab') is not None:
            row['equity'] = row['assets'] - row['liab']
    put('bal', ed, (d, {}))

# ── 경영분석비율 ──
RAT = ['eqr', 'debt', 'fixr', 'fixl', 'cur', 'quick', 'roa', 'roe', 'npm', 'expr']
put('ratio', '81', pdf_multi('81', [(140, 'L', RAT[:5]), (142, 'L', RAT[5:])]))
ws = WB['95']['31.경영분석 비율']
rr = {}
for r in range(4, ws.max_row + 1):
    m = re.match(r'\s*((19|20)\d\d)', str(ws.cell(r, 1).value or ''))
    if m:
        rr[int(m.group(1))] = {k: xnum(ws.cell(r, 2 + i).value) for i, k in enumerate(RAT)}
put('ratio', '95', (rr, {}))

# ── 시도별 고객호수 ──
put('regcust', '69', pdf_multi('69', [
    (93, 'L', ['서울', '부산', '대구', '인천']), (94, 'R', ['광주', '대전', '경기', '강원']),
    (95, 'L', ['충북', '충남', '전북', '전남']), (96, 'R', ['경북', '경남', '제주', '합계'])]))
put('regcust', '75', pdf_multi('75', [
    (103, 'L', ['서울', '부산', '대구', '인천']), (104, 'R', ['광주', '대전', '울산', '경기']),
    (105, 'L', ['강원', '충북', '충남', '전북']), (106, 'R', ['전남', '경북', '경남', '제주', '합계'])]))
put('regcust', '81', pdf_multi('81', [
    (125, 'L', ['서울', '부산', '대구', '인천']), (126, 'R', ['광주', '대전', '울산', '경기']),
    (127, 'L', ['강원', '충북', '충남', '전북', '전남']), (128, 'R', ['경북', '경남', '제주', '개성', '합계'])]))
ws = WB['95']['26.행정구역별 고객호수 추이']
rc = {}
for c in range(2, ws.max_column + 1):
    n = clean(ws.cell(3, c).value or '')
    if n and n != '시도별연도별' and n not in rc.values():
        rc[c] = n
put('regcust', '95', xl_table('26.행정구역별 고객호수 추이', rc))

# ── 제조업종별 판매량: 신분류(1995~2018) 18개 업종, 제11차 표준산업분류(2019~) 25개 업종 ──
MF = ['식료품', '섬유·의복', '목재·나무', '펄프·종이', '출판·인쇄', '석유·화학', '요업', '1차금속', '조립금속',
      '기타기계', '사무기기', '전기기기', '영상·음향', '의료·광학', '자동차', '기타운송', '가구및기타', '재생재료']
MF11 = ['식료품', '음료', '담배', '섬유제품', '의복·모피', '가죽·가방', '목재·나무', '펄프·종이', '인쇄·매체', '연탄·석유', '화학', '의료·의약', '플라스틱',
        '비금속', '1차금속', '금속가공', '전자·통신', '의료·광학', '전기장비', '기타기계', '자동차', '기타운송', '가구', '기타제품', '산업기계']
put('mfg', '75', pdf_multi('75', [(99, 'L', MF[:5]), (100, 'R', MF[5:10]), (101, 'L', MF[10:15]), (102, 'R', MF[15:] + ['합계'])]))
put('mfg', '81', pdf_multi('81', [(121, 'L', MF[:5]), (122, 'R', MF[5:10]), (123, 'L', MF[10:15]), (124, 'R', MF[15:] + ['합계'])]))
ws = WB['95']['25.제조업종별 판매량 추이']
OLDC = [2, 4, 6, 7, 8, 9, 11, 12, 14, 17, 18, 19, 20, 22, 23, 25, 26, 27]
NEWC = list(range(2, 15)) + list(range(17, 29))
m_old, m_new = {}, {}
for r in range(4, ws.max_row + 1):
    y = ws.cell(r, 1).value
    if not isinstance(y, (int, float)) or y < 1900:
        continue
    if ws.cell(r, 3).value is None:   # 옛 열 배치
        m_old[int(y)] = {**{n: xnum(ws.cell(r, c).value) for n, c in zip(MF, OLDC)}, '합계': xnum(ws.cell(r, 28).value)}
    else:                             # 2019년부터 25개 업종
        m_new[int(y)] = {**{n: xnum(ws.cell(r, c).value) for n, c in zip(MF11, NEWC)}, '합계': xnum(ws.cell(r, 29).value)}
put('mfg', '95', (m_old, {}))
put('mfg11', '95', (m_new, {}))

# ───────────────────────── 판별 보정(잇기 전에) ─────────────────────────
for name in ('cust', 'kw', 'sales', 'rev', 'price'):
    for y, d in EDS[name]['69'][0].items():  # 구 요금체계: 소동력+대동력 = 일반·교육·산업 합산
        s, l = d.pop(OLD_S, None), d.pop(OLD_L, None)
        if name != 'price':
            d['gis'] = (s or 0) + (l or 0) if (s is not None or l is not None) else None
    for y, d in EDS[name]['75'][0].items():  # 1990~1993년: 한 칸에 합쳐 실린 값이 교육용 열에 들어감
        if y < 1994 and d.get('gen') is None and d.get('ind') is None and d.get('edu') is not None:
            d['gis'], d['edu'] = d['edu'], None
        else:
            d.setdefault('gis', None)

# ───────────────────────── 여러 판 잇기 ─────────────────────────
AUDIT = {'overlap': [], 'short_rows': SHORT, 'extra_token_rows': EXTRA, 'checks': [], 'fixes': []}
Y0, Y1 = 1979, 2025
YEARS = [1961] + list(range(Y0, Y1 + 1))
TABLES, EDITION, MONTHLY = {}, {}, {}

for name, eds in EDS.items():
    order = [e for e in ORDER if e in eds]
    keys = []
    for ed in order:
        for d in eds[ed][0].values():
            for k in d:
                if k not in keys:
                    keys.append(k)
    tab = {k: [None] * len(YEARS) for k in keys}
    edi = [None] * len(YEARS)
    for i, y in enumerate(YEARS):
        have = [ed for ed in order if y in eds[ed][0]]
        if not have:
            continue
        edi[i] = have[0]
        top = eds[have[0]][0][y]
        for k, v in top.items():
            tab[k][i] = v
        for ed in have[1:]:
            for k, v in eds[ed][0][y].items():
                new = top.get(k)
                if k not in top and v is not None and tab[k][i] is None and y != 1961:
                    tab[k][i] = v  # 최신 판에 없는 세부 열은 이전 판에서 보충
                elif new is not None and v is not None and new != 0 and y != 1961:
                    diff = (v - new) / new * 100
                    if abs(diff) >= 0.05:
                        AUDIT['overlap'].append({'table': name, 'col': k, 'year': y, 'used_ed': have[0], 'used': new,
                                                 'other_ed': ed, 'other': v, 'diff_pct': round(diff, 2)})
    TABLES[name] = tab
    EDITION[name] = edi
    mo = {}
    for ed in ('75', '81', '95'):
        m = eds.get(ed, ({}, {}))[1]
        if len(m) == 12:
            mo[LAST_YEAR[ed]] = {k: [m[i].get(k) for i in range(1, 13)] for k in m[1]}
    if mo:
        MONTHLY[name] = mo

for i, y in enumerate(YEARS):  # 1996년부터 인건비는 판매비와관리비 안의 일부만 실려 잇지 않는다
    if y >= 1996:
        TABLES['fin']['labor'][i] = None
for name in ('cust', 'kw', 'sales', 'rev', 'price'):  # 종별 값이 따로 있으면 합산 열은 비운다
    t = TABLES[name]
    for i in range(len(YEARS)):
        if t['gen'][i] is not None and t['ind'][i] is not None:
            t['gis'][i] = None

r = TABLES['region']  # 시도 합과 0.2% 넘게 다른 합계는 시도 합으로 바꾼다(원자료 합계 칸 오류)
for i, y in enumerate(YEARS):
    parts = [v[i] for k, v in r.items() if k != '합계' and v[i] is not None]
    if parts and r['합계'][i] and abs(sum(parts) - r['합계'][i]) > r['합계'][i] * 0.002:
        AUDIT['fixes'].append(f'시도별 판매량 {y}년 합계: 원자료 {r["합계"][i]:,.0f} → 시도 합 {sum(parts):,.0f} MWh 로 대체')
        r['합계'][i] = sum(parts)

g = TABLES['gen']  # 2005년 집단·대체: 따로 실린 값이 있으면 합산 열은 비운다
for i, y in enumerate(YEARS):
    if g['grpalt'][i] is not None and g['grp'][i] is not None and g['ren'][i] is not None:
        if abs(g['grp'][i] + g['ren'][i] - g['grpalt'][i]) <= 1:
            g['grpalt'][i] = None

# ───────────────────────── 2025년 시도별 단면 ─────────────────────────
REG17 = ['서울', '부산', '대구', '인천', '광주', '대전', '울산', '세종', '경기', '강원', '충북', '충남', '전북', '전남', '경북', '경남', '제주']
ws = WB['95']['28.행정구역별 용도별 판매량']
hdr = {}
for c in range(2, ws.max_column + 1):
    n = clean(ws.cell(3, c).value or '')
    if n in REG17 or n == '합계':
        hdr[n] = c
REG_USE = {}
USE_ROWS = {'가정용': 'res', '공공용': 'pub', '서비스업': 'svc', '농림어업': 'agr', '광업': 'min', '제조업': 'mfg', '합계': 'total'}
for rr in range(4, ws.max_row + 1):
    n = clean(ws.cell(rr, 1).value or '')
    if n in USE_ROWS and USE_ROWS[n] not in REG_USE:
        REG_USE[USE_ROWS[n]] = {reg: xnum(ws.cell(rr, c).value) for reg, c in hdr.items()}
ws = WB['95']['8-2. 행정구역별 발전설비 및 발전량']
SRC82 = ['nuc', 'anth', 'bitu', 'lng', 'ren', 'oil', 'pump', 'etc', 'total']
REG_CAP, REG_GEN = {}, {}
for rr in range(6, ws.max_row + 1):
    n = clean(ws.cell(rr, 1).value or '')
    n = '합계' if n == '총계' else n
    if n in REG17 or n == '합계':
        REG_CAP[n] = {s: xnum(ws.cell(rr, 2 + i).value) or 0 for i, s in enumerate(SRC82)}
        REG_GEN[n] = {s: xnum(ws.cell(rr, 11 + i).value) or 0 for i, s in enumerate(SRC82)}

MFG_ROWS = {}
ws = WB['95']['28.행정구역별 용도별 판매량']
for rr_ in range(4, ws.max_row + 1):
    n = clean(ws.cell(rr_, 1).value or '')
    if n and '합계' in hdr:
        MFG_ROWS.setdefault(n, xnum(ws.cell(rr_, hdr['합계']).value))
# ───────────────────────── 검증 ─────────────────────────
def check(label, ok, detail=''):
    AUDIT['checks'].append({'check': label, 'ok': bool(ok), 'detail': detail})

def sumcheck(name, parts, total, tol=0.002):
    bad, t = [], TABLES[name]
    for i, y in enumerate(YEARS):
        tv = t[total][i]
        vals = [t[p][i] for p in parts if p in t]
        if y == 1961 or tv is None or all(v is None for v in vals):
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
sumcheck('trans', ['c765', 'c345', 'c154', 'c66', 'c22', 'cdc', 'cdc500', 'cdc250', 'cdc150'], 'ctot', tol=0.01)
sumcheck('subst', ['t765', 't345', 't154', 't66', 't22'], 'ttot', tol=0.01)
sumcheck('distf', ['rh', 'rl'], 'rtot')
sumcheck('regcust', REG17 + ['개성'], '합계')
sumcheck('mfg', MF, '합계')
sumcheck('mfg11', MF11, '합계')
bad = [f'{y}' for i, y in enumerate(YEARS) if None not in (TABLES['bal']['assets'][i], TABLES['bal']['liab'][i], TABLES['bal']['equity'][i])
       and abs(TABLES['bal']['assets'][i] - TABLES['bal']['liab'][i] - TABLES['bal']['equity'][i]) > 3]
check('bal: 자산 = 부채 + 자본', not bad, ', '.join(bad))
bad = [f'{y}' for i, y in enumerate(YEARS) if TABLES['regcust']['합계'][i] and TABLES['cust']['total'][i] and abs(TABLES['regcust']['합계'][i] - TABLES['cust']['total'][i]) > 5]
check('regcust 합계 = cust 합계', not bad, ', '.join(bad))
sumcheck('emp', ['admin', 'office', 'eng', 'skilled'], 'total', tol=0.01)
bad = []
for c in CLS8:
    for i, y in enumerate(YEARS):
        rv, s, p = TABLES['rev'][c][i], TABLES['sales'][c][i], TABLES['price'][c][i]
        if rv and s and p and abs(rv / s - p) > max(0.06, p * 0.005):
            bad.append(f'{y} {c}: {rv / s:.2f} vs {p}')
check('price: 판매수입÷판매량 = 판매단가', not bad, '; '.join(bad[:8]))
bad = []
f = TABLES['fin']
for i, y in enumerate(YEARS):
    if y not in (2010, 2011, 2012, 2013) and None not in (f['rev'][i], f['cost'][i], f['opinc'][i]) and abs(f['rev'][i] - f['cost'][i] - f['opinc'][i]) > max(3, abs(f['rev'][i]) * 0.0005):
        bad.append(f'{y}: {f["rev"][i] - f["cost"][i]:,.0f} vs {f["opinc"][i]:,.0f}')
check('fin: 매출 − 영업비용 = 영업이익', not bad, '; '.join(bad[:8]))
bad = [f'{y}' for i, y in enumerate(YEARS) if TABLES['sales']['total'][i] and TABLES['region']['합계'][i]
       and abs(TABLES['sales']['total'][i] - TABLES['region']['합계'][i]) > 50]
check('region 합계 = sales 합계', not bad, ', '.join(bad))
i25 = YEARS.index(2025)
names28 = [k for k in MFG_ROWS if k not in USE_ROWS][:25]
bad = [f'{a}/{b}' for a, b in zip(MF11, names28) if MFG_ROWS[b] is None or abs((TABLES['mfg11'][a][i25] or 0) - MFG_ROWS[b]) > 2]
check('mfg11: 2025년 업종별 값 = 28번 표 합계 열(업종 이름 순서 확인)', not bad and len(names28) == 25, f'{names28} | 불일치 {bad}')
AUDIT['coverage'] = {n: f'{min(y for i, y in enumerate(YEARS) if EDITION[n][i] and y > 1961)}–{max(y for i, y in enumerate(YEARS) if EDITION[n][i])}'
                     + (lambda miss: f' (빈 연도 {miss})' if miss else '')([y for i, y in enumerate(YEARS) if not EDITION[n][i]
                        and min(yy for j, yy in enumerate(YEARS) if EDITION[n][j] and yy > 1961) < y]) for n in TABLES}

# ───────────────────────── 내보내기 ─────────────────────────
def rnd(v):
    return round(v, 3) if isinstance(v, float) else v

DATA = {
    'meta': {'title': '한국전력통계', 'editions': EDN},
    'years': YEARS,
    'tables': {n: {k: [rnd(v) for v in vs] for k, vs in t.items()} for n, t in TABLES.items()},
    'edition': EDITION,
    'monthly': {n: {str(y): {k: [rnd(v) for v in vs] for k, vs in d.items()} for y, d in m.items()} for n, m in MONTHLY.items()},
    'regions': REG17, 'reg_use': REG_USE, 'reg_cap': REG_CAP, 'reg_gen': REG_GEN,
}
OUT.mkdir(parents=True, exist_ok=True)
(OUT / 'data.json').write_text(json.dumps(DATA, ensure_ascii=False, separators=(',', ':')), encoding='utf-8')
(OUT / 'audit.json').write_text(json.dumps(AUDIT, ensure_ascii=False, indent=1), encoding='utf-8')
print('data.json', (OUT / 'data.json').stat().st_size, 'bytes')
for c in AUDIT['checks']:
    print('OK ' if c['ok'] else 'NG ', c['check'], c['detail'][:300])
print('overlap diffs:', len(AUDIT['overlap']), '| short rows:', len(SHORT))
for n, c in AUDIT['coverage'].items():
    print(f'  {n:7s} {c}')
