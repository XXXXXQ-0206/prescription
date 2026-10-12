# -*- coding: utf-8 -*-
"""
verification/templates/verify_claims.py
独立复量各模板负责人声称的「修复数字」（容差 1pt）。

方法：用**实测文字带**（而非按声明 y 反查）来定位元素，避免"按声明找声明"的循环论证；
再与模板源码常量（声明值）比较。
用法：python verification/templates/verify_claims.py
"""
import json
import os
import sys

import numpy as np
from PIL import Image

sys.stdout.reconfigure(encoding="utf-8")
BASE = "verification/templates"
INK = 160
TOL_PT = 1.0
CLAIMS = []


def load(tid):
    return np.asarray(Image.open(os.path.join(BASE, f"tpl-{tid}.png")).convert("L")).astype(np.int32)


def bands(m, min_h=4, gap_tol=1):
    on = m.any(axis=1)
    out, y, n = [], 0, len(on)
    while y < n:
        if on[y]:
            y0, g = y, 0
            while y < n:
                if on[y]:
                    g = 0
                else:
                    g += 1
                    if g > gap_tol:
                        break
                y += 1
            y1 = y - g
            if y1 - y0 + 1 >= min_h:
                out.append((y0, y1))
        else:
            y += 1
    return out


def hrules(m, frac=0.55):
    w = m.shape[1]
    return sorted(y for y in range(m.shape[0]) if m[y].sum() > frac * w)


def row_blocks(m, y0, y1, gap=14, min_w=6):
    on = m[y0:y1 + 1].sum(axis=0) > 0
    out, x, n = [], 0, len(on)
    while x < n:
        if on[x]:
            x0, last, g = x, x, 0
            while x < n and g <= gap:
                if on[x]:
                    last, g = x, 0
                else:
                    g += 1
                x += 1
            if last - x0 + 1 >= min_w:
                out.append((x0, last))
        else:
            x += 1
    return out


def claim(tpl, elem, desc, declared, measured, note="", tol=TOL_PT):
    d = abs(measured - declared)
    CLAIMS.append(dict(tpl=tpl, elem=elem, desc=desc, declared=round(declared, 2),
                       measured=round(measured, 2), diff=round(d, 2),
                       tol=tol, pass_=bool(d <= tol), note=note))


def main():
    # ═══════════════ bj3 ═══════════════
    # 声明：诊断行 y 171.7->166.5；通栏横线 180.6->180.8；药品行距 31.5->36.3；
    #       版心右界 821->820.5（源码 X_R=820.5）
    g = load("bj3"); m = g < INK
    bs = bands(m)
    hr = hrules(m)
    # 通栏横线：诊断下方那条（y≈361px）
    cand = [y for y in hr if 300 < y < 420]
    if cand:
        claim("bj3", "通栏横线", "180.6 -> 180.8pt", 180.8, cand[0] / 2.0)
        # 诊断行 = 该横线正上方最近的一条文字带
        above = [b for b in bs if b[1] < cand[0]]
        if above:
            db = above[-1]
            # 诊断行「顶」= 文字带顶；源码 y=166.5 是 em 盒顶，墨迹顶略低
            claim("bj3", "诊断行顶", "诊断 y 171.7 -> 166.5pt", 166.5, db[0] / 2.0,
                  note=f"实测带 y{db[0]}..{db[1]}（墨迹顶）", tol=3.0)
                    # 版心右界：诊断文本不足长时不会顶到右界，故**只在文本足够长时**校验；
            # 此处 bj3 默认 3 条短诊断远未触界，仅记录实测值供参考，不作为判定。
            CLAIMS.append(dict(tpl="bj3", elem="诊断行右端", desc="版心右界 820.5pt",
                               declared=820.5, measured=round(db[1] / 2.0, 2),
                               diff=None, tol=None, pass_=None,
                               note=f"默认诊断较短未触界，实测右端={db[1]}px（{db[1]/2:.1f}pt）；"
                                    f"仅作参考，不判定"))
    # 药品行距：药品区文字带，每条药 2 带
    db_ = [b for b in bs if 400 <= b[0] <= 720]
    if len(db_) >= 4:
        names = [b[0] for b in db_[0::2]]
        pitches = [names[i + 1] - names[i] for i in range(len(names) - 1)]
        claim("bj3", "药品行距", "31.5 -> 36.3pt", 36.3,
              float(np.median(pitches)) / 2.0, note=f"各值={[round(v/2,1) for v in pitches]}")

    # ═══════════════ zz ═══════════════
    # 声明：处方号与日期右端统一 376pt；页脚行距 18/18；页脚横线 528->535
    g2 = load("zz"); m2 = g2 < INK
    hr2 = hrules(m2)
    cand2 = [y for y in hr2 if y > 950]
    if cand2:
        claim("zz", "页脚横线", "528 -> 535pt", 535, cand2[0] / 2.0)
    bs2 = bands(m2)
    foot = [b for b in bs2 if b[0] > 1050]
    if len(foot) >= 3:
        g1 = (foot[1][0] - foot[0][0]) / 2.0
        g2_ = (foot[2][0] - foot[1][0]) / 2.0
        claim("zz", "页脚行距1", "20 -> 18pt", 18, g1, note=f"带={foot[:3]}")
        claim("zz", "页脚行距2", "15 -> 18pt", 18, g2_, note=f"带={foot[:3]}")
    # 右端统一 376pt：处方号行 / 日期行
    for nm, ypt in (("处方号行", 69.7), ("日期行", 113.7)):
        bb = [b for b in bs2 if abs(b[0] - ypt * 2) <= 20]
        if bb:
            y0, y1 = bb[0]
            blk = row_blocks(m2, y0, y1, gap=12)
            if blk:
                claim("zz", nm + "右端", "右端统一 376pt", 376, blk[-1][1] / 2.0)

    # ═══════════════ zy ═══════════════
    # 声明：三条通栏线 125.5->123、504.5->500、530->532；
    #       同味两行距 16.4->14.6、相邻味 31.1->27.7；数量列固定 x=260
    g3 = load("zy"); m3 = g3 < INK
    hr3 = hrules(m3)
    for want in (123, 500, 532):
        if hr3:
            near = min(hr3, key=lambda y: abs(y / 2.0 - want))
            if abs(near / 2.0 - want) <= 4:
                claim("zy", f"通栏线{want}", f"通栏线 y={want}pt", want, near / 2.0)
    bs3 = bands(m3)
    drug_bands = [b for b in bs3 if 540 <= b[0] <= 800]
    if len(drug_bands) >= 4:
        names = [b[0] for b in drug_bands[0::2]]
        uses = [b[0] for b in drug_bands[1::2]]
        inner = [uses[i] - names[i] for i in range(min(len(names), len(uses)))]
        across = [names[i + 1] - uses[i] for i in range(min(len(names), len(uses)) - 1)]
        if inner:
            claim("zy", "同味两行距", "16.4 -> 14.6pt", 14.6,
                  float(np.median(inner)) / 2.0, note=f"各值={[round(v/2,1) for v in inner]}")
        # 相邻两味距（pitch）= 同味内 + 味间
        if across:
            pitch = [(names[i + 1] - names[i]) for i in range(len(names) - 1)]
            claim("zy", "相邻两味距", "31.1 -> 27.7pt", 27.7,
                  float(np.median(pitch)) / 2.0,
                  note=f"各值={[round(v/2,1) for v in pitch]}（= 同味内 + 味间）")
    # 数量列固定 260pt：取每味药名行最右侧那一截的起点
    qs = []
    for i in range(4):
        ypt = 274 + i * 27.7
        candb = [b for b in bs3 if abs(b[0] - ypt * 2) <= 14]
        if not candb:
            continue
        y0, y1 = candb[0]
        blk = row_blocks(m3, y0, y1, gap=10)
        if blk:
            qs.append(blk[-1][0])
    if qs:
        # place 的 dx=520px 是 em 盒左沿；数字/汉字字形左侧边距实测 +1~+3px，
        # 故判定用 2pt 容差（与「列一致性」检查的口径一致）。
        claim("zy", "数量列起点", "由流式改为固定 x=260pt", 260,
              float(np.median(qs)) / 2.0, note=f"各值(px)={qs}（含字形左侧边距 +1~+3px）",
              tol=2.0)

    # ═══════════════ cq ═══════════════
    # 声明：「核对、发药」x 246->326；条码号与条码净空 0.5->4.5pt
    g4 = load("cq"); m4 = g4 < INK
    bs4 = bands(m4)
    # 「核对、发药：」在页脚区，取 y 接近 721pt(1442px) 的带
    # 「审核、调配：」与「核对、发药：」同行，需按**大间隙**切分（gap 阈值放宽到 >150px）
    c4 = [b for b in bs4 if 1420 <= b[0] <= 1480]
    if c4:
        y0, y1 = c4[0]
        on = m4[y0:y1 + 1].sum(axis=0) > 0
        cols = np.nonzero(on)[0]
        d = np.diff(cols)
        big = np.nonzero(d > 150)[0]
        if len(big):
            right_start = int(cols[big[-1] + 1])
            claim("cq", "核对发药标签", "246 -> 326pt", 326, right_start / 2.0,
                  note=f"左标签起笔={int(cols.min())}px({cols.min()/2:.1f}pt)，"
                       f"右标签起笔={right_start}px")
    # 条码底 vs 条码号顶 的净空
    bc_bands = [b for b in bs4 if 80 <= b[0] <= 130]
    if len(bc_bands) >= 2:
        gap = (bc_bands[1][0] - bc_bands[0][1]) / 2.0
        claim("cq", "条码-条码号净空", "0.5 -> 4.5pt", 4.5, gap,
              note=f"条码带={bc_bands[0]} 条码号带={bc_bands[1]}")

    print("--- 声明复核（容差 1pt，个别见注）---")
    ok = bad = na = 0
    for c in CLAIMS:
        if c["pass_"] is None:
            s, na = "参考", na + 1
            t = ""
        else:
            s = "成立" if c["pass_"] else "不成立"
            ok += 1 if c["pass_"] else 0
            bad += 0 if c["pass_"] else 1
            t = "" if c.get("tol") == TOL_PT else f"(容差{c.get('tol')})"
        dv = "  n/a " if c["diff"] is None else f"{c['diff']:5.2f}"
        print(f"  [{s}] {c['tpl']:4s} {c['elem']:14s} {c['desc']:26s} "
              f"声明={c['declared']:7.2f} 实测={c['measured']:8.2f} "
              f"偏差={dv}pt{t} {c['note']}")
    print(f"\n共 {len(CLAIMS)} 条：成立 {ok}，不成立 {bad}，仅参考 {na}")
    with open(os.path.join(BASE, "claims.json"), "w", encoding="utf-8") as fh:
        json.dump(CLAIMS, fh, ensure_ascii=False, indent=1)
    return 0


if __name__ == "__main__":
    sys.exit(main())
