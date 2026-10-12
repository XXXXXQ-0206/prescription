/**
 * 通用门诊处方笺骨架（起始模板）：标题 + 患者行 + 诊断 + Rp 药品 + 页脚。
 * ⚠️ 这是给新模板的**起点**，各模板文件请把需要的部分复制进自己的文件后再改写，
 *    不要直接修改本文件（多人并行时会互相覆盖）。
 */
import type { PrescriptionDoc } from "@/lib/doc";
import { totalOf } from "@/lib/doc";
import { BARCODE_HELPER, QR_HELPER, barcodeBlock, circled, esc, money, preamble, qrBlock, trim } from "@/templates/kit";

export interface SimpleOpts {
  widthPt: number;
  heightPt: number;
  margin?: string;
  baseSize?: number;
  title: string;
  /** 顶部左侧是否显示条码（内容用 extra.medicalId 或 patientCard） */
  barcode?: boolean;
  /** 右上角小方框里的文字（如 普通处方 / 处方当日有效） */
  cornerBox?: string[];
  /** 药品数量列显示方式 */
  qtyStyle?: "unit" | "plain";
}

export function simpleTemplate(doc: PrescriptionDoc, o: SimpleOpts) {
  const total = totalOf(doc.drugs);
  const amount = doc.extra.amount?.trim() ? doc.extra.amount.trim() : money(total);
  const bcText = doc.extra.medicalId || doc.cardNo;
  const lines: string[] = [];
  lines.push(preamble(o.widthPt, o.heightPt, { margin: o.margin ?? "14pt 16pt", baseSize: o.baseSize ?? 9 }));
  lines.push(BARCODE_HELPER);
  lines.push(QR_HELPER);
  lines.push("");
  // 标题行
  lines.push("#grid(columns: (1fr, auto, 1fr), align: (left, center, right),");
  lines.push(`  [${o.barcode && bcText ? barcodeBlock(bcText, 96, 22) : []}],`);
  lines.push(`  text(size: 15pt, weight: "bold")[${esc(o.title)}],`);
  if (o.cornerBox?.length) {
    lines.push(`  box(stroke: 0.6pt, inset: 3pt)[#align(center)[${o.cornerBox.map(esc).join(" \\ ")}]],`);
  } else {
    lines.push("  [],");
  }
  lines.push(")");
  lines.push("#v(4pt)");
  // 患者信息
  lines.push("#grid(columns: (1fr, 1fr, 1fr), column-gutter: 6pt, row-gutter: 3pt,");
  lines.push(`  [姓名：${esc(doc.patientName)}], [性别：${esc(doc.gender)}], [年龄：${esc(doc.age)}岁],`);
  lines.push(`  [科别：${esc(doc.dept)}], [病历号：${esc(bcText)}], [日期：${esc(doc.extra.visitDate || doc.printDate)}],`);
  lines.push(")");
  lines.push("#v(2pt)");
  lines.push("#line(length: 100%, stroke: 0.6pt)");
  lines.push(`#v(3pt) 临床诊断：#underline[${esc(doc.diagnoses.filter(Boolean).join("；"))}]`);
  lines.push("#v(4pt)");
  lines.push("#text(size: 13pt, weight: \"bold\")[Rp]");
  lines.push("#v(2pt)");
  lines.push("#for (i, d) in __drugs.enumerate() {");
  lines.push("  grid(columns: (1fr, auto, auto), column-gutter: 8pt,");
  lines.push("    [#i. #d.at(0)], [#d.at(1)], [#d.at(2)],");
  lines.push("  )");
  lines.push("  v(2pt)");
  lines.push("}");
  lines.push("#v(1pt)");
  lines.push("#line(length: 100%, stroke: 0.6pt)");
  lines.push("#v(4pt)");
  lines.push("#grid(columns: (1fr, 1fr),");
  lines.push(`  [医师：${esc(doc.doctor)}], [药品金额：${esc(amount)} 元],`);
  lines.push("  [审核/调配：], [核对/发药：],");
  lines.push(")");
  lines.push(`#v(3pt) #text(size: 8pt)[${esc(doc.extra.note || doc.options.tips.join("  "))}]`);
  // 药品数据表（Typst 里用数组更省事）
  const rows = doc.drugs.map((d, i) => {
    const name = `${d.prefix ? d.prefix : ""}${d.name}${d.brand ? `(${d.brand})` : ""}`;
    const spec = d.spec ? `(${d.spec})` : "";
    const qty = `${trim(d.qty)}${d.unit || ""}`;
    const usage = d.usage || [d.dose, d.route, d.freq, d.days ? `×${d.days}天` : ""].filter(Boolean).join(" ");
    return `  ("${esc(`${name}${spec}`)}", "${esc(qty)}", "${esc(usage)}"),`;
  });
  const head = `#let __drugs = (\n${rows.join("\n")}\n)\n`;
  return [head, ...lines, ""].join("\n");
}
