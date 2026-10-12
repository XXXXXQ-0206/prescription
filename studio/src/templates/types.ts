import type { DocExtra, PrescriptionDoc } from "@/lib/doc";

/** 模板需要表单显示哪些区块（不同医院单据的字段差别很大） */
export interface TemplateSections {
  /** 患者：姓名/性别/年龄 */
  patient: boolean;
  /** 医院科室与病历号：科别、卡号/病历号、序号 */
  identity: boolean;
  /** 就诊信息：就诊科室、就诊次、日期、身份、社保号、单位、电话、体重 */
  visit: boolean;
  /** 诊断 */
  diagnosis: boolean;
  /** 药品基础列：名称/厂牌/规格/单价/数量/用法 */
  drugs: boolean;
  /** 药品表格列：单位、频率、用量、给药途径、天数、备注 */
  drugTable: boolean;
  /** 中药剂量列（每味药带克数，多栏排布） */
  tcm: boolean;
  /** 页脚：医师/审核/调配/核对/药房/提示/金额/打印时间 */
  footer: boolean;
}

export interface Template {
  id: string;
  /** 显示名（模板选择器） */
  name: string;
  /** 默认医院名 */
  hospital: string;
  /** 一句话说明，鼠标悬停显示 */
  desc: string;
  group: "复刻样张" | "门诊电子处方" | "中药处方";
  /** 页面尺寸（pt）；预览按此比例给出画布 */
  page: { widthPt: number; heightPt: number };
  sections: TemplateSections;
  /** 版面上限：固定版式（复刻样张）有硬上限；流式版面可以放宽 */
  limits: { maxDiag: number; maxDrugs: number };
  /** 该模板用到的扩展字段（表单按此顺序渲染输入框） */
  extraKeys: Array<{ key: keyof DocExtra; label: string; placeholder?: string }>;
  /** 该模板的默认数据（新建/切换模板时套用）；extra 可只写用到的字段 */
  defaults?: Omit<Partial<PrescriptionDoc>, "extra"> & { extra?: Partial<DocExtra> };
  /** 生成 Typst 源码 */
  build: (doc: PrescriptionDoc) => string;
}

export const NO_SECTIONS: TemplateSections = {
  patient: false,
  identity: false,
  visit: false,
  diagnosis: false,
  drugs: false,
  drugTable: false,
  tcm: false,
  footer: false,
};
