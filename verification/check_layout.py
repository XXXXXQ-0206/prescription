# -*- coding: utf-8 -*-
"""
verification/check_layout.py
独立版式验证：只测量渲染后的像素，不信任生成器代码。

用法（工作目录 = 仓库根）：
    python verification/check_layout.py
    python verification/check_layout.py --json verification/measurements.json
    python verification/check_layout.py --glob "studio/out/X*.png"

输出：每个 PNG 的 5 项检查（a..e）结果 PASS/FAIL + 数值证据。
依赖：PIL, numpy（环境中已存在，不新增依赖）

坐标全部使用「原图像素」（1672x941 @144dpi）。非 1672x941 的 PNG 会被标记为
OUT-OF-SPEC 并跳过几何检查（避免污染结论）。
"""
import argparse
import glob
import json
import os
import sys

import numpy as np
from PIL import Image

# ── 版式基准（原图像素）─────────────────────────────────────
PAGE_W, PAGE_H = 1672, 941
XL, XR, YT, YB = 20, 1657, 17, 925          # 纸张边缘线
RULE_TOP_Y = 262.09
RULE_TOP_X0, RULE_TOP_X1 = 106, 1539
RULE_MID_Y = 679.12
RULE_MID_X0, RULE_MID_X1 = 363.7, 1537
RULE_V1_X = 363.7
RULE_V1_Y1 = 873.0
RULE_V2_X = 616.46

DIAG_BOX = dict(x0=380, x1=614, y0=330, y1=645)     # 诊断栏内容区
DRUG_BOX = dict(x0=645, x1=1535, y0=330, y1=676)    # 药品栏内容区（到中横线上沿）
LEFT_COL = dict(x0=106, x1=363.7)                   # 左栏内容区

DIAG_LINE_PITCH = 29.3
DRUG_LINE_PITCH = 35.37
DRUG_BLOCK_PITCH = 70.74

# 判定阈值
INK_THR = 128          # 灰度 < 该值 = 墨迹（纸张底色 239-255，边缘阴影 ~120-160）
RULE_THR = 90          # 表格线（纯黑 <=10）
EDGE_POS_TOL = 3       # 边缘线位置容差
EDGE_CONT_TOL = 4      # 边缘线允许的最大连续缺口

# 纸张边缘线自身所占的列/行（不属于「正文墨迹」）
EDGE_BANDS_X = [(0, 24), (1651, PAGE_W - 1)]
EDGE_BANDS_Y = [(0, 21), (921, PAGE_H - 1)]


def load_gray(path):
    return np.asarray(Image.open(path).convert("L")).astype(np.int32)


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


def bbox_of(mask, x0=0, y0=0):
    if not mask.any():
        return None
    ys, xs = np.nonzero(mask)
    return dict(x0=int(xs.min()) + x0, x1=int(xs.max()) + x0,
                y0=int(ys.min()) + y0, y1=int(ys.max()) + y0,
                count=int(mask.sum()))


def body_mask(g):
    """正文墨迹 mask：暗像素，且**剔除纸张边缘线所在的窄带**。"""
    m = g < INK_THR
    for a, b in EDGE_BANDS_X:
        m[:, a:b + 1] = False
    for a, b in EDGE_BANDS_Y:
        m[a:b + 1, :] = False
    return m


def rules_mask(g):
    """表格线 mask（用于从文字墨迹中区分线条）。
    线的端点由版式基准给定，不依赖暗像素计数（文字会与线交错）。
    线宽 1pt = 2px，故取 [line-3, line+3] 的窄带，并只覆盖线本身的起止范围。"""
    m = np.zeros(g.shape, bool)
    # 横线：y 附近 ±3px，x 覆盖基准端点
    for y, xa, xb in ((RULE_TOP_Y, RULE_TOP_X0, RULE_TOP_X1),
                      (RULE_MID_Y, RULE_MID_X0, RULE_MID_X1)):
        yy0, yy1 = int(round(y)) - 3, int(round(y)) + 3
        m[max(0, yy0):yy1 + 1, int(xa) - 4:int(xb) + 5] = True
    # 竖线：x 附近 ±3px，y 覆盖基准端点
    for x, ya, yb in ((RULE_V1_X, RULE_TOP_Y, RULE_V1_Y1),
                      (RULE_V2_X, RULE_TOP_Y, RULE_MID_Y)):
        xx0, xx1 = int(round(x)) - 3, int(round(x)) + 3
        m[int(ya) - 4:int(yb) + 5, max(0, xx0):xx1 + 1] = True
    return m


def region_lines(mask, x0, x1, y0, y1, gap=3):
    """把区域内的墨迹按水平投影切成「行」。返回每行的 y 范围与 x 范围。"""
    sub = mask[y0:y1 + 1, x0:x1 + 1]
    rows = np.nonzero(sub.any(axis=1))[0]
    out = []
    for s, e in groups(rows, gap=gap):
        seg = sub[s:e + 1]
        xs = np.nonzero(seg.any(axis=0))[0]
        out.append(dict(y0=int(s) + y0, y1=int(e) + y0, cy=(s + e) / 2.0 + y0,
                        h=int(e - s + 1),
                        x0=int(xs.min()) + x0, x1=int(xs.max()) + x0))
    return out


def row_overlaps(lines):
    ov = []
    for a, b in zip(lines, lines[1:]):
        n = min(a["y1"], b["y1"]) - max(a["y0"], b["y0"]) + 1
        if n > 0:
            ov.append(dict(a=[a["y0"], a["y1"]], b=[b["y0"], b["y1"]], overlap_px=int(n)))
    return ov


# ══════════════════════════════════════════════════════════════
# 检查 a：纸张四边边缘线闭合
# ══════════════════════════════════════════════════════════════
def check_paper_frame(g):
    """边缘线是「渐变阴影带」，不是硬线：用与边平行的扫描线找亮度极小。
    位置 = 各扫描线极小的中位数；连续性 = 沿线是否存在长时间非暗段。"""
    H, W = g.shape
    rows = np.arange(YT + 10, YB - 10)
    cols = np.arange(XL + 10, XR - 10)

    lefts = np.array([8 + int(np.argmin(g[y, 8:33])) for y in rows])
    rights = np.array([1645 + int(np.argmin(g[y, 1645:1670])) for y in rows])
    tops = np.array([4 + int(np.argmin(g[4:33, x])) for x in cols])
    bots = np.array([912 + int(np.argmin(g[912:941, x])) for x in cols])

    res = {}
    for name, arr, expect in (("left", lefts, XL), ("right", rights, XR),
                              ("top", tops, YT), ("bottom", bots, YB)):
        # 用中位数稳健估计线位置；偏差只统计「偏离中位线的离群扫描线」
        med = int(np.median(arr))
        res[name] = dict(expect=int(expect), median=med, min_pos=int(arr.min()),
                         max_pos=int(arr.max()),
                         pos_dev=int(abs(med - expect)),
                         pos_ok=bool(abs(med - expect) <= EDGE_POS_TOL))

    def continuity(vals):
        v = vals.astype(float)
        med = float(np.median(v))
        bg = float(np.percentile(v, 95))
        if bg - med < 3:
            return 0, 0, True          # 阴影极浅，无法判定 -> 视为连续
        cutoff = med + (bg - med) * 0.5
        gaps = groups(np.nonzero(v > cutoff)[0], gap=0)
        mg = max((e - s + 1 for s, e in gaps), default=0)
        return int(mg), int((v > cutoff).sum()), bool(mg <= EDGE_CONT_TOL)

    lx, rx = int(np.median(lefts)), int(np.median(rights))
    ty, by = int(np.median(tops)), int(np.median(bots))
    spans = {
        "left": g[YT:YB + 1, lx], "right": g[YT:YB + 1, rx],
        "top": g[ty, XL:XR + 1], "bottom": g[by, XL:XR + 1],
    }
    for name, v in spans.items():
        mg, cnt, ok = continuity(v)
        res[name].update(max_gap=mg, gap_px=cnt, cont_ok=ok)

    # 角落：四条边应当在四角交汇（角附近存在边缘阴影）
    corners = {}
    for cn, (cx, cy) in (("tl", (lx, ty)), ("tr", (rx, ty)),
                         ("bl", (lx, by)), ("br", (rx, by))):
        patch = g[max(0, cy - 8):cy + 9, max(0, cx - 8):cx + 9]
        corners[cn] = int(patch.min())
    res["corners"] = corners

    ok = all(res[k]["pos_ok"] and res[k]["cont_ok"] for k in ("left", "right", "top", "bottom"))
    return dict(pass_=bool(ok), detail=res, line_pos=dict(left=lx, right=rx, top=ty, bottom=by))


# ══════════════════════════════════════════════════════════════
# 检查 b：诊断栏
# ══════════════════════════════════════════════════════════════
def check_diag(g, body):
    # 诊断栏：x ∈ [RULE_V1_X+2, RULE_V2_X-2]，排除两条竖线本身
    x0, x1 = int(RULE_V1_X) + 3, int(RULE_V2_X) - 3
    y0, y1 = 270, 675
    m = np.zeros(g.shape, bool)
    m[y0:y1 + 1, x0:x1 + 1] = True
    mm = body & m
    bb = bbox_of(mm)
    lines = region_lines(mm, x0, x1, y0, y1, gap=3)

    # 角色分类（基准）：「诊断：」表头 y≈284-303；正文行 y≈338 起，行距 29.3；
    # 「合计：」y≈641-660；y>676 的属于中横线/底部签章区，剔除
    lines = [l for l in lines if l["y1"] <= 672]
    header_lines = [l for l in lines if l["y1"] <= 315]
    total_lines = [l for l in lines if l["y0"] >= 625]
    text_lines = [l for l in lines if l["y0"] > 315 and l["y1"] < 625]

    pitches = [round(b["cy"] - a["cy"], 2) for a, b in zip(text_lines, text_lines[1:])]

    # 冲突：诊断文字墨迹压在左/中竖线上。
    # 竖线本身是黑线，必须先剔除线条像素；且只在「诊断栏的纵向范围」内统计，
    # 避免把页眉标题（x≈588-848）、底部签章区误判为压线。
    rules = rules_mask(g)
    txt = body & ~rules
    # 诊断栏纵向范围：顶横线 y=262.09 之下到中横线 y=679.12 之上
    ytop, ybot = int(RULE_TOP_Y) + 4, int(RULE_MID_Y) - 4
    def col_conflict(x):
        band = txt[ytop:ybot + 1, max(0, int(round(x)) - 5):int(round(x)) + 6]
        return int(band.sum())
    v1 = col_conflict(RULE_V1_X)
    v2 = col_conflict(RULE_V2_X)

    # 与「合计」冲突：诊断正文最后一行是否与「合计」行**垂直重叠**
    clash_total = 0
    if text_lines and total_lines:
        t = total_lines[0]
        last = text_lines[-1]
        clash_total = max(0, min(last["y1"], t["y1"]) - max(last["y0"], t["y0"]) + 1)
    # 诊断正文最后一行下沿与「合计」行上沿的间距
    gap_to_total = (total_lines[0]["y0"] - text_lines[-1]["y1"] - 1) if (text_lines and total_lines) else None

    # 正文包围盒（只含诊断正文行，不含表头/合计/竖线）
    text_bb = None
    if text_lines:
        text_bb = dict(x0=min(l["x0"] for l in text_lines), x1=max(l["x1"] for l in text_lines),
                       y0=min(l["y0"] for l in text_lines), y1=max(l["y1"] for l in text_lines))

    # 是否落在诊断栏内：左不压左竖线、右不压中竖线、上不越表头行、下不与「合计」重叠
    in_box = None
    if text_bb:
        tbl = total_lines[0]["y0"] if total_lines else DIAG_BOX["y1"]
        in_box = dict(
            left_ok=text_bb["x0"] >= int(RULE_V1_X) + 4,
            right_ok=text_bb["x1"] <= int(RULE_V2_X) - 4,
            top_ok=text_bb["y0"] >= 320,
            bottom_ok=text_bb["y1"] < tbl,
        )
    return dict(bbox=text_bb, region_bbox=bbox_of(mm),
                n_text_lines=len(text_lines), text_lines=text_lines,
                header_lines=header_lines, total_lines=total_lines, pitches=pitches,
                overlaps=row_overlaps(text_lines),
                v1_conflict_px=v1, v2_conflict_px=v2, clash_total_px=clash_total,
                gap_to_total=gap_to_total,
                in_box=in_box, box=dict(x0=x0, x1=x1, y0=y0, y1=y1))


# ══════════════════════════════════════════════════════════════
# 检查 c：药品栏
# ══════════════════════════════════════════════════════════════
def check_drug(g, body):
    x0, x1 = 620, 1650
    y0, y1 = 270, int(RULE_MID_Y) - 2      # 只看到中横线为止
    m = np.zeros(g.shape, bool)
    m[y0:y1 + 1, x0:x1 + 1] = True
    mm = body & m
    bb = bbox_of(mm)
    lines = region_lines(mm, x0, x1, y0, y1, gap=3)

    # 越中横线：药品栏最后一行文字的墨迹是否延伸到中横线 y=679.12 或更下。
    # 注意 y∈[697,925] 是「底部签章区」的合法内容，不计入。
    # 判定：取药品栏内 y <= 679 的所有药名/规格行，看最后一行 y1 是否 >= 679-2。
    # 另单独统计「紧贴中横线上下 3px 内」的非线条墨迹（真正的压线）。
    band = np.zeros(g.shape, bool)
    band[int(RULE_MID_Y) - 6:int(RULE_MID_Y) + 7, 620:1651] = True
    rules = rules_mask(g)
    mb = body & band & ~rules
    over = int(mb.sum())
    over_bb = bbox_of(mb)

    # 药名行（字号 27）与规格行（字号 24.5）交替：按 h 粗分
    last_y1 = max((l["y1"] for l in lines), default=None)
    # 药品正文行（排除右上角表头 y<320）
    drug_lines = [l for l in lines if l["y0"] >= 320]
    drug_bb = None
    if drug_lines:
        drug_bb = dict(x0=min(l["x0"] for l in drug_lines), x1=max(l["x1"] for l in drug_lines),
                       y0=min(l["y0"] for l in drug_lines), y1=max(l["y1"] for l in drug_lines))
    in_box = None
    if drug_bb:
        in_box = dict(
            left_ok=drug_bb["x0"] >= DRUG_BOX["x0"] - 4,
            right_ok=drug_bb["x1"] <= DRUG_BOX["x1"] + 18,
            top_ok=drug_bb["y0"] >= 320,
            bottom_ok=drug_bb["y1"] < RULE_MID_Y,
        )
    return dict(bbox=drug_bb, region_bbox=bb, lines=drug_lines, all_lines=lines,
                n_lines=len(drug_lines), last_y1=last_y1,
                over_mid_px=over, over_mid_bbox=over_bb,
                crosses_mid=(drug_bb is not None and drug_bb["y1"] >= RULE_MID_Y - 2),
                overlaps=row_overlaps(drug_lines), in_box=in_box,
                box=dict(x0=x0, x1=x1, y0=y0, y1=y1))


# ══════════════════════════════════════════════════════════════
# 检查 d：墨迹越过纸张边界
# ══════════════════════════════════════════════════════════════
def check_overflow(g, body):
    """正文墨迹（已剔除边缘线窄带）出现在安全区之外即越界。
    安全区 = 纸张边缘线内侧：[XL+3, XR-3] x [YT+3, YB-3]。"""
    safe = np.zeros(g.shape, bool)
    safe[YT + 3:YB - 2, XL + 3:XR - 2] = True
    out_mask = body & ~safe
    n = int(out_mask.sum())
    return dict(count=n, bbox=bbox_of(out_mask), safe=[XL + 3, XR - 2, YT + 3, YB - 2])


# ══════════════════════════════════════════════════════════════
# 检查 e：相邻文字行垂直重叠
# ══════════════════════════════════════════════════════════════
# ══════════════════════════════════════════════════════════════
# 检查 f：左栏文字越界（左栏 x∈[106, 363.7]）
# ══════════════════════════════════════════════════════════════
LEFT_COL_X0, LEFT_COL_X1 = XL, RULE_V1_X      # 允许范围：纸张左边缘线内侧 ~ 左竖线
HOSP_NAME_Y = (283, 308)                       # 左栏医院名所在行


def check_left_column(g, body):
    """左栏（医院名/卡号/序号/科别/有效期等）的文字墨迹必须落在
    纸张左边缘线之内、且不越过左竖线 x=363.7。"""
    # 左栏区域：y ∈ (顶横线, 中横线)，x ∈ [XL-2, RULE_V1_X+60]（右边界留出越界检测空间）
    x0, x1 = XL - 2, 613
    y0, y1 = int(RULE_TOP_Y) + 4, int(RULE_MID_Y) - 4
    m = np.zeros(g.shape, bool)
    m[y0:y1 + 1, x0:x1 + 1] = True
    mm = body & m
    bb = bbox_of(mm)

    # 医院名行：定位越界（这是已确认的 BUG-1）
    # 注意：左竖线本身(fill black, x≈363..364)也落在该行带内，必须先剔除，
    # 否则会把线条像素误当作医院名的右端，虚报越界。
    hy0, hy1 = HOSP_NAME_Y
    hb = body[hy0:hy1 + 1, :].copy()
    rules = rules_mask(g)
    hb = hb & ~rules[hy0:hy1 + 1, :]
    cols_ink = np.nonzero(hb[:, :int(RULE_V1_X) + 40].any(axis=0))[0]
    # 医院名 glyph run：从左栏内第一个墨迹列起，容忍字间距分组
    runs = []
    if len(cols_ink):
        s = p = int(cols_ink[0])
        for v in cols_ink[1:]:
            v = int(v)
            if v - p > 12:
                runs.append((s, p))
                s = v
            p = v
        runs.append((s, p))
    name_run = runs[0] if runs else None

    # 越左竖线的墨迹（诊断栏之前的 x 带 [RULE_V1_X-4, RULE_V1_X+40]）
    cross_v1 = 0
    if name_run:
        cross_v1 = max(0, name_run[1] - int(RULE_V1_X))

    # 距离纸张左边缘的余量
    left_margin = (name_run[0] - XL) if name_run else None

    over_left_rule = bool(cross_v1 > 4)
    return dict(bbox=bb, name_run=name_run, name_span_width=(name_run[1] - name_run[0] + 1) if name_run else None,
                cross_v1_px=int(cross_v1), left_margin_px=left_margin,
                over_left_rule=over_left_rule,
                col_ok=bool(name_run and name_run[0] >= XL + 4),
                pass_=not over_left_rule and bool(name_run and name_run[0] >= XL + 4))


def check_line_overlap(g, body, kind):
    if kind == "diag":
        x0, x1, y0, y1 = int(RULE_V1_X) + 3, int(RULE_V2_X) - 3, 300, 670
    else:
        x0, x1, y0, y1 = 620, 1650, 270, int(RULE_MID_Y) - 2
    m = np.zeros(g.shape, bool)
    m[y0:y1 + 1, x0:x1 + 1] = True
    mm = body & m
    lines = region_lines(mm, x0, x1, y0, y1, gap=3)
    gaps = [b["y0"] - a["y1"] - 1 for a, b in zip(lines, lines[1:])]
    ov = row_overlaps(lines)
    return dict(lines=lines, overlaps=ov, n_lines=len(lines),
                min_gap=(min(gaps) if gaps else None), gaps=gaps, pass_=len(ov) == 0)


def measure(path):
    g = load_gray(path)
    base = os.path.basename(path)
    H, W = g.shape
    rec = dict(file=base, path=path.replace("\\", "/"), size=[int(W), int(H)],
               in_spec=bool(W == PAGE_W and H == PAGE_H))
    if not rec["in_spec"]:
        rec["note"] = f"OUT-OF-SPEC 尺寸 {W}x{H}，非 {PAGE_W}x{PAGE_H}，跳过几何检查"
        return rec
    body = body_mask(g)
    rec["ink_total"] = int(body.sum())
    rec["a_frame"] = check_paper_frame(g)
    rec["b_diag"] = check_diag(g, body)
    rec["c_drug"] = check_drug(g, body)
    rec["d_overflow"] = check_overflow(g, body)
    rec["f_left_column"] = check_left_column(g, body)
    rec["e_diag_overlap"] = check_line_overlap(g, body, "diag")
    rec["e_drug_overlap"] = check_line_overlap(g, body, "drug")
    return rec


def verdicts(r):
    """把测量结果归纳成 a..e 的 PASS/FAIL。"""
    if not r.get("in_spec"):
        return {}
    v = {}
    v["a"] = r["a_frame"]["pass_"]
    b = r["b_diag"]
    v["b"] = bool(b["in_box"] and all(b["in_box"].values())
                  and b["v1_conflict_px"] == 0 and b["v2_conflict_px"] == 0
                  and not b["overlaps"])
    c = r["c_drug"]
    v["c"] = bool(c["in_box"] and all(c["in_box"].values())
                  and not c["crosses_mid"] and not c["overlaps"])
    v["d"] = r["d_overflow"]["count"] == 0
    v["e"] = bool(r["e_diag_overlap"]["pass_"] and r["e_drug_overlap"]["pass_"])
    v["f"] = r["f_left_column"]["pass_"]
    return v


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--json", default=None)
    ap.add_argument("--glob", default="studio/out/*.png")
    args = ap.parse_args()

    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    os.chdir(root)
    files = sorted(f for f in glob.glob(args.glob)
                   if "_crop" not in os.path.basename(f) and "/_" not in f.replace("\\", "/"))
    if not files:
        print("no PNG found for", args.glob)
        return 2

    results = []
    for f in files:
        try:
            results.append(measure(f))
        except Exception as e:
            import traceback
            traceback.print_exc()
            results.append(dict(file=os.path.basename(f), error=str(e)))

    summary = []
    for r in results:
        print("=" * 76)
        if "error" in r:
            print(f"{r['file']}: ERROR {r['error']}")
            continue
        if not r["in_spec"]:
            print(f"{r['file']}: {r['note']}")
            continue
        v = verdicts(r)
        print(f"### {r['file']}  {r['size'][0]}x{r['size'][1]}   正文墨迹 {r['ink_total']}")
        f_ = r["a_frame"]
        print(f"  [a] 纸张四边闭合  {'PASS' if v['a'] else 'FAIL'}")
        for k in ("left", "right", "top", "bottom"):
            d = f_["detail"][k]
            print(f"        {k:6s} 线位={d['median']:5d}(期望{d['expect']:5d} 偏差{d['pos_dev']}px)"
                  f" {'OK ' if d['pos_ok'] else 'BAD'} | 最大缺口={d['max_gap']}px"
                  f" {'连续' if d['cont_ok'] else '断裂'}")
        print(f"        四角最小灰度={f_['detail']['corners']}")
        b = r["b_diag"]
        print(f"  [b] 诊断栏        {'PASS' if v['b'] else 'FAIL'}"
              f"  包围盒 x[{b['bbox']['x0']},{b['bbox']['x1']}] y[{b['bbox']['y0']},{b['bbox']['y1']}]"
              f"  正文行数={b['n_text_lines']}")
        print(f"        行距={b['pitches']}  行重叠={b['overlaps']}")
        print(f"        压左竖线={b['v1_conflict_px']}px 压中竖线={b['v2_conflict_px']}px"
              f" 与合计重叠={b['clash_total_px']}px  盒内={b['in_box']}")
        c = r["c_drug"]
        print(f"  [c] 药品栏        {'PASS' if v['c'] else 'FAIL'}"
              f"  包围盒 x[{c['bbox']['x0']},{c['bbox']['x1']}] y[{c['bbox']['y0']},{c['bbox']['y1']}]"
              f"  行数={c['n_lines']} 末行y1={c['last_y1']}")
        print(f"        末行越中横线={c['crosses_mid']} 压线墨迹={c['over_mid_px']}px"
              f" bbox={c['over_mid_bbox']} 盒内={c['in_box']}")
        o = r["d_overflow"]
        print(f"  [d] 越出纸张      {'PASS' if v['d'] else 'FAIL'}"
              f"  安全区外墨迹={o['count']}px bbox={o['bbox']}")
        e1, e2 = r["e_diag_overlap"], r["e_drug_overlap"]
        print(f"  [e] 行重叠        {'PASS' if v['e'] else 'FAIL'}"
              f"  诊断行数={e1['n_lines']} 最小行间隔={e1['min_gap']} 重叠={e1['overlaps']}"
              f" | 药品行数={e2['n_lines']} 重叠={e2['overlaps']}")
        fl = r["f_left_column"]
        print(f"  [f] 左栏越界      {'PASS' if v['f'] else 'FAIL'}"
              f"  医院名墨迹 x[{fl['name_run'][0] if fl['name_run'] else '?'},"
              f"{fl['name_run'][1] if fl['name_run'] else '?'}]"
              f" 宽={fl['name_span_width']} 越左竖线={fl['cross_v1_px']}px"
              f" 距纸左边={fl['left_margin_px']}px")
        summary.append(dict(file=r["file"], **{k: "PASS" if x else "FAIL" for k, x in v.items()}))

    print("=" * 76)
    print("\n汇总（a=纸张闭合 b=诊断栏 c=药品栏 d=越界 e=行重叠 f=左栏越界）")
    print(f"{'file':<18}{'a':<6}{'b':<6}{'c':<6}{'d':<6}{'e':<6}{'f':<6}")
    for s in summary:
        print(f"{s['file']:<18}{s['a']:<6}{s['b']:<6}{s['c']:<6}{s['d']:<6}{s['e']:<6}{s['f']:<6}")

    if args.json:
        with open(args.json, "w", encoding="utf-8") as fh:
            json.dump(dict(results=results, summary=summary), fh, ensure_ascii=False, indent=1)
        print(f"\nJSON → {args.json}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
