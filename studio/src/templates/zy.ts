import { totalOf } from "@/lib/doc";
import type { PrescriptionDoc } from "@/lib/doc";
import { BARCODE_HELPER, QR_HELPER, barcodeBlock, money, preamble, qrBlock, trim, tw } from "@/templates/kit";
import type { Template } from "@/templates/types";

/**
 * 遵义医科大学第五附属（珠海）医院 / 珠海市第六人民医院 门诊处方笺
 *
 * 版面按 refs/zy_zunyi.png 复刻，全部栏位用**绝对坐标（pt）**定位：
 *   ① 顶栏：左=Code128 条码 + 病历号；中=院徽 + 中英文院名 4 行；右=「普通」方框
 *   ② 费别：门诊自付（左） / 「处方笺」居中大标题 / 医师：____（标题下方）
 *   ③ 患者信息 4 行，「标签 + 下划线填空」结构：
 *      姓名·体重·性别·年龄 ／ 门诊住院病历号·科别 ／ 电话地址·开具日期 ／ 临床诊断
 *   ④ 分隔实线 ⑤ Rp
 *   ⑥ 每味药**两行**：第 1 行「序号 药名(规格) … 数量」，第 2 行为独立缩进行
 *      「用法： 剂量　途径　频次×天数」（剂量/途径/频次为四味药对齐的固定列）
 *   ⑦ 「以下空白」 ⑧ 页脚：取药说明 + 二维码 + 处方序号 + 医师/金额/药师签名 + 温馨提示
 *
 * 坐标来源：对 refs/zy_zunyi.png 做墨迹行列扫描后按 3.08px/pt 换算；正文 9.5pt、
 * 药名行 10.5pt、Rp 19pt、条码号 16pt，与照片上的字号层级一致。
 */
const W = 419.5;
const H = 595.3;
/** 内容左右边界（参考照片量得 约 13pt / 406.5pt） */
const L = 13;
const R = 406.5;

/** 参考单据固定的温馨提示（版面容条纹样，不随数据变化） */
const TIPS =
  "温馨提示：1、依《医疗机构药事管理规定》第二十八条“为保证患者用药安全，除药品质量原因外，药品一经发出，不得退换”；2、本处方当天有效；3、取药时请仔细核对清单，点齐药品；";

/** 换行符（避免源码里出现裸转义） */
const LF = String.fromCharCode(10);

/** 缺省取药说明（参考照片上的两行） */
const NOTE_DEFAULT =
  "1.中/西药房位置：门诊一楼医保窗口旁；\n2.先缴费后取药。关注药房窗口上方显示屏，到对应窗口排队取药。";

const pt = (v: number) => String(Math.round(v * 100) / 100);

/**
 * 内容模式转义：**必须先转义反斜杠，再转义引号，最后转义 Typst 标记字符**。
 * 顺序不能调换：先补 \# 这类标记转义、再转义反斜杠会把刚补上的反斜杠二次转义。
 * 与 `esc()` 的输出等价（esc 就是前两步），此处内联是为了让转义链自包含。
 */
const cx = (s: unknown) =>
  String(s ?? "")
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/([#$\[\]*_])/g, "\\$1");

/** 生成期按可用宽度自动缩字号（em 估算），保证长名字/长规格不溢出、不串栏 */
function fit(text: string, size: number, maxW: number) {
  const em = tw(text);
  if (em <= 0) return size;
  const want = maxW / em;
  if (want >= size) return size;
  return Math.max(3.4, Math.round(want * 100) / 100);
}

/** 绝对定位文本（place 的 dy 即字面墨迹顶端，已用标尺实测校准） */
const T = (x: number, y: number, s: number, body: string) =>
  `#place(dx: ${pt(x)}pt, dy: ${pt(y)}pt, text(size: ${pt(s)}pt)[${body}])`;
const TB = (x: number, y: number, s: number, body: string) =>
  `#place(dx: ${pt(x)}pt, dy: ${pt(y)}pt, text(size: ${pt(s)}pt, weight: "bold")[${body}])`;
/** 定宽居中 / 右对齐文本 */
const TC = (x: number, y: number, w: number, s: number, body: string) =>
  `#place(dx: ${pt(x)}pt, dy: ${pt(y)}pt, box(width: ${pt(w)}pt, align(center, text(size: ${pt(s)}pt)[${body}])))`;
const TR = (x: number, y: number, w: number, s: number, body: string) =>
  `#place(dx: ${pt(x)}pt, dy: ${pt(y)}pt, box(width: ${pt(w)}pt, align(right, text(size: ${pt(s)}pt)[${body}])))`;
/** 绝对坐标直线（填空白下划线 / 栏间分隔线） */
const LN = (x: number, y: number, w: number, t = 0.6) =>
  `#place(dx: ${pt(x)}pt, dy: ${pt(y)}pt, line(length: ${pt(w)}pt, stroke: ${t}pt))`;

/** 「标签 + 填空白」一栏：标签 / 值（自动缩字号）/ 下划线 */
function fill(o: {
  lx: number; ly: number; ls: number; label: string;
  vx: number; vy: number; vs: number; value: string; vw: number;
  ux: number; uy: number; uw: number;
}) {
  const size = fit(o.value, o.vs, o.vw);
  const out = [T(o.lx, o.ly, o.ls, o.label)];
  if (o.value) out.push(T(o.vx, o.vy, size, cx(o.value)));
  out.push(LN(o.ux, o.uy, o.uw, 0.6));
  return out;
}

export const zy: Template = {
  id: "zy",
  name: "遵义医科大学第五附属（珠海）医院处方笺",
  hospital: "遵义医科大学第五附属（珠海）医院",
  desc: "门诊处方笺：条码+病历号在左上、中英文院名带院徽、右上普通方框、每味药两行（用法含剂量/途径/频次×天数）、页脚取药说明与药师签名",
  group: "门诊电子处方",
  page: { widthPt: W, heightPt: H },
  limits: { maxDiag: 6, maxDrugs: 6 },
  sections: { patient: true, identity: true, visit: true, diagnosis: true, drugs: true, drugTable: true, tcm: false, footer: true },
  extraKeys: [
    { key: "feeCategory", label: "费别" },
    { key: "weight", label: "体重(kg)" },
    { key: "medicalId", label: "门诊/住院病历号" },
    { key: "phone", label: "电话/地址" },
    { key: "visitDate", label: "开具日期" },
    { key: "rxNo", label: "处方序号" },
    { key: "amount", label: "药品金额" },
    { key: "note", label: "页脚说明(两行)" },
    { key: "qrText", label: "二维码内容" },
  ],
  defaults: {
    hospital: "遵义医科大学第五附属（珠海）医院",
    docType: "普通",
    patientName: "赵敏", gender: "男", age: "34", dept: "口腔科门诊",
    diagnoses: ["18、48阻生牙"],
    drugs: [
      { id: "z1", name: "双氯芬酸钠缓释胶囊(Ⅰ)", brand: "", spec: "0.1g*20粒/盒", price: 0, qty: 1, usage: "", prefix: "", unit: "盒", freq: "必要时", dose: "0.1000g", route: "口服", days: "1" },
      { id: "z2", name: "头孢克肟胶囊", brand: "", spec: "0.1g*20粒/盒", price: 0, qty: 1, usage: "", prefix: "(国采)", unit: "盒", freq: "每日二次", dose: "0.1000g", route: "口服", days: "1" },
      { id: "z3", name: "甲硝唑片", brand: "", spec: "0.2g*100片/盒", price: 6.0, qty: 6, usage: "", prefix: "(集采)", unit: "片", freq: "每日二次", dose: "0.2000g", route: "口服", days: "3" },
      { id: "z4", name: "西帕依固龈液", brand: "", spec: "30ml/瓶", price: 0, qty: 1, usage: "", prefix: "", unit: "瓶", freq: "每日二次", dose: "3.0000ml", route: "含漱", days: "1" },
    ],
    doctor: "林浩然",
    extra: {
      feeCategory: "门诊自付", weight: "", medicalId: "0000000000", phone: "", visitDate: "2026年05月30日",
      rxNo: "00000000", amount: "", note: NOTE_DEFAULT,
      qrText: "https://fifth.zmu.edu.cn/pay/00000000",
    },
  },
  build: (doc: PrescriptionDoc) => {
    const ex = doc.extra;
    const out: string[] = [];
    out.push(preamble(W, H, { margin: "0pt", baseSize: 9.5 }));
    // 参考单据中西文之间没有额外间距（如「2026年05月30日」「(0.1g*20粒/盒)」）
    out.push("#set text(cjk-latin-spacing: none)");
    out.push(BARCODE_HELPER);
    out.push(QR_HELPER);
    out.push("");

    const bcText = ex.medicalId || doc.cardNo || "";
    const amount = ex.amount?.trim() ? ex.amount.trim() : money(totalOf(doc.drugs));

    // ─────────── ① 顶栏 ───────────
    const bcW = 113;
    if (bcText) {
      const bc = barcodeBlock(bcText, bcW, 18).replace(/#/g, "");
      out.push(`#place(dx: ${pt(L)}pt, dy: 12pt, box(width: ${pt(bcW)}pt, { ${bc} }))`);
      out.push(TC(L, 33, bcW, fit(bcText, 16, bcW - 2), cx(bcText)));
    }
    // 院徽：双圈 + 医学十字（院徽图案本身不复刻，用通用医疗徽记占位）
    out.push("#place(dx: 139.1pt, dy: 34.8pt, circle(radius: 15.5pt, stroke: 0.8pt))");
    out.push("#place(dx: 144.1pt, dy: 39.8pt, circle(radius: 10.5pt, stroke: 0.45pt))");
    out.push("#place(dx: 151.6pt, dy: 42.4pt, rect(width: 6pt, height: 16pt, fill: black))");
    out.push("#place(dx: 146.6pt, dy: 47.4pt, rect(width: 16pt, height: 6pt, fill: black))");
    // 中英文院名 4 行
    const hx = 187;
    out.push(TB(hx, 39, 8, cx(doc.hospital)));
    out.push(T(hx, 52, 4.1, "THE FIFTH AFFILIATED HOSPITAL OF ZUNYI MEDICAL UNIVERSITY(ZHUHAI)"));
    out.push(TB(hx, 60.5, 8.5, "珠海市第六人民医院"));
    out.push(T(hx, 72, 4.2, "ZHUHAI SIXTH PEOPLE'S HOSPITAL"));
    // 右上「普通」方框
    const bx = 336;
    out.push(
      `#place(dx: ${pt(bx)}pt, dy: 57.5pt, box(width: ${pt(R - bx)}pt, height: 21pt, stroke: 0.7pt, align(center + horizon, text(size: 11pt)[${cx(doc.docType || "普通")}])))`,
    );

    // ─────────── ② 费别 / 标题 ───────────
    out.push(T(13.5, 89.5, 9.5, `费别： ${cx(ex.feeCategory)}`));
    out.push(`#place(dx: 178pt, dy: 84pt, box(width: 82pt, align(center, text(size: 13.5pt, weight: "bold")[处方笺])))`);
    out.push(T(197, 111, 9.5, "医师："));
    // 参考图该处只有一条通栏细线（逐段 dip 扫描 y384-396 → pt122.1-126.0，中位 123pt），
    // 它同时充当「医师：____」填写线；原先把线放在 125.5pt 会横穿「姓名」行文字
    out.push(LN(L, 123, R - L, 0.7));

    // ─────────── ③ 患者信息四行 ───────────
    // 第 1 行四栏共用同一基线（标签 127.5pt / 下划线 143pt），姓名标签 10pt、值右移留出间隔
    out.push(...fill({ lx: 14, ly: 127, ls: 10, label: "姓名", vx: 52, vy: 127.5, vs: 10, value: doc.patientName, vw: 64, ux: 45, uy: 143, uw: 75 }));
    out.push(...fill({ lx: 147.4, ly: 127.5, ls: 9.5, label: "体重：", vx: 176, vy: 128.5, vs: 9.5, value: ex.weight, vw: 18, ux: 174, uy: 143, uw: 22 }));
    out.push(T(198, 127.5, 9.5, "kg"));
    out.push(...fill({ lx: 240.3, ly: 127.5, ls: 9.5, label: "性别", vx: 268, vy: 128.5, vs: 9.5, value: doc.gender, vw: 26, ux: 254, uy: 143, uw: 22 }));
    out.push(...fill({ lx: 319.6, ly: 127.5, ls: 9.5, label: "年龄：", vx: 351, vy: 128.5, vs: 9.5, value: doc.age, vw: 20, ux: 349, uy: 143, uw: 26 }));
    out.push(...fill({ lx: 15, ly: 158, ls: 9.5, label: "门诊/住院病历号：", vx: 108, vy: 159, vs: 9.5, value: bcText, vw: 112, ux: 105, uy: 173.5, uw: 119 }));
    out.push(...fill({ lx: 238.5, ly: 158, ls: 9.5, label: "科别(病区/床位号)：", vx: 331, vy: 159, vs: 9.5, value: doc.dept, vw: 74, ux: 329.5, uy: 173.5, uw: 77 }));
    out.push(...fill({ lx: 18.2, ly: 188.5, ls: 9.5, label: "电话/地址：", vx: 144, vy: 189.5, vs: 9.5, value: ex.phone, vw: 50, ux: 141.6, uy: 204, uw: 53 }));
    out.push(...fill({ lx: 238.5, ly: 188.5, ls: 9.5, label: "开具日期：", vx: 288, vy: 189.5, vs: 9.5, value: ex.visitDate || doc.printDate, vw: 100, ux: 286, uy: 204, uw: 110 }));
    const diagRaw = doc.diagnoses.filter(Boolean).join("；");
// 诊断行是单行绝对定位：缩字号到 3.4pt 仍放不下时按 em 宽度硬截断，保证永不越界
const DIAG_MAX_EM = 330 / 4.5;
const diag = (() => {
  if (tw(diagRaw) <= DIAG_MAX_EM) return diagRaw;
  let w = 0;
  let acc = "";
  for (const ch of diagRaw) {
    const cw = ch.charCodeAt(0) > 0x2e80 ? 1 : 0.5;
    if (w + cw > DIAG_MAX_EM - 1) break;
    w += cw;
    acc += ch;
  }
  return acc + "…";
})();
    out.push(...fill({ lx: 20.1, ly: 219, ls: 9.5, label: "临床诊断：", vx: 74, vy: 220, vs: 9.5, value: diag, vw: 330, ux: 73, uy: 234.5, uw: R - 73 }));
    out.push(LN(L, 247.5, R - L, 0.7));

    // ─────────── ④⑤ Rp 与药品（每味两行） ───────────
    out.push(TB(15.3, 253, 19, "Rp"));
    const drugs = doc.drugs;
    const drugTop = 274;
    // 参考图实测：同一味药两行相距 14.6pt、相邻两味相距 27.7pt（固定值，不随字号放大，
    // 否则 4 味药累计会多出 13pt）；只有超出药区预算（274→445pt）时才整体等比缩小。
    const BASE_FS = 11.8;
    const BASE_GAP = 14.6;
    const BASE_PITCH = 27.7;
    const budget = 445 - drugTop;
    const need = drugs.length > 1 ? (drugs.length - 1) * BASE_PITCH + BASE_GAP + BASE_FS : BASE_FS;
    const k = Math.min(1, budget / need);
    const fs = BASE_FS * k;
    const lineGap = BASE_GAP * k;
    const pitch = BASE_PITCH * k;
    drugs.forEach((d, i) => {
      const y1 = drugTop + i * pitch;
      const y2 = y1 + lineGap;
      const name = `${d.prefix ?? ""}${d.name}${d.brand ? `(${d.brand})` : ""}`;
      const spec = d.spec ? `(${d.spec})` : "";
      const qty = `${trim(d.qty)}${d.unit || ""}`;
      out.push(TR(22, y1, 12, fs, String(i + 1)));
      // 药名→规格**流式**相接（规格紧跟药名约 5pt，参考图四味药规格起点 117.5/128.9/167.8/174.1pt 各不相同）；
      // 数量是**固定列**：参考图四味药数量左端 258.8/262/264.5/268.2pt（西帕依那行规格只到 164.6pt，
      // 数量仍落在 262pt），所以数量列固定在 260pt，规格超出则先压规格、再回流压药名。
      const QTY_X = 260;
      const qtySize = fit(qty, fs, 44);
      const layout = (nameLimit: number) => {
        const nSize = fit(name, fs, nameLimit);
        const nW = tw(name) * nSize;
        const sX = 40 + nW + 5;
        const sSize = spec ? fit(spec, fs, Math.max(24, QTY_X - 6 - sX)) : 0;
        const sW = spec ? tw(spec) * sSize : 0;
        return { nSize, nW, sX, sSize, sW };
      };
      let L1 = layout(150);
      if (L1.sX + L1.sW > QTY_X - 6 && spec) L1 = layout(Math.max(60, 150 - (L1.sX + L1.sW - (QTY_X - 6)) - 5));
      if (name) out.push(T(40, y1, L1.nSize, cx(name)));
      if (spec) out.push(T(L1.sX, y1, L1.sSize, cx(spec)));
      if (qty) out.push(T(QTY_X, y1, qtySize, cx(qty)));
      out.push(T(54.2, y2, fs, "用法："));
      const raw = d.usage?.trim();
      if (raw) {
        // 自由文本用法也限制在二维码左边界（300pt）以内
        out.push(T(93.5, y2, fit(raw, fs, 205), cx(raw)));
      } else {
        const dose = d.dose || "";
        const route = d.route || "";
        const freq = `${d.freq || ""}${d.days ? `×${trim(d.days)}天` : ""}`;
        if (dose) out.push(T(93.5, y2, fit(dose, fs, 48), cx(dose)));
        if (route) out.push(T(143.5, y2, fit(route, fs, 34), cx(route)));
        if (freq) out.push(T(179.5, y2, fit(freq, fs, 120), cx(freq)));
      }
    });
    // ─────────── ⑥ 以下空白 ───────────
    const lastY = drugs.length ? drugTop + (drugs.length - 1) * pitch + lineGap : drugTop;
    const tailY = Math.min(lastY + 16.5, 452);
    out.push(LN(149, tailY - 4.5, 101, 0.6));
    out.push(T(178, tailY, 10.5, "以下空白"));

    // ─────────── ⑦ 页脚 ───────────
    const rawNote = ex.note?.trim() ? ex.note : NOTE_DEFAULT;
    let notices: string[] = rawNote.split(/\r?\n+/).map((s) => s.trim()).filter(Boolean);
    if (notices.length < 2) {
      const m = rawNote.match(/^(.*?)\s*(?=2[.、])/);
      notices = m ? [m[1].trim(), rawNote.slice(m[1].length).trim()] : [rawNote];
    }
    // 取药说明两行：参考图左侧实测 466 / 477.5pt；宽度收到 280pt，避免伸到二维码下方
    notices.slice(0, 2).forEach((t, i) => out.push(T(22, 466 + i * 11.5, fit(t, 9.5, 280), cx(t))));

    // 二维码 + 竖排「自费患者 / 请扫码支付」
    out.push(`#place(dx: 308pt, dy: 434pt, ${qrBlock(ex.qrText || "", 48).replace(/^#/, "")})`);
    for (const [vx, vtext] of [[361, "自费患者"], [375.5, "请扫码支付"]] as Array<[number, string]>) {
      for (let i = 0; i < vtext.length; i++) out.push(T(vx, 436 + i * 12, 10, vtext[i]));
    }

    // 处方序号（数字下方自带一条短填写线，参考图 z_foot1 可辨）
    out.push(T(187.3, 488, 9.5, "处方序号："));
    out.push(T(235, 488, fit(ex.rxNo, 9.5, 40), cx(ex.rxNo)));
    out.push(LN(186, 497, 62, 0.6));
    out.push(LN(L, 500, R - L, 0.7));
    // 医师 / 药品金额（文字 503.5、下划线 513.5，与通栏线 500 留 2.8pt 净空）
    out.push(T(26.6, 503.5, 9.5, "医师："));
    out.push(T(57.5, 503.5, 10, cx(doc.doctor)));
    out.push(T(104.6, 503.5, 9.5, "药品金额："));
    out.push(T(154.5, 504, fit(amount, 9.5, 50), cx(amount)));
    out.push(LN(149, 513.5, 58, 0.6));
    // 审核 / 调配 / 核对发药（文字 516.5、下划线 526.5，与通栏线 532 留 4.9pt 净空）
    out.push(T(26.6, 516.5, 9.5, "审核药师："));
    out.push(LN(88, 526.5, 60, 0.6));
    out.push(T(119, 516.5, 9.5, "调配药师："));
    out.push(LN(178, 526.5, 60, 0.6));
    out.push(T(228, 516.5, 9.5, "核对、发药师："));
    out.push(LN(296, 526.5, 110, 0.6));
    // 分隔线 + 温馨提示（定宽自动折行）
    out.push(LN(L, 532, R - L, 0.7));
    out.push(`#place(dx: ${pt(L)}pt, dy: 535pt, box(width: ${pt(R - L)}pt, text(size: 9.5pt)[${cx(TIPS)}]))`);

    return out.join(LF) + LF;
  },
};
