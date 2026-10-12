/**
 * 重庆市九龙坡区中医院 处方笺（中药）
 *
 * 版面按 refs/cq_chongqing.png 逐项复刻（页宽 559pt，与照片 1:1.42 的纸张比例一致）：
 *   ① 左上「支付宝/微信」竖排小字 + 真实二维码，其下「发药药房：…」；
 *   ② 中上两行居中标题（院名 / 处 方 笺）；右上 NO·普通·条码·条码号·取药联；
 *   ③ 患者行（姓名 · 性别 · 年龄 · 门诊号）、科室行（科室 · 医疗类别 · 床号 · 日期）；
 *   ④ 费别行、证型诊断行——每行下方一条通栏分隔线；
 *   ⑤ Rx 下方**三栏药味宫格**（药名 + 克数，列优先排布；24 味 = 8 行 × 3 栏）；
 *   ⑥「（该处方结束，以下内容为空白）」+ 留白；剂数/煎服说明、嘱托、医师 / 药品金额、
 *      审核调配 / 核对发药、药事管理规定两行页脚。
 *
 * 可变内容自适应：药味按 n 自动分栏（列优先）、诊断 1~8 行顺延并下移宫格、
 * 宫格行距/字号随行数收缩、超宽文本按生成期实测宽度缩字号，均不溢出、不串栏。
 */
import { encodeCode128 } from "@/lib/barcode";
import type { DrugItem, PrescriptionDoc } from "@/lib/doc";
import { totalOf } from "@/lib/doc";
import { BARCODE_HELPER, QR_HELPER, esc, money, preamble, qrBlock, tw } from "@/templates/kit";
import type { Template } from "@/templates/types";

/**
 * 印刷日期的紧凑形态：2026-10-11 → 20261011。
 * 模板里「编号内嵌年月日」的字段（如取药联条码号 20231023108 的前 8 位）统一用它派生，
 * 使编号里的日期跟随 doc.printDate；表单里印刷日期是普通文本框，5 月 7 日可能写成 2026-5-7，
 * 故按年/月/日分别补零，拆不出三段时退回「取有效数字的前 8 位」（已是 20261011 这类紧凑写法）。
 */
const ymd = (d: string) => {
  const p = String(d || "").split(/\D+/).filter(Boolean);
  return p.length >= 3
    ? p[0].padStart(4, "0") + p[1].padStart(2, "0") + p[2].padStart(2, "0")
    : String(d || "").replace(/\D/g, "").slice(0, 8);
};

/* ─────────── 版面常量（pt；由参考照片按页宽比例换算） ─────────── */
/** 页宽 */
const W = 559;
/** 页高 */
const H = 794;
/** 左边距（照片里正文左起点 ≈ 19pt；与照片逐像素对齐后取值） */
const ML = 19;
/** 版心右界（分隔线 / 页脚止于此，照片里右侧留白更大） */
const MR = 521;
/** 版心宽 */
const CW = MR - ML;
/** 药味宫格三栏列起点（列距 191.5pt，与照片三栏等距一致） */
const COL_X = [19, 210.5, 402];
/** 单栏可用宽度（列距 - 栏间留白） */
const COL_W = 189;
/** 宫格起始 y 的下限（诊断多行时顺延） */
const GRID_TOP_MIN = 238;
/** 宫格下沿（保证 8 行 × 31pt 行距） */
const GRID_BOTTOM = 487;
/** 正文字号（照片里药味 / 各字段同一字号 ≈ 15pt） */
const BASE = 15;
/** 药名与克数之间的间距（em） */
const NAME_GAP = 0.7;
/** 顶部通栏分隔线 y（发药药房行与患者行之间） */
const RULE_TOP = 96;
/** 页脚：药事管理规定 */
const FOOT1 = "根据卫生部《医疗机构药事管理规定》除药品质量原因外，药品一经发出，不得退换";
const FOOT2 = "处方三日有效（急诊处方除外）";

/* ─────────── 生成期小工具（全部绝对定位，互不影响） ─────────── */
const n2 = (v: number) => String(Math.round(v * 100) / 100);
/** 绝对定位一块内容：页边距为 0，top+left 即页面左上角 */
const pin = (x: number, y: number, body: string) =>
  `#place(top + left, dx: ${n2(x)}pt, dy: ${n2(y)}pt)[${body}]`;
/** 通栏分隔线 */
const rule = (y: number, x1 = ML, x2 = MR, w = 0.6) =>
  pin(x1, y, `#line(length: ${n2(x2 - x1)}pt, stroke: ${w}pt)`);
/** 左对齐文本 */
const at = (x: number, y: number, s: string, size = BASE, weight?: string) =>
  pin(x, y, `#text(size: ${n2(size)}pt${weight ? `, weight: "${weight}"` : ""})[${esc(s)}]`);
/** 右对齐文本 */
const atRight = (xr: number, y: number, s: string, size = BASE, weight?: string) =>
  at(xr - tw(s) * size, y, s, size, weight);
/** 居中文本 */
const atCenter = (xc: number, y: number, s: string, size = BASE, weight?: string) =>
  at(xc - (tw(s) * size) / 2, y, s, size, weight);
/** 把 s 压进 maxW 宽所需字号（不低于 7pt） */
const fit = (s: string, maxW: number, size: number) =>
  Math.max(7, Math.min(size, maxW / Math.max(tw(s), 0.01)));
/** 一味药的用量文本：30.0g（照片统一一位小数 + g；无 tcm 的成药退化为数量+单位） */
const doseOf = (d: DrugItem) => {
  const tcm = Number(d.tcm);
  if (Number.isFinite(tcm) && tcm > 0) return `${tcm.toFixed(1)}${d.unit || "g"}`;
  const qty = d.qty === undefined || d.qty === null ? "" : String(d.qty);
  return qty ? `${qty}${d.unit || ""}` : "";
};

export const cq: Template = {
  id: "cq",
  name: "重庆市九龙坡区中医院处方笺（中药）",
  hospital: "重庆市九龙坡区中医院",
  desc: "中药处方：左上二维码与发药药房、Rx 下方三栏药味宫格（名称+克数）、剂数与煎服说明、嘱托、药品金额与药事规定页脚",
  group: "中药处方",
  page: { widthPt: W, heightPt: H },
  limits: { maxDiag: 8, maxDrugs: 60 },
  sections: { patient: true, identity: true, visit: true, diagnosis: true, drugs: true, drugTable: true, tcm: true, footer: true },
  extraKeys: [
    { key: "pharmacy", label: "发药药房" },
    { key: "rxNo", label: "NO / 处方号" },
    { key: "visitNo", label: "门诊号" },
    { key: "medicalId", label: "取药联条码号" },
    { key: "visitDate", label: "日期" },
    { key: "feeCategory", label: "费别" },
    { key: "note", label: "剂数与煎服说明" },
    { key: "amount", label: "药品金额" },
    { key: "qrText", label: "二维码内容" },
  ],
  defaults: {
    hospital: "重庆市九龙坡区中医院",
    docType: "普通",
    patientName: "王强", gender: "女", age: "26", dept: "中医内科一诊室",
    diagnoses: ["腰痛(肾气虚证)"],
    drugs: [
      { id: "c1", name: "熟地黄", brand: "", spec: "", price: 0, qty: 1, usage: "", tcm: 30.0, unit: "g" },
      { id: "c2", name: "牡丹皮", brand: "", spec: "", price: 0, qty: 1, usage: "", tcm: 3.0, unit: "g" },
      { id: "c3", name: "白芍", brand: "", spec: "", price: 0, qty: 1, usage: "", tcm: 8.0, unit: "g" },
      { id: "c4", name: "木香", brand: "", spec: "", price: 0, qty: 1, usage: "", tcm: 12.0, unit: "g" },
      { id: "c5", name: "盐补骨脂", brand: "", spec: "", price: 0, qty: 1, usage: "", tcm: 30.0, unit: "g" },
      { id: "c6", name: "甘草", brand: "", spec: "", price: 0, qty: 1, usage: "", tcm: 6.0, unit: "g" },
      { id: "c7", name: "盐杜仲", brand: "", spec: "", price: 0, qty: 1, usage: "", tcm: 15.0, unit: "g" },
      { id: "c8", name: "生姜", brand: "", spec: "", price: 0, qty: 1, usage: "", tcm: 12.0, unit: "g" },
      { id: "c9", name: "茯苓", brand: "", spec: "", price: 0, qty: 1, usage: "", tcm: 15.0, unit: "g" },
      { id: "c10", name: "山药", brand: "", spec: "", price: 0, qty: 1, usage: "", tcm: 12.0, unit: "g" },
      { id: "c11", name: "党参", brand: "", spec: "", price: 0, qty: 1, usage: "", tcm: 12.0, unit: "g" },
      { id: "c12", name: "醋香附", brand: "", spec: "", price: 0, qty: 1, usage: "", tcm: 15.0, unit: "g" },
      { id: "c13", name: "桂枝", brand: "", spec: "", price: 0, qty: 1, usage: "", tcm: 10.0, unit: "g" },
      { id: "c14", name: "北柴胡", brand: "", spec: "", price: 0, qty: 1, usage: "", tcm: 5.0, unit: "g" },
      { id: "c15", name: "续断", brand: "", spec: "", price: 0, qty: 1, usage: "", tcm: 15.0, unit: "g" },
      { id: "c16", name: "盐菟丝子", brand: "", spec: "", price: 0, qty: 1, usage: "", tcm: 24.0, unit: "g" },
      { id: "c17", name: "盐泽泻", brand: "", spec: "", price: 0, qty: 1, usage: "", tcm: 12.0, unit: "g" },
      { id: "c18", name: "当归", brand: "", spec: "", price: 0, qty: 1, usage: "", tcm: 5.0, unit: "g" },
      { id: "c19", name: "白术", brand: "", spec: "", price: 0, qty: 1, usage: "", tcm: 5.0, unit: "g" },
      { id: "c20", name: "乌药", brand: "", spec: "", price: 0, qty: 1, usage: "", tcm: 15.0, unit: "g" },
      { id: "c21", name: "大枣", brand: "", spec: "", price: 0, qty: 1, usage: "", tcm: 12.0, unit: "g" },
      { id: "c22", name: "黄芪", brand: "", spec: "", price: 0, qty: 1, usage: "", tcm: 24.0, unit: "g" },
      { id: "c23", name: "山萸肉", brand: "", spec: "", price: 0, qty: 1, usage: "", tcm: 12.0, unit: "g" },
      { id: "c24", name: "炒火麻仁", brand: "", spec: "", price: 0, qty: 1, usage: "", tcm: 15.0, unit: "g" },
    ],
    doctor: "郑安国",
    // rxNo(NO) = 纯流水号，不含日期 → 保持占位原样
    extra: { pharmacy: "煎煮中心药房", rxNo: "0000000",
      // 门诊号 / 取药联条码号含日期（20231023108 = 8 位日期 + 3 位序号）：留空 → build() 按印刷日期派生
      visitNo: "", medicalId: "",
      visitDate: "2026年07月25日", feeCategory: "", note: "6剂，每天一剂，水煎(煎药机)至600ml，分3次口服（中药），单次剂量200ml",
      amount: "134.65",
      // 二维码默认内容里嵌的也是取药联条码号（含日期）：留空 → 改用条码号本身，跟随派生值
      qrText: "" },
  },
  build: (doc: PrescriptionDoc) => {
    const ex = doc.extra;
    const amount = ex.amount?.trim() ? ex.amount.trim() : money(totalOf(doc.drugs));
    /* 编号：参考样张的取药联条码号与门诊号同为 20231023108 = 8 位日期 + 3 位序号，
       日期部分跟随印刷日期（2026-10-11 → 20261011108），长度与格式不变；表单手填的值优先。 */
    const derivedNo = ymd(doc.printDate) + "108";
    const visitNo = (ex.visitNo || "").trim() || derivedNo;
    /** 取药联条码号（条码 + 条码号文本 + 二维码内容）：手填优先，未填时与门诊号同值（样张两者就是同一个号） */
    const bcText = (ex.medicalId || "").trim() || visitNo;
    const head: string[] = [
      preamble(W, H, { margin: "0pt", baseSize: 10 }),
      "#set text(cjk-latin-spacing: none)",
      BARCODE_HELPER,
      QR_HELPER,
      "",
    ];
    const out: string[] = [];

    /* ① 左上：竖排「支付宝/微信」+ 二维码 + 发药药房 */
    out.push(pin(34, 11, qrBlock(ex.qrText || "https://pay.cqjlpzyy.com/" + (bcText || ""), 66)));
    const vert = ["支", "付", "宝", "/", "微", "信"].map((c) => `text(size: 8.5pt)[${c}]`).join(", ");
    out.push(pin(22, 14, `#stack(dir: ttb, spacing: 0.3pt, ${vert})`));
    out.push(at(ML, 78, `发药药房：${ex.pharmacy || ""}`));

    /* ② 中上标题两行 + 右上 NO / 普通 / 条码 / 条码号 / 取药联 */
    out.push(atCenter(253, 12, doc.hospital || "重庆市九龙坡区中医院", 18.5, "bold"));
    const t2Size = 18.5;
    const t2Gap = 0.45;
    const t2W = t2Size * 3 + t2Size * t2Gap * 2;
    out.push(pin(253 - t2W / 2, 35, `#text(size: ${n2(t2Size)}pt)[处#h(${t2Gap}em)方#h(${t2Gap}em)笺]`));
    if (ex.rxNo) out.push(atRight(463, 18, `NO: ${ex.rxNo}`, 13.5));
    out.push(atCenter(434, 32.5, doc.docType || "普通", 13));
    if (bcText) {
      out.push(`#let __bc = (${encodeCode128(bcText).widths.join(", ")})`);
      out.push(pin(360, 46.5, "#barcode(__bc, 168pt, 12pt)"));
      out.push(atCenter(444.6, 62.5, bcText, 20));
      out.push(atRight(508, 81, "取药联", 14));
    }
    out.push(rule(RULE_TOP));

    /* ③ 患者行 / 科室行 */
    out.push(at(ML, 104, `姓名：${doc.patientName || ""}`, fit(`姓名：${doc.patientName || ""}`, 157.5 - ML - 6, BASE)));
    out.push(at(162, 104, `性别：${doc.gender || ""}`));
    out.push(at(265, 104, doc.age ? `年龄：${doc.age}岁` : "年龄："));
    const visitNoLine = `门诊号:${visitNo}`;
    out.push(at(360, 104, visitNoLine, fit(visitNoLine, 495 - 360 + 0.5, BASE)));
    const deptLine = `科室：${doc.dept || ""}`;
    out.push(at(ML, 128, deptLine, fit(deptLine, 174 - ML - 4, BASE)));
    out.push(at(174, 128, "医疗类别："));
    out.push(at(301, 128, "床号："));
    const dateLine = ex.visitDate || doc.printDate || "";
    out.push(at(390, 128, dateLine, fit(dateLine, MR - 390, BASE)));
    out.push(rule(146));

    /* ④ 费别行 / 证型诊断行 */
    out.push(at(ML, 155, `费别：${ex.feeCategory || ""}`));
    out.push(rule(171));

    const diagList = doc.diagnoses.map((d) => (d || "").trim()).filter(Boolean);
    const shown = (diagList.length ? diagList : [""]).slice(0, 8);
    const dSize = shown.length > 3 ? 12.5 : BASE;
    const dLead = shown.length > 3 ? 14 : 16;
    const diagTop = 177;
    shown.forEach((d, i) => {
      const s = i === 0 ? `证型诊断：${d}` : d;
      const x = i === 0 ? ML : ML + 5 * dSize;
      out.push(at(x, diagTop + i * dLead, s, fit(s, MR - x, dSize)));
    });
    const ruleDiagY = diagTop + shown.length * dLead + 5;
    out.push(rule(ruleDiagY));

    /* ⑤ Rx + 三栏药味宫格（列优先：先填满第 1 栏再第 2、3 栏） */
    const gridTop = Math.max(GRID_TOP_MIN, ruleDiagY + 10);
    out.push(pin(10, gridTop - 34, '#text(size: 26pt, weight: "bold", style: "italic", font: "Times New Roman")[R]'));
    const drugs = doc.drugs ?? [];
    const rows = Math.max(1, Math.ceil(drugs.length / COL_X.length));
    const pitch = Math.min(31, (GRID_BOTTOM - gridTop) / rows);
    const gridSize = Math.min(BASE, pitch * 0.48);
    drugs.forEach((d, i) => {
      const col = Math.floor(i / rows);
      if (col >= COL_X.length) return;
      const row = i % rows;
      const name = d.name || "";
      const dose = doseOf(d);
      const w0 = (tw(name) + (dose ? NAME_GAP + tw(dose) : 0)) * gridSize;
      const size = w0 > COL_W ? Math.max(7, gridSize * (COL_W / w0)) : gridSize;
      const body = dose ? `${esc(name)}#h(${NAME_GAP}em)${esc(dose)}` : esc(name);
      out.push(pin(COL_X[col], gridTop + row * pitch, `#text(size: ${n2(size)}pt)[${body}]`));
    });

    /* ⑥ 结束语 / 剂数煎服说明 / 嘱托 / 医师 / 审核调配 / 页脚 */
    out.push(at(ML, 490, "（该处方结束，以下内容为空白）", 12));
    const usage = (ex.note || "").trim();
    if (usage) out.push(at(ML, 629, usage, fit(usage, CW, BASE)));
    out.push(at(ML, 668, "嘱托："));
    out.push(rule(685));
    out.push(at(ML, 695, `医师：${doc.doctor || ""}`));
    out.push(at(324, 695, "药品金额", 17));
    out.push(atRight(464, 695, amount, fit(amount, 464 - 410, 17)));
    out.push(rule(713));
    out.push(at(ML, 721, "审核、调配："));
    out.push(at(326, 721, "核对、发药："));
    out.push(rule(741));
    out.push(at(ML, 752, FOOT1, fit(FOOT1, CW, 13)));
    out.push(at(ML, 771, FOOT2, fit(FOOT2, CW, 13)));

    return [...head, ...out, ""].join("\n");
  },
};
