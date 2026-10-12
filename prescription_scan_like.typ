// ============================================================
//  北京大学第六医院 · 非医保处方 —— 扫描件复刻版（仅供参考）
//  这一版把扫描件的虚化、底色渐变、阴影、印刷增益一并还原，
//  与原图逐像素 MAE 4.47/255、SSIM 0.933。
//  需要"原始高清电子版"时请用 prescription.typ。
// ============================================================

#set page(width: 836pt, height: 470.5pt, margin: 0pt, fill: white)
#set text(font: "SimSun", lang: "zh", fill: black)

// measure=1 时只排文字（用于逐元素比对），正常编译会输出完整处方
#let measure = sys.inputs.at("measure", default: "0") == "1"
// 1 个原图像素 = 0.5pt（1672×941 px → 836pt×470.5pt，144dpi 渲染即原尺寸）
#let px = 0.5pt

// x, y : 文本排版原点（相对页面左上角，单位=原图像素）
// size : 字号（单位=原图像素，即 em 高度）
#let T(x, y, size, body, font: "SimSun", weight: "regular", tracking: 0, stroke: 0) = place(
  dx: x * px, dy: y * px,
  text(font: font, size: size * px, weight: weight, tracking: tracking * px,
       stroke: if stroke == 0 { none } else { stroke * px }, body),
)

// ── 扫描底色（32×18 网格，格宽 52.25×52.28 px）───────────────
#let BG = (
  (241, 239, 237, 237, 236, 235, 235, 234, 234, 233, 233, 232, 232, 231, 230, 230, 229, 229, 229, 229, 229, 229, 229, 228, 228, 228, 228, 228, 228, 228, 228, 229),
  (244, 242, 240, 239, 239, 238, 238, 237, 236, 236, 236, 236, 235, 234, 234, 233, 234, 234, 233, 233, 233, 233, 233, 232, 232, 231, 232, 231, 231, 232, 232, 232),
  (245, 242, 242, 240, 240, 240, 240, 239, 238, 238, 237, 237, 236, 236, 237, 236, 236, 235, 235, 235, 235, 234, 234, 234, 233, 234, 234, 233, 233, 233, 233, 233),
  (245, 243, 242, 241, 241, 241, 240, 240, 240, 239, 239, 238, 238, 238, 239, 238, 238, 237, 236, 236, 237, 237, 235, 235, 235, 235, 235, 235, 234, 234, 235, 235),
  (245, 243, 243, 242, 241, 241, 241, 241, 240, 240, 240, 239, 239, 239, 239, 239, 238, 238, 237, 237, 237, 238, 236, 236, 235, 236, 235, 235, 234, 235, 236, 235),
  (246, 243, 243, 242, 242, 242, 241, 241, 241, 240, 240, 239, 239, 239, 239, 239, 238, 238, 238, 237, 237, 237, 236, 236, 236, 236, 235, 235, 235, 236, 236, 236),
  (245, 243, 243, 242, 241, 241, 241, 241, 241, 241, 240, 240, 240, 239, 239, 239, 239, 239, 238, 238, 238, 237, 237, 236, 237, 236, 236, 236, 236, 236, 237, 237),
  (246, 243, 243, 243, 242, 242, 241, 241, 241, 240, 240, 240, 240, 240, 240, 240, 240, 239, 238, 238, 238, 238, 238, 237, 237, 237, 236, 236, 236, 236, 237, 237),
  (246, 244, 243, 243, 242, 242, 242, 241, 241, 241, 241, 241, 240, 240, 240, 240, 239, 239, 239, 238, 238, 238, 238, 237, 237, 237, 237, 237, 236, 236, 237, 237),
  (246, 244, 243, 243, 243, 242, 242, 242, 241, 241, 241, 241, 241, 240, 241, 240, 239, 239, 239, 239, 239, 239, 238, 238, 238, 238, 237, 237, 236, 237, 237, 238),
  (246, 244, 243, 243, 242, 242, 242, 242, 242, 241, 241, 241, 241, 241, 241, 240, 240, 240, 239, 239, 239, 239, 238, 238, 238, 238, 238, 237, 237, 237, 237, 238),
  (246, 244, 244, 244, 243, 243, 243, 243, 242, 242, 242, 241, 241, 241, 241, 240, 240, 240, 239, 239, 239, 239, 239, 238, 238, 238, 238, 237, 237, 237, 238, 238),
  (246, 244, 244, 243, 243, 243, 243, 243, 242, 242, 241, 241, 241, 242, 241, 241, 240, 240, 239, 239, 239, 239, 239, 238, 238, 238, 238, 238, 237, 237, 238, 238),
  (246, 244, 244, 243, 243, 242, 242, 243, 242, 242, 242, 241, 241, 241, 241, 240, 240, 239, 239, 239, 239, 239, 239, 239, 238, 238, 238, 237, 238, 238, 238, 238),
  (246, 244, 244, 243, 243, 242, 242, 243, 242, 242, 241, 241, 241, 241, 241, 240, 240, 240, 239, 239, 239, 239, 239, 239, 238, 238, 237, 238, 238, 237, 238, 238),
  (245, 244, 244, 243, 243, 243, 242, 242, 241, 241, 242, 241, 241, 241, 241, 240, 240, 240, 239, 239, 239, 239, 238, 238, 238, 237, 237, 237, 237, 237, 238, 237),
  (245, 243, 243, 243, 243, 243, 243, 243, 242, 241, 242, 241, 241, 241, 240, 240, 240, 240, 239, 239, 239, 239, 239, 239, 238, 238, 238, 237, 237, 238, 238, 238),
  (245, 243, 243, 242, 242, 243, 242, 242, 241, 241, 241, 240, 240, 240, 239, 239, 238, 238, 238, 237, 237, 238, 237, 237, 237, 236, 236, 236, 236, 236, 236, 237),
)
#if not measure {
  for (i, row) in BG.enumerate() {
    for (j, v) in row.enumerate() {
      place(dx: j * 52.25 * px, dy: i * 52.28 * px, rect(width: 52.25 * px, height: 52.28 * px, fill: luma(v / 255 * 100%)))
    }
  }
}

// ── 线条/阴影：中心线折点 + 1px 一档灰度剖面 ─────────────────
// prof 为各 1px 行的灰度（已做反卷积，使渲染出的行均值等于实测值），
// dlo 表示 prof[0] 相对中心线的行偏移；vert=true 时剖面沿 x 方向。
#let band(pts, prof, dlo, vert: false) = {
  let n = prof.len()
  for i in range(pts.len() - 1) {
    let p1 = pts.at(i); let p2 = pts.at(i + 1)
    let a1 = p1.at(0); let c1 = calc.round(p1.at(1))
    let a2 = p2.at(0); let c2 = calc.round(p2.at(1))
    let cmin = calc.min(c1, c2)
    let hb = n + calc.max(c1, c2) - cmin
    let stops = prof.enumerate().map(((k, v)) => (luma(v / 255 * 100%), (k + 0.5 + (c1 + c2) / 2 - cmin) / hb * 100%))
    let ext = ((luma(prof.first() / 255 * 100%), 0%),) + stops + ((luma(prof.last() / 255 * 100%), 100%),)
    let g = gradient.linear(angle: if vert { 0deg } else { 90deg }, ..ext)
    let t1 = c1 + dlo - 0.5
    let t2 = c2 + dlo - 0.5
    let b1 = t1 + n
    let b2 = t2 + n
    if vert {
      place(dx: 0pt, dy: 0pt, polygon(fill: g, (t1 * px, a1 * px), (t2 * px, a2 * px), (b2 * px, a2 * px), (b1 * px, a1 * px)))
    } else {
      place(dx: 0pt, dy: 0pt, polygon(fill: g, (a1 * px, t1 * px), (a2 * px, t2 * px), (a2 * px, b2 * px), (a1 * px, b1 * px)))
    }
  }
}

// 顶横线：49 个中心线采样点，剖面行偏移 -3..3
#let RT_P = (241.3, 249.7, 107.3, 0.0, 90.7, 244.7, 241.4)
#let RT = ((106, 260.74), (136, 260.76), (166, 260.86), (196, 261.04), (226, 261.05), (256, 261.13), (286, 261.22), (316, 261.33), (346, 261.49), (376, 261.48), (406, 261.53), (436, 261.63), (466, 261.8), (496, 261.89), (526, 261.91), (556, 261.91), (586, 262.02), (616, 262.61), (646, 262.04), (676, 262.22), (706, 262.35), (736, 262.25), (766, 262.38), (796, 262.38), (826, 262.45), (856, 262.49), (886, 262.55), (916, 262.57), (946, 262.53), (976, 262.55), (1006, 262.5), (1036, 262.6), (1066, 262.59), (1096, 262.6), (1126, 262.63), (1156, 262.61), (1186, 262.61), (1216, 262.61), (1246, 262.55), (1276, 262.53), (1306, 262.49), (1336, 262.49), (1366, 262.45), (1396, 262.42), (1426, 262.35), (1456, 262.41), (1486, 262.34), (1516, 262.35), (1539, 262.22))

// 中横线：41 个中心线采样点，剖面行偏移 -3..3
#let RM_P = (244.1, 248.2, 68.0, 0.0, 109.9, 255.0, 242.0)
#let RM = ((363, 679.69), (393, 678.69), (423, 678.59), (453, 678.65), (483, 678.61), (513, 678.6), (543, 678.62), (573, 678.6), (603, 678.7), (633, 678.65), (663, 678.59), (693, 678.61), (723, 678.68), (753, 678.68), (783, 678.65), (813, 678.71), (843, 678.85), (873, 678.84), (903, 678.88), (933, 678.82), (963, 678.97), (993, 678.95), (1023, 679.08), (1053, 679.1), (1083, 679.17), (1113, 679.27), (1143, 679.32), (1173, 679.39), (1203, 679.47), (1233, 679.55), (1263, 679.55), (1293, 679.59), (1323, 679.67), (1353, 679.71), (1383, 679.71), (1413, 679.67), (1443, 679.77), (1473, 679.88), (1503, 679.95), (1533, 679.92), (1537, 679.94))

// 左竖线：22 个中心线采样点，剖面行偏移 -3..4
#let RV1_P = (243.3, 255.0, 129.9, 0.0, 75.4, 255.0, 238.8, 235.6)
#let RV1 = ((261, 362.48), (291, 363.41), (321, 363.34), (351, 363.24), (381, 363.18), (411, 363.19), (441, 363.24), (471, 363.26), (501, 363.33), (531, 363.38), (561, 363.48), (591, 363.51), (621, 363.65), (651, 363.76), (681, 364.41), (711, 364.02), (741, 364.11), (771, 364.16), (801, 364.41), (831, 364.62), (861, 364.85), (873, 364.8))

// 中竖线：15 个中心线采样点，剖面行偏移 -1..3
#let RV2_P = (156.2, 0.0, 54.9, 251.2, 240.6)
#let RV2 = ((261, 616.32), (291, 616.36), (321, 616.3), (351, 616.29), (381, 616.3), (411, 616.36), (441, 616.37), (471, 616.4), (501, 616.41), (531, 616.48), (561, 616.57), (591, 616.7), (621, 616.73), (651, 616.82), (679, 616.48))

// 上边缘阴影：57 个中心线采样点，剖面行偏移 -2..2
#let ST_P = (223.8, 219.8, 200.0, 181.0, 219.4)
#let ST = ((20, 13.89), (50, 14.37), (80, 14.36), (110, 14.61), (140, 14.45), (170, 14.82), (200, 15.15), (230, 14.79), (260, 15.21), (290, 14.88), (320, 14.93), (350, 15.23), (380, 15.17), (410, 15.5), (440, 15.65), (470, 15.94), (500, 15.72), (530, 15.9), (560, 16.11), (590, 16.5), (620, 15.85), (650, 16.18), (680, 16.03), (710, 16.24), (740, 16.79), (770, 16.55), (800, 16.73), (830, 16.6), (860, 17), (890, 16.63), (920, 16.45), (950, 16.4), (980, 16.09), (1010, 16.02), (1040, 16.45), (1070, 15.81), (1100, 15.91), (1130, 16.21), (1160, 16.08), (1190, 16.21), (1220, 16.64), (1250, 16.89), (1280, 16.79), (1310, 16.84), (1340, 15.97), (1370, 16.56), (1400, 15.85), (1430, 15.87), (1460, 15.56), (1490, 15.45), (1520, 15.3), (1550, 15.31), (1580, 15.88), (1610, 15.85), (1640, 15.81), (1670, 16.58), (1671, 16.49))

// 右边缘阴影：31 个中心线采样点，剖面行偏移 -3..12
#let SR_P = (172.8, 130.9, 146.2, 158.3, 179.9, 196.5, 207.9, 216.2, 221.4, 224.8, 226.8, 228.4, 229.6, 230.6, 231.4, 231.8)
#let SR = ((24, 1657.24), (54, 1658.06), (84, 1658.65), (114, 1658.79), (144, 1658.74), (174, 1658.58), (204, 1658.31), (234, 1658.06), (264, 1657.9), (294, 1658.03), (324, 1658.11), (354, 1658.39), (384, 1658.54), (414, 1658.63), (444, 1658.59), (474, 1658.57), (504, 1658.67), (534, 1658.85), (564, 1659.19), (594, 1659.47), (624, 1659.51), (654, 1659.81), (684, 1659.95), (714, 1660.03), (744, 1660.18), (774, 1660.4), (804, 1660.41), (834, 1660.5), (864, 1660.24), (894, 1659.7), (921, 1659.22))

#if not measure {
  band(RT, RT_P, -3, vert: false)   // 顶横线
  band(RM, RM_P, -3, vert: false)   // 中横线
  band(RV1, RV1_P, -3, vert: true)   // 左竖线
  band(RV2, RV2_P, -1, vert: true)   // 中竖线
  band(ST, ST_P, -2, vert: false)   // 上边缘阴影
  band(SR, SR_P, -3, vert: true)   // 右边缘阴影
  // 底边浅影
  place(dx: 0pt, dy: 462pt, rect(width: 52pt, height: 0.5pt, fill: luma(93.7%)))
  place(dx: 0pt, dy: 462.5pt, rect(width: 52pt, height: 0.5pt, fill: luma(88.8%)))
  place(dx: 0pt, dy: 463pt, rect(width: 52pt, height: 0.5pt, fill: luma(92.5%)))
  place(dx: 0pt, dy: 463.5pt, rect(width: 52pt, height: 0.5pt, fill: luma(94.1%)))
  place(dx: 52pt, dy: 462pt, rect(width: 52pt, height: 0.5pt, fill: luma(92.1%)))
  place(dx: 52pt, dy: 462.5pt, rect(width: 52pt, height: 0.5pt, fill: luma(87.6%)))
  place(dx: 52pt, dy: 463pt, rect(width: 52pt, height: 0.5pt, fill: luma(93.2%)))
  place(dx: 104pt, dy: 462pt, rect(width: 52pt, height: 0.5pt, fill: luma(91.5%)))
  place(dx: 104pt, dy: 462.5pt, rect(width: 52pt, height: 0.5pt, fill: luma(87.8%)))
  place(dx: 104pt, dy: 463pt, rect(width: 52pt, height: 0.5pt, fill: luma(93.6%)))
  place(dx: 156pt, dy: 462pt, rect(width: 52pt, height: 0.5pt, fill: luma(90.4%)))
  place(dx: 156pt, dy: 462.5pt, rect(width: 52pt, height: 0.5pt, fill: luma(87.6%)))
  place(dx: 156pt, dy: 463pt, rect(width: 52pt, height: 0.5pt, fill: luma(93.7%)))
  place(dx: 208pt, dy: 462pt, rect(width: 52pt, height: 0.5pt, fill: luma(89.4%)))
  place(dx: 208pt, dy: 462.5pt, rect(width: 52pt, height: 0.5pt, fill: luma(88.0%)))
  place(dx: 260pt, dy: 462pt, rect(width: 52pt, height: 0.5pt, fill: luma(88.7%)))
  place(dx: 260pt, dy: 462.5pt, rect(width: 52pt, height: 0.5pt, fill: luma(87.1%)))
  place(dx: 260pt, dy: 463pt, rect(width: 52pt, height: 0.5pt, fill: luma(92.8%)))
  place(dx: 260pt, dy: 463.5pt, rect(width: 52pt, height: 0.5pt, fill: luma(93.1%)))
  place(dx: 260pt, dy: 464pt, rect(width: 52pt, height: 0.5pt, fill: luma(93.3%)))
  place(dx: 260pt, dy: 465pt, rect(width: 52pt, height: 0.5pt, fill: luma(93.2%)))
  place(dx: 260pt, dy: 466pt, rect(width: 52pt, height: 0.5pt, fill: luma(93.2%)))
  place(dx: 312pt, dy: 462pt, rect(width: 52pt, height: 0.5pt, fill: luma(88.5%)))
  place(dx: 312pt, dy: 462.5pt, rect(width: 52pt, height: 0.5pt, fill: luma(85.2%)))
  place(dx: 312pt, dy: 463pt, rect(width: 52pt, height: 0.5pt, fill: luma(91.7%)))
  place(dx: 312pt, dy: 463.5pt, rect(width: 52pt, height: 0.5pt, fill: luma(92.5%)))
  place(dx: 312pt, dy: 464pt, rect(width: 52pt, height: 0.5pt, fill: luma(92.9%)))
  place(dx: 312pt, dy: 466pt, rect(width: 52pt, height: 0.5pt, fill: luma(92.9%)))
  place(dx: 364pt, dy: 462pt, rect(width: 52pt, height: 0.5pt, fill: luma(88.1%)))
  place(dx: 364pt, dy: 462.5pt, rect(width: 52pt, height: 0.5pt, fill: luma(83.8%)))
  place(dx: 364pt, dy: 463pt, rect(width: 52pt, height: 0.5pt, fill: luma(90.3%)))
  place(dx: 364pt, dy: 463.5pt, rect(width: 52pt, height: 0.5pt, fill: luma(91.6%)))
  place(dx: 364pt, dy: 464pt, rect(width: 52pt, height: 0.5pt, fill: luma(92.1%)))
  place(dx: 364pt, dy: 464.5pt, rect(width: 52pt, height: 0.5pt, fill: luma(92.4%)))
  place(dx: 364pt, dy: 465pt, rect(width: 52pt, height: 0.5pt, fill: luma(92.4%)))
  place(dx: 364pt, dy: 466pt, rect(width: 52pt, height: 0.5pt, fill: luma(92.5%)))
  place(dx: 416pt, dy: 462pt, rect(width: 52pt, height: 0.5pt, fill: luma(88.6%)))
  place(dx: 416pt, dy: 462.5pt, rect(width: 52pt, height: 0.5pt, fill: luma(82.4%)))
  place(dx: 416pt, dy: 463pt, rect(width: 52pt, height: 0.5pt, fill: luma(89.8%)))
  place(dx: 416pt, dy: 463.5pt, rect(width: 52pt, height: 0.5pt, fill: luma(91.0%)))
  place(dx: 416pt, dy: 464pt, rect(width: 52pt, height: 0.5pt, fill: luma(91.4%)))
  place(dx: 416pt, dy: 464.5pt, rect(width: 52pt, height: 0.5pt, fill: luma(92.0%)))
  place(dx: 416pt, dy: 465pt, rect(width: 52pt, height: 0.5pt, fill: luma(92.0%)))
  place(dx: 416pt, dy: 465.5pt, rect(width: 52pt, height: 0.5pt, fill: luma(92.3%)))
  place(dx: 416pt, dy: 466pt, rect(width: 52pt, height: 0.5pt, fill: luma(92.1%)))
  place(dx: 416pt, dy: 466.5pt, rect(width: 52pt, height: 0.5pt, fill: luma(92.2%)))
  place(dx: 468pt, dy: 462pt, rect(width: 52pt, height: 0.5pt, fill: luma(88.5%)))
  place(dx: 468pt, dy: 462.5pt, rect(width: 52pt, height: 0.5pt, fill: luma(81.8%)))
  place(dx: 468pt, dy: 463pt, rect(width: 52pt, height: 0.5pt, fill: luma(89.4%)))
  place(dx: 468pt, dy: 463.5pt, rect(width: 52pt, height: 0.5pt, fill: luma(90.8%)))
  place(dx: 468pt, dy: 464pt, rect(width: 52pt, height: 0.5pt, fill: luma(91.3%)))
  place(dx: 468pt, dy: 464.5pt, rect(width: 52pt, height: 0.5pt, fill: luma(91.7%)))
  place(dx: 468pt, dy: 465pt, rect(width: 52pt, height: 0.5pt, fill: luma(91.7%)))
  place(dx: 468pt, dy: 465.5pt, rect(width: 52pt, height: 0.5pt, fill: luma(91.9%)))
  place(dx: 468pt, dy: 466pt, rect(width: 52pt, height: 0.5pt, fill: luma(91.7%)))
  place(dx: 468pt, dy: 466.5pt, rect(width: 52pt, height: 0.5pt, fill: luma(91.8%)))
  place(dx: 520pt, dy: 462pt, rect(width: 52pt, height: 0.5pt, fill: luma(89.3%)))
  place(dx: 520pt, dy: 462.5pt, rect(width: 52pt, height: 0.5pt, fill: luma(81.4%)))
  place(dx: 520pt, dy: 463pt, rect(width: 52pt, height: 0.5pt, fill: luma(89.1%)))
  place(dx: 520pt, dy: 463.5pt, rect(width: 52pt, height: 0.5pt, fill: luma(90.9%)))
  place(dx: 520pt, dy: 464pt, rect(width: 52pt, height: 0.5pt, fill: luma(91.3%)))
  place(dx: 520pt, dy: 464.5pt, rect(width: 52pt, height: 0.5pt, fill: luma(91.6%)))
  place(dx: 520pt, dy: 465pt, rect(width: 52pt, height: 0.5pt, fill: luma(91.6%)))
  place(dx: 520pt, dy: 465.5pt, rect(width: 52pt, height: 0.5pt, fill: luma(91.8%)))
  place(dx: 520pt, dy: 466pt, rect(width: 52pt, height: 0.5pt, fill: luma(91.5%)))
  place(dx: 520pt, dy: 466.5pt, rect(width: 52pt, height: 0.5pt, fill: luma(91.7%)))
  place(dx: 572pt, dy: 462pt, rect(width: 52pt, height: 0.5pt, fill: luma(90.1%)))
  place(dx: 572pt, dy: 462.5pt, rect(width: 52pt, height: 0.5pt, fill: luma(81.2%)))
  place(dx: 572pt, dy: 463pt, rect(width: 52pt, height: 0.5pt, fill: luma(87.9%)))
  place(dx: 572pt, dy: 463.5pt, rect(width: 52pt, height: 0.5pt, fill: luma(90.9%)))
  place(dx: 572pt, dy: 464pt, rect(width: 52pt, height: 0.5pt, fill: luma(91.1%)))
  place(dx: 572pt, dy: 464.5pt, rect(width: 52pt, height: 0.5pt, fill: luma(91.5%)))
  place(dx: 572pt, dy: 465pt, rect(width: 52pt, height: 0.5pt, fill: luma(91.5%)))
  place(dx: 572pt, dy: 465.5pt, rect(width: 52pt, height: 0.5pt, fill: luma(91.7%)))
  place(dx: 572pt, dy: 466pt, rect(width: 52pt, height: 0.5pt, fill: luma(91.5%)))
  place(dx: 572pt, dy: 466.5pt, rect(width: 52pt, height: 0.5pt, fill: luma(91.7%)))
  place(dx: 624pt, dy: 462pt, rect(width: 52pt, height: 0.5pt, fill: luma(90.7%)))
  place(dx: 624pt, dy: 462.5pt, rect(width: 52pt, height: 0.5pt, fill: luma(80.7%)))
  place(dx: 624pt, dy: 463pt, rect(width: 52pt, height: 0.5pt, fill: luma(87.0%)))
  place(dx: 624pt, dy: 463.5pt, rect(width: 52pt, height: 0.5pt, fill: luma(90.3%)))
  place(dx: 624pt, dy: 464pt, rect(width: 52pt, height: 0.5pt, fill: luma(90.6%)))
  place(dx: 624pt, dy: 464.5pt, rect(width: 52pt, height: 0.5pt, fill: luma(91.2%)))
  place(dx: 624pt, dy: 465pt, rect(width: 52pt, height: 0.5pt, fill: luma(91.3%)))
  place(dx: 624pt, dy: 465.5pt, rect(width: 52pt, height: 0.5pt, fill: luma(91.5%)))
  place(dx: 624pt, dy: 466pt, rect(width: 52pt, height: 0.5pt, fill: luma(91.3%)))
  place(dx: 624pt, dy: 466.5pt, rect(width: 52pt, height: 0.5pt, fill: luma(91.5%)))
  place(dx: 676pt, dy: 462.5pt, rect(width: 52pt, height: 0.5pt, fill: luma(82.5%)))
  place(dx: 676pt, dy: 463pt, rect(width: 52pt, height: 0.5pt, fill: luma(85.7%)))
  place(dx: 676pt, dy: 463.5pt, rect(width: 52pt, height: 0.5pt, fill: luma(90.1%)))
  place(dx: 676pt, dy: 464pt, rect(width: 52pt, height: 0.5pt, fill: luma(90.2%)))
  place(dx: 676pt, dy: 464.5pt, rect(width: 52pt, height: 0.5pt, fill: luma(90.7%)))
  place(dx: 676pt, dy: 465pt, rect(width: 52pt, height: 0.5pt, fill: luma(90.7%)))
  place(dx: 676pt, dy: 465.5pt, rect(width: 52pt, height: 0.5pt, fill: luma(91.0%)))
  place(dx: 676pt, dy: 466pt, rect(width: 52pt, height: 0.5pt, fill: luma(90.8%)))
  place(dx: 676pt, dy: 466.5pt, rect(width: 52pt, height: 0.5pt, fill: luma(91.0%)))
  place(dx: 728pt, dy: 462.5pt, rect(width: 52pt, height: 0.5pt, fill: luma(83.3%)))
  place(dx: 728pt, dy: 463pt, rect(width: 52pt, height: 0.5pt, fill: luma(83.9%)))
  place(dx: 728pt, dy: 463.5pt, rect(width: 52pt, height: 0.5pt, fill: luma(89.6%)))
  place(dx: 728pt, dy: 464pt, rect(width: 52pt, height: 0.5pt, fill: luma(90.0%)))
  place(dx: 728pt, dy: 464.5pt, rect(width: 52pt, height: 0.5pt, fill: luma(90.6%)))
  place(dx: 728pt, dy: 465pt, rect(width: 52pt, height: 0.5pt, fill: luma(90.7%)))
  place(dx: 728pt, dy: 465.5pt, rect(width: 52pt, height: 0.5pt, fill: luma(91.0%)))
  place(dx: 728pt, dy: 466pt, rect(width: 52pt, height: 0.5pt, fill: luma(90.8%)))
  place(dx: 728pt, dy: 466.5pt, rect(width: 52pt, height: 0.5pt, fill: luma(90.9%)))
  place(dx: 780pt, dy: 462pt, rect(width: 56pt, height: 0.5pt, fill: luma(92.7%)))
  place(dx: 780pt, dy: 462.5pt, rect(width: 56pt, height: 0.5pt, fill: luma(87.9%)))
  place(dx: 780pt, dy: 463pt, rect(width: 56pt, height: 0.5pt, fill: luma(83.6%)))
  place(dx: 780pt, dy: 463.5pt, rect(width: 56pt, height: 0.5pt, fill: luma(88.5%)))
  place(dx: 780pt, dy: 464pt, rect(width: 56pt, height: 0.5pt, fill: luma(89.4%)))
  // 条码：逐列灰度（188 列 × 1px，起点 x=132）
  let BC = (250, 227, 78, 0, 0, 113, 252, 58, 71, 255, 251, 159, 0, 7, 7, 0, 67, 252, 252, 245, 125, 0, 0, 50, 226, 104, 0, 1, 76, 254, 244, 247, 129, 0, 1, 35, 220, 142, 0, 15, 1, 56, 250, 243, 245, 126, 39, 235, 248, 245, 116, 0, 11, 6, 138, 217, 40, 234, 111, 41, 243, 236, 234, 246, 213, 10, 2, 30, 231, 131, 0, 2, 8, 216, 248, 240, 253, 139, 3, 1, 106, 252, 242, 254, 100, 26, 234, 246, 238, 254, 145, 6, 7, 8, 201, 249, 253, 203, 6, 149, 248, 255, 90, 38, 231, 248, 240, 232, 253, 181, 23, 0, 133, 248, 239, 253, 191, 23, 0, 3, 6, 4, 19, 231, 142, 44, 212, 255, 182, 4, 184, 193, 25, 0, 10, 0, 94, 210, 56, 0, 15, 12, 13, 0, 138, 253, 241, 248, 225, 54, 0, 10, 0, 103, 231, 56, 71, 234, 255, 244, 83, 0, 62, 221, 105, 0, 10, 0, 128, 254, 241, 247, 240, 81, 0, 10, 2, 5, 185, 189, 23, 185, 184, 7, 0, 36, 188, 255)
  for (i, v) in BC.enumerate() {
    place(dx: (132 + i) * px, dy: 331 * px, rect(width: px, height: 62 * px, fill: luma(v / 255 * 100%)))
  }
}

// ── 文字 ────────────────────────────────────────────
#T(583.47, 60.12, 53.95, "非医保处方", font: ("SimSun"))
#T(1296.47, 67.02, 30.83, "北京大学第六医院", font: ("SimSun"), stroke: 0.8)
#T(698.33, 162.79, 26.25, "姓名：", font: ("SimSun"), stroke: 0.2)
#T(780.44, 162.69, 25.73, "张伟", font: ("SimSun"), stroke: 0.3)
#T(1050.26, 163.03, 25.22, "性别：", font: ("SimSun"), stroke: 0.4)
#T(1128.91, 163.4, 25.06, "男", font: ("SimSun"), stroke: 0.3)
#T(699.02, 216.43, 25.68, "科别：", font: ("SimSun"), stroke: 0.3)
#T(780.27, 216.53, 25.7, "精神科", font: ("SimSun"), stroke: 0.2)
#T(1050.13, 216.75, 25.27, "年龄：", font: ("SimSun"), stroke: 0.2)
#T(1129.4, 217.98, 22.2, "21岁", font: ("SimSun"), stroke: 0.2)
#T(130.02, 287.18, 25.33, "北京大学第六医院", font: ("SimSun"), stroke: 0.3)
#T(145.77, 399, 27.26, "0000000000", font: ("Courier New"))
#T(144.92, 435.72, 38.73, "序号：", font: ("SimSun"), stroke: 0.2)
#T(172.75, 482.4, 32.41, "000000", font: ("SimSun"), stroke: 0.5)
#T(161.23, 524.38, 39.53, "精神科", font: ("SimSun"), stroke: 0.7)
#T(139.24, 575.47, 23.63, "此处方当日有效", font: ("SimSun"), stroke: 0.1)
#T(128.73, 605.49, 23.58, "（自2026-07-31）", font: ("SimSun"))
#T(159.14, 637.2, 23.81, "（当日有效）", font: ("SimSun"))
#T(160.16, 675.15, 21.45, "个人自付", font: ("SimSun"), tracking: 8.727, stroke: 0.3)
#T(149.38, 854.18, 19.71, "印刷日期：2026-07-31", font: ("SimSun"))
#T(441.19, 285.87, 23.87, "诊断：", font: ("SimSun"), stroke: 0.3)
#T(385.17, 340.59, 23.32, "心境[情感]障碍", font: ("SimSun"), stroke: 0.2)
#T(385.12, 370.32, 23.28, "抑郁状态", font: ("SimSun"), stroke: 0.2)
#T(385.15, 399.22, 23.26, "偏执性反应", font: ("SimSun"), stroke: 0.2)
#T(385.73, 643.26, 23.06, "合计：", font: ("SimSun"), stroke: 0.2)
#T(455.86, 643.31, 21.46, "19.74", font: ("Arial"), weight: "bold")
#T(642.86, 283.53, 26.42, "Rp", font: ("Arial"), weight: "bold")
#T(708.77, 285.39, 24.66, "药品名称/规格/单价", font: ("SimSun"), stroke: 0.2)
#T(651.31, 337.48, 27.1, "③氢溴酸伏硫西汀片(石药)", font: ("SimSun"), stroke: 0.2)
#T(695.14, 373.82, 24.31, "(10mg x 14片/盒) 9.87元", font: ("SimSun"))
#T(385.6, 699.65, 24.21, "审核/调配签名（签章）：", font: ("SimSun"))
#T(951.05, 700.36, 24.09, "核对/发药签名（签章）：", font: ("SimSun"), stroke: 0.1)
#T(386.69, 741.35, 23.47, "提示：(1)请遵医嘱服药", font: ("SimSun"), stroke: 0.2)
#T(672.27, 741.15, 24.12, "(2)请在窗口点清药品", font: ("SimSun"))
#T(933.75, 741.36, 23.71, "(3)处方当日有效", font: ("SimSun"), stroke: 0.2)
#T(386.41, 781.95, 23.38, "费用类别：", font: ("SimSun"), stroke: 0.2)
#T(520.15, 781.81, 23.47, "①(甲)无自付", font: ("SimSun"), stroke: 0.2)
#T(695.55, 781.65, 24.01, "②(乙)有自付", font: ("SimSun"))
#T(873.37, 781.91, 23.66, "③(丙)全自付", font: ("SimSun"), stroke: 0.2)
#T(1090.06, 816.5, 23.05, "医师：", font: ("SimSun"), stroke: 0.3)
#T(1168.87, 816.63, 22.75, "陈", font: ("SimSun"), stroke: 0.2)
#T(1209.29, 817.21, 22.71, "明", font: ("SimSun"), stroke: 0.3)
#T(1124.93, 853.85, 23.87, "（签章）", font: ("SimSun"), stroke: 0.1)
