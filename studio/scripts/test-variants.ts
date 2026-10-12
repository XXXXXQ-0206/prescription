import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { buildTypst } from "@/lib/typst-doc";
import { defaultDoc, makeDrug, totalOf } from "@/lib/doc";
import type { PrescriptionDoc } from "@/lib/doc";

const out = path.resolve("out");
fs.mkdirSync(out, { recursive: true });
const typst = path.resolve("resources", process.platform === "win32" ? "typst.exe" : "typst");

function variant(name: string, mutate: (d: PrescriptionDoc) => void) {
  const d = defaultDoc();
  mutate(d);
  return { name, src: buildTypst(d), total: totalOf(d.drugs) };
}

const cases = [
  variant("A-默认（样张同款）", () => {}),
  variant("B-五条药品+八行诊断", (d) => {
    d.diagnoses = ["心境[情感]障碍", "抑郁状态", "焦虑状态", "失眠症", "强迫性障碍", "躯体形式障碍", "适应障碍", "偏执性反应"];
    d.drugs = [makeDrug("草酸艾司西酞普兰片"), makeDrug("米氮平片"), makeDrug("枸橼酸坦度螺酮胶囊"), makeDrug("右佐匹克隆片"), makeDrug("奥氮平片")];
  }),
  variant("C-长姓名+医保+三日有效", (d) => {
    d.patientName = "欧阳司马长风";
    d.docType = "医保处方";
    d.hospital = "首都医科大学附属北京安定医院";
    d.dept = "心身医学科";
    d.validDays = 3;
    d.feeKey = "乙";
    d.doctor = "欧阳夏丹";
    d.cardNo = "202607310001";
  }),
  variant("D-显示用法用量与数量金额", (d) => {
    d.drugs = [makeDrug("草酸艾司西酞普兰片"), makeDrug("劳拉西泮片")];
    d.drugs[0].qty = 3;
    d.drugs[1].qty = 2;
    d.options.showUsage = true;
    d.options.showMoney = true;
  }),
  variant("E-极简（关掉条码/提示/费用行/签章）", (d) => {
    d.options.showBarcode = false;
    d.options.showCardNo = false;
    d.options.showSerial = false;
    d.options.showTips = false;
    d.options.showFeeLine = false;
    d.options.showSign = false;
    d.options.showPrintDate = false;
  }),
];

let fail = 0;
for (const c of cases) {
  const typ = path.join(out, `${c.name.slice(0, 1)}.typ`);
  const png = path.join(out, `${c.name.slice(0, 1)}.png`);
  fs.writeFileSync(typ, c.src, "utf8");
  try {
    execFileSync(typst, ["compile", typ, png, "--ppi", "144"], { stdio: "pipe" });
    console.log(`✓ ${c.name}  合计 ${c.total.toFixed(2)} 元  → ${path.basename(png)}`);
  } catch (e) {
    fail++;
    console.log(`✗ ${c.name}\n${String(e.stderr || e).slice(0, 600)}`);
  }
}
console.log(fail ? `${fail} 个变体失败` : "全部变体编译通过");
process.exit(fail ? 1 : 0);
