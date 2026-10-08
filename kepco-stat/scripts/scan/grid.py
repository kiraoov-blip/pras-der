"""스캔 표 한 쪽 → {연도: [열1, 열2, …]} (열은 연도 열 쪽에서부터 센다).

- 낱말 위치로 같은 수의 천 단위 묶음을 합치고, 칸 경계는 쪽 전체의 오른쪽 끝 위치 묶음으로 정한다.
- 연도는 읽힌 값이 순서와 맞으면 쓰고, 못 읽은 줄은 앞 줄 + 1 로 메운다(순서가 어긋나면 그 쪽은 버린다).
- 숫자가 아닌 글자가 섞인 칸은 None. '-' 는 0 이 아니라 '-' 로 둔다.
"""
import csv, re, statistics

def words(tsv):
    lines = {}
    with open(tsv, encoding='utf-8', errors='replace') as f:
        for r in csv.DictReader(f, delimiter='\t', quoting=csv.QUOTE_NONE):
            if r['level'] == '5' and r['text'].strip():
                lines.setdefault((r['block_num'], r['par_num'], r['line_num']), []).append(
                    (int(r['left']), int(r['top']), int(r['width']), int(r['height']), r['text'].strip()))
    return [sorted(ws) for ws in lines.values()]

def cells_of(ws):
    h = statistics.median(w[3] for w in ws)
    cw = max(10.0, h * 0.62)
    groups, cur = [], [ws[0]]
    for a, b in zip(ws, ws[1:]):
        if b[0] - (a[0] + a[2]) < cw * 1.6:
            cur.append(b)
        else:
            groups.append(cur); cur = [b]
    groups.append(cur)
    return [(''.join(w[4] for w in g), g[0][0], g[-1][0] + g[-1][2], min(w[1] for w in g)) for g in groups]

def parse(t):
    t = t.replace(',', '')
    if re.fullmatch(r'-+', t):
        return '-'
    if re.fullmatch(r'\d+', t):
        return int(t)
    if re.fullmatch(r'\d+\.\d+', t):
        return float(t)
    return None

def table(tsv, side, ncols, y0=1961, y1=1983):
    """side: 연도 열이 왼쪽(L)·오른쪽(R). ncols: 연도를 뺀 숫자 열 수."""
    lines = []
    for ws in words(tsv):
        cs = cells_of(ws)
        if len(cs) < 2:
            continue
        lines.append(cs)
    lines.sort(key=lambda cs: min(c[3] for c in cs))
    # 연도 칸 후보: 연도 쪽 끝 칸. 4자리로 붙여 읽히면 연도.
    data = []
    for cs in lines:
        yc = cs[0] if side == 'L' else cs[-1]
        body = cs[1:] if side == 'L' else cs[:-1]
        yt = yc[0].replace('.', '').replace(',', '')
        yr = int(yt) if re.fullmatch(r'19[4-9]\d', yt) else None
        nums = [c for c in body if parse(c[0]) is not None]
        if yr is None and len(nums) < max(2, ncols - 1):
            continue
        if yr is None and side == 'L' and len(cs) == ncols:   # 연도 칸을 못 읽어 숫자 칸만 남은 줄
            body = cs
        elif yr is None and side == 'R' and len(cs) == ncols:
            body = cs
        data.append([yr, body, min(c[3] for c in cs)])
    # 연도 메우기
    for i, d in enumerate(data):
        if d[0] is None and i > 0 and data[i - 1][0]:
            d[0] = data[i - 1][0] + 1
    ys = [d[0] for d in data if d[0]]
    if any(b <= a for a, b in zip(ys, ys[1:])):
        return None, 'year-order'
    data = [d for d in data if d[0] and y0 <= d[0] <= y1]
    # 열 경계: 모든 칸의 오른쪽 끝을 묶는다
    xs = sorted(c[2] for d in data for c in d[1])
    if not xs:
        return None, 'empty'
    cl, cur = [], [xs[0]]
    for a, b in zip(xs, xs[1:]):
        if b - a > 60:
            cl.append(cur); cur = [b]
        else:
            cur.append(b)
    cl.append(cur)
    centers = [statistics.median(c) for c in cl if len(c) >= max(3, len(data) * 0.35)]
    if len(centers) != ncols:
        return None, f'cols {len(centers)}≠{ncols}'
    if side == 'R':
        centers = centers[::-1]   # 연도 쪽(오른쪽)부터 센다
    out = {}
    for y, body, _ in data:
        row = [None] * ncols
        for t, x0, x1, top in body:
            j = min(range(ncols), key=lambda j: abs(centers[j] - x1))
            if abs(centers[j] - x1) < 60:
                v = parse(t)
                row[j] = v if row[j] is None else None
        if y in out:
            return None, f'dup {y}'
        out[y] = row
    if side == 'R':
        out = {y: r[::-1] for y, r in out.items()}  # 다시 왼쪽→오른쪽 순서로
    return out, 'ok'
