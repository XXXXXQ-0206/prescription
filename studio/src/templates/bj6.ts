import { buildTypst as build } from "@/templates/bj6-impl";
import type { Template } from "@/templates/types";

/** 复刻样张：原 origin_pic.png 的版式（绝对定位 + 纸张边缘阴影框） */
export const bj6: Template = {
  id: "bj6",
  name: "北京大学第六医院 · 非医保处方",
  hospital: "北京大学第六医院",
  desc: "按原扫描样张逐像素复刻：四格表格线 + 纸张边缘闭合阴影框，版面固定 836×470.5pt；左上角新增扫码支付二维码",
  group: "复刻样张",
  page: { widthPt: 836, heightPt: 470.5 },
  limits: { maxDiag: 8, maxDrugs: 5 },
  sections: {
    patient: true,
    identity: true,
    visit: false,
    diagnosis: true,
    drugs: true,
    drugTable: false,
    tcm: false,
    footer: true,
  },
  extraKeys: [
    // 左上角「扫码支付」二维码的内容（新增元素，见 bj6-impl.ts）；留空时自动回退用病历号
    { key: "qrText", label: "二维码内容（扫码支付）" },
  ],
  build,
};
