import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { buildTypst } from "@/lib/typst-doc";
import { defaultDoc, makeDrug, totalOf, MAX_DIAG_LINES, MAX_DRUGS } from "@/lib/doc";
import type { PrescriptionDoc } from "@/lib/doc";

/**
 * 独立验证者新增：极限用例渲染脚本（只新增，不修改既有文件）。
 * 输出 studio/out/X1..X4.{typ,png}
 */
const out = path.resolve("out");
fs.mkdirSync(out, { recursive: true });
const typst = path.resolve("resources", process.platform === "win32" ? "typst.exe" : "typst");

function variant(name: string, mutate: (d: PrescriptionDoc) => void) {
  const d = defaultDoc();
  mutate(d);
  return { name, src: buildTypst(d), total: totalOf(d.drugs), doc: d };
}

const eightDiag = ["心境[情感]障碍", "抑郁状态", "焦虑状态", "失眠症", "强迫性障碍", "躯体形式障碍", "适应障碍", "偏执性反应"];

const cases = [
  // X1: 8 行诊断（诊断上限）
  variant("X1-八行诊断", (d) => {
    d.diagnoses = eightDiag;
    d.drugs = [makeDrug("氢溴酸伏硫西汀片")];
  }),
  // X2: 5 条药品（药品上限）
  variant("X2-五条药品", (d) => {
    d.diagnoses = ["抑郁状态"];
    d.drugs = [
      makeDrug("草酸艾司西酞普兰片"), makeDrug("米氮平片"), makeDrug("枸橼酸坦度螺酮胶囊"),
      makeDrug("右佐匹克隆片"), makeDrug("奥氮平片"),
    ];
  }),
  // X3: 最少内容（1 行诊断 + 1 条药品）
  variant("X3-最少内容", (d) => {
    d.diagnoses = ["抑郁状态"];
    d.drugs = [makeDrug("氢溴酸伏硫西汀片")];
  }),
  // X4: 左栏医院名超长
  variant("X4-超长医院名", (d) => {
    d.hospital = "中国人民解放军总医院第一医学中心";
    d.diagnoses = eightDiag;
    d.drugs = [makeDrug("氢溴酸伏硫西汀片")];
  }),
  // X5: 诊断与药品同时打满（8 行诊断 + 5 条药品）—— 极限叠加
  variant("X5-双打满", (d) => {
    d.diagnoses = eightDiag;
    d.drugs = [
      makeDrug("草酸艾司西酞普兰片"), makeDrug("米氮平片"), makeDrug("枸橼酸坦度螺酮胶囊"),
      makeDrug("右佐匹克隆片"), makeDrug("奥氮平片"),
    ];
    d.options.showUsage = true;
    d.options.showMoney = true;
  }),
  // X6: 超限（9 行诊断 + 6 条药品）—— 校验截断是否生效
  variant("X6-超出上限", (d) => {
    d.diagnoses = [...eightDiag, "第九行诊断"];
    d.drugs = [
      makeDrug("草酸艾司西酞普兰片"), makeDrug("米氮平片"), makeDrug("枸橼酸坦度螺酮胶囊"),
      makeDrug("右佐匹克隆片"), makeDrug("奥氮平片"), makeDrug("劳拉西泮片"),
    ];
  }),
];

for (const c of cases) {
  const id = c.name.split("-")[0];
  const typ = path.join(out, `${id}.typ`);
  const png = path.join(out, `${id}.png`);
  fs.writeFileSync(typ, c.src, "utf8");
  try {
    execFileSync(typst, ["compile", typ, png, "--ppi", "144"], { stdio: "pipe" });
    console.log(`OK ${c.name}  合计 ${c.total.toFixed(2)} 元 diag=${c.doc.diagnoses.length} drug=${c.doc.drugs.length} → ${id}.png`);
  } catch (e) {
    console.log(`FAIL ${c.name}\n${String((e as any).stderr || e).slice(0, 800)}`);
    process.exitCode = 1;
  }
}
console.log("MAX_DIAG_LINES=" + MAX_DIAG_LINES + " MAX_DRUGS=" + MAX_DRUGS);
