#!/usr/bin/env python3
"""Silhouette measurement report (MEASURES ONLY — judgment belongs to the LLM).
usage: python3 maskmetrics.py <outdir> <img1.png> [img2.png ...]
Per image: crops to content, writes <stem>_thumb24.png / _thumb48.png and
metrics to <outdir>/metrics.json. Also writes sheet.png (all views side by side).
Descriptors: W_over_H, fill, thirds_cols, thirds_rows, compactness
(perimeter^2/4πA: 1=disc, higher=spikier/branchier), neg_pockets (enclosed
whitespace count+sizes), protrusions (direction & sharpness of major limbs/spikes),
com (centre of mass position in bbox, 0..1)."""
import sys, os, json
import numpy as np
from PIL import Image

outdir = sys.argv[1]; os.makedirs(outdir, exist_ok=True)
report = {}
sheets = []
for p in sys.argv[2:]:
    name = os.path.splitext(os.path.basename(p))[0]
    im = np.array(Image.open(p).convert('L'))
    m = im < 128
    if not m.any():
        report[name] = None; continue
    ys, xs = np.where(m)
    m = m[ys.min():ys.max()+1, xs.min():xs.max()+1]
    H, W = m.shape; area = int(m.sum())
    # perimeter: count edge transitions
    per = int((m[:, 1:] != m[:, :-1]).sum() + (m[1:] != m[:-1]).sum()
              + m[0].sum() + m[-1].sum() + m[:, 0].sum() + m[:, -1].sum())
    from scipy import ndimage
    inv = ~m
    lab, n = ndimage.label(inv)
    border = set(lab[0]) | set(lab[-1]) | set(lab[:, 0]) | set(lab[:, -1])
    pockets = sorted([int((lab == i).sum()) for i in range(1, n+1)
                      if i not in border and (lab == i).sum() > area*0.002], reverse=True)
    # protrusions: erode heavily -> core; subtract -> appendages; report each blob's
    # direction from core centroid and aspect (long/thin = sharp)
    core = ndimage.binary_erosion(m, iterations=max(2, int(min(H, W)*0.06)))
    app = m & ~ndimage.binary_dilation(core, iterations=max(2, int(min(H, W)*0.06)))
    la, na = ndimage.label(app)
    cy, cx = ndimage.center_of_mass(m)
    protr = []
    for i in range(1, na+1):
        blob = la == i
        s = int(blob.sum())
        if s < area*0.01: continue
        by, bx = ndimage.center_of_mass(blob)
        import math
        ang = math.degrees(math.atan2(-(by-cy), bx-cx))  # 0=right, 90=up
        ys2, xs2 = np.where(blob)
        ext = max(ys2.max()-ys2.min(), xs2.max()-xs2.min()) + 1
        thin = ext*ext / max(s, 1)   # higher = longer/thinner = sharper read
        protr.append({'dir_deg': round(ang), 'size': round(s/area, 3), 'thinness': round(thin, 1)})
    protr.sort(key=lambda x: -x['size'])
    # ── dullness flags (MEASURES ONLY, the reader/LLM judges) ──
    # 1:1-frame fill: the silhouette in a square frame must carry real volume
    Ssq = max(H, W)
    sq_fill = area / (Ssq * Ssq)
    # mirror symmetry: IoU with own horizontal flip (front views of bilateral
    # creatures are EXEMPT from judgment on this — measure everywhere, judge per view)
    mf = np.fliplr(m)
    mirror_sym = float((m & mf).sum() / max((m | mf).sum(), 1))
    # straight-line runs: longest constant-slope run on any boundary, as a
    # fraction of that boundary's length (stiff legs / plank wings light this up)
    def longest_const_slope(arr):
        best, cur, slope = 0, 1, None
        for i in range(1, len(arr)):
            if arr[i] < 0 or arr[i-1] < 0:
                cur, slope = 1, None; continue
            s = arr[i] - arr[i-1]
            if slope is not None and s == slope: cur += 1
            else: slope, cur = s, 2
            best = max(best, cur)
        return best
    topB = [-1]*W; botB = [-1]*W; lefB = [-1]*H; rigB = [-1]*H
    for x in range(W):
        col = np.where(m[:, x])[0]
        if len(col): topB[x] = int(col.min()); botB[x] = int(col.max())
    for y in range(H):
        row = np.where(m[y])[0]
        if len(row): lefB[y] = int(row.min()); rigB[y] = int(row.max())
    straight = max(longest_const_slope(topB)/max(W,1), longest_const_slope(botB)/max(W,1),
                   longest_const_slope(lefB)/max(H,1), longest_const_slope(rigB)/max(H,1))
    report[name] = {
        'W_over_H': round(W/H, 2), 'fill': round(area/(H*W), 3),
        'thirds_cols': [round(float(m[:, i*W//3:(i+1)*W//3].sum()/area), 2) for i in range(3)],
        'thirds_rows': [round(float(m[i*H//3:(i+1)*H//3].sum()/area), 2) for i in range(3)],
        'compactness': round(per*per/(4*np.pi*area), 1),
        'neg_pockets': pockets[:6],
        'com': [round(float(cx)/W, 2), round(float(cy)/H, 2)],
        'protrusions': protr[:8],
        'sq_fill': round(sq_fill, 3),
        'mirror_sym': round(mirror_sym, 2),
        'straight_max': round(float(straight), 2),
    }
    sil = Image.fromarray((~m*255).astype(np.uint8))
    for px in (24, 48):
        sil.resize((px, px), Image.LANCZOS).resize((240, 240), Image.NEAREST)\
           .save(os.path.join(outdir, f'{name}_thumb{px}.png'))
    sheets.append((name, sil))
if sheets:
    hmax = 300
    tiles = [(n, s.resize((int(s.width*hmax/s.height), hmax))) for n, s in sheets]
    Wt = sum(t.width for _, t in tiles) + 10*(len(tiles)+1)
    sheet = Image.new('L', (Wt, hmax+40), 255)
    x = 10
    from PIL import ImageDraw
    d = ImageDraw.Draw(sheet)
    for n, t in tiles:
        sheet.paste(t, (x, 30)); d.text((x, 8), n, fill=0); x += t.width + 10
    sheet.save(os.path.join(outdir, 'sheet.png'))
with open(os.path.join(outdir, 'metrics.json'), 'w') as f:
    json.dump(report, f, indent=1)
print(json.dumps(report))
