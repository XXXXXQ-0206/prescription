/**
 * 郑州市中心医院处方笺 —— 按参考照片 refs/zz_zhengzhou.png 逐项复刻的版面。
 *
 * 版面结构（自上而下）：
 *   ① 二维码（"扫码支付"）  ② 标题「郑州市中心医院处方笺」  ③ 右上角「普通处方 / 处方当日有效」方框
 *   ④ 费别 + 处方号   ⑤ 姓名 + 性别 + 年龄   ⑥ 科别 + 住院（门诊）号 + 日期
 *   ── 横线 ──  ⑦ 临床诊断   ── 粗横线 ──  ⑧ Rp: 药品（规格/数量右对齐 + 用法 + 备注）
 *   ⑨「以下处方空白」  ⑩ 页脚：药费 / 医师签名 / 审核、调配 / 核对、发药 / 第N页 共N页 / 打印时间
 *
 * 坐标来源：参考照片去倾斜（-4.5°）后逐像素测量，1 参考像素 ≈ 0.312pt（A5 页面 419.5×595.3pt）。
 * 全部文字用 G/T/TC/TR 绝对定位，带 maxw 自动缩字号兜底；药品 1~6 条、诊断 1~6 行时行距自动压缩，
 * 保证不越界、不串栏。
 */
import type { PrescriptionDoc } from "@/lib/doc";
import { MAX_DIAG_LINES, MAX_DRUGS, totalOf } from "@/lib/doc";
import { QR_HELPER, esc, money, preamble, qrBlock, trim } from "@/templates/kit";
import type { Template } from "@/templates/types";

/**
 * 印刷日期的紧凑形态：2026-10-11 → 20261011。
 * 模板里「编号内嵌年月日」的字段（如处方号 20260507009159 的前 8 位）统一用它派生，
 * 使编号里的日期跟随 doc.printDate；表单里印刷日期是普通文本框，5 月 7 日可能写成 2026-5-7，
 * 故按年/月/日分别补零，拆不出三段时退回「取有效数字的前 8 位」（已是 20261011 这类紧凑写法）。
 */
const ymd = (d: string) => {
  const p = String(d || "").split(/\D+/).filter(Boolean);
  return p.length >= 3
    ? p[0].padStart(4, "0") + p[1].padStart(2, "0") + p[2].padStart(2, "0")
    : String(d || "").replace(/\D/g, "").slice(0, 8);
};

/* ── 页面与内容框（pt） ───────────────────────────────────────── */
const PAGE_W = 419.5;
const PAGE_H = 595.3;
const L = 40; // 内容左边界
const R = 377; // 内容右边界

/* ── 字号（pt） ───────────────────────────────────────────────── */
const BODY = 9.5; // 正文（费别/姓名/药品/页脚…）
const TITLE = 13.5; // 医院名标题
const BOX_FONT = 9.5; // 右上角方框
const RP_FONT = 12.5; // Rp:
const FOOT_SMALL = 7.5; // 页脚第三行（第N页/共N页、打印时间）——参考照片此处字号明显小于上面两行

/* ── 纵向位置（文字中心 y，pt） ───────────────────────────────── */
const Y = {
  boxTop: 23.4,
  boxBot: 46.8,
  boxMid: 32.7,
  title: 33.7, // 标题墨迹中心与右上角方框中心对齐（方框 23.4~46.8 → 中心 35.1）
  scan: 36.3,
  row1: 69.7, // 费别 / 处方号
  row2: 91.5, // 姓名 / 性别 / 年龄
  row3: 113.7, // 科别 / 住院（门诊）号 / 日期
  rule1: 122,
  diag: 132.4, // 临床诊断
  rule2: 142.2,
  rp: 152,
  drug: 172.7, // 第 1 条药品首行
  blank: 284.5, // 「以下处方空白」
  fRule: 535, // 页脚横线（参考照片实测 535.0）
  fRow1: 543, // 药费 / 医师签名（参考 543.4）
  fRow2: 561, // 审核、调配 / 核对、发药（参考 561.9）
  fRow3: 579, // 第 N 页 共 N 页 / 打印时间（参考 579.1）——三行等距 18pt
};

/* ── 横向位置（pt） ───────────────────────────────────────────── */
const X = {
  boxL: 298.6,
  boxR: 362.5,
  boxMid: (298.6 + 362.5) / 2,
  scan: 48.7,
  qr: 42,
  qrTop: 42.4,
  qrSide: 66, // 参考照片量到二维码 69.2pt 宽 × 61.8pt 高（照片竖向压缩）；二维码必须正方形，
  //            66pt 是既不压到下方「科别」行（留 3pt）又不与「扫码支付」重叠的最大值
  rxR: R, // 处方号值右端与「日期」值右端统一到版心右边界
  fee: 114,
  name: 114,
  sex: 196,
  age: 262,
  visit: 149.8,
  diag: 90,
  idx: 36,
  drug: 67,
  specR: 322,
  qtyR: 368,
  usage: 58,
  sig: 208, // 医师签名（右栏统一列）
  check: 208, // 核对、发药（右栏统一列，与「医师签名：」同为 5 字，左右端都齐）
  page: 136, // 第N页 共N页（参考 136.8）
  print: 232, // 打印时间（参考 232.3；第三行是独立行，不并入右栏）
};

/* ── 药品块行距（pt，参考照片实测；条数多时按比例压缩） ────────── */
const PITCH = 18.1; // 药名行 → 用法行
const NOTE_PITCH = 18.1; // 用法行 → 备注行
const GAP = 33.7; // 上一条用法行 → 下一条药名行
const DIAG_PITCH = 15; // 诊断多行时的行距

interface Run {
  x: number;
  y: number;
  size: number;
  text: string;
  anchor?: "l" | "c" | "r";
  weight?: "regular" | "bold";
  font?: string[];
  maxw?: number;
}

const n = (v: number) => {
  const s = v.toFixed(2);
  return s.replace(/\.?0+$/, "") || "0";
};

/** Typst 定位 helper：maxw>0 且实测超宽时按比例缩字号，保证不越界 */
const HELPERS = [`#let G(x, y, size, body, font: "SimSun", weight: "regular", mode: "l", maxw: 0pt) = context {`,
`  let mk(s) = text(font: font, size: s, weight: weight, body)`,
`  let t0 = mk(size)`,
`  let w0 = measure(t0).width`,
`  let s = if maxw > 0pt and w0 > maxw { size * (maxw / w0) } else { size }`,
`  let t = if s == size { t0 } else { mk(s) }`,
`  let w = if s == size { w0 } else { measure(t).width }`,
`  let dx = if mode == "c" { x - w / 2 } else if mode == "r" { x - w } else { x }`,
`  place(dx: dx, dy: y, t)`,
`}`,
`#let T(x, y, size, body, font: "SimSun", weight: "regular", maxw: 0pt) = G(x, y, size, body, font: font, weight: weight, mode: "l", maxw: maxw)`,
`#let TC(x, y, size, body, font: "SimSun", weight: "regular", maxw: 0pt) = G(x, y, size, body, font: font, weight: weight, mode: "c", maxw: maxw)`,
`#let TR(x, y, size, body, font: "SimSun", weight: "regular", maxw: 0pt) = G(x, y, size, body, font: font, weight: weight, mode: "r", maxw: maxw)`].join("\n");

function buildZz(doc: PrescriptionDoc): string {
  const runs: Run[] = [];
  const add = (r: Run) => {
    if (String(r.text ?? "").trim() !== "") runs.push(r);
  };
  /**
   * 以「文字墨迹中心 y」写字（参考照片量到的就是墨迹中心）。
   * Typst place 的 dy 是 em 盒顶；SimSun 的 CJK 墨迹中心约在 em 顶下方 0.305em，
   * 故 dy = cy - 0.195em，渲染出来的墨迹中心正好落在 cy。
   */
  const addC = (x: number, cy: number, size: number, text: string, o: Partial<Run> = {}) =>
    add({ x, y: cy - size * 0.195, size, text, ...o });

  const e = doc.extra;
  const amount = e.amount?.trim() || money(totalOf(doc.drugs));
  const hospital = doc.hospital?.trim() || "郑州市中心医院";
  /* 编号：处方号 = 印刷日期（8 位）+ 流水号（6 位），与参考样张 20260507009159 同格式、同长度。
     表单手填的处方号优先；留空（默认值已置空）才按印刷日期派生。 */
  const rxNo = (e.rxNo || "").trim() || ymd(doc.printDate) + "009159";

  /* ── 标题 / 二维码 / 右上角方框 ─────────────────────────── */
  const boxText1 = doc.docType?.trim() || "普通处方";
  const boxText2 = Number(doc.validDays) <= 1 ? "处方当日有效" : `处方` + doc.validDays + `日内有效`;
  addC(X.boxMid, (Y.boxTop + Y.boxMid) / 2, BOX_FONT, boxText1, { anchor: "c", maxw: X.boxR - X.boxL - 6 });
  addC(X.boxMid, (Y.boxMid + Y.boxBot) / 2, BOX_FONT, boxText2, { anchor: "c", maxw: X.boxR - X.boxL - 6 });
  addC(185.5, Y.title, TITLE, hospital + `处方笺`, { anchor: "c", weight: "bold", maxw: 2 * (X.boxL - 185.5 - 4) });
  addC(X.scan, Y.scan, BODY, "扫码支付");
  addC(X.rxR, Y.row1, BODY, `处方号：` + rxNo, { anchor: "r", maxw: 190 });

  /* ── 三行表头 ───────────────────────────────────────────── */
  addC(X.fee, Y.row1, BODY, `费别：` + e.feeCategory, { maxw: X.age - X.fee - 6 });
  addC(X.name, Y.row2, BODY, `姓名：` + doc.patientName, { maxw: X.sex - X.name - 6 });
  addC(X.sex, Y.row2, BODY, `性别：` + doc.gender, { maxw: X.age - X.sex - 6 });
  addC(X.age, Y.row2, BODY, `年龄：` + doc.age + `岁`, { maxw: R - X.age });
  addC(L, Y.row3, BODY, `科别：` + doc.dept, { maxw: X.visit - L - 6 });
  addC(X.visit, Y.row3, BODY, `住院（门诊）号 ` + e.visitNo, { maxw: 108 });
  addC(R, Y.row3, BODY, `日期：` + e.visitDate, { anchor: "r", maxw: 110 });

  /* ── 临床诊断（1~6 行，随行数下移后续内容） ───────────────── */
  const diags = doc.diagnoses
    .map((d) => String(d ?? "").trim())
    .filter(Boolean)
    .slice(0, MAX_DIAG_LINES);
  const diagShift = Math.max(0, diags.length - 1) * DIAG_PITCH;
  addC(L, Y.diag, BODY, "临床诊断：");
  diags.forEach((d, i) => addC(X.diag, Y.diag + i * DIAG_PITCH, BODY, d, { maxw: R - X.diag }));

  /* ── Rp：药品 ───────────────────────────────────────────── */
  addC(L - 2, Y.rp + diagShift, RP_FONT, "Rp:", { weight: "bold", font: ["Arial", "SimSun"] });

  const drugs = doc.drugs.slice(0, MAX_DRUGS + 1);
  const drugTop = Y.drug + diagShift;
  const drugBottom = Y.fRule - 46;
  const noteCount = drugs.filter((d) => String(d.note ?? "").trim()).length;
  const need = drugs.length * PITCH + Math.max(0, drugs.length - 1) * GAP + noteCount * NOTE_PITCH;
  const k = need > drugBottom - drugTop ? Math.max(0.5, (drugBottom - drugTop) / need) : 1;
  const pitch = PITCH * k;
  const gap = GAP * k;
  const notePitch = NOTE_PITCH * k;

  let cy = drugTop;
  let lastLine = drugTop;
  drugs.forEach((d, i) => {
    const nameLine = (d.prefix ?? "") + d.name + (d.brand ? `(` + d.brand + `)` : "");
    const spec = d.spec ? String(d.spec) : "";
    const qty = trim(d.qty) + (d.unit || "");
    const usage = d.usage || [d.dose, d.route, d.freq, d.days ? `×` + d.days + `天` : ""].filter(Boolean).join(" ");
    const note = String(d.note ?? "").trim();

    addC(X.idx, cy, BODY, i + 1 + ".");
    addC(X.drug, cy, BODY, nameLine, { maxw: 160 });
    if (spec) addC(X.specR, cy, BODY, spec, { anchor: "r", maxw: 90 });
    if (qty) addC(X.qtyR, cy, BODY, qty, { anchor: "r", maxw: 46 });
    lastLine = cy;
    if (usage) {
      cy += pitch;
      addC(X.usage, cy, BODY, `用法：` + usage, { maxw: 250 });
      lastLine = cy;
    }
    if (note) {
      cy += notePitch;
      addC(X.usage, cy, BODY, `备注：` + note, { maxw: 250 });
      lastLine = cy;
    }
    cy += gap;
  });

  /* ── 以下处方空白 ───────────────────────────────────────── */
  addC(L, Math.max(Y.blank, lastLine + 13), BODY, "以下处方空白");

  /* ── 页脚 ───────────────────────────────────────────────── */
  addC(L, Y.fRow1, BODY, "药费：");
  addC(L + 34, Y.fRow1, BODY, amount);
  addC(L + 84, Y.fRow1, BODY, "元");
  addC(X.sig, Y.fRow1, BODY, `医师签名：` + doc.doctor, { maxw: R - X.sig });
  addC(L, Y.fRow2, BODY, "审核、调配：");
  addC(X.check, Y.fRow2, BODY, "核对、发药：");
  addC(X.page, Y.fRow3, FOOT_SMALL, e.pageInfo || "第1页 共1页");
  addC(X.print, Y.fRow3, FOOT_SMALL, `打印时间 ` + e.printTime);

  /* ── 组装 ───────────────────────────────────────────────── */
  // 二维码内容：手填优先；留空时沿用本模板兜底「院名-处方号」——处方号已跟随印刷日期
  const qrText = e.qrText || "https://pay.zzszxyy.com/rx/" + rxNo;
  const qr = qrBlock(qrText, X.qrSide);
  const out: string[] = [];
  out.push(`// ` + hospital + ` 处方笺 —— 由「Prescription」生成，页面 ` + PAGE_W + `pt × ` + PAGE_H + `pt，纯矢量输出`);
  out.push(preamble(PAGE_W, PAGE_H, { margin: "0pt", baseSize: BODY }));
  out.push(QR_HELPER);
  out.push(HELPERS);
  out.push("");
  out.push("// ── 右上角「普通处方 / 处方当日有效」方框 ──");
  out.push(
    `#place(dx: ` + n(X.boxL) + `pt, dy: ` + n(Y.boxTop) + `pt, rect(width: ` + n(X.boxR - X.boxL) + `pt, height: ` + n(Y.boxBot - Y.boxTop) + `pt, stroke: 0.7pt))`,
  );
  out.push(
    `#place(dx: ` + n(X.boxL) + `pt, dy: ` + n(Y.boxMid) + `pt, line(start: (0pt, 0pt), end: (` + n(X.boxR - X.boxL) + `pt, 0pt), stroke: 0.7pt))`,
  );
  out.push("");
  out.push("// ── 横线：表头下细线 / 诊断下粗线 / 页脚横线 ──");
  out.push(`#place(dx: ` + L + `pt, dy: ` + Y.rule1 + `pt, line(start: (0pt, 0pt), end: (` + (R - L) + `pt, 0pt), stroke: 0.55pt))`);
  out.push(
    `#place(dx: ` + L + `pt, dy: ` + n(Y.rule2 + diagShift) + `pt, line(start: (0pt, 0pt), end: (` + (R - L) + `pt, 0pt), stroke: 0.9pt))`,
  );
  out.push(`#place(dx: ` + L + `pt, dy: ` + Y.fRule + `pt, line(start: (0pt, 0pt), end: (` + (R - L) + `pt, 0pt), stroke: 0.8pt))`);
  out.push("");
  out.push(`// ── 二维码（扫码支付）：` + qrText + ` ──`);
  out.push(`#place(dx: ` + X.qr + `pt, dy: ` + X.qrTop + `pt)[` + qr + `]`);
  out.push("");
  out.push("// ── 文字 ──");
  for (const r of runs) {
    const fn = r.anchor === "c" ? "TC" : r.anchor === "r" ? "TR" : "T";
    const args = [n(r.x) + "pt", n(r.y) + "pt", n(r.size) + "pt", `"` + esc(r.text) + `"`];
    const opt: string[] = [];
    if (r.font) opt.push(`font: (` + r.font.map((f) => `"` + f + `"`).join(", ") + `)`);
    if (r.weight && r.weight !== "regular") opt.push(`weight: "` + r.weight + `"`);
    if (r.maxw) opt.push(`maxw: ` + n(r.maxw) + `pt`);
    out.push(`#` + fn + "(" + args.join(", ") + (opt.length ? ", " + opt.join(", ") : "") + ")");
  }
  out.push("");
  return out.join("\n");
}

export const zz: Template = {
  id: "zz",
  name: "郑州市中心医院处方笺",
  hospital: "郑州市中心医院",
  desc: "门诊处方笺复刻：左侧扫码支付二维码、右上角普通处方/处方当日有效方框、费别/姓名/科别三行表头、临床诊断下粗横线、Rp 药品（规格与数量右对齐）、以下处方空白、页脚药费/医师签名/页码/打印时间",
  group: "门诊电子处方",
  page: { widthPt: PAGE_W, heightPt: PAGE_H },
  limits: { maxDiag: 12, maxDrugs: 20 },
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
  extraKeys: [
    { key: "rxNo", label: "处方号" },
    { key: "feeCategory", label: "费别" },
    { key: "visitNo", label: "住院(门诊)号" },
    { key: "visitDate", label: "日期" },
    { key: "amount", label: "药费" },
    { key: "pageInfo", label: "页码" },
    { key: "printTime", label: "打印时间" },
    { key: "qrText", label: "二维码内容" },
  ],
  defaults: {
    hospital: "郑州市中心医院",
    docType: "普通处方",
    patientName: "孙磊",
    gender: "女",
    age: "31",
    dept: "皮肤科门诊",
    diagnoses: ["酒渣鼻(玫瑰痤疮 疗程用药)"],
    drugs: [
      { id: "zz1", name: "润燥止痒胶囊", brand: "", spec: "0.5g*48粒/盒", price: 52.18, qty: 5, usage: "2g口服 每天三次", prefix: "(基)", unit: "盒", freq: "每天三次", dose: "2g", route: "口服" },
      { id: "zz2", name: "盐酸米诺环素胶囊", brand: "", spec: "50mg*20粒/盒", price: 60.0, qty: 2, usage: "50mg口服 每天二次", prefix: "(基)", unit: "盒", freq: "每天二次", dose: "50mg", route: "口服", note: "饭后立即吃" },
    ],
    doctor: "吴静怡",
    validDays: 1,
    extra: {
      // 含日期的编号：留空 → build() 按 doc.printDate 派生（前 8 位=印刷日期，后 6 位=流水号）
      rxNo: "",
      feeCategory: "国家医保",
      // 门诊号属患者建档号 → 用等长占位（10 位），保持版式不变
      visitNo: "0000000000",
      visitDate: "2026-05-07",
      amount: "260.90",
      pageInfo: "第1页 共1页",
      printTime: "2026/05/07 14:06:4",
      // 二维码默认内容里嵌的也是处方号（含日期）：留空 → 用模板兜底，跟随上面派生出的处方号
      qrText: "",
    },
  },
  build: buildZz,
};
