import type { PrescriptionDoc } from "@/lib/doc";
import { BARCODE_HELPER, barcodeBlock, money, preamble, ruleLine, total, tw } from "@/templates/kit";
import type { Template } from "@/templates/types";

/**
 * 北京大学第三医院处方（医保）门诊
 * 版面按 refs/bj3_beiyi.png 逐项测量复刻（横向 A4 842 × 595.3pt）：
 *
 *   ① 页眉     左上 Code128 条码 + ID号；居中大标题「北京大学第三医院处方」+ 小字「（医保）」，右侧「门诊」
 *   ② 患者栏   三行三列：ID号 · 姓名 · 单位 | 身份 · 性别 · 年龄 | 社保号 · 定点医疗机构编码 · 证件号
 *   ③ 就诊栏   就诊科室 / 就诊次 / 就诊日期（三家分列），下接一条通栏横线
 *   ④ 诊断栏
 *   ⑤ 药品区   RP + 五列表头（药品名称/规格 | 数量 | 频率 | 用量 | 给药途径）；每条药品占两行：
 *              第 1 行 = 带圈序号 + 名称（厂牌），第 2 行 = （规格）（单价 元）+ 超限原因
 *   ⑥ 页脚     横线 → 审核/发药 · 取药药房 · 医师 → 提示（三条须知）→ 合计金额/打印时间
 *              → 费用类别 → 就诊次/证件号 → 底部说明
 *
 * 坐标定义：以「照片纸边」为基准换算到页面 pt。参考照片整页 = 1400px 宽，
 * 纸左边缘 x≈22.8px、右边缘 x≈1370px，故 1px ≈ 0.6143pt，页面左边距取 22.8pt，右边距取 21pt。
 * 纵向容差已按照片行基线逐条校准（水平方向留白以竖线/横线为准）。
 *
 * 可变内容适配：药品 1~6 条、诊断 1~6 条、姓名/科室长短不一；
 * 所有单行文本都带 maxw，超宽由 Typst 端按比例缩字号，保证不溢出、不串栏；
 * 药品条数超过 4 条时页脚整体下移，避免压到药表。
 */

const PAGE_W = 842;
const PAGE_H = 595.3;

// ── 横向基准（pt） ────────────────────────────────────────
const X_L = 22.8;      // 版心左边距（ID号/姓名/科室/诊断/提示/费用类别共用）
const X_R = 820.5;     // 版心右边界（左边距 22.8 / 右边距 21.5，左右对称）
const X_C = 429.5;     // 版心水平中心（标题居中位）
const P_X1 = 22.8;     // 患者栏第 1 列
const P_X2 = 274.7;    // 患者栏第 2 列
const P_X3 = 507.4;    // 患者栏第 3 列
const D_NO = 377;      // 就诊次（三家分列的中间一格）
const D_DATE = 587.2;  // 就诊日期
const F_MID = 425;     // 页脚中栏（取药药房）
const F_RIGHT = 767;   // 页脚右栏（医师 / 合计金额）

/** 药品表格列（绝对坐标 pt；x 为起笔点或居中点，w 为可用宽度） */
const COLS = {
  name: { x: 22.1, center: 0, w: 400 },    // ② + 名称（厂牌），左对齐
  spec: { x: 34.2, center: 0, w: 400 },    // （规格）（单价 元）+ 超限原因，左对齐
  qty: { x: 536.4, center: 1, w: 70 },     // 数量，居中（照片 743~775px）
  freq: { x: 601.3, center: 1, w: 70 },    // 频率，居中（照片 812~916px）
  dose: { x: 660.6, center: 1, w: 70 },    // 用量，居中（照片 945~1014px）
  route: { x: 727.2, center: 1, w: 80 },   // 给药途径，居中（照片 1106~1212px）
} as const;

// ── 纵向基准（pt） ────────────────────────────────────────
const Y = {
  barcodeY: 9.8,      // 条码顶
  barcodeW: 202,
  barcodeH: 49,
  barcodeText: 60.5,  // 条码下方细号（条码下沿 58.8pt，留 1.7pt 间隙）
  head: 24.6,         // 标题行
  p1: 86.6,           // 患者第 1 行
  pStep: 19.2,        // 患者行距
  dept: 152.0,        // 就诊科室 / 就诊次 / 就诊日期
  diag: 166.5,        // 诊断（字形高 12pt：166.5~178.5）
  rule: 180.8,        // 通栏横线（诊断字形下沿 178.5 + 2.3pt 间隙）
  rp: 196.4,          // RP（横线 + 15.6pt，与照片一致）
  drugHead: 200.4,    // 五列表头
  drugTop: 220.8,     // 第 1 条药品
  drugRow: 36.3,      // 每条药品占高（照片实测两行 36.3pt）
  offName: 0,         // 名称行 = 药品块首行
  offSpec: 17,        // 规格行（名称基线 + 17pt）
} as const;

// ── 页脚纵向基准（pt，相对于 fy() 的基准线） ──────────────
const F = {
  rule: 437,          // 页脚上方通栏横线
  base: 445,          // 页脚第一行（审核 / 发药 / 取药药房 / 医师）
  rowGap: 17.6,       // 右栏行距
  tips: 463,          // 提示第一行
  tipsGap: 17,        // 提示行距
  fee: 514,           // 费用类别
  note: 531,          // 底部说明（此处方仅作报销用）
} as const;

// ── 字号（pt） ────────────────────────────────────────────
const S = {
  title: 19,
  titleSub: 10,
  clinic: 14,
  body: 12,           // 患者栏 / 就诊栏 / 诊断
  tiny: 10,           // 条码下方细号
  rp: 15,
  drugHead: 11,
  drugName: 11.5,
  drugSpec: 11,
  drugVal: 11.5,
  foot: 12,           // 页脚主行
  small: 11.5,        // 页脚次行
  tips: 11.5,         // 提示正文
  tipsHead: 11.5,     // 「提示：」
} as const;

/** 最多打印几条药品 */
const MAX_DRUGS_PRINT = 6;

/**
 * Typst 字符串转义：**先反斜杠，再引号，最后方括号与引用符 @**。
 * 顺序不能调换，否则会二次转义刚补上的反斜杠；与 kit 的 `esc()` 前两步一致，内联以保证转义链自包含。
 */
const esc = (s: string) =>
  String(s ?? "")
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\[/g, "\\[")
    .replace(/\]/g, "\\]")
    .replace(/(^|[^\w])@/g, "$1\\@");

/** 数值：两位小数去掉无意义尾零（51.64 → 51.64，1.00 → 1） */
const num = (v: number, d = 2) => {
  const s = (Math.round((Number(v) || 0) * Math.pow(10, d)) / Math.pow(10, d)).toFixed(d);
  return s.replace(/\.?0+$/, "") || "0";
};

interface Txt {
  x: number;
  y: number;
  size: number;
  text: string;
  weight?: "bold";
  /** 字距（pt）：用于「医师：」这类需要撑满签名位的栏 */
  track?: number;
  /** left / center / right，默认 left */
  align?: "left" | "center" | "right";
  /** 可用宽度（pt）：超宽时由 Typst 端按比例缩字号，保证不溢出、不串栏 */
  maxw?: number;
  /** 缩字号的下限（pt），如提示正文不希望缩得太小 */
  minSize?: number;
}

/**
 * Typst 文本排版 helper：按绝对坐标摆一行文字，超宽自动等比缩字号。
 * 注意：参数名不能用 body / text / size（会遮蔽 Typst 内置），缩放比例要先算成无量纲数。
 */
const T_HELPER = [
  "// T(x, y, size, s, weight, align, maxw, track)：绝对坐标排版一行文字",
  '#let T(x, y, size, s, weight: "regular", align: "left", maxw: 0pt, track: 0pt, minSize: 0pt) = context {',
  '  let mk(z) = text(size: z, weight: weight, tracking: track, s)',
  '  let t0 = mk(size)',
  '  let w0 = measure(t0).width',
  '  let ratio = float(maxw / w0)',
  '  let floor = if minSize > 0pt { minSize } else { 6pt }',
  '  let sc = if maxw > 0pt and ratio < 1 { calc.max(size * ratio, floor) } else { size }',
  '  let t = if sc == size { t0 } else { mk(sc) }',
  '  let w = if sc == size { w0 } else { measure(t).width }',
  '  let dx = if align == "center" { x - w / 2 } else if align == "right" { x - w } else { x }',
  '  place(dx: dx, dy: y, t)',
  '}',
].join("\n");

/** 生成一条排版指令（空文本直接跳过） */
function t(r: Txt): string {
  if (!r.text) return "";
  const a = [num(r.x, 1) + "pt", num(r.y, 1) + "pt", num(r.size, 1) + "pt", '"' + esc(r.text) + '"'];
  if (r.weight) a.push('weight: "' + r.weight + '"');
  if (r.track) a.push("track: " + num(r.track, 1) + "pt");
  if (r.align && r.align !== "left") a.push('align: "' + r.align + '"');
  if (r.maxw) a.push("maxw: " + num(r.maxw, 1) + "pt");

  if (r.minSize) a.push("minSize: " + num(r.minSize, 1) + "pt");
  return "#T(" + a.join(", ") + ")";
}

/**
 * 药品拆成两行文本（与照片一致）：
 *   第 1 行：②布地奈德鼻喷雾剂（雷诺考特）
 *   第 2 行：（120喷 64UG/喷雾）（51.64元）   超限原因:慢性病患者
 */
function drugLines(d: PrescriptionDoc["drugs"][number]): { name: string; spec: string } {
  const brand = d.brand ? "（" + d.brand + "）" : "";
  const name = (d.prefix || "") + d.name + brand;
  const parts: string[] = [];
  if (d.spec) parts.push("（" + d.spec + "）");
  if (d.price) parts.push("（" + money(Number(d.price)) + "元）");
  const note = d.note ? "   " + d.note : "";
  // 没有填频率/用量/途径时，退回用法描述，避免表格空格
  const usage = !d.freq && !d.dose && !d.route && d.usage ? "   " + d.usage : "";
  return { name, spec: parts.join("") + note + usage };
}

/** 默认三条须知（照片原文），表单里填了提示就优先用表单的 */
const TIPS_REF = [
  "此处方有效期为三天（含当日）。为了您与其他患者的用药安全，药品发出后不予退换",
  "(2)注意合理用药，多科就诊可能造成重复用药",
  "(3)如有任何用药问题请拨打临床药师咨询电话：82264130",
];

/** 默认选项：提示默认关闭（空值时用样张原文） */
const OPTIONS_REF = {
  showTips: false,      // 表单未填提示时用样张原文（TIPS_REF），避免出现通用提示
  tips: [] as string[],
  showBarcode: true,
  showPrintDate: true,
  showSerial: true,
  showFeeLine: true,
  showFeeMark: true,
  showSign: true,
  showUsage: false,
  showMoney: false,
};

export function buildBj3(doc: PrescriptionDoc): string {
  const L: string[] = [];
  const push = (...xs: string[]) => xs.forEach((s) => { if (s) L.push(s); });
  /** 排版一行文字（= t() 的别名，便于阅读） */
  const mk = t;

  L.push(preamble(PAGE_W, PAGE_H, { margin: "0pt", baseSize: 10 }));
  L.push(BARCODE_HELPER);
  L.push(T_HELPER);
  L.push("");

  const bcText = doc.extra.medicalId || doc.cardNo;
  const idNo = doc.extra.caseNo && doc.extra.caseNo.trim() ? bcText + "_" + doc.extra.caseNo.trim() : bcText;
  const drugs = doc.drugs.slice(0, MAX_DRUGS_PRINT);
  const amount = doc.extra.amount && doc.extra.amount.trim() ? doc.extra.amount.trim() : money(total(doc));
  const tipList = (doc.options.tips.filter((s) => s.trim()).length ? doc.options.tips : TIPS_REF)
    .map((s) => s.replace("82264130", doc.extra.phone || "82264130"))
    .slice(0, 3);

  // ── ① 页眉 ──────────────────────────────────────────────
  if (bcText) {
    // 条码块必须自带 __bars 定义：流式布局里变量不会跨内容块可见
    const bc = barcodeBlock(bcText, Y.barcodeW, Y.barcodeH).split("\n").join("\n  ");
    L.push("#place(dx: " + num(X_L, 1) + "pt, dy: " + num(Y.barcodeY, 1) + "pt)[\n  " + bc + "\n]");
  }
  push(mk({ x: X_L, y: Y.barcodeText, size: S.tiny, text: idNo, maxw: 160 }));
  push(mk({ x: X_C, y: Y.head, size: S.title, text: doc.hospital + "处方", weight: "bold", align: "center", maxw: 340 }));
  push(mk({ x: X_C + 230, y: Y.head + 3.5, size: S.titleSub, text: "（" + (doc.docType || "医保") + "）", maxw: 70 }));
  push(mk({ x: X_C + 301, y: Y.head + 3, size: S.clinic, text: "门诊", align: "center", maxw: 70 }));

  // ── ② 患者栏（三行三列） ────────────────────────────────
  const rowY = (row: number) => Y.p1 + row * Y.pStep;
  const px = [P_X1, P_X2, P_X3] as const;
  const rows: string[][] = [
    ["ID号： " + bcText, "身份： " + doc.extra.idType, "社保号： " + doc.extra.ssn],
    ["姓名： " + doc.patientName, "性别： " + doc.gender, "定点医疗机构编码： " + doc.extra.orgCode],
    ["单位：" + (doc.extra.unitName ? " " + doc.extra.unitName : ""), "", "证件号："],
  ];
  rows.forEach((row, ri) => {
    row.forEach((txt, ci) => {
      push(mk({ x: px[ci], y: rowY(ri), size: S.body, text: txt, maxw: 236.7 }));
    });
  });
  push(mk({ x: P_X1 + 90, y: rowY(1), size: S.body, text: "年龄：", maxw: 44 }));
  push(mk({ x: P_X1 + 134, y: rowY(1), size: S.body, text: doc.age ? doc.age + "岁" : "", maxw: 70 }));

  // ── ③ 就诊栏 + ④ 诊断栏 ────────────────────────────────
  /* 科室名可能很长：「就诊科室」最多占 296pt；「就诊次」固定落在版心中间偏右，三家分列互不相压 */
  push(mk({ x: X_L, y: Y.dept, size: S.body, text: "就诊科室：   " + doc.dept, maxw: 296 }));
  push(mk({ x: D_NO, y: Y.dept, size: S.body, text: "就诊次：" + (doc.extra.visitNo || ""), maxw: 150 }));
  push(mk({ x: D_DATE, y: Y.dept, size: S.body, text: "就诊日期： " + (doc.extra.visitDate || doc.printDate), maxw: 230 }));
  // 诊断是单行绝对定位：先按"可读下限 7pt 能容纳多少"截断，再交 Typst 端按 maxw 缩字号。
  // 这样既不会缩成不可读的小字，也不会越界被右边缘裁掉（上一版 minSize=7 无截断时会溢出 42px）。
  const DIAG_FLOOR = 7;
  const diagMaxEm = (X_R - X_L) / DIAG_FLOOR;
  const diagRaw = doc.diagnoses.filter(Boolean).join("；");
  const diag = (() => {
    if (tw("诊断： ") + tw(diagRaw) <= diagMaxEm) return diagRaw;
    let w = tw("诊断： ") + 1;
    let acc = "";
    for (const ch of diagRaw) {
      const cw = ch.charCodeAt(0) > 0x2e80 ? 1 : 0.5;
      if (w + cw > diagMaxEm) break;
      w += cw;
      acc += ch;
    }
    return acc + (acc.length < diagRaw.length ? "…" : "");
  })();
  push(mk({ x: X_L, y: Y.diag, size: S.body, text: diag ? "诊断： " + diag : " 诊断：", maxw: X_R - X_L, minSize: DIAG_FLOOR }));
  push(ruleLine(X_L, Y.rule, X_R, Y.rule, 0.7));

  // ── ⑤ 药品区（RP + 五列表头 + 两行/条） ────────────────
  push(mk({ x: X_L, y: Y.rp, size: S.rp, text: "RP", weight: "bold" }));
  push(mk({ x: 42.4, y: Y.drugHead, size: S.drugHead, text: "药品名称/规格", maxw: 200 }));
  push(mk({ x: COLS.qty.x, y: Y.drugHead, size: S.drugHead, text: "数量", align: "center", maxw: COLS.qty.w }));
  push(mk({ x: COLS.freq.x, y: Y.drugHead, size: S.drugHead, text: "频率", align: "center", maxw: COLS.freq.w }));
  push(mk({ x: COLS.dose.x, y: Y.drugHead, size: S.drugHead, text: "用量", align: "center", maxw: COLS.dose.w }));
  push(mk({ x: COLS.route.x, y: Y.drugHead, size: S.drugHead, text: "给药途径", align: "center", maxw: COLS.route.w }));

  drugs.forEach((d, i) => {
    const top = Y.drugTop + i * Y.drugRow;
    const dl = drugLines(d);
    push(mk({ x: COLS.name.x, y: top + Y.offName, size: S.drugName, text: dl.name, maxw: COLS.name.w }));
    push(mk({ x: COLS.spec.x, y: top + Y.offSpec, size: S.drugSpec, text: dl.spec, maxw: COLS.spec.w }));
    push(mk({ x: COLS.qty.x, y: top + Y.offName, size: S.drugVal, text: d.qty ? num(d.qty) + (d.unit || "") : "", align: "center", maxw: COLS.qty.w }));
    push(mk({ x: COLS.freq.x, y: top + Y.offName, size: S.drugVal, text: d.freq || "", align: "center", maxw: COLS.freq.w }));
    push(mk({ x: COLS.dose.x, y: top + Y.offName, size: S.drugVal, text: d.dose || "", align: "center", maxw: COLS.dose.w }));
    push(mk({ x: COLS.route.x, y: top + Y.offName, size: S.drugVal, text: d.route || "", align: "center", maxw: COLS.route.w }));
  });

  // ── ⑥ 页脚 ──────────────────────────────────────────────
  // 4 条以内页脚保持照片里的位置；5~6 条时整体下移，最多下移 22pt，保证底部说明仍在纸内
  const drugEnd = Y.drugTop + drugs.length * Y.drugRow + 6;
  const shift = Math.max(0, Math.min(22, drugEnd - F.rule));
  const fy = (v: number) => v + shift;

  push(ruleLine(X_L, fy(F.rule), X_R, fy(F.rule), 0.7));
  // 左栏第一行：审核 / 发药（与照片一样分列摆放）
  push(mk({ x: X_L, y: fy(F.base), size: S.foot, text: "审核：", maxw: 60 }));
  push(mk({ x: 376.4, y: fy(F.base + 6.7), size: S.foot, text: "发药：", maxw: 60 }));
  // 提示：三条须知逐行；正文用 maxw 兜底，较长时由 Typst 端缩字号保证单行不折行
  tipList.forEach((s, i) => {
    push(mk({ x: X_L + 30, y: fy(F.tips + i * F.tipsGap), size: S.tips, text: (i === 0 ? "提示：" : "") + s, maxw: 470, minSize: 9 }));
  });
  push(mk({ x: X_L, y: fy(F.fee), size: S.small, text: "费用类别：   ①公费  ②部分自费  ③自费 ⑦儿童 ⑧ 工伤  ⑨生育", maxw: 500 }));
  push(mk({ x: X_L + 34, y: fy(F.note), size: S.small, text: doc.extra.note || "", maxw: 300 }));

  /* 页脚右栏：取药药房 → 医师（签名位）→ 合计金额 → 打印时间 → 就诊次/证件号 */
  push(mk({ x: F_MID, y: fy(F.base), size: S.foot, text: "取药药房： " + (doc.extra.pharmacy || ""), maxw: 224 }));
  push(mk({ x: F_RIGHT, y: fy(F.base), size: S.foot, text: "医师：", maxw: 60 }));
  // 照片里医生签名正好压在「医师：」上，用字距把名字撑到与照片同宽
  push(mk({ x: X_R, y: fy(F.base + F.rowGap - 4), size: S.small, text: doc.doctor, track: 5, align: "right", maxw: 84 }));
  // 「合计金额」「打印时间」同一起笔位（与照片一致），值过长时右端自动收在版心内
  push(mk({ x: 600, y: fy(F.base + 2 * F.rowGap), size: S.small, text: "合计金额： " + amount + "元", maxw: 200 }));
  push(mk({ x: 600, y: fy(F.base + 3 * F.rowGap), size: S.small, text: "打印时间： " + (doc.extra.printTime || ""), maxw: 200 }));
  // 页脚右栏到此为止（医师 / 合计金额 / 打印时间），不再重复页眉的「就诊次 / 证件号」

  L.push("");
  return L.join("\n");
}

export const bj3: Template = {
  id: "bj3",
  name: "北京大学第三医院处方（医保）门诊",
  hospital: "北京大学第三医院",
  desc: "按参考样张复刻：左上条码 + ID号/病案号、姓名/身份/社保号、单位/性别/年龄/定点编码、就诊科室/就诊次/就诊日期、诊断；药品为五列表格（药品名称/规格 | 数量 | 频率 | 用量 | 给药途径），每条两行；页脚取药药房/医师/审核/发药 + 提示 + 费用类别 + 合计金额 + 打印时间",
  group: "门诊电子处方",
  page: { widthPt: PAGE_W, heightPt: PAGE_H },
  limits: { maxDiag: 6, maxDrugs: MAX_DRUGS_PRINT },
  sections: {
    patient: true,
    identity: true,
    visit: true,
    diagnosis: true,
    drugs: true,
    drugTable: true,
    tcm: false,
    footer: true,
  },
  extraKeys: [{ key: "medicalId", label: "ID号" }, { key: "caseNo", label: "病案号" }, { key: "idType", label: "身份" }, { key: "ssn", label: "社保号" }, { key: "orgCode", label: "定点医疗机构编码" }, { key: "unitName", label: "单位" }, { key: "visitNo", label: "就诊次" }, { key: "visitDate", label: "就诊日期" }, { key: "pharmacy", label: "取药药房" }, { key: "amount", label: "合计金额" }, { key: "printTime", label: "打印时间" }, { key: "note", label: "页脚说明" }],
  defaults: {
    hospital: "北京大学第三医院",
    docType: "医保处方",
    patientName: "李娜", gender: "女", age: "31", dept: "北方院区耳鼻喉科门诊",
    diagnoses: ["咽喉炎", "鼻后滴漏", "鼻炎"],
    drugs: [
      { id: "b1", name: "布地奈德鼻喷雾剂", brand: "雷诺考特", spec: "120喷 64UG/喷雾", price: 51.64, qty: 1, usage: "", prefix: "②", unit: "支", freq: "二次/日", dose: "2喷/次", route: "喷鼻" },
      { id: "b2", name: "桉柠蒎肠溶胶囊", brand: "切诺", spec: "0.3g x18粒/盒", price: 23.77, qty: 3, usage: "", prefix: "②", unit: "盒", freq: "3次/日", dose: "0.3g/次", route: "口服<饭前>", note: "超限原因:慢性病患者" },
      { id: "b3", name: "氯雷他定片", brand: "开瑞坦片", spec: "10mg x6片/盒", price: 14.98, qty: 3, usage: "", prefix: "①", unit: "盒", freq: "1次/每晚", dose: "10mg/次", route: "口服", note: "超限原因:慢性病患者" },
      { id: "b4", name: "金噪散结胶囊", brand: "", spec: "0.4g x36粒/盒", price: 67.14, qty: 4, usage: "", prefix: "②", unit: "盒", freq: "二次/日", dose: "1.6g/次", route: "口服", note: "超限原因:慢性病患者" },
    ],
    options: { ...OPTIONS_REF } as PrescriptionDoc["options"],
    doctor: "周文博",
    extra: { medicalId: "000000000000", caseNo: "", idType: "异地医保患者", ssn: "F00000000000", orgCode: "08110010",
      unitName: "", visitNo: "2", visitDate: "2026-05-29", pharmacy: "北方医院门诊药房", amount: "436.45",
      printTime: "2026-05-29 13:07:57", note: "此处方仅作报销用",
      qrText: "https://rx.puh3.net.cn/000000000000" },
  },
  build: buildBj3,
};
