import { rolldown } from "rolldown";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const root = path.resolve(import.meta.dirname, "..");
const outdir = mkdtempSync(path.join(tmpdir(), "presets-doc-"));
const outfile = path.join(outdir, "presets.mjs");
const b = await rolldown({ input: path.join(root, "src/data/presets.ts"), logLevel: "silent" });
await b.write({ file: outfile, format: "esm" });
await b.close();
const P = await import(pathToFileURL(outfile).href);
rmSync(outdir, { recursive: true, force: true });

const { HOSPITALS, DEPARTMENTS, DIAGNOSES, DRUGS, DOCTORS, FEE_TYPES, DOC_TYPES, USAGE_PRESETS, TIP_PRESETS, REGIMENS, GENDERS, INSURANCE_PRESETS } = P;
const esc = (s) => String(s).replace(/\|/g, "\\|");
const table = (head, rows) => {
  const out = ["| " + head.join(" | ") + " |", "| " + head.map(() => "---").join(" | ") + " |"];
  for (const r of rows) out.push("| " + r.map(esc).join(" | ") + " |");
  return out.join("\n");
};
const num = (a, b) => a - b;

const diagTotal = DIAGNOSES.reduce((n, g) => n + g.items.length, 0);
const byClass = new Map();
for (const d of DRUGS) byClass.set(d.class, (byClass.get(d.class) ?? 0) + 1);

const L = [];
L.push("# 处方预设库清单（PRESETS）");
L.push("");
L.push("本文件描述 `studio/src/data/presets.ts` 中全部预设数据的结构、清单与维护方式。");
L.push("界面中的下拉框、搜索列表、\"常用方案\" 一键带入均直接读取该文件，**改数据只需改这一个文件**。");
L.push("");
L.push("> 所有药品价格仅为演示排版数据，实际使用请按本单位药品目录自行修改。");
L.push("");
L.push("## 1. 总览");
L.push("");
L.push(table(["导出名", "含义", "类型", "数量"], [
  ["HOSPITALS", "医院名称", "string[]", HOSPITALS.length],
  ["DEPARTMENTS", "科室名称", "string[]", DEPARTMENTS.length],
  ["DIAGNOSES", "诊断（按组）", "DiagnosisGroup[]", DIAGNOSES.length + " 组 / " + diagTotal + " 条"],
  ["DRUGS", "药品（含厂牌/规格/单价/用法）", "DrugPreset[]", DRUGS.length],
  ["DOCTORS", "医师姓名", "string[]", DOCTORS.length],
  ["FEE_TYPES", "费用类别（甲/乙/丙）", "FeeType[]", FEE_TYPES.length],
  ["DOC_TYPES", "单据类型", "DocType[]", DOC_TYPES.length],
  ["USAGE_PRESETS", "用法用量", "string[]", USAGE_PRESETS.length],
  ["TIP_PRESETS", "处方提示语（按组）", "string[][]", TIP_PRESETS.length + " 组"],
  ["REGIMENS", "常见方案（诊断+用药）", "RegimenPreset[]", REGIMENS.length],
  ["GENDERS", "性别", "string[]", GENDERS.length],
  ["INSURANCE_PRESETS", "结算方式文案", "InsurancePreset[]", INSURANCE_PRESETS.length],
]));
L.push("");
L.push("## 2. 字段说明");
L.push("");
L.push("### DrugPreset（DRUGS 的元素）");
L.push("");
L.push(table(["字段", "类型", "说明", "示例"], [
  ["name", "string", "药品通用名，**REGIMENS.drugs 必须与此完全一致**", DRUGS[0].name],
  ["brand", "string", "厂牌/商品名", DRUGS[0].brand],
  ["spec", "string", "规格，形如 \"10mg x 14片/盒\"", DRUGS[0].spec],
  ["price", "number", "单价（元），保留两位小数", DRUGS[0].price.toFixed(2)],
  ["usage", "string", "默认用法用量，如 \"每日1次 每次1片 口服\"", DRUGS[0].usage],
  ["class", "string", "药品分类，用于归类检索", DRUGS[0].class],
]));
L.push("");
L.push("### DiagnosisGroup（DIAGNOSES 的元素）");
L.push("");
L.push(table(["字段", "类型", "说明"], [
  ["group", "string", "分组名，如 \"心境障碍\""],
  ["items", "string[]", "该组下的诊断名称（ICD/中文精神科常用写法）"],
]));
L.push("");
L.push("### RegimenPreset（REGIMENS 的元素）");
L.push("");
L.push(table(["字段", "类型", "说明"], [
  ["name", "string", "方案名，显示为界面上的快捷按钮，**全局唯一**"],
  ["diagnosis", "string[]", "诊断列表，每项必须命中 DIAGNOSES 中的条目"],
  ["drugs", "string[]", "药品名列表，每项必须命中 DRUGS 的 name（否则带不出规格与价格）"],
]));
L.push("");
L.push("## 3. 医院清单（" + HOSPITALS.length + "）");
L.push("");
L.push(HOSPITALS.map((h, i) => (i + 1) + ". " + h).join("\n"));
L.push("");
L.push("## 4. 科室清单（" + DEPARTMENTS.length + "）");
L.push("");
L.push(DEPARTMENTS.join("、"));
L.push("");
L.push("## 5. 诊断清单（" + DIAGNOSES.length + " 组 / " + diagTotal + " 条）");
L.push("");
L.push(table(["分组", "条数", "诊断名称"], DIAGNOSES.map((g) => [g.group, g.items.length, g.items.join("；")])));
L.push("");
L.push("## 6. 药品清单（" + DRUGS.length + "）");
L.push("");
L.push("按分类统计：" + [...byClass.entries()].map(([k, v]) => k + " " + v + " 种").join("，") + "。");
L.push("");
L.push(table(["#", "药品名", "厂牌", "规格", "单价(元)", "默认用法", "分类"],
  DRUGS.map((d, i) => [i + 1, d.name, d.brand, d.spec, d.price.toFixed(2), d.usage, d.class])));
L.push("");
L.push("## 7. 常见方案清单（" + REGIMENS.length + "）");
L.push("");
L.push(table(["方案名", "诊断", "用药"], REGIMENS.map((r) => [r.name, r.diagnosis.join("；"), r.drugs.join("；")])));
L.push("");
L.push("## 8. 用法用量预设（" + USAGE_PRESETS.length + "）");
L.push("");
L.push(USAGE_PRESETS.map((u, i) => (i + 1) + ". " + u).join("\n"));
L.push("");
L.push("## 9. 提示语预设（" + TIP_PRESETS.length + " 组）");
L.push("");
for (const [i, t] of TIP_PRESETS.entries()) L.push("- 第 " + (i + 1) + " 组：" + t.join(" "));
L.push("");
L.push("## 10. 其它预设");
L.push("");
L.push(table(["预设", "内容"], [
  ["DOCTORS", DOCTORS.join("、")],
  ["GENDERS", GENDERS.join("、")],
  ["FEE_TYPES", FEE_TYPES.map((f) => f.key + "=" + f.label + "（" + f.desc + "）").join("；")],
  ["DOC_TYPES", DOC_TYPES.map((d) => d.title + "（" + d.hint + "）").join("；")],
  ["INSURANCE_PRESETS", INSURANCE_PRESETS.map((i) => i.label + "→" + i.selfPayText).join("；")],
]));
L.push("");
L.push("## 11. 如何新增一条");
L.push("");
L.push("### 新增药品");
L.push("");
L.push("在 `DRUGS` 数组末尾追加一行（保持双引号、分号、2 空格缩进）：");
L.push("");
L.push("```ts");
L.push('{ name: "盐酸示例片", brand: "示例厂牌", spec: "5mg x 14片/盒", price: 12.34, usage: "每日1次 每次1片 口服", class: "抗抑郁药" },');
L.push("```");
L.push("");
L.push("要求：");
L.push("");
L.push("1. `name` 为通用名且**不与现有药品重名**（重名会让 `makeDrug` 查到错误的价格）。");
L.push("2. `spec`、`usage`、`brand`、`class` 均为非空字符串；`price` 为正数，保留两位小数。");
L.push("3. 规格写法统一为 \"剂量 x 装量/盒（或 /瓶、/支）\"。");
L.push("");
L.push("### 新增诊断");
L.push("");
L.push("找到（或新建）一个分组对象，往 `items` 里加字符串；若新建分组，需保持 `{ group, items }` 结构：");
L.push("");
L.push("```ts");
L.push('{ group: "新分组名", items: ["诊断一", "诊断二"] },');
L.push("```");
L.push("");
L.push("### 新增常见方案（重要）");
L.push("");
L.push("在 `REGIMENS` 追加：");
L.push("");
L.push("```ts");
L.push('{ name: "方案名", diagnosis: ["抑郁状态"], drugs: ["盐酸舍曲林片", "劳拉西泮片"] },');
L.push("```");
L.push("");
L.push("**约束（生成器按 name 查表，写错会静默带出空规格/0 元）**：");
L.push("");
L.push("- `drugs` 里的每个字符串必须**逐字命中** `DRUGS[].name`；");
L.push("- `diagnosis` 里的每个字符串必须逐字命中 `DIAGNOSES[].items`；");
L.push("- `name` 全局唯一；`diagnosis` 与 `drugs` 均不得为空数组；");
L.push("- 界面按 `MAX_DIAG_LINES`(8) 与 `MAX_DRUGS`(5) 截断，建议每方案诊断 ≤ 8、药品 ≤ 5。");
L.push("");
L.push("### 新增医院 / 科室 / 用法 / 提示语");
L.push("");
L.push("分别追加到 `HOSPITALS`、`DEPARTMENTS`、`USAGE_PRESETS`（字符串数组）、`TIP_PRESETS`（二维字符串数组，一组一条医嘱提示）。");
L.push("");
L.push("## 12. 自检");
L.push("");
L.push("改完预设后运行：");
L.push("");
L.push("```bash");
L.push("cd studio");
L.push("node scripts/check-presets.mjs   # 预设一致性断言");
L.push("npm run build                    # 类型/构建检查");
L.push("```");
L.push("");
L.push("断言脚本先用 Vite 自带的 rolldown 把 `presets.ts` 打包成 ESM 再动态导入（不新增任何依赖），覆盖：REGIMENS 的 drug 名与 diagnosis 是否命中库中、DRUGS/HOSPITALS/科室/诊断条目/方案名是否重复、");
L.push("每条药品字段是否非空且价格有效，以及各项数量下限（医院 ≥30、科室 ≥20、诊断 ≥8 组且 ≥60 条、药品 ≥45、方案 ≥15、用法 ≥20、提示语 ≥6 组）。");
L.push("");

const md = L.join("\n") + "\n";
writeFileSync(path.join(root, "docs/PRESETS.md"), md, "utf8");
console.log("written docs/PRESETS.md, chars=" + md.length);
