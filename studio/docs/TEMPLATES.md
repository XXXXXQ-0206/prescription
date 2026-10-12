# 模板系统（多医院单据适配）

程序里的每一种单据版式都是一个**模板**，模板 = 一份「版面声明 + 表单字段需求 + Typst 生成函数」。
界面顶部「单据模板」一行切换，切换时会自动套用该模板的示例数据与扩展字段。

## 现有模板

| id | 名称 | 版式 | 页面(pt) | 内容上限 |
| --- | --- | --- | --- | --- |
| `bj6` | 北京大学第六医院 · 非医保处方 | 复刻样张（绝对定位 + 纸张边缘阴影框） | 836 × 470.5 | 8 诊断 / 5 药品 |
| `zz` | 郑州市中心医院处方笺 | 二维码 + 右上角方框 + Rp 两行式药品 | 419.5 × 595.3 | 12 / 20 |
| `bj3` | 北京大学第三医院处方（医保）门诊 | 横向 A4，药品五列表格 | 842 × 595.3 | 6 / 6 |
| `zy` | 遵义医科大学第五附属（珠海）医院处方笺 | 条码 + 中英文院名，每味药两行 | 419.5 × 595.3 | 6 / 6 |
| `cq` | 重庆市九龙坡区中医院处方笺（中药） | 中药三栏药味宫格 | 559 × 794 | 8 / 60 |

## 目录结构

```
src/templates/
├── types.ts     Template 接口（版面/字段/上限/默认数据）
├── kit.ts       工具箱：preamble / esc / money / circled / trim /
│                BARCODE_HELPER + barcodeBlock / QR_HELPER + qrBlock /
│                ruleLine / total
├── generic.ts   通用处方笺骨架（新模板的起点，**只读**，请把需要的部分复制进自己的文件）
├── bj6.ts       → 复用 lib 里的绝对定位实现（保留逐像素复刻成果）
├── bj6-impl.ts  复刻样张的 Typst 生成实现
├── zz.ts / bj3.ts / zy.ts / cq.ts   各家医院模板
└── index.ts     注册表：TEMPLATES + getTemplate() + buildTypst()
```

## 数据模型

表单数据在 `src/lib/doc.ts`：

- **通用字段**：`patientName / gender / age / dept / diagnoses[] / drugs[] / doctor / feeKey / printDate / validDays / options`
- **drug**：`name brand spec price qty usage`（复刻版用）+ `prefix unit freq dose route days tcm note`（表格版/中药版用）
- **extra**（各模板差异最大的表头表尾都放这里，见 `DocExtra`）：
  `rxNo feeCategory medicalId caseNo idType ssn orgCode unitName visitNo visitDate weight phone pharmacy note amount pageInfo printTime qrText`

模板用 `extraKeys` 声明自己需要哪些扩展字段，表单会据此渲染输入框。

## 新增一个模板

1. 复制 `generic.ts` 里需要的部分，新建 `src/templates/<id>.ts`，导出一个 `Template`：

```ts
export const myTpl: Template = {
  id: "my", name: "某某医院处方笺", hospital: "某某医院",
  desc: "一句话说明", group: "门诊电子处方",
  page: { widthPt: 419.5, heightPt: 595.3 },
  limits: { maxDiag: 12, maxDrugs: 20 },
  sections: { patient: true, identity: true, visit: true, diagnosis: true,
              drugs: true, drugTable: true, tcm: false, footer: true },
  extraKeys: [{ key: "rxNo", label: "处方号" }],
  defaults: { hospital: "某某医院", patientName: "示例", /* … */ },
  build: (doc) => `…Typst 源码…`,
};
```

2. 在 `src/templates/index.ts` 的 `TEMPLATES` 数组里登记一行。
3. 渲染自检：

```bash
cd studio
npx esbuild scripts/render-all.ts --bundle --format=esm --platform=node --outfile=scripts/render-all.mjs '--alias:@=./src'
node scripts/render-all.mjs my      # 产出 out/tpl-my.png
```

## 两种排版风格

- **绝对定位**（`bj6`）：每个字块用 `place(dx: …, dy: …)` 钉死在实测坐标上，适合"复刻某一张样张"；
  内容长度超出时用 `maxw` 自动缩字号兜底。
- **流式布局**（其余模板）：用 Typst 的 `grid / box / stack` 自然流排，内容多就往下长，适合"生成任意一张单据"。
  这类模板要自己保证不溢出：给长文本加 `maxw` 或 `#set text(…)` 的换行约束，并渲染压力用例验证。

## 约定

- 字体：中文 SimSun（宋体），数字/英文 Times New Roman 或 Arial，条码数字 Courier New——都是 Windows 自带，不打包字体。
- 条码：`barcodeBlock(text, w, h)` 输出 Code 128；二维码：`qrBlock(text, side)`，`src/lib/qr.ts` 未实现时退化成"扫码支付"提示框，**不会画假二维码**。
- 金额：`money()` 两位小数；`extra.amount` 填了就以它为准，否则用 `total(doc)` 自动合计。
