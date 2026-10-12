/**
 * 模板工具箱：所有模板共用的 Typst 片段与工具函数。
 * 新模板只需 import 这里的东西，再写自己的版面即可。
 */
import { encodeCode128 } from "@/lib/barcode";
import { qrMatrix } from "@/lib/qr";
import type { PrescriptionDoc } from "@/lib/doc";
import { totalOf } from "@/lib/doc";

/** Typst 字符串转义 */
export const esc = (s: string) => String(s ?? "").replace(/\\/g, "\\\\").replace(/"/g, '\\"');
/** 金额：两位小数 */
export const money = (v: number) => (Math.round((Number(v) || 0) * 100) / 100).toFixed(2);
/** 带圈序号 ①..⑳，超出退回 (n) */
export const circled = (i: number) => (i >= 1 && i <= 20 ? String.fromCharCode(0x245f + i) : `(${i})`);
/** 去掉小数末尾多余的 0：12.40 -> 12.4，6.00 -> 6 */
export const trim = (v: number | string) => {
  const s = typeof v === "number" ? String(v) : String(v ?? "");
  return s.includes(".") ? s.replace(/0+$/, "").replace(/\.$/, "") : s;
};
/** 中文按 1em、ASCII 按 0.5em 估算像素宽度（用于生成期预警） */
export const tw = (text: string) => {
  let w = 0;
  for (const ch of String(text ?? "")) w += ch.charCodeAt(0) > 0x2e80 ? 1 : 0.5;
  return w;
};

/** 页面与全局设置。页边距默认 0，模板自己排版。 */
export function preamble(widthPt: number, heightPt: number, opts?: { margin?: string; baseSize?: number }) {
  const { margin = "0pt", baseSize = 9 } = opts ?? {};
  // margin 支持 "12pt 14pt"（纵向 横向），转成 Typst 的字典写法
  const parts = margin.trim().split(/\s+/);
  const marginTypst = parts.length === 1 ? parts[0] : `(y: ${parts[0]}, x: ${parts[1]})`;
  return [
    `#set page(width: ${widthPt}pt, height: ${heightPt}pt, margin: ${marginTypst}, fill: white)`,
    '#set text(font: ("SimSun", "Times New Roman"), lang: "zh", fill: black, size: ' + baseSize + "pt)",
    "#set par(leading: 0.62em)",
    "#let px = 0.5pt",
  ].join("\n");
}

/** 表格线/分隔线 */
export function ruleLine(x1: number, y1: number, x2: number, y2: number, w = 0.6) {
  return `#place(dx: ${x1}pt, dy: ${y1}pt, line(start: (0pt, 0pt), end: (${x2 - x1}pt, ${y2 - y1}pt), stroke: ${w}pt))`;
}

/**
 * 条码块：在当前位置生成一个 `w × h`（pt）的 Code 128 条码，可放在任意流式布局里。
 * bars 为模块宽度序列（由 encodeCode128 得到）。
 */
export function barcodeBlock(text: string, wPt: number, hPt: number) {
  const bc = encodeCode128(text ?? "");
  const bars = bc.widths.join(", ");
  return [
    `#let __bars = (${bars})`,
    `#barcode(__bars, ${wPt}pt, ${hPt}pt)`,
  ].join("\n");
}

/** 条形码 helper 的 Typst 定义（放在 preamble 之后） */
export const BARCODE_HELPER = `#let barcode(bars, w, h) = {
  let unit = w / bars.sum()
  let pos = 0pt
  box(width: w, height: h, {
    for (i, m) in bars.enumerate() {
      if calc.even(i) {
        place(dx: pos, dy: 0pt, rect(width: m * unit, height: h, fill: black))
      }
      pos += m * unit
    }
  })
}`;

/** 二维码 helper：把 bool 矩阵画成方块阵（qr.ts 生成矩阵） */
export const QR_HELPER = `#let qrcode(mat, side) = {
  let n = mat.len()
  let u = side / n
  box(width: side, height: side, {
    for (y, row) in mat.enumerate() {
      for (x, on) in row.enumerate() {
        if on { place(dx: x * u, dy: y * u, rect(width: u, height: u, fill: black)) }
      }
    }
  })
}`;

/**
 * 二维码块：优先用 qr.ts 的真实矩阵；若编码不可用，退化为带说明的空框
 * （绝不画"看起来像二维码"的假图案）。
 */
export function qrBlock(text: string, sidePt: number) {
  let mat: boolean[][] | null = null;
  try {
    mat = qrMatrix(text);
  } catch {
    mat = null;
  }
  if (!mat) {
    return `#box(width: ${sidePt}pt, height: ${sidePt}pt, stroke: 0.4pt)[#align(center + horizon)[#text(size: 6pt)[扫码支付]]]`;
  }
  const body = mat.map((row) => "(" + row.map((v) => (v ? "true" : "false")).join(", ") + ")").join(", ");
  return `#qrcode((${body}), ${sidePt}pt)`;
}

/** 合计金额 */
export const total = (doc: PrescriptionDoc) => totalOf(doc.drugs);

/** 新模板骨架：复制这段开始写 */
export function skeleton(doc: PrescriptionDoc) {
  return [
    preamble(419.5, 595.3),
    "",
    "// 你的版面",
    "",
  ].join("\n");
}
