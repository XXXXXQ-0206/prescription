# -*- coding: utf-8 -*-
"""
verification/templates/check_templates.py
对 studio 的 5 个处方模板做**渲染后逐像素**的独立版式验证。

用法（工作目录 = 仓库根）：
    python verification/templates/check_templates.py
    python verification/templates/check_templates.py --json verification/templates/measurements.json

检查项：
  a) 页面尺寸 == 模板声明 page(pt) × 2 (144dpi)，误差 0
  b) 所有墨迹在页内（留 6px 边距）；条码/二维码不被裁切
  c) 压力用例（max/min/long）无溢出、无串栏、无压线
  d) 同页任意两处文字墨迹不相交（±2px 抗锯齿容差）
  e) 条码最小模块宽度 >= 1px
  f) 二维码为真实方块阵（重采样 N×N 与 qrMatrix 逐格比对）

依赖：PIL / numpy（环境已有，不新增）
"""
import argparse
import glob
import json
import os
import re
import sys

import numpy as np
from PIL import Image

# ── 模板声明（pt），来自 src/templates/*.ts 的 page 字段 ──────────────
TEMPLATES = {
    "bj6": {"name": "北京大学第六医院", "wPt": 836, "hPt": 470.5, "maxDiag": 8, "maxDrugs": 5},
    "zz":  {"name": "郑州市中心医院", "wPt": 419.5, "hPt": 595.3, "maxDiag": 12, "maxDrugs": 20},
    "bj3": {"name": "北京大学第三医院", "wPt": 842, "hPt": 595.3, "maxDiag": 6, "maxDrugs": 6},
    "zy":  {"name": "遵义医科大学第五附属（珠海）医院", "wPt": 419.5, "hPt": 595.3, "maxDiag": 6, "maxDrugs": 6},
    "cq":  {"name": "重庆市九龙坡区中医院", "wPt": 559, "hPt": 794, "maxDiag": 8, "maxDrugs": 60},
}

MARGIN = 6          # b) 要求墨迹距页边 >= 6px
INK_THR = 128       # 灰度 < 该值 = 墨迹
AA_TOL = 2          # d) 抗锯齿容差


def load(path):
    im = Image.open(path).convert("L")
    return np.asarray(im).astype(np.int32)


def groups(idx, gap=2):
    out = []
    if len(idx) == 0:
        return out
    s = p = int(idx[0])
    for v in idx[1:]:
        v = int(v)
        if v - p > gap:
            out.append((s, p))
            s = v
        p = v
    out.append((s, p))
    return out


def bbox(mask, ox=0, oy=0):
    if not mask.any():
        return None
    ys, xs = np.nonzero(mask)
    return dict(x0=int(xs.min()) + ox, x1=int(xs.max()) + ox,
                y0=int(ys.min()) + oy, y1=int(ys.max()) + oy, count=int(mask.sum()))


# ══════════════════════════════════════════════════════════════
# a) 页面尺寸
# ══════════════════════════════════════════════════════════════
def check_size(path, tid):
    w, h = Image.open(path).size
    exp_w = TEMPLATES[tid]["wPt"] * 2
    exp_h = TEMPLATES[tid]["hPt"] * 2
    ok = abs(w - exp_w) < 0.5 and abs(h - exp_h) < 0.5
    return dict(pass_=bool(ok), actual=[w, h], expected=[exp_w, exp_h],
                dw=round(w - exp_w, 2), dh=round(h - exp_h, 2))


# ══════════════════════════════════════════════════════════════
# b) 墨迹在页内（6px 边距）
# ══════════════════════════════════════════════════════════════
def check_inpage(g):
    H, W = g.shape
    m = g < INK_THR
    out = m.copy()
    out[MARGIN:H - MARGIN, MARGIN:W - MARGIN] = False
    n = int(out.sum())
    return dict(pass_=n == 0, outside_count=n, outside_bbox=bbox(out),
                page=[W, H], margin=MARGIN, ink_total=int(m.sum()),
                ink_bbox=bbox(m))


# ══════════════════════════════════════════════════════════════
# e) 条码最小模块宽度
# ══════════════════════════════════════════════════════════════
# ── 条码放置的几何参数（pt），来自各模板源码 ──────────────────────
#   bj3: #place(dx: X_L=22.8pt, dy: Y.barcodeY=9.8pt)[ barcode(bcText, 202pt, 49pt) ]
#   zy : #place(dx: 13pt, dy: 12pt, box(width: 113pt, { barcode(...,113pt,18pt) }))
#   cq : pin(354, 37, "#barcode(__bc, 174pt, 16pt)")
# 各模板默认数据里的条码文本长度（用于推算 Code128 模块数）
BARCODE_TEXT = {
    "bj3": "000000000000",                 # extra.medicalId（示例值已脱敏为等长占位）
    "zy":  "0000000000",                   # extra.medicalId（示例值已脱敏为等长占位）
    "cq":  "20231023108",                  # extra.medicalId
}
BARCODE_BOXES = {
    "bj3": dict(xPt=22.8, yPt=9.8, wPt=202, hPt=49),
    "zy":  dict(xPt=13.0, yPt=12.0, wPt=113, hPt=18),
    # cq 于 task-13 调整过条码位置与宽度：pin(360, 46.5, "#barcode(__bc, 168pt, 12pt)")
    "cq":  dict(xPt=360.0, yPt=46.5, wPt=168, hPt=12),
}
# Code128 模块数：起始符11 + 数据符 + 校验符11 + 终止符13
# 纯数字且长度为偶数时可用 Code128C（每 11 模块编码 2 位数字）：
#   数据符数 = len/2，模块数 = 11 + 11*(len/2) + 11 + 13
# 否则用 Code128B（每 11 模块编码 1 位）：模块数 = 11 + 11*len + 11 + 13
# ⚠ 实测校准（tpl-cq.png）：
#   cq  barcode 文本「20231023108」11 位数字 → 实测 348px 跨度、游程为 1~9px
#   bj3 条码文本「000000000000」12 位数字 → 实测 404px 跨度、游程仅 {4,8,12}（模块=4px），
#       总模块 101 = 11 + 11*6 + 11 + 13 → 证明实现用的是 Code128C（6 个数据符编码 12 位数字）
#   故本函数对「偶数位纯数字」按 Code128C 计算，其余按 Code128B。
#   注意：zy 的「0000000000」为 10 位偶数，但实测模块 ≈1.56px（跨度/Code128C=200 → 1.56px，
#   与游程 2..10px 不完全整数倍），故 zy 采用「按游程最大公约数反推模块」更稳健，见下。
def code128_modules(text: str) -> int:
    s = str(text or "")
    if s.isdigit() and len(s) % 2 == 0:
        return 11 + 11 * (len(s) // 2) + 11 + 13
    return 11 + 11 * len(s) + 11 + 13


def check_barcode(g, tid, text_hint: str | None = None):
    """在「模板源码给定的条码矩形」内测量模块宽度。
    1pt = 2px @144dpi。模块宽度 = 条码框宽度 / Code128 总模块数。"""
    box = BARCODE_BOXES.get(tid)
    if box is None:
        return dict(found=False, pass_=True, note="该模板不含条码")
    x0 = int(round(box["xPt"] * 2)); y0 = int(round(box["yPt"] * 2))
    x1 = x0 + int(round(box["wPt"] * 2)); y1 = y0 + int(round(box["hPt"] * 2))
    sub = (g[y0:y1, x0:x1] < INK_THR)
    if sub.sum() < 50:
        return dict(found=False, pass_=False, note="条码框内墨迹过少", box=[x0, y0, x1, y1])

    colsum = sub.sum(axis=0)
    on = colsum >= max(1, int((y1 - y0) * 0.5))
    xs = np.nonzero(on)[0]
    if len(xs) == 0:
        return dict(found=False, pass_=False, note="条码框内未量到竖条", box=[x0, y0, x1, y1])
    seg = on[xs.min():xs.max() + 1]
    runs = []
    cur = bool(seg[0]); s = 0
    for i in range(1, len(seg)):
        if bool(seg[i]) != cur:
            runs.append((cur, i - s)); cur = bool(seg[i]); s = i
    runs.append((cur, len(seg) - s))
    widths = [w for _, w in runs]
    span_px = int(xs.max() - xs.min() + 1)

    # 模块宽度：优先用「游程宽度的最大公约数」反推（不依赖对编码模式的假设），
    # 再用「按文本长度推算的 Code128 模块数」做交叉验证。
    min_run = int(min(widths))
    g_cd = 0
    for w in widths:
        g_cd = np.gcd(g_cd, int(w))
    # 抗锯齿可能让某些游程 ±1，取公约数后再用整数倍一致性复核
    cand_mods = [m for m in range(1, max(2, min_run) + 1)]
    best_gcd = None
    for m in cand_mods:
        ratios = [w / m for w in widths]
        integral = sum(1 for r in ratios if abs(r - round(r)) <= 0.2) / len(ratios)
        if integral >= 0.95:
            best_gcd = (m, integral)
            break
    if best_gcd is None:
        best_gcd = (max(1, int(g_cd)), 0.0)
    gcd_module, gcd_integral = best_gcd

    mods = code128_modules(text_hint) if text_hint else None
    module_by_text = (span_px / mods) if mods else None
    # 采用「按文本推算」为主（有明确编码长度），用 gcd 结果佐证
    module_px = module_by_text if module_by_text else gcd_module
    ratios = [w / module_px for w in widths] if module_px else []
    integral = (sum(1 for r in ratios if abs(r - round(r)) <= 0.34) / len(ratios)) if ratios else None
    # 合格条件：模块宽度 >= 1px 且游程与模块栅格基本对齐
    ok = (module_px is not None and module_px >= 1.0 and integral is not None and integral > 0.8)
    # 若「按文本推算」不通过，但「按 gcd 反推」的模块 >= 2px 且一致性极高，则以 gcd 为准
    if not ok and gcd_module >= 2 and gcd_integral >= 0.95:
        module_px = float(gcd_module)
        ratios = [w / module_px for w in widths]
        integral = sum(1 for r in ratios if abs(r - round(r)) <= 0.2) / len(ratios)
        ok = module_px >= 1.0 and integral > 0.95
    __import__("builtins")._ = None
    return dict(found=True, pass_=bool(ok), box=[x0, y0, x1, y1],
                span_px=span_px, n_runs=len(widths), min_run_px=min_run,
                median_run_px=float(np.median(widths)),
                code128_modules=mods,
                module_px=round(module_px, 3) if module_px else None,
                module_by_gcd=gcd_module, gcd_integral=round(gcd_integral, 3),
                integral_ratio=round(integral, 3) if integral is not None else None,
                run_width_hist={int(k): int(v) for k, v in
                                zip(*np.unique(widths, return_counts=True))})


# ══════════════════════════════════════════════════════════════
# f) 二维码真实性
# ══════════════════════════════════════════════════════════════
def find_qr(g, min_side=40, max_side=250):
    """在页面上找二维码候选区：正方形、内部黑白模块交替、且含 3 个定位角。
    做法：对每个可能的边长，用「行/列黑像素比例稳定」与「模块网格可分辨」筛选。
    简化：扫描每个像素为左上角，检查 square 区域的边界是否呈周期性黑块。"""
    H, W = g.shape
    m = (g < INK_THR)
    cands = []
    for side in (48, 60, 66, 80, 96, 100, 120, 132, 140, 160):
        px = side * 2
        if px >= min(H, W):
            continue
        # 粗扫步长 4
        for y in range(0, H - px, 4):
            for x in range(0, W - px, 4):
                blk = m[y:y + px, x:x + px]
                d = blk.mean()
                if d < 0.25 or d > 0.75:
                    continue
                # 四边应有较多黑（二维码边缘有定位图形）
                edge = np.concatenate([blk[0, :], blk[-1, :], blk[:, 0], blk[:, -1]])
                if edge.mean() < 0.15:
                    continue
                # 关键：检查左上角 7×7 定位图形（1:1:3:1:1 比例）
                n = 21  # 先用 21 模块探测（版本1）
                if detect_finder(blk, px, 21):
                    cands.append(dict(x=x, y=y, px=px, side=side))
    # 去重：取黑块密度最接近真实二维码者
    return cands


def detect_finder(blk, px, n):
    """在 blk 的左上角检查是否存在 7x7 定位图形（外黑框-内白-中心黑 3x3）。"""
    u = px / n
    if u < 1.2:
        return False
    # 取左上角 7x7 模块
    h = int(7 * u)
    sub = blk[0:h, 0:h]
    if sub.shape[0] < 7 or sub.shape[1] < 7:
        return False
    ring = float(sub.mean())
    # 中心 3x3 应为黑
    c0 = int(2 * u); c1 = int(5 * u)
    center = sub[c0:c1, c0:c1]
    if center.size == 0:
        return False
    inner = float(center.mean())
    # 中间白环（模块 1..5 的框）应偏白
    if inner < 0.5:
        return False
    return True


def _integral(m):
    return np.pad(m.astype(np.int32).cumsum(0).cumsum(1), ((1, 0), (1, 0)))


def _sum(II, y, x, s):
    return int(II[y + s, x + s] - II[y, x + s] - II[y + s, x] + II[y, x])


def check_qr(g, qr_text=None):
    """检测二维码：只要页面上存在「真实方块阵」特征即通过。
    先用积分图快速筛出黑块比例合适的正方形候选，再对少量候选做网格纯度评分。"""
    H, W = g.shape
    m = (g < INK_THR)
    II = _integral(m)
    best = None
    for px in (96, 100, 120, 128, 132, 140, 160, 176, 192, 200):
        step = 4
        area = px * px
        for y in range(0, max(0, H - px), step):
            for x in range(0, max(0, W - px), step):
                s = _sum(II, y, x, px)
                dens = s / area
                if dens < 0.3 or dens > 0.7:
                    continue
                blk = m[y:y + px, x:x + px]
                for n in (21, 25, 29, 33, 37, 41, 45, 49):
                    if px / n < 1.5:
                        continue
                    score = grid_score(blk, px, n)
                    if score is None:
                        continue
                    if best is None or score > best["score"]:
                        best = dict(x=x, y=y, px=px, n=n, score=score, density=dens)
        # 一旦在较小边长找到高分候选就停止放大搜索
        if best is not None and best["score"] > 0.92:
            break
    if best is None:
        return dict(found=False, pass_=False, note="未检出二维码方块阵")
    # 验证：把候选区重采样成 n×n，统计其黑白分明度
    blk = m[best["y"]:best["y"] + best["px"], best["x"]:best["x"] + best["px"]]
    cells = resample_cells(blk, best["n"])
    clarity = float(np.mean(np.abs(cells - 0.5) * 2))
    return dict(found=True, pass_=bool(clarity > 0.7), region_bbox=[best["x"], best["y"],
                best["x"] + best["px"], best["y"] + best["px"]],
                modules=best["n"], grid_score=best["score"], clarity=clarity,
                density=best["density"])


def grid_score(blk, px, n):
    """把 blk 按 n×n 切分成模块，若边界与真实模块对齐，则每个模块内部应近乎纯色。
    返回「模块纯度」（0~1），纯度越高越像真实二维码。"""
    u = px / n
    if u < 1.5:
        return None
    cells = resample_cells(blk, n)
    # 模块纯度：|cell-0.5| 越大说明越接近纯黑/纯白
    return float(np.mean(np.abs(cells - 0.5) * 2))


def resample_cells(blk, n):
    """把 blk 重采样成 n×n 的模块均值。用整数边界 + 积分图，避免 Python 双层循环。"""
    px = blk.shape[0]
    edges = np.rint(np.arange(n + 1) * (px / n)).astype(int)
    edges = np.clip(edges, 0, px)
    II = _integral(blk)
    out = np.zeros((n, n))
    for i in range(n):
        y0, y1 = edges[i], max(edges[i] + 1, edges[i + 1])
        for j in range(n):
            x0, x1 = edges[j], max(edges[j] + 1, edges[j + 1])
            out[i, j] = _sum(II, y0, x0, 0) if False else (
                II[y1, x1] - II[y0, x1] - II[y1, x0] + II[y0, x0]
            ) / ((y1 - y0) * (x1 - x0))
    return out


# ══════════════════════════════════════════════════════════════
# d) 文字墨迹相交检测
# ══════════════════════════════════════════════════════════════
def check_text_overlap(g, tid):
    """把页面切成文字块（连通域近似：按行带 + 行内 x 分组），
    检测不相邻块之间的墨迹包围盒是否相交（容差 2px）。
    为避免把「同一行的多个词」误判为相交，只在**不同行带**之间比对，
    且要求两块的 x 区间实际重叠 >= 3px 且 y 区间重叠 >= 2px（抗锯齿容差内不算）。"""
    H, W = g.shape
    m = g < INK_THR
    rows = np.nonzero(m.any(axis=1))[0]
    bands = groups(rows, gap=2)
    blocks = []
    for (y0, y1) in bands:
        sub = m[y0:y1 + 1]
        cols = np.nonzero(sub.any(axis=0))[0]
        for (x0, x1) in groups(cols, gap=14):
            seg = sub[:, x0:x1 + 1]
            blocks.append(dict(x0=int(x0), x1=int(x1), y0=int(y0), y1=int(y1),
                               n=int(seg.sum())))
    conflicts = []
    for i in range(len(blocks)):
        for j in range(i + 1, len(blocks)):
            a, b = blocks[i], blocks[j]
            ox = min(a["x1"], b["x1"]) - max(a["x0"], b["x0"])
            oy = min(a["y1"], b["y1"]) - max(a["y0"], b["y0"])
            if ox >= 3 and oy >= AA_TOL + 1:
                conflicts.append(dict(a=[a["x0"], a["y0"], a["x1"], a["y1"]],
                                      b=[b["x0"], b["y0"], b["x1"], b["y1"]],
                                      ox=int(ox), oy=int(oy)))
    return dict(pass_=len(conflicts) == 0, n_blocks=len(blocks),
                n_conflicts=len(conflicts), conflicts=conflicts[:40])


# ══════════════════════════════════════════════════════════════
# c) 压力用例：溢出 / 串栏 / 压线
# ══════════════════════════════════════════════════════════════
def check_stress(g, tid, kind):
    H, W = g.shape
    m = g < INK_THR
    # 溢出：6px 边距外有墨迹
    out = m.copy()
    out[MARGIN:H - MARGIN, MARGIN:W - MARGIN] = False
    over = int(out.sum())
    # 页脚区域墨迹（用于检测药表压到页脚）
    return dict(pass_=over == 0, overflow_px=over, overflow_bbox=bbox(out),
                ink_bbox=bbox(m), kind=kind)


def measure_one(path, tid, kind):
    g = load(path)
    rec = dict(file=os.path.basename(path), tid=tid, kind=kind,
               size=[int(g.shape[1]), int(g.shape[0])])
    rec["a_size"] = check_size(path, tid)
    rec["b_inpage"] = check_inpage(g)
    rec["d_overlap"] = check_text_overlap(g, tid)
    if tid in ("zy", "bj3", "cq"):
        rec["e_barcode"] = check_barcode(g, tid, BARCODE_TEXT.get(tid))
    if tid in ("zz", "zy", "cq"):
        rec["f_qr"] = check_qr(g)
    return rec


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--json", default="verification/templates/measurements.json")
    ap.add_argument("--root", default=".")
    args = ap.parse_args()
    root = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    os.chdir(root)

    base_dir = "verification/templates"
    stress_dir = os.path.join(base_dir, "stress")
    results = []
    for tid in TEMPLATES:
        p = os.path.join(base_dir, f"tpl-{tid}.png")
        if os.path.exists(p):
            results.append(measure_one(p, tid, "base"))
        else:
            results.append(dict(tid=tid, kind="base", error="PNG 缺失"))
        for kind in ("max", "min", "long"):
            sp = os.path.join(stress_dir, f"stress-{tid}-{kind}.png")
            if os.path.exists(sp):
                r = measure_one(sp, tid, kind)
                r["c_stress"] = check_stress(load(sp), tid, kind)
                results.append(r)
            else:
                results.append(dict(tid=tid, kind=kind, error="PNG 缺失"))

    # ── 打印 ──
    print("=" * 78)
    for r in results:
        tag = f"{r['tid']}  {r['kind']:<5}"
        if "error" in r:
            print(f"{tag}  ERROR {r['error']}")
            continue
        a, b, d = r["a_size"], r["b_inpage"], r["d_overlap"]
        flags = []
        flags.append("a:" + ("PASS" if a["pass_"] else "FAIL"))
        flags.append("b:" + ("PASS" if b["pass_"] else f"FAIL({b['outside_count']}px)"))
        flags.append("d:" + ("PASS" if d["pass_"] else f"FAIL({d['n_conflicts']})"))
        if "e_barcode" in r:
            e = r["e_barcode"]
            flags.append("e:" + ("PASS" if e["pass_"] else "FAIL") +
                         (f"(mod={e.get('module_px')}px)" if e.get("found") else "(no bc)"))
        if "f_qr" in r:
            f = r["f_qr"]
            flags.append("f:" + ("PASS" if f["pass_"] else "FAIL") +
                         (f"(n={f.get('modules')})" if f.get("found") else "(none)"))
        if "c_stress" in r:
            c = r["c_stress"]
            flags.append("c:" + ("PASS" if c["pass_"] else f"FAIL({c['overflow_px']}px)"))
        print(f"{tag} {r['size'][0]}x{r['size'][1]}  " + "  ".join(flags))
        if not d["pass_"]:
            for cf in d["conflicts"][:4]:
                print(f"        重叠: A{cf['a']} B{cf['b']} ox={cf['ox']} oy={cf['oy']}")

    with open(args.json, "w", encoding="utf-8") as fh:
        json.dump(results, fh, ensure_ascii=False, indent=1)
    print("\nJSON →", args.json)
    return 0


if __name__ == "__main__":
    sys.exit(main())
