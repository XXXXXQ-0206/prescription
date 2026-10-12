/** 处方单据的数据模型与默认值 */
import { DRUGS } from "@/data/presets";

export interface DrugItem {
  id: string;
  name: string;
  /** 厂牌/后缀，如 (石药) */
  brand: string;
  spec: string;
  price: number;
  qty: number;
  /** 用法描述（复刻模板用） */
  usage: string;
  /** 前缀标注，如 (基)/(国采)/(集采) */
  prefix?: string;
  /** 数量单位：盒/支/瓶/片/袋 */
  unit?: string;
  /** 频率：二次/日 */
  freq?: string;
  /** 单次用量：2喷/次 */
  dose?: string;
  /** 给药途径：口服/喷鼻/含漱 */
  route?: string;
  /** 用药天数 */
  days?: string;
  /** 中药单味剂量（g） */
  tcm?: number;
  /** 备注（如 超限原因:慢性病患者） */
  note?: string;
  /**
   * 过量（OD）风险提示（来自 presets.ts 的 DRUGS[].odRisk）。
   * 仅作系统内安全性提示，**模板不读取该字段，绝不会打印到处方上**。
   * 注意：用户手改药名或读取旧存档时该值可能过期，界面建议用 odRiskOf(d.name) 实时查表。
   */
  odRisk?: string;
}

/** 各模板公用的扩展字段（不同单据的表头/表尾差异放在这里） */
export interface DocExtra {
  /** 处方号 */
  rxNo: string;
  /** 费别：国家医保 / 门诊自付 / 自费 … */
  feeCategory: string;
  /** ID号 / 病历号 */
  medicalId: string;
  /** 病案号 */
  caseNo: string;
  /** 身份：异地医保患者 … */
  idType: string;
  /** 社保号 */
  ssn: string;
  /** 定点医疗机构编码 */
  orgCode: string;
  /** 单位 */
  unitName: string;
  /** 就诊次 / 住院号 */
  visitNo: string;
  /** 就诊日期 / 开具日期 */
  visitDate: string;
  /** 体重 */
  weight: string;
  /** 电话 / 地址 */
  phone: string;
  /** 取药药房 / 发药药房 */
  pharmacy: string;
  /** 嘱托 / 备注 */
  note: string;
  /** 药品金额（留空则用自动合计） */
  amount: string;
  /** 第 N 页 共 N 页 */
  pageInfo: string;
  /** 打印时间 */
  printTime: string;
  /** 二维码内容 */
  qrText: string;
}

export const emptyExtra = (): DocExtra => ({
  rxNo: "",
  feeCategory: "",
  medicalId: "",
  caseNo: "",
  idType: "",
  ssn: "",
  orgCode: "",
  unitName: "",
  visitNo: "",
  visitDate: "",
  weight: "",
  phone: "",
  pharmacy: "",
  note: "",
  amount: "",
  pageInfo: "第1页 共1页",
  printTime: "",
  qrText: "",
});

export interface DocOptions {
  showBarcode: boolean;
  showCardNo: boolean;
  showPrintDate: boolean;
  showSerial: boolean;
  showFeeLine: boolean;
  showFeeMark: boolean;
  showTips: boolean;
  showSign: boolean;
  showUsage: boolean;
  showMoney: boolean;
  selfPayLabel: string;
  tips: string[];
}

export interface PrescriptionDoc {
  /** 模板 id（见 src/templates/index.ts） */
  templateId: string;
  docType: string;
  hospital: string;
  patientName: string;
  gender: string;
  age: string;
  dept: string;
  cardNo: string;
  serial: string;
  diagnoses: string[];
  drugs: DrugItem[];
  doctor: string;
  feeKey: "甲" | "乙" | "丙";
  printDate: string;
  validDays: number;
  options: DocOptions;
  /** 当前模板生效的扩展字段（模板生成器只读这里） */
  extra: DocExtra;
  /** 各模板的扩展字段快照：切模板时先把当前 extra 存回这里，再取新模板的 —— 这样郑州的处方号不会印到遵义的单据上 */
  extraByTemplate: Record<string, Partial<DocExtra>>;
}

export const MAX_DIAG_LINES = 8;
export const MAX_DRUGS = 5;

let seq = 0;
export const newId = () => `d${Date.now().toString(36)}${(seq++).toString(36)}`;

export function makeDrug(name = ""): DrugItem {
  const preset = DRUGS.find((d) => d.name === name);
  const spec = preset?.spec ?? "";
  // 从规格里猜数量单位：10mg x 14片/盒 -> 盒
  const unitMatch = spec.match(/[/／]\s*(盒|支|瓶|袋|板|包)/);
  const doseMatch = spec.match(/x\s*([\d.]+)\s*(片|粒|袋|支|ml|g)/i);
  return {
    id: newId(),
    name: name || preset?.name || "",
    brand: preset?.brand ?? "",
    spec,
    price: preset?.price ?? 0,
    qty: 1,
    usage: preset?.usage ?? "",
    prefix: "",
    unit: unitMatch?.[1] ?? "盒",
    freq: "每日1次",
    dose: preset?.usage?.match(/([\d.]+\s*(?:片|粒|袋|支|喷|ml|U|g))/)?.[1] ?? "",
    route: preset?.usage?.match(/(口服|喷鼻|含漱|外用|肌注|静滴|皮下注射|皮下)/)?.[1] ?? "口服",
    days: "",
    note: doseMatch ? "" : "",
    odRisk: preset?.odRisk,
  };
}

export const totalOf = (drugs: DrugItem[]) =>
  drugs.reduce((sum, d) => sum + (Number(d.price) || 0) * (Number(d.qty) || 0), 0);

export function defaultDoc(): PrescriptionDoc {
  return {
    templateId: "bj6",
    docType: "非医保处方",
    hospital: "北京大学第六医院",
    patientName: "张伟",
    gender: "男",
    age: "21",
    dept: "精神科",
    cardNo: "0000000000",
    serial: "000000",
    diagnoses: ["心境[情感]障碍", "抑郁状态", "偏执性反应"],
    drugs: [
      {
        id: newId(),
        name: "氢溴酸伏硫西汀片",
        brand: "石药",
        spec: "10mg x 14片/盒",
        price: 9.87,
        qty: 2,
        usage: "每日1次 每次1片 口服",
      },
    ],
    doctor: "陈明",
    feeKey: "丙",
    // 首启示例数据：演示用虚构值（姓名/病历号/条码号/医师均已脱敏），仅印刷日期取当天（避免显示过期日期）
    printDate: new Date().toISOString().slice(0, 10),
    validDays: 1,
    options: {
      showBarcode: true,
      showCardNo: true,
      showPrintDate: true,
      showSerial: true,
      showFeeLine: true,
      showFeeMark: true,
      showTips: true,
      showSign: true,
      showUsage: false,
      showMoney: false,
      selfPayLabel: "个人自付",
      tips: ["(1)请遵医嘱服药", "(2)请在窗口点清药品", "(3)处方当日有效"],
    },
    extra: emptyExtra(),
    extraByTemplate: {},
  };
}

/** 空白新处方：保留医院/医师/版式选项，清空患者与内容 */
export function blankDoc(base: PrescriptionDoc): PrescriptionDoc {
  return {
    ...base,
    patientName: "",
    age: "",
    cardNo: "",
    serial: "",
    diagnoses: [""],
    drugs: [makeDrug()],
  };
}

/** 从 JSON 还原（容错：缺字段走默认值） */
export function fromJSON(text: string): PrescriptionDoc | null {
  try {
    const parsed = JSON.parse(text) as Partial<PrescriptionDoc>;
    const base = defaultDoc();
    return {
      ...base,
      ...parsed,
      templateId: typeof parsed.templateId === "string" && parsed.templateId ? parsed.templateId : base.templateId,
      diagnoses: Array.isArray(parsed.diagnoses) ? parsed.diagnoses : base.diagnoses,
      drugs: Array.isArray(parsed.drugs) && parsed.drugs.length ? parsed.drugs : base.drugs,
      options: { ...base.options, ...(parsed.options ?? {}) },
      extra: { ...base.extra, ...(parsed.extra ?? {}) },
      // v1 → v2：老数据只有一份 extra，迁移时把它归入当时模板的快照
      extraByTemplate: { ...(parsed.extraByTemplate ?? {}), [parsed.templateId ?? base.templateId]: { ...(parsed.extra ?? {}) } },
    };
  } catch {
    return null;
  }
}

/** 粗略估算文本像素宽度（中文按 1em、ASCII 按 0.5em），用于溢出预警 */
export function estimateWidth(text: string, size: number) {
  let w = 0;
  for (const ch of text) w += ch.charCodeAt(0) > 0x2e80 ? size : size * 0.5;
  return w;
}

export interface Warning {
  level: "warn" | "error";
  text: string;
}

export function validate(doc: PrescriptionDoc, limits = { maxDiag: MAX_DIAG_LINES, maxDrugs: MAX_DRUGS }): Warning[] {
  const out: Warning[] = [];
  if (doc.diagnoses.length > limits.maxDiag)
    out.push({ level: "error", text: `该模板诊断最多 ${limits.maxDiag} 行，当前 ${doc.diagnoses.length} 行，超出部分不会打印` });
  if (doc.drugs.length > limits.maxDrugs)
    out.push({ level: "error", text: `该模板最多 ${limits.maxDrugs} 条，当前 ${doc.drugs.length} 条，超出部分不会打印` });
  if (!doc.patientName.trim()) out.push({ level: "warn", text: "未填写患者姓名" });
  if (!doc.diagnoses.length) out.push({ level: "warn", text: "未填写诊断" });
  if (!doc.drugs.length) out.push({ level: "warn", text: "未添加药品" });
  if (estimateWidth(`姓名：${doc.patientName}`, 25.5) > 250)
    out.push({ level: "warn", text: "患者姓名过长，可能与“性别”栏重叠" });
  // 左右栏都可能被长文本撑破：生成器会用 maxw 自动缩字号兜底，这里再给一次可读性预警
  if (estimateWidth(doc.hospital, 25.5) > 244)
    out.push({
      level: "warn",
      text: `医院名「${doc.hospital}」超出左栏宽度，已自动缩小字号（建议 ≤9 字）`,
    });
  if (estimateWidth(doc.dept, 39.5) > 236)
    out.push({ level: "warn", text: `科别「${doc.dept}」超出左栏宽度，已自动缩小字号` });
  if (limits.maxDrugs <= 6 && doc.drugs.length >= limits.maxDrugs)
    out.push({ level: "warn", text: `药品已用到 ${limits.maxDrugs} 条上限，末行距表格横线很近，建议精简` });
  if (doc.drugs.some((d) => !d.name.trim())) out.push({ level: "warn", text: "有药品未填名称" });
  const long = doc.drugs.find((d) => estimateWidth(`(${d.spec}) ${d.price}元`, 24.5) > 860);
  if (long) out.push({ level: "warn", text: `药品「${long.name}」的规格行过长，可能超出药栏` });
  return out;
}
