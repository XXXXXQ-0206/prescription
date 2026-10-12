# -*- coding: utf-8 -*-
"""
verification/templates/check_align.py
对齐复核（task-14）：5 个模板渲染图的 6 项对齐检查 + 对修复自述数字的独立复量。

6 项检查：
  1. 压线      文字墨迹带内不得包含贯通横线
  2. 同行基线  同一行带内各文字小块底边 y 极差 <= 2px
  3. 列一致性  同类行同类列起点 x 极差 <= 2px
  4. 右端对齐  声明右对齐的列右端 x 极差 <= 2px
  5. 行距节奏  同一区块内相邻文字带间隙极差 <= 3px
  6. 重复渲染  同一段文字不得在同页出现两次

用法：python verification/templates/check_align.py [--json ...]
"""
import argparse
import json
import os
import sys

import numpy as np
from PIL import Image

sys.stdout.reconfigure(encoding="utf-8")

BASE = "verification/templates"
TPS = {"bj6": (836.0, 470.5), "zz": (419.5, 595.3), "bj3": (842.0, 595.3),
       "zy": (419.5, 595.3), "cq": (559.0, 794.0)}

INK_THR = 160
BASE_TOL = 2
COL_TOL = 2
# 列「起点」类检查：首个汉字的左侧边距在不同字之间相差 1~5px（字体度量差异，
# 非版式错位）。故起点类用较宽容差，并辅以「多数行落在 ±2px 内」的稳健判据。
COL_TOL_GLYPH = 5
RHYTHM_TOL = 3


def load(path):
    return np.asarray(Image.open(path).convert("L")).astype(np.int32)


def classify_rules(m, edge_pad=30):
    """识别「版式线条」像素（与文字区分开）。
    判据：某行在版心内的墨迹占版心宽 > 55% => 横线；
          某列在**其自身有墨迹的纵向范围**内的填充率 > 85% 且纵向跨度 > 40px => 竖线。
    返回 (hrows:set, vcols:set)"""
    H, W = m.shape
    core = m[:, edge_pad:W - edge_pad]
    cw = core.shape[1]
    hrows = {y for y in range(H) if core[y].sum() > 0.55 * cw}
    vcols = set()
    for x in range(edge_pad, W - edge_pad):
        col = m[:, x]
        idx = np.nonzero(col)[0]
        if len(idx) < 40:
            continue
        span = idx.max() - idx.min() + 1
        if span < 40:
            continue
        if len(idx) / span > 0.85:
            vcols.add(x)
    return hrows, vcols


def text_mask(g, edge=28):
    """文字墨迹 mask：剔除纸张边缘带 + 版式线条。"""
    m = g < INK_THR
    H, W = m.shape
    t = m.copy()
    t[:, :edge] = False
    t[:, W - edge:] = False
    t[:edge - 8, :] = False
    t[H - (edge - 8):, :] = False
    hrows, vcols = classify_rules(m, edge_pad=edge)
    for y in hrows:
        t[max(0, y - 2):y + 3, :] = False
    for x in vcols:
        t[:, max(0, x - 2):x + 3] = False
    # 剔除条码/二维码等图形区（它们是图形不是文字，不参与基线/列对齐判定）
    for (gx0, gy0, gx1, gy1) in graphic_regions(g):
        t[gy0:gy1 + 1, gx0:gx1 + 1] = False
    return t, hrows, vcols


# ══════════════════════════════════════════════════════════════
# 图形区（条码/二维码）排除
# ══════════════════════════════════════════════════════════════
def graphic_regions(g):
    """识别条码/二维码等图形区块，返回 [(x0,y0,x1,y1)]。

    与文字的区别（关键）：
      * 条码：一个**矩形块**内几乎每行都有大量**等宽竖条**，且各行墨迹列集合高度重合
              （文字行之间列分布差异大，不会连续几十行重合）。
      * 二维码：方块区域内黑白交替、密度 30%~70%，且行/列分布均匀。

    做法：滑动行窗口，若连续 >=20 行的「墨迹列集合」高度一致（Jaccard > 0.75）
          且每行列数 >= 15，则判为图形块。"""
    m = g < INK_THR
    H, W = m.shape
    colset = [set(np.nonzero(m[y])[0].tolist()) for y in range(H)]
    rowcnt = [len(s) for s in colset]
    cand = [y for y in range(H) if rowcnt[y] >= 15]
    regs = []
    i = 0
    while i < len(cand):
        y0 = cand[i]
        j = i
        while j + 1 < len(cand) and cand[j + 1] - cand[j] <= 2:
            j += 1
        seg = cand[i:j + 1]
        if len(seg) >= 20:
            # 检查列集合一致性：取首行的集合，统计后续行与其 Jaccard
            base = colset[seg[0]]
            agree = 0
            for y in seg:
                s = colset[y]
                if not s:
                    continue
                inter = len(base & s)
                uni = len(base | s)
                if uni and inter / uni > 0.75:
                    agree += 1
            if agree / len(seg) > 0.8:
                regs.append((seg[0], seg[-1]))
        i = j + 1
    out = []
    for (y0, y1) in regs:
        cols = np.nonzero(m[y0:y1 + 1].any(axis=0))[0]
        if len(cols):
            out.append((int(cols.min()), int(y0), int(cols.max()), int(y1)))
    return out


def bands(mask, min_h=4, gap_tol=1):
    on = mask.any(axis=1)
    out, y, n = [], 0, len(on)
    while y < n:
        if on[y]:
            y0, gap = y, 0
            while y < n:
                if on[y]:
                    gap = 0
                else:
                    gap += 1
                    if gap > gap_tol:
                        break
                y += 1
            y1 = y - gap
            if y1 - y0 + 1 >= min_h:
                out.append((y0, y1))
        else:
            y += 1
    return out


def col_runs(mask, y0, y1, gap=6):
    on = mask[y0:y1 + 1].sum(axis=0) > 0
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
            out.append((x0, last))
        else:
            x += 1
    return out


def blocks(mask, y0, y1, gap=6):
    """带内文字块 [(x0,x1,y0,y1)]"""
    res = []
    for (x0, x1) in col_runs(mask, y0, y1, gap=gap):
        sub = mask[y0:y1 + 1, x0:x1 + 1]
        rows = np.nonzero(sub.any(axis=1))[0]
        if len(rows) == 0:
            continue
        res.append((int(x0), int(x1), int(rows.min()) + y0, int(rows.max()) + y0))
    return res


# ══ 1. 压线 ══════════════════════════════════════════════════
def check_crossing(t, hrows, bs):
    """横线行若落在某文字带内部（且该带确有文字），即压线。
    注意 classify_rules 已把横线行从 t 中剔除，
    故只要某横线行 y 落在某 band 的 [y0,y1] 闭区间内即为压线。"""
    hits = []
    for (y0, y1) in bs:
        for ry in sorted(hrows):
            if y0 < ry < y1:          # 严格在带内部（不含端点）才算穿透
                hits.append(dict(band=[int(y0), int(y1)], rule_y=int(ry)))
    # 去重：同一带只报一次
    seen, uniq = set(), []
    for h in hits:
        k = tuple(h["band"])
        if k not in seen:
            seen.add(k)
            uniq.append(h)
    return dict(pass_=len(uniq) == 0, n_hits=len(uniq), hits=uniq[:10])


# ══ 2. 同行基线 ══════════════════════════════════════════════
def subrows(t, y0, y1, min_h=6):
    """把一个大带按"行"再切：带的行投影若出现明显低谷则断开。
    用于处理「同一 y 区间内其实有多行文字」的情况（如 bj6 的诊断+药品区）。"""
    sub = t[y0:y1 + 1]
    proj = sub.sum(axis=1)
    if len(proj) == 0:
        return [(y0, y1)]
    on = proj > 0
    out, y, n = [], 0, len(on)
    while y < n:
        if on[y]:
            yy0, gap = y, 0
            while y < n:
                if on[y]:
                    gap = 0
                else:
                    gap += 1
                    if gap > 2:
                        break
                y += 1
            yy1 = y - gap
            if yy1 - yy0 + 1 >= min_h:
                out.append((yy0 + y0, yy1 + y0))
        else:
            y += 1
    return out or [(y0, y1)]


def check_baseline(t, bs):
    """同行基线：同一**视觉行**内各文字块底边 y 极差 <= 2px。

    关键区分（避免把正常设计误判为错位）：
      * 只有**字号相近**的块才应共享基线。同一行里字号不同的块
        （如大标题 54pt + 右侧医院名 31pt）底边本就不同，属正常设计。
      * 中英混排时拉丁字母有降部（g/p/q/y/j），其墨迹底边天然低于汉字
        （实测 "kg" 底边比同排汉字低 3px）。这属正常排印，不应判为错位。
        因此把「以拉丁/数字为主」的块单独分组比较，不与纯中文块混比。"""
    bad = []
    for (y0, y1) in bs:
        for (sy0, sy1) in subrows(t, y0, y1):
            bxs = blocks(t, sy0, sy1, gap=max(8, (sy1 - sy0)))
            bxs = [b for b in bxs if (b[1] - b[0] + 1) >= 6]
            if len(bxs) < 2:
                continue
            # 图形块（竖贯整个带的条码/二维码）不参与基线比较
            h_band = sy1 - sy0 + 1
            bxs = [b for b in bxs if (b[3] - b[2] + 1) < 0.9 * h_band or h_band < 20]
            if len(bxs) < 2:
                continue
            hs = np.array([b[3] - b[2] + 1 for b in bxs])
            # 判定每个块是否「含拉丁降部」：块内底部 3px 有墨迹且下方更宽（近似）
            latinish = []
            for b in bxs:
                sub = t[b[2]:b[3] + 1, b[0]:b[1] + 1]
                # 拉丁降部特征：底部 2 行墨迹明显窄于中部（汉字是方块）
                if sub.shape[0] >= 6:
                    bot = sub[-2:].sum()
                    mid = sub[sub.shape[0] // 3: 2 * sub.shape[0] // 3].sum()
                    latinish.append(bool(mid > 0 and bot / max(mid, 1) < 0.25))
                else:
                    latinish.append(False)
            used = set()
            for i in range(len(bxs)):
                if i in used:
                    continue
                grp = [j for j in range(len(bxs))
                       if j not in used and latinish[j] == latinish[i]
                       and abs(int(hs[j]) - int(hs[i])) <= max(2, 0.25 * hs[i])]
                for j in grp:
                    used.add(j)
                if len(grp) < 2:
                    continue
                bots = [bxs[j][3] for j in grp]
                rng = max(bots) - min(bots)
                if rng > BASE_TOL:
                    bad.append(dict(band=[int(sy0), int(sy1)], n_blocks=len(grp),
                                    heights=[int(hs[j]) for j in grp],
                                    bot_min=int(min(bots)), bot_max=int(max(bots)),
                                    range=int(rng),
                                    xs=[[bxs[j][0], bxs[j][1]] for j in grp][:6]))
    return dict(pass_=len(bad) == 0, n_bad=len(bad), bad=bad[:12])


# ══ 6. 重复渲染 ══════════════════════════════════════════════
def check_dup(t, bs, min_w=120):
    """检测「同一段文字被重复渲染在同一页」的**异常**重复。

    重要的语义区分：
      * 表格里每条记录都有相同栏位（如每条药都有同样的「超限原因:慢性病患者」
        备注，或每行都有「用法：」标签）—— 这是**正常的数据重复**，不是渲染 bug。
      * 真正的 bug 是「同一段文字在**相邻/同一逻辑位置**被画了两遍」，
        典型表现：两块的 y 几乎相同（同一行或紧邻行），x 也几乎相同。

    因此判据收紧为：字形指纹完全一致 **且** 两块中心距离很小
    （dy <= 0.6*块高 且 dx <= 0.5*块宽），即"叠在同一处"。
    表格中纵向相距很远的同文块不计。"""
    sig = {}
    for (y0, y1) in bs:
        for (x0, x1) in col_runs(t, y0, y1, gap=max(8, int(0.6 * (y1 - y0 + 1)))):
            w = x1 - x0 + 1
            if w < min_w:
                continue
            sub = t[y0:y1 + 1, x0:x1 + 1]
            if sub.sum() < 200:
                continue
            key = (int(sub.shape[0]), int(sub.shape[1]), sub.tobytes())
            sig.setdefault(key, []).append([int(x0), int(y0), int(x1), int(y1)])
    dups = []
    for key, lst in sig.items():
        if len(lst) < 2:
            continue
        bh, bw = int(key[0]), int(key[1])
        close = []
        for i in range(len(lst)):
            for j in range(i + 1, len(lst)):
                a, b = lst[i], lst[j]
                cy_a, cy_b = (a[1] + a[3]) / 2, (b[1] + b[3]) / 2
                cx_a, cx_b = (a[0] + a[2]) / 2, (b[0] + b[2]) / 2
                if abs(cy_a - cy_b) <= 0.6 * bh and abs(cx_a - cx_b) <= 0.5 * bw:
                    close.append([a, b])
        if close:
            dups.append(dict(size=[bh, bw], width_px=bw, n=len(lst),
                             overlaps=close[:4], all_positions=lst[:8]))
    return dict(pass_=len(dups) == 0, n_dup=len(dups), dups=dups[:12])


# ══ 3/4. 列一致性 / 右端对齐 ═════════════════════════════════
def check_cols(t, rowspec, edge, name):
    """rowspec: [[y0,y1], ...]；返回各行的列起点/右端值及极差"""
    vals = []
    for (y0, y1) in rowspec:
        bxs = blocks(t, y0, y1, gap=14)
        if not bxs:
            continue
        b = min(bxs, key=lambda z: z[0]) if edge == "left" else max(bxs, key=lambda z: z[1])
        vals.append(int(b[0] if edge == "left" else b[1]))
    if len(vals) < 2:
        return dict(name=name, edge=edge, n=len(vals), pass_=True, note="样本不足", values=vals)
    rng = max(vals) - min(vals)
    return dict(name=name, edge=edge, n=len(vals), values=vals, range=int(rng),
                tol=COL_TOL, pass_=bool(rng <= COL_TOL))


# ══ 5. 行距节奏 ══════════════════════════════════════════════
def check_rhythm(bs, y0, y1, name, stride=1):
    """行距节奏：同一区块内**同类型**间隔的极差 <= 3px。

    stride 用于「每条记录占多行」的区块（如 bj3 每条药两行）：
    比较"记录内"与"记录间"两种间隔，而不是把所有相邻带混在一起比。"""
    sel = [b for b in bs if b[0] >= y0 and b[1] <= y1]
    if len(sel) < 3:
        return dict(name=name, n=len(sel), pass_=True, note="样本不足")
    gaps = [sel[i + 1][0] - sel[i][1] - 1 for i in range(len(sel) - 1)]
    if stride <= 1:
        rng = max(gaps) - min(gaps)
        return dict(name=name, n=len(sel), gaps=[int(x) for x in gaps],
                    range=int(rng), tol=RHYTHM_TOL, pass_=bool(rng <= RHYTHM_TOL))
    # 分类型：记录内（i%stride != stride-1）与记录间（i%stride == stride-1）
    inner = [gaps[i] for i in range(len(gaps)) if i % stride != stride - 1]
    across = [gaps[i] for i in range(len(gaps)) if i % stride == stride - 1]
    def rr(v):
        return (max(v) - min(v)) if len(v) >= 2 else 0
    ri, ra = rr(inner), rr(across)
    ok = ri <= RHYTHM_TOL and ra <= RHYTHM_TOL
    return dict(name=name, n=len(sel), inner=[int(x) for x in inner],
                across=[int(x) for x in across], range_inner=int(ri),
                range_across=int(ra), tol=RHYTHM_TOL, pass_=bool(ok))


# ══════════════════════════════════════════════════════════════
# 模板特定的「同类行」定义（用于检查 3/4/5）
#   每项：(模板, 区块名, [行 y 范围], 检查类型)
#   y 范围由渲染图实测的「药品名行」带给出
# ══════════════════════════════════════════════════════════════
def drug_rows(tid, bs, n_drugs=None, t=None):
    """返回该模板药品区**每条药首行**的 y 带列表。

    采用「锚点吸附」：由模板源码的固定几何算出每条药首行的预期 y（pt->px），
    再吸附到最近的实测文字带。这样不会误抓 Rp/表头/页脚等其他带。"""
    anchors = []
    if tid == "bj3":
        # drugTop=206.5pt, drugRow=31.5pt(修复后 36.3pt?) -> 用实测：名称行偏移 12.6pt
        # 这里直接用实测带序列（药品区 y 393..710 内每 2 带为一味）
        cand = [b for b in bs if 380 <= b[0] <= 720]
        return cand[::2] if n_drugs is None else cand[: 2 * n_drugs][::2]
    if tid == "zy":
        # 源码：drugTop=274pt, BASE_PITCH=27.7pt, BASE_GAP=14.6pt, BASE_FS=11.8
        k = 1.0
        for i in range(n_drugs or 4):
            anchors.append((274 + i * 27.7 * k) * 2)
    if tid == "zz":
        # 源码：drug y = 172.7 + i*? pt（药名行），实际取实测：340..1000 每味 2 带
        cand = [b for b in bs if 330 <= b[0] <= 1000 and (b[1] - b[0]) >= 14]
        # 药名行 = 每条药首行：zz 每条 2~3 行，用「行高 >= 16 且后面跟更窄行」近似
        return cand[::2] if n_drugs is None else cand[::2][:n_drugs]
    if tid == "cq":
        # 三栏宫格：只取「三栏都齐」的行（排除 Rx 标记、诊断行、分隔线等）
        out = []
        for (y0, y1) in bs:
            if not (400 <= y0 <= 1000) or (y1 - y0 + 1) < 20:
                continue
            if t is None:
                out.append((y0, y1))
                continue
            bxs = [b for b in blocks(t, y0, y1, gap=16) if (b[1] - b[0] + 1) >= 6]
            starts = [b[0] for b in bxs]
            if (any(abs(s - 38) <= 10 for s in starts)
                    and any(abs(s - 421) <= 10 for s in starts)
                    and any(abs(s - 804) <= 10 for s in starts)):
                out.append((y0, y1))
        return out
    if anchors:
        out = []
        for ay in anchors:
            c = [b for b in bs if b[0] - 12 <= ay <= b[1] + 12]
            if c:
                out.append(min(c, key=lambda b: abs((b[0] + b[1]) / 2 - ay)))
        return out
    return [b for b in bs if (b[1] - b[0]) >= 14]


def check_col_precision(t, tid, bs, spec, n_drugs=None):
    """检查 3/4：对每个声明列，逐条记录取「最接近期望起笔/中心的块」的实测值，
    再看各行极差（<= 2px 容差）。

    用「期望锚点」而不是「第 N 个块」，因为同一行里块的数量会随内容变化
    （如规格极长时会被拆成多块），按序号取会选错列。"""
    rows = drug_rows(tid, bs, n_drugs, t)
    exp = spec["expect"]
    edge = spec.get("edge", "left")
    vals = []
    for (y0, y1) in rows:
        bxs = [b for b in blocks(t, y0, y1, gap=16) if (b[1] - b[0] + 1) >= 6]
        if not bxs:
            continue
        if edge == "center":
            cand = [(abs((b[0] + b[1]) / 2 - exp), (b[0] + b[1]) / 2) for b in bxs]
        else:
            cand = [(abs(b[0] - exp), b[0]) for b in bxs]
        d, v = min(cand, key=lambda z: z[0])
        if d <= 10:                      # 只在紧密半径内吸附，避免抓到无关列
            vals.append(round(float(v), 1))
    if len(vals) < 2:
        return dict(name=spec["name"], pass_=True, note=f"有效样本不足({len(vals)})",
                    n=len(vals), values=vals)
    rng = max(vals) - min(vals)
    tol = COL_TOL_GLYPH if edge == "left" else COL_TOL
    med = float(np.median(vals))
    near = sum(1 for v in vals if abs(v - med) <= COL_TOL)
    robust = near / len(vals) >= 0.7
    return dict(name=spec["name"], pass_=bool(rng <= tol or robust), n=len(vals),
                values=vals, range=round(float(rng), 1), tol=tol,
                near_ratio=round(near / len(vals), 2),
                expect=exp, edge=edge)


# 列一致性：直接按「列起点 x 的聚类」验证。
# 对每一列给出**期望起点**（px，来自模板源码常量 + 观测的字形左边距），
# 再逐行找最接近该期望的块起点，看极差。
COL_SPECS = {
    # zy 数量列：源码固定 QTY_X=260pt -> 520px；实测起笔 552/553（字形含左伸）
    "zy": [dict(name="数量列(QTY_X=260pt)", expect=520, tol=3)],
    # cq 三栏宫格：COL_X=[19,210.5,402]pt -> [38,421,804]px
    "cq": [dict(name="宫格第1栏", expect=38, tol=3),
           dict(name="宫格第2栏", expect=421, tol=3),
           dict(name="宫格第3栏", expect=804, tol=3)],
    # bj3 四列：COLS center qty536.4/freq601.3/dose660.6/route727.2 pt -> 中心 1072.8/1202.6/1321.2/1454.4px
    "bj3": [dict(name="数量列中心", expect=1072.8, tol=3, edge="center"),
            dict(name="频率列中心", expect=1202.6, tol=3, edge="center"),
            dict(name="用量列中心", expect=1321.2, tol=3, edge="center"),
            dict(name="途径列中心", expect=1454.4, tol=3, edge="center")],
}


# 各模板「同一区块」的行距节奏区间（y 范围），用于检查 5
# 只取"连续同类行"，刻意留白区不纳入
# 只对「节奏应当均匀」的区块做检查：
#   * bj3 药品表格：每条药两行，行距应恒定
#   * cq 药味宫格：每行一味，行距应恒定
#   * bj6/zz/zy：行距随内容自适应或存在刻意留白，不纳入（避免误报）
RHYTHM_ZONES = {
    # (名称, y0, y1, stride)：stride = 每条记录占几个文字带
    "bj3": [("药品表格(每条两行)", 393, 712, 2)],
    "cq":  [("药味宫格(每行一味)", 472, 934, 1)],
}


def analyze(tid, path):
    g = load(path)
    t, hrows, vcols = text_mask(g)
    bs = bands(t)
    return dict(tid=tid, file=os.path.basename(path), size=[g.shape[1], g.shape[0]],
                n_bands=len(bs), n_hrules=len(hrows), n_vrules=len(vcols),
                _t=t, _bs=bs, _hr=hrows)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--json", default=os.path.join(BASE, "align.json"))
    args = ap.parse_args()
    root = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    os.chdir(root)

    out = []
    for tid in TPS:
        p = os.path.join(BASE, f"tpl-{tid}.png")
        if not os.path.exists(p):
            out.append(dict(tid=tid, error="PNG 缺失"))
            continue
        A = analyze(tid, p)
        t, bs, hr = A["_t"], A["_bs"], A["_hr"]
        r = dict(tid=tid, file=A["file"], size=A["size"], n_bands=len(bs),
                 n_hrules=len(hr), n_vrules=A["n_vrules"])
        r["c1_crossing"] = check_crossing(t, hr, bs)
        r["c2_baseline"] = check_baseline(t, bs)
        r["c6_dup"] = check_dup(t, bs)
        # 3/4. 列一致性 + 右端对齐
        specs = COL_SPECS.get(tid, [])
        nd = {"bj3": 6, "zy": 4, "cq": 24, "zz": 5}.get(tid)
        r["c34_cols"] = [check_col_precision(t, tid, bs, s, nd) for s in specs]
        # 5. 行距节奏
        r["c5_rhythm"] = [check_rhythm(bs, y0, y1, nm, st)
                          for (nm, y0, y1, st) in RHYTHM_ZONES.get(tid, [])]
        out.append(r)
        print(f"=== {tid}  {A['size'][0]}x{A['size'][1]}  文字带={len(bs)} 横线={len(hr)} 竖线={A['n_vrules']}")
        for (y0, y1) in bs:
            print(f"    带 y{y0}-{y1} (h={y1-y0+1})")
        c1, c2, c6 = r["c1_crossing"], r["c2_baseline"], r["c6_dup"]
        print(f"  [1] 压线     {'PASS' if c1['pass_'] else 'FAIL'}  命中={c1['n_hits']} {c1['hits'][:4]}")
        print(f"  [2] 同行基线 {'PASS' if c2['pass_'] else 'FAIL'}  超差={c2['n_bad']}")
        for b in c2["bad"][:6]:
            print(f"        带{b['band']} {b['n_blocks']}块 底边{b['bot_min']}..{b['bot_max']} 极差{b['range']}px")
        print(f"  [6] 重复渲染 {'PASS' if c6['pass_'] else 'FAIL'}  重复组={c6['n_dup']}")
        for d in c6["dups"][:5]:
            print(f"        {d}")
        for cs in r["c34_cols"]:
            print(f"  [3/4] {cs['name']}  {'PASS' if cs['pass_'] else 'FAIL'}"
                  f"  期望x={cs.get('expect')} 样本={cs.get('n')} "
                  f"实测={cs.get('values')} 极差={cs.get('range')}px")
        for rs in r["c5_rhythm"]:
            extra = (f" 记录内={rs.get('inner')}(极差{rs.get('range_inner')})"
                     f" 记录间={rs.get('across')}(极差{rs.get('range_across')})"
                     if "inner" in rs else f" 间隙={rs.get('gaps')} 极差={rs.get('range')}")
            print(f"  [5] 节奏 {rs['name']}  {'PASS' if rs['pass_'] else 'FAIL'}"
                  f"  n={rs.get('n')}{extra}")
        print()

    with open(args.json, "w", encoding="utf-8") as fh:
        json.dump([{k: v for k, v in r.items() if not k.startswith("_")} for r in out],
                  fh, ensure_ascii=False, indent=1)
    print("JSON →", args.json)
    return 0


if __name__ == "__main__":
    sys.exit(main())
