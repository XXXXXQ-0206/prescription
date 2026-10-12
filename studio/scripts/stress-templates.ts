/**
 * 压力测试用例渲染（独立验证者新增，不修改既有脚本）。
 *
 * 对每个模板渲染 3 个用例：
 *   max  —— 诊断/药品同时拉到该模板 limits 上限
 *   min  —— 极短内容（1 诊断 + 1 药品，字段尽量留空）
 *   long —— 超长文本（长诊断/长药名/长规格/长科室）
 * 输出 studio/out/stress-<id>-<kind>.{typ,png}
 *
 * 用法：
 *   cd studio
 *   npx esbuild scripts/stress-templates.ts --bundle --format=esm --platform=node --outfile=scripts/stress-templates.mjs '--alias:@=./src'
 *   node scripts/stress-templates.mjs
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { defaultDoc, emptyExtra, type PrescriptionDoc, type DrugItem } from "@/lib/doc";
import { TEMPLATES } from "@/templates";

/** 与 render-all.ts 的 docFor 等价，但本地实现以避免触发 render-all 的渲染副作用 */
function docFor(templateId: string): PrescriptionDoc {
  const t = TEMPLATES.find((x) => x.id === templateId) ?? TEMPLATES[0];
  const d = (t.defaults ?? {}) as Partial<PrescriptionDoc> & { extra?: Record<string, string> };
  const base = defaultDoc();
  return {
    ...base,
    ...d,
    templateId: t.id,
    options: { ...base.options, ...(d.options ?? {}) },
    extra: { ...emptyExtra(), ...(d.extra ?? {}) },
  } as PrescriptionDoc;
}

const out = path.resolve("out");
fs.mkdirSync(out, { recursive: true });
const typst = path.resolve("resources", process.platform === "win32" ? "typst.exe" : "typst");

/** 复制一份默认文档（含 extra），便于安全改写 */
function clone(id: string): PrescriptionDoc {
  const d = docFor(id);
  return JSON.parse(JSON.stringify(d)) as PrescriptionDoc;
}

/** 造一条「内容饱满」的药品：名称/规格/用法都取长文本 */
function richDrug(i: number, id: string): DrugItem {
  const names = [
    "草酸艾司西酞普兰片", "米氮平片", "枸橼酸坦度螺酮胶囊", "右佐匹克隆片", "奥氮平片",
    "盐酸舍曲林片", "阿普唑仑片", "氯硝西泮片", "喹硫平片", "碳酸锂缓释片",
    "盐酸度洛西汀肠溶胶囊", "阿立哌唑口崩片", "丙戊酸钠缓释片", "劳拉西泮片", "帕罗西汀片",
  ];
  const specs = ["10mg x 14片/盒", "30mg x 20片/盒", "5mg x 28片/盒", "0.5g x 24粒/盒"];
  return {
    id: `${id}s${i}`,
    name: names[i % names.length],
    brand: i % 3 === 0 ? "石药" : "",
    spec: specs[i % specs.length],
    price: 9.87 + i,
    qty: 1 + (i % 3),
    usage: "每日1次 每次1片 口服",
    prefix: i % 4 === 0 ? "(基)" : "",
    unit: "盒",
    freq: "每日二次",
    dose: "0.1000g",
    route: "口服",
    days: String(1 + (i % 7)),
    tcm: 10 + (i % 20),
    note: i % 3 === 1 ? "超限原因:慢性病患者" : "",
  } as DrugItem;
}

const LONG_DIAGS = [
  "心境[情感]障碍", "抑郁状态", "焦虑状态", "失眠症", "强迫性障碍", "躯体形式障碍",
  "适应障碍", "偏执性反应", "广泛性焦虑障碍", "双相情感障碍",
  "精神分裂症偏执型", "创伤后应激障碍",
];

const cases: Array<{ id: string; kind: string; doc: PrescriptionDoc }> = [];

for (const t of TEMPLATES) {
  const { maxDiag, maxDrugs } = t.limits;

  // ── max：诊断与药品同时拉到上限 ──
  {
    const d = clone(t.id);
    d.diagnoses = Array.from({ length: maxDiag }, (_, i) => LONG_DIAGS[i % LONG_DIAGS.length]);
    d.drugs = Array.from({ length: maxDrugs }, (_, i) => richDrug(i, t.id));
    cases.push({ id: t.id, kind: "max", doc: d });
  }

  // ── min：极短内容 ──
  {
    const d = clone(t.id);
    d.diagnoses = ["感冒"];
    d.patientName = "丁一";
    d.doctor = "王五";
    d.dept = "全科";
    d.age = "1";
    d.drugs = [{ ...richDrug(0, t.id), name: "阿司匹林", spec: "0.1g", usage: "口服", brand: "", note: "" }];
    cases.push({ id: t.id, kind: "min", doc: d });
  }

  // ── long：超长文本（诊断/药名/规格/科室/单位/提示） ──
  {
    const d = clone(t.id);
    d.diagnoses = [
      "慢性阻塞性肺疾病伴急性下呼吸道感染(重度,合并Ⅱ型呼吸衰竭)",
      "2型糖尿病伴多种并发症(糖尿病肾病Ⅳ期、周围神经病变、视网膜病变)",
      "原发性高血压3级(极高危)伴左心室肥厚及心功能不全",
      "冠状动脉粥样硬化性心脏病(陈旧性心肌梗死,支架植入术后)",
      "慢性肾脏病5期(维持性血液透析状态)",
      "重度抑郁症伴精神病性症状(反复发作,目前为重度发作)",
      "甲状腺功能减退症(自身免疫性甲状腺炎所致)",
      "良性前列腺增生伴下尿路症状及残余尿增多",
    ].slice(0, Math.max(1, Math.min(maxDiag, 8)));
    d.drugs = Array.from({ length: Math.max(1, Math.min(maxDrugs, 8)) }, (_, i) => ({
      ...richDrug(i, t.id),
      name: "盐酸戊乙奎醚注射液(超长药名测试用)",
      spec: "10mg:1ml x 6支/盒(冷藏避光保存,有效期24个月)",
      usage: "每日三次 每次一片 饭后半小时温开水送服",
      note: "超限原因:慢性病患者长期用药需专科医师复核后方可开具",
    }));
    d.dept = "耳鼻咽喉头颈外科变态反应与睡眠呼吸障碍专病门诊";
    d.patientName = "欧阳司马长风";
    d.doctor = "欧阳夏丹";
    cases.push({ id: t.id, kind: "long", doc: d });
  }
}

let bad = 0;
const manifest: Array<Record<string, unknown>> = [];
for (const c of cases) {
  const t = TEMPLATES.find((x) => x.id === c.id)!;
  let src: string;
  try {
    src = t.build(c.doc);
  } catch (e) {
    bad++;
    console.log(`FAIL ${c.id}-${c.kind}  build() 抛异常: ${String(e).slice(0, 200)}`);
    manifest.push({ id: c.id, kind: c.kind, diag: c.doc.diagnoses.length, drugs: c.doc.drugs.length,
                    page: t.page, limits: t.limits, error: String(e).slice(0, 300) });
    continue;
  }
  const base = `stress-${c.id}-${c.kind}`;
  const typ = path.join(out, base + ".typ");
  const png = path.join(out, base + ".png");
  fs.writeFileSync(typ, src, "utf8");
  try {
    execFileSync(typst, ["compile", typ, png, "--ppi", "144"], { stdio: "pipe" });
    const kb = (fs.statSync(png).size / 1024).toFixed(0);
    console.log(`OK   ${base.padEnd(18)} diag=${c.doc.diagnoses.length} drug=${c.doc.drugs.length} → ${base}.png (${kb}KB)`);
    manifest.push({ id: c.id, kind: c.kind, diag: c.doc.diagnoses.length, drugs: c.doc.drugs.length,
                    page: t.page, limits: t.limits, png: png.replace(/\\\\/g, "/") });
  } catch (e) {
    bad++;
    console.log(`FAIL ${base}\n${String((e as { stderr?: Buffer }).stderr ?? e).slice(0, 800)}`);
  }
}
fs.writeFileSync(path.join(out, "stress-manifest.json"), JSON.stringify(manifest, null, 1), "utf8");
console.log(`共 ${cases.length} 个压力用例，失败 ${bad} 个`);
process.exit(bad ? 1 : 0);
