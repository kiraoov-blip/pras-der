"""요금표 PDF(글자층 있는 판) → 단(column)별 숫자 행 추출. 사용: python rows.py PDF OUT.json"""
import json, re, subprocess, sys

pdf, out = sys.argv[1], sys.argv[2]
info = subprocess.run(["pdfinfo", pdf], capture_output=True, text=True).stdout
pages = int(re.search(r"Pages:\s+(\d+)", info).group(1))
PW, PH = map(float, re.search(r"Page size:\s+([\d.]+) x ([\d.]+)", info).groups())
CW = PW / 4
NUM = re.compile(r"(?<![\d.])\d{1,3}(?:,\d{3})+(?![\d])|(?<![\d.,])\d+\.\d(?![\d])|(?<![\d.,:~])\d{2,5}(?![\d.,:~])")
LABEL = re.compile(r"경\s*부\s*하|중간\s*부하|최대\s*부하|저\s*압|고압[ABC]?|선택\s*[ⅠⅡⅢIV]+|처음|다음|초과|이하|여름철|봄·가을철|겨울철|기타계절|겨울\s*철|평일|주말|기타시간|수요시간|전체시간|갑|을")
recs = []
for p in range(1, pages + 1):
    for c in range(4):
        txt = subprocess.run(["pdftotext", "-f", str(p), "-l", str(p), "-x", str(int(c * CW)), "-y", "0", "-W", str(int(CW) + 1), "-H", str(int(PH) + 1),
                              "-layout", pdf, "-"], capture_output=True, text=True).stdout
        for i, line in enumerate(txt.splitlines()):
            if not line.strip():
                continue
            nums = [float(n.replace(",", "")) for n in NUM.findall(line)]
            labs = [re.sub(r"\s+", "", m) for m in LABEL.findall(line)]
            if nums:
                recs.append({"p": p, "c": c, "i": i, "lab": labs, "nums": nums, "text": line.strip()[:120]})
json.dump(recs, open(out, "w"), ensure_ascii=False, indent=0)
print(pdf.split("/")[-1][:40], len(recs))
