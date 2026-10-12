/**
 * Typst 单据生成器：把表单数据渲染成与样张同一版式的 .typ 源码。
 * 所有坐标均为「原图像素」（1px = 0.5pt），来自样张的逐像素测量，
 * 因此生成结果与 studio 的预览、导出 PDF 完全一致。
 *
 * 例外：左上角「扫码支付」二维码不是样张上的内容（样张此处为空白），
 * 是按明确需求新增的版面元素，样式与坐标对齐 zz 模板左上角的同款二维码，
 * 详见下面 QR 常量处的说明。
 */
import { barsToRects, encodeCode128 } from "@/lib/barcode";
import type { PrescriptionDoc } from "@/lib/doc";
import { MAX_DIAG_LINES, MAX_DRUGS, totalOf } from "@/lib/doc";
import { QR_HELPER, qrBlock } from "@/templates/kit";

/** 纸张边缘阴影的变暗比例（实测） */
const A_TOP = [0.018,0.018,0.018,0.018,0.018,0.018,0.029,0.055,0.117,0.178,0.093,0.018,0.018,0.018,0.018];
const A_RIGHT = [0,0,0.053,0.312,0.399,0.363,0.296,0.210,0.141,0.093,0.060,0.039,0.028,0.028,0.028,0.028,0.028,0.028,0.028,0.028,0.028,0.028];
const A_LEFT = [...A_RIGHT].reverse();
const A_BOTTOM = [0,0,0,0,0,0,0.033,0.095,0.036,0.016,0.016,0.016,0.016,0.016];

const F = {
  xl: 20, xr: 1657, yt: 17, yb: 925,
  ruleTopY: 262.09, ruleTopX0: 106, ruleTopX1: 1539,
  ruleMidY: 679.12, ruleMidX0: 363.7, ruleMidX1: 1537,
  ruleV1X: 363.7, ruleV1Y1: 873, ruleV2X: 616.46,
  bcX0: 134, bcX1: 317, bcY0: 331, bcY1: 393,
};

/**
 * ── 左上角「扫码支付」二维码【新增元素】 ─────────────────────────────
 * 样张（origin_pic.png）此处是空白；按需求照搬 zz 模板（郑州市中心医院处方笺）
 * 左上角那枚扫码支付二维码的样式与边距，填补 x∈[0,294pt]、y∈[0,131pt] 的空白区。
 *
 * zz 实测（渲染 out/tpl-zz.png 逐像素量得，1pt = 2px）：
 *   二维码 66pt 见方；左边缘 42pt、上边缘 42.5pt（≈ 内容左边界 + 2pt）；
 *   上方「扫码支付」9.5pt 小字，字墨迹下沿距二维码上边缘 2px（1pt），
 *   字墨迹左沿在二维码左边缘右侧 15px（7.5pt）。
 *
 * bj6 对齐方式（坐标仍为原图像素，1px = 0.5pt）：
 *   · 尺寸：132px = 66pt 见方 —— 与 zz 完全相同；
 *   · 左边缘 106px = 53pt —— 与表格顶横线左端（F.ruleTopX0）即左栏内容左边界齐平，
 *     对应 zz「二维码贴内容左边界」的对齐方式；
 *   · 上边缘 92px = 46pt —— 与 zz 的 42.5pt 同量级，下方距表格顶横线（262.09px）还有 37~38px（约 18.5pt）；
 *   · 「扫码支付」19px = 9.5pt（同 zz 的 BODY 字号），字盒顶 76px，
 *     字墨迹下沿落在二维码上边缘上方 1px（zz 实测 2px），字左沿缩进二维码左边缘 14px（zz 15px）。
 * 该区域上方是纸张边缘阴影（y ≤ 23px），右侧最近文字是居中标题（左沿 587px），均无重叠。
 */
const QR = {
  side: 132, // 66pt
  x: 106, // 53pt
  y: 92, // 46pt
  label: "扫码支付",
  labelSize: 19, // 9.5pt
  labelX: 119, // 59.5pt：与 zz 一样，字起笔点略缩进于二维码左边缘
  labelY: 76, // 38pt：「扫码支付」字盒顶
};

export const LIMITS = { maxDiag: MAX_DIAG_LINES, maxDrugs: MAX_DRUGS };

interface Run {
  x: number;
  y: number;
  size: number;
  text: string;
  font?: string[];
  weight?: "regular" | "bold";
  track?: number;
  anchor?: "left" | "center" | "right";
  /** 最大可用宽度（原图像素）：超出时由 Typst 端按比例缩字号，保证不越界 */
  maxw?: number;
}

const n = (v: number, d = 2) => {
  const s = v.toFixed(d);
  return s.replace(/\.?0+$/, "") || "0";
};
const esc = (s: string) => s.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
const money = (v: number) => (Math.round(v * 100) / 100).toFixed(2);
const circled = (i: number) => (i >= 1 && i <= 20 ? String.fromCharCode(0x245f + i) : `(${i})`);

export function buildTypst(doc: PrescriptionDoc): string {
  const o = doc.options;
  const runs: Run[] = [];
  const total = totalOf(doc.drugs);
  const add = (r: Run) => runs.push(r);

  // ── 页眉 ────────────────────────────────────────────────
  add({ x: 718, y: 60.12, size: 54, text: doc.docType || "处方", anchor: "center", maxw: 700 });
  add({ x: 1541, y: 67.04, size: 31, text: doc.hospital, anchor: "right", maxw: 430 });
  // 按用户要求：二维码上方不再印「扫码支付」字样，只保留二维码本体

  // ── 患者信息 ────────────────────────────────────────────
  add({ x: 699.0, y: 162.82, size: 25.5, text: "姓名：" });
  add({ x: 780.58, y: 162.91, size: 25.5, text: doc.patientName, maxw: 250 });
  add({ x: 1049.74, y: 163.2, size: 25.5, text: "性别：" });
  add({ x: 1128.63, y: 163.33, size: 25.5, text: doc.gender, maxw: 100 });
  add({ x: 699.03, y: 216.4, size: 25.5, text: "科别：" });
  add({ x: 780.53, y: 216.51, size: 25.5, text: doc.dept, maxw: 250 });
  add({ x: 1049.99, y: 216.78, size: 25.5, text: "年龄：" });
  add({ x: 1128.36, y: 216.68, size: 25.5, text: `${doc.age}岁`, maxw: 120 });

  // ── 左栏 ────────────────────────────────────────────────
  add({ x: 231, y: 287.2, size: 25.5, text: doc.hospital, anchor: "center", maxw: 244 });
  if (o.showCardNo) add({ x: 227, y: 399.13, size: 27.26, text: doc.cardNo, font: ["Courier New"], anchor: "center", maxw: 180 });
  if (o.showSerial) {
    add({ x: 145.06, y: 435.69, size: 38.5, text: "序号：" });
    add({ x: 220, y: 482.4, size: 32.5, text: doc.serial, anchor: "center", maxw: 200 });
  }
  add({ x: 219.5, y: 524.38, size: 39.5, text: doc.dept, anchor: "center", maxw: 236 });
  const validText = doc.validDays <= 1 ? "此处方当日有效" : `此处方${doc.validDays}日内有效`;
  const validShort = doc.validDays <= 1 ? "（当日有效）" : `（${doc.validDays}日内有效）`;
  add({ x: 221, y: 575.45, size: 23.5, text: validText, anchor: "center", maxw: 236 });
  add({ x: 219, y: 605.48, size: 23.5, text: `（自${doc.printDate}）`, anchor: "center", maxw: 236 });
  add({ x: 218, y: 637.16, size: 23.5, text: validShort, anchor: "center", maxw: 236 });
  add({ x: 216, y: 674.91, size: 21.5, text: o.selfPayLabel, anchor: "center", track: 8.73, maxw: 200 });
  if (o.showPrintDate) add({ x: 150.4, y: 854.15, size: 19.5, text: `印刷日期：${doc.printDate}`, maxw: 208 });

  // ── 诊断栏 ──────────────────────────────────────────────
  add({ x: 441.96, y: 285.82, size: 23.5, text: "诊断：" });
  doc.diagnoses.slice(0, MAX_DIAG_LINES).forEach((d, i) => {
    add({ x: 384.5, y: 340.62 + i * 29.3, size: 23.5, text: d, maxw: 226 });
  });
  add({ x: 385.73, y: 643.25, size: 23, text: "合计：" });
  add({ x: 455.86, y: 643.31, size: 21.5, text: money(total), font: ["Arial"], weight: "bold", maxw: 130 });

  // ── 药品栏 ──────────────────────────────────────────────
  add({ x: 642.86, y: 283.53, size: 26.5, text: "Rp", font: ["Arial"], weight: "bold" });
  add({ x: 709.78, y: 285.37, size: 24.5, text: "药品名称/规格/单价" });
  doc.drugs.slice(0, MAX_DRUGS).forEach((d, i) => {
    const y = 337.47 + i * 70.74;
    const brand = d.brand ? `(${d.brand})` : "";
    add({ x: 651.81, y, size: 27, text: `${circled(i + 1)}${d.name}${brand}`, maxw: 880 });
    let line2 = `(${d.spec}) ${money(d.price)}元`;
    if (o.showMoney && Number(d.qty) > 1) line2 += ` ×${d.qty} = ${money(d.price * d.qty)}元`;
    if (o.showUsage && d.usage) line2 += `  用法：${d.usage}`;
    add({ x: 696.09, y: y + 35.37, size: 24.5, text: line2, maxw: 836 });
  });

  // ── 底部签名与提示 ──────────────────────────────────────
  add({ x: 388.66, y: 699.93, size: 23.5, text: "审核/调配签名（签章）：" });
  add({ x: 954.2, y: 700.4, size: 23.5, text: "核对/发药签名（签章）：" });
  if (o.showTips) {
    const xs = [386.56, 676.03, 934.54];
    const mw = [280, 250, 580];
    o.tips.slice(0, 3).forEach((t, i) => add({ x: xs[i], y: 741.2, size: 23.5, text: t, maxw: mw[i] }));
  }
  if (o.showFeeLine) {
    add({ x: 386.27, y: 781.97, size: 23.5, text: "费用类别：" });
    const xs = [520.15, 697.82, 873.75];
    ["①(甲)无自付", "②(乙)有自付", "③(丙)全自付"].forEach((label, i) => {
      const key = ["甲", "乙", "丙"][i];
      add({ x: xs[i], y: 781.85, size: 23.5, text: label, weight: o.showFeeMark && doc.feeKey === key ? "bold" : "regular" });
    });
  }
  add({ x: 1089.15, y: 816.55, size: 23.5, text: "医师：" });
  if (doc.doctor)
    add({
      x: 1168.88,
      y: 816.6,
      size: 22.5,
      text: doc.doctor,
      track: doc.doctor.length <= 2 ? 18 : 6,
      maxw: doc.doctor.length <= 2 ? 200 : 220,
    });
  if (o.showSign) add({ x: 1160, y: 853.8, size: 23.5, text: "（签章）", anchor: "center" });

  // ── 条码 ────────────────────────────────────────────────
  let bars: Array<[number, number]> = [];
  if (o.showBarcode && doc.cardNo.trim()) {
    bars = barsToRects(encodeCode128(doc.cardNo), F.bcX0, F.bcX1 - F.bcX0);
  }

  // ── 左上角二维码内容：优先 extra.qrText（表单可编辑），为空回退病历号 ──
  const qrText = String(doc.extra?.qrText ?? "").trim() || String(doc.cardNo ?? "").trim();
  // 两者都为空时照 kit.qrBlock 的降级行为：不画任何图案，只留一个 66pt 空框
  const qr = qrText
    ? qrBlock(qrText, QR.side / 2)
    : `#box(width: ${QR.side / 2}pt, height: ${QR.side / 2}pt, stroke: 0.4pt)`;

  // ── 组装 Typst ──────────────────────────────────────────
  const L: string[] = [];
  L.push(`// ============================================================
//  ${doc.hospital} · ${doc.docType}
//  由「Prescription Master」按选定的医院/诊断/药品/医师等数据生成
//  页面 836pt × 470.5pt（1 原图像素 = 0.5pt），纯矢量输出
//  字体：中文 SimSun（宋体）；Rp、合计金额为 Arial Bold；条码数字为 Courier New
// ============================================================
`);
  L.push('#set page(width: 836pt, height: 470.5pt, margin: 0pt, fill: white)');
  L.push('#set text(font: "SimSun", lang: "zh", fill: black)');
  L.push("");
  L.push("#let px = 0.5pt");
  L.push("");
  L.push("// x, y：排版原点（原图像素）；size：字号（原图像素 = em 高度）");
  L.push("// T=左对齐起笔点；TC=以 x 为水平中心；TR=以 x 为右端（用 measure 精确对齐）");
  L.push("#let G(x, y, size, body, font: \"SimSun\", weight: \"regular\", tracking: 0, mode: \"l\", maxw: 0) = context {");
  L.push("  let mk(s) = text(font: font, size: s * px, weight: weight, tracking: tracking * px, body)");
  L.push("  let t0 = mk(size)");
  L.push("  let w0 = measure(t0).width");
  L.push("  let s = if maxw > 0 and w0 > maxw * px { size * maxw * px / w0 } else { size }");
  L.push("  let t = if s == size { t0 } else { mk(s) }");
  L.push("  let w = if s == size { w0 } else { measure(t).width }");
  L.push("  let dx = if mode == \"c\" { x * px - w / 2 } else if mode == \"r\" { x * px - w } else { x * px }");
  L.push("  place(dx: dx, dy: y * px, t)");
  L.push("}");
  L.push("#let T(x, y, size, body, font: \"SimSun\", weight: \"regular\", tracking: 0, maxw: 0) = G(x, y, size, body, font: font, weight: weight, tracking: tracking, mode: \"l\", maxw: maxw)");
  L.push("#let TC(x, y, size, body, font: \"SimSun\", weight: \"regular\", tracking: 0, maxw: 0) = G(x, y, size, body, font: font, weight: weight, tracking: tracking, mode: \"c\", maxw: maxw)");
  L.push("#let TR(x, y, size, body, font: \"SimSun\", weight: \"regular\", tracking: 0, maxw: 0) = G(x, y, size, body, font: font, weight: weight, tracking: tracking, mode: \"r\", maxw: maxw)");
  L.push("");
  L.push("#let tint(x0, y0, x1, y1, a) = place(dx: x0 * px, dy: y0 * px,");
  L.push("  rect(width: (x1 - x0) * px, height: (y1 - y0) * px, fill: rgb(0, 0, 0, a * 100%)))");
  L.push("");
  L.push("#let edgeH(x0, x1, y, A) = place(dx: x0 * px, dy: y * px,");
  L.push("  rect(width: (x1 - x0) * px, height: A.len() * px,");
  L.push("    fill: gradient.linear(angle: 90deg,");
  L.push("      ..A.enumerate().map(((i, a)) => (rgb(0, 0, 0, a * 100%), i / A.len() * 100%)),");
  L.push("      (rgb(0, 0, 0, A.last() * 100%), 100%))))");
  L.push("");
  L.push("#let edgeV(y0, y1, x, A) = place(dx: x * px, dy: y0 * px,");
  L.push("  rect(width: A.len() * px, height: (y1 - y0) * px,");
  L.push("    fill: gradient.linear(angle: 0deg,");
  L.push("      ..A.enumerate().map(((i, a)) => (rgb(0, 0, 0, a * 100%), i / A.len() * 100%)),");
  L.push("      (rgb(0, 0, 0, A.last() * 100%), 100%))))");
  L.push("");
  L.push("#let hline(x0, x1, y, w) = place(dx: x0 * px, dy: y * px,");
  L.push("  line(start: (0pt, 0pt), end: ((x1 - x0) * px, 0pt), stroke: w * px))");
  L.push("#let vline(x, y0, y1, w) = place(dx: x * px, dy: y0 * px,");
  L.push("  line(start: (0pt, 0pt), end: (0pt, (y1 - y0) * px), stroke: w * px))");
  L.push("");
  if (qrText) {
    L.push("// 二维码：把 bool 矩阵画成方块阵（与 zz 模板共用 kit.QR_HELPER） ──");
    L.push(QR_HELPER);
    L.push("");
  }
  L.push("// ── 纸张边缘阴影（四边闭合细线框，电子模拟） ─────────────");
  L.push(`#tint(0, 0, ${F.xr}, ${F.yt}, 0.018)`);
  L.push(`#tint(${F.xr}, 0, 1672, 941, 0.028)`);
  L.push(`#tint(0, ${F.yt}, ${F.xl}, ${F.yb}, 0.018)`);
  L.push(`#tint(0, ${F.yb}, ${F.xr}, 941, 0.016)`);
  L.push(`#let A_TOP = (${A_TOP.map((v) => v.toFixed(3)).join(", ")})`);
  L.push(`#let A_RIGHT = (${A_RIGHT.map((v) => v.toFixed(3)).join(", ")})`);
  L.push(`#let A_LEFT = (${A_LEFT.map((v) => v.toFixed(3)).join(", ")})`);
  L.push(`#let A_BOTTOM = (${A_BOTTOM.map((v) => v.toFixed(3)).join(", ")})`);
  L.push(`#edgeV(${F.yt}, ${F.yb}, 3, A_LEFT)`);
  L.push(`#edgeV(${F.yt}, ${F.yb}, 1653, A_RIGHT)`);
  L.push(`#edgeH(${F.xl}, ${F.xr}, 8, A_TOP)`);
  L.push(`#edgeH(${F.xl}, ${F.xr}, 918, A_BOTTOM)`);
  L.push("");
  L.push("// ── 表格线 ───────────────────────────────────────────────");
  L.push("#let LW = 2.0   // 1pt");
  L.push(`#hline(${F.ruleTopX0}, ${F.ruleTopX1}, ${F.ruleTopY}, LW)`);
  L.push(`#hline(${F.ruleMidX0}, ${F.ruleMidX1}, ${F.ruleMidY}, LW)`);
  L.push(`#vline(${F.ruleV1X}, ${F.ruleTopY}, ${F.ruleV1Y1}, LW)`);
  L.push(`#vline(${F.ruleV2X}, ${F.ruleTopY}, ${F.ruleMidY}, LW)`);
  L.push("");
  L.push("// ── 左上角「扫码支付」二维码（新增元素，样张此处为空白） ─────────");
  L.push(`// 内容：${qrText ? esc(qrText).replace(/\s+/g, " ") : "（qrText 与病历号均为空，仅画空框）"}`);
  L.push(`#place(dx: ${n(QR.x)} * px, dy: ${n(QR.y)} * px)[${qr}]`);
  L.push("");
  if (bars.length) {
    L.push(`// ── 条码（Code 128，${bars.length} 根条，由卡号 ${esc(doc.cardNo)} 生成） ──`);
    L.push(`#let BARS = (${bars.map(([a, b]) => `(${n(a)}, ${n(b)})`).join(", ")})`);
    L.push("#for (a, b) in BARS {");
    L.push(`  place(dx: a * px, dy: ${F.bcY0} * px,`);
    L.push(`    polygon(fill: black, (0pt, 0pt), ((b - a) * px, 0pt), ((b - a) * px, ${F.bcY1 - F.bcY0} * px), (0pt, ${F.bcY1 - F.bcY0} * px)))`);
    L.push("}");
    L.push("");
  }
  L.push("// ── 文字 ─────────────────────────────────────────────────");
  for (const r of runs) {
    if (!r.text) continue;
    const fn = r.anchor === "center" ? "TC" : r.anchor === "right" ? "TR" : "T";
    const args = [`${n(r.x)}, ${n(r.y)}, ${n(r.size, 2)}, "${esc(r.text)}"`];
    const opt: string[] = [];
    if (r.font) opt.push(`font: (${r.font.map((f) => `"${f}"`).join(", ")})`);
    if (r.weight && r.weight !== "regular") opt.push(`weight: "${r.weight}"`);
    if (r.track) opt.push(`tracking: ${n(r.track, 2)}`);
    if (r.maxw) opt.push(`maxw: ${n(r.maxw, 1)}`);
    L.push(`#${fn}(${args.join(", ")}${opt.length ? ", " + opt.join(", ") : ""})`);
  }
  L.push("");
  return L.join("\n");
}
