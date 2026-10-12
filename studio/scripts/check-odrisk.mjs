// scripts/check-odrisk.mjs —— OD（过量）风险提示专项断言 + 新增药品/诊断/方案统计
// 运行：cd studio && node scripts/check-odrisk.mjs
import { rolldown } from "rolldown";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const root = path.resolve(import.meta.dirname, "..");
const outdir = mkdtempSync(path.join(tmpdir(), "odrisk-check-"));
const outfile = path.join(outdir, "presets.mjs");
const bundle = await rolldown({ input: path.join(root, "src/data/presets.ts"), logLevel: "silent" });
await bundle.write({ file: outfile, format: "esm" });
await bundle.close();
const P = await import(pathToFileURL(outfile).href);
rmSync(outdir, { recursive: true, force: true });

const fails = [];
const check = (cond, label, extra = "") => {
  console.log((cond ? "PASS" : "FAIL") + "  " + label + (extra ? "  " + extra : ""));
  if (!cond) fails.push(label);
};

const { DRUGS, DIAGNOSES, REGIMENS, odRiskOf, COLD_MEDICINE_HINTS } = P;

// —— 本次任务新增的 24 种药品（任务清单，用于断言"每个新增药品都有 odRisk"） ——
const NEW_DRUGS = ["盐酸阿米替林片","盐酸丙咪嗪片","对乙酰氨基酚片","布洛芬缓释胶囊","双氯芬酸钠缓释片","阿司匹林肠溶片","盐酸吗啡缓释片","盐酸羟考酮缓释片","芬太尼透皮贴剂","盐酸曲马多缓释片","盐酸苯海拉明片","马来酸氯苯那敏片","盐酸异丙嗪片","酒石酸美托洛尔片","富马酸比索洛尔片","苯磺酸氨氯地平片","硝苯地平控释片","地高辛片","华法林钠片","甘精胰岛素注射液","门冬胰岛素注射液","格列美脲片","格列齐特缓释片","盐酸二甲双胍缓释片"];
// —— 本次任务新增的 24 条方案 ——
const NEW_REGIMENS = ["抑郁症·SSRI 起始","抑郁症·三环类（二线）","抑郁症·三环类替代","焦虑症伴失眠","焦虑症·短期助眠","双相障碍·锂盐维持","精神分裂症·奥氮平起始","失眠症·非苯二氮䓬类","发热·解热镇痛","关节炎·NSAIDs","关节炎·双氯芬酸方案","过敏性鼻炎·抗组胺","荨麻疹·抗组胺","荨麻疹伴瘙痒·镇静性抗组胺","高血压·联合降压","高血压·钙通道阻滞剂","心律失常·心室率控制","心力衰竭·基础用药","心房颤动·率控与抗凝","2 型糖尿病·口服起始","2 型糖尿病·磺脲类联合","2 型糖尿病·基础胰岛素","2 型糖尿病·基础-餐时胰岛素","癌性疼痛·阿片类起始"];
// —— 本次任务新增的 12 条诊断 ——
const NEW_DIAGNOSES = ["抑郁症","焦虑症","发热","关节炎","过敏性鼻炎","荨麻疹","高血压","心律失常","心力衰竭","心房颤动","2 型糖尿病","癌性疼痛"];

// —— 本轮补齐 odRisk 的 18 种药品（SNRI/NaSSA/其他抗抑郁/抗焦虑/认知改善/ADHD/褪黑素） ——
const OD_FILLED_DRUGS = ["盐酸文拉法辛缓释胶囊","度洛西汀肠溶胶囊","米那普仑片","米氮平片","曲唑酮片","盐酸米安色林片","阿戈美拉汀片","盐酸安非他酮缓释片","枸橼酸坦度螺酮胶囊","盐酸丁螺环酮片","盐酸多奈哌齐片","重酒石酸卡巴拉汀胶囊","盐酸美金刚片","奥拉西坦胶囊","盐酸哌甲酯缓释片","盐酸右哌甲酯片","盐酸托莫西汀胶囊","褪黑素缓释片"];
// —— 覆盖率断言范围：精神/神经/镇痛/心血管/内分泌类，及中枢或循环相关的抗组胺、抗凝血 ——
const OD_SCOPE_CLASSES = ["抗抑郁药","抗精神病药","抗焦虑药","镇静催眠药","心境稳定剂","认知改善药","ADHD用药","解热镇痛药","麻醉性镇痛药","镇痛药","抗组胺药","β受体阻滞剂","钙通道阻滞剂","强心苷","抗凝血药","胰岛素","口服降糖药"];
// —— 允许无 odRisk 的白名单（每条必须写明理由，且必须确实没有 odRisk）。
//    当前为空：全库 77 种药品均已挂 odRisk，无需例外。 ——
const OD_WHITELIST = [];

const byName = new Map(DRUGS.map((d) => [d.name, d]));
const missingNew = NEW_DRUGS.filter((n) => !byName.has(n));
check(missingNew.length === 0, "新增药品全部存在于 DRUGS（" + NEW_DRUGS.length + " 种）", missingNew.join("; "));

// ① 每个新增药品都有非空 odRisk
const noOd = NEW_DRUGS.filter((n) => !(byName.get(n)?.odRisk ?? "").trim());
check(noOd.length === 0, "① 每个新增药品都有非空 odRisk", noOd.join("; "));
const withOd = DRUGS.filter((d) => (d.odRisk ?? "").trim()).length;
console.log("     （全库带 odRisk：" + withOd + "/" + DRUGS.length + " 种）");

// ② odRisk 长度（用户要求 ≤60 字；此处同时满足任务的 ≤80 字上限）
const lens = DRUGS.filter((d) => d.odRisk).map((d) => [...d.odRisk].length);
const maxLen = lens.length ? Math.max(...lens) : 0;
const tooLong = DRUGS.filter((d) => (d.odRisk ?? "") && [...d.odRisk].length > 60).map((d) => d.name + "(" + [...d.odRisk].length + "字)");
check(tooLong.length === 0, "② 所有 odRisk <= 60 字（严格于任务的 80 字；实际最长 " + maxLen + " 字）", tooLong.join("; "));
const tooLong80 = DRUGS.filter((d) => (d.odRisk ?? "") && [...d.odRisk].length > 80).map((d) => d.name);
check(tooLong80.length === 0, "②-b 所有 odRisk <= 80 字", tooLong80.join("; "));
const blank = DRUGS.filter((d) => d.odRisk !== undefined && !String(d.odRisk).trim()).map((d) => d.name);
check(blank.length === 0, "odRisk 若存在则不为空白字符串", blank.join("; "));

// ①-b 本轮补齐清单的 18 种药品都在库中且都有非空 odRisk
const missingFilled = OD_FILLED_DRUGS.filter((n) => !byName.has(n));
check(missingFilled.length === 0, "①-b 本轮补齐清单的 18 种药品都存在于 DRUGS", missingFilled.join("; "));
const noOdFilled = OD_FILLED_DRUGS.filter((n) => !(byName.get(n)?.odRisk ?? "").trim());
check(noOdFilled.length === 0, "①-c 本轮 18 种药品都有非空 odRisk", noOdFilled.join("; "));

// ①-d 覆盖范围完整性：DRUGS 里出现的每个 class 都必须已被下面的覆盖率断言覆盖（新增类别会在此暴露，需人工确认）
const unknownClasses = [...new Set(DRUGS.map((d) => d.class))].filter((c) => !OD_SCOPE_CLASSES.includes(c));
check(unknownClasses.length === 0, "①-d DRUGS 中所有 class 都在 odRisk 覆盖率断言范围内", unknownClasses.join("; "));

// ①-e 【全覆盖】精神/神经/镇痛/心血管/内分泌类药品（白名单例外）都有非空 odRisk
const inScope = DRUGS.filter((d) => OD_SCOPE_CLASSES.includes(d.class));
const noOdScope = inScope
  .filter((d) => !(d.odRisk ?? "").trim() && !OD_WHITELIST.some((w) => w.name === d.name))
  .map((d) => d.name + "[" + d.class + "]");
check(noOdScope.length === 0, "①-e 全覆盖：精神/神经/镇痛/心血管/内分泌类药品（" + inScope.length + " 种 / " + OD_SCOPE_CLASSES.length + " 类）均有非空 odRisk", noOdScope.join("; "));

// ①-f 白名单自身有效：条目真实存在、写明理由、且确实没有 odRisk（防止白名单躺平）
const wlBad = OD_WHITELIST.filter((w) => !byName.has(w.name) || !(w.reason ?? "").trim() || (byName.get(w.name)?.odRisk ?? "").trim().length > 0).map((w) => w.name);
check(wlBad.length === 0, "①-f 白名单条目均真实存在、已写明理由且确实无 odRisk（当前 " + OD_WHITELIST.length + " 条）", wlBad.join("; "));

// ①-g 全库覆盖率 100%
const coveredAll = DRUGS.filter((d) => (d.odRisk ?? "").trim()).length;
const stillMissing = DRUGS.filter((d) => !(d.odRisk ?? "").trim()).map((d) => d.name);
check(coveredAll === DRUGS.length, "①-g 全库 odRisk 覆盖率 100%（" + coveredAll + "/" + DRUGS.length + "）", stillMissing.join("; "));

// ③ 无重复药名
const dupNames = DRUGS.map((d) => d.name).filter((x, i, a) => a.indexOf(x) !== i);
check(dupNames.length === 0, "③ DRUGS 无重复药名", dupNames.join("; "));

// ④ 新增方案引用的药名/诊断都在库中
const diagSet = new Set(DIAGNOSES.flatMap((g) => g.items));
const regNames = new Set(REGIMENS.map((r) => r.name));
const notFoundReg = NEW_REGIMENS.filter((n) => !regNames.has(n));
check(notFoundReg.length === 0, "④-a 新增方案都已写入 REGIMENS（" + NEW_REGIMENS.length + " 条）", notFoundReg.join("; "));
const badDrug = [];
for (const r of REGIMENS) if (NEW_REGIMENS.includes(r.name)) for (const nm of r.drugs) if (!byName.has(nm)) badDrug.push(r.name + " -> " + nm);
check(badDrug.length === 0, "④-b 新增方案引用的药名都在药品库中", badDrug.join("; "));
const badDiag = [];
for (const r of REGIMENS) if (NEW_REGIMENS.includes(r.name)) for (const d of r.diagnosis) if (!diagSet.has(d)) badDiag.push(r.name + " -> " + d);
check(badDiag.length === 0, "④-c 新增方案引用的诊断都在 DIAGNOSES 中", badDiag.join("; "));
const missDiag = NEW_DIAGNOSES.filter((d) => !diagSet.has(d));
check(missDiag.length === 0, "④-d 本次新增诊断都已写入 DIAGNOSES（" + NEW_DIAGNOSES.length + " 条）", missDiag.join("; "));

// ⑤ odRisk 绝不能出现在任何模板/打印链路里
const tplDir = path.join(root, "src/templates");
const tplHits = readdirSync(tplDir).filter((f) => f.endsWith(".ts")).filter((f) => readFileSync(path.join(tplDir, f), "utf8").includes("odRisk"));
check(tplHits.length === 0, "⑤ src/templates/** 无任何 odRisk 引用（不会打印到处方上）", tplHits.join("; "));
const dts = readFileSync(path.join(root, "src/lib/doc.ts"), "utf8");
check(dts.includes("odRisk?: string"), "DrugItem 已加可选字段 odRisk（不改变既有字段语义）");

// 附：odRiskOf() 查询助手
check(odRiskOf("盐酸舍曲林片").length > 0 && odRiskOf("库里没有的药") === "", "odRiskOf(name) 可查；未收录药品返回空串");

// 附：复方感冒药成分提示（系统内提示，不入药库、不打印）
const coldOk = COLD_MEDICINE_HINTS.length >= 2 && COLD_MEDICINE_HINTS.every((c) => c.name && c.ingredients.length && c.hint);
check(coldOk, "COLD_MEDICINE_HINTS 至少 2 条且字段完整（仅系统内提示）");
const coldDup = COLD_MEDICINE_HINTS.filter((c) => byName.has(c.name));
check(coldDup.length === 0, "复方感冒药（泰诺/新康泰克）不当成药品条目入库，避免同成分叠加", coldDup.map((c) => c.name).join("; "));

// ⑥ 端到端：把 5 个模板真渲染一遍，确认 odRisk 没有进入排版源（模板排版已冻结，不允许改）
const outdir2 = mkdtempSync(path.join(tmpdir(), "odrisk-print-"));
const bundleOne = async (entry, name) => {
  const f = path.join(outdir2, name);
  const b = await rolldown({ input: path.join(root, entry), resolve: { alias: { "@": path.join(root, "src") } }, logLevel: "silent" });
  await b.write({ file: f, format: "esm" });
  await b.close();
  return import(pathToFileURL(f).href);
};
const DOC = await bundleOne("src/lib/doc.ts", "doc.mjs");
const TPL = await bundleOne("src/templates/index.ts", "templates.mjs");
rmSync(outdir2, { recursive: true, force: true });
const PICKED = ["盐酸羟考酮缓释片", "地高辛片", "甘精胰岛素注射液", "奥氮平片", "艾司唑仑片"];
// 本轮补齐 odRisk 的探针药：一起放进文档，验证新文案同样不会进入任何模板输出。
// 注意：bj6/zz/bj3 等模板有药品行数上限（写入 doc 的条目数多于可打印行数属既有设计），
// 因此这些条目只参与"0 泄漏"断言，不参与"药品名照常打印"的数量断言。
const PICKED_NEW = ["盐酸文拉法辛缓释胶囊", "盐酸哌甲酯缓释片", "盐酸托莫西汀胶囊"];
const probe = PICKED.map((n) => DOC.makeDrug(n));
const probeNew = PICKED_NEW.map((n) => DOC.makeDrug(n));
const probeAll = [...probe, ...probeNew];
check(probe.length === PICKED.length && probe.every((d) => d.odRisk), "makeDrug 会把 odRisk 带进处方条目（供界面提示）");
check(probeNew.length === PICKED_NEW.length && probeNew.every((d) => d.odRisk), "本轮补齐药品经 makeDrug 同样带出 odRisk（探针 " + probeNew.length + " 种）");
const allRisks = DRUGS.filter((d) => d.odRisk).map((d) => d.odRisk);
const FRAG = ["5-羟色胺", "阿片三联征", "锥体外系", "恶性综合征", "黄视", "乳酸酸中毒", "水杨酸", "消化道大出血", "低血糖昏迷", "锂中毒", "谵妄", "呼吸抑制", "心源性休克", "共济失调", "胆碱能危象", "异常勃起", "癫痫阈值", "5-HT1A", "心脏事件", "过度镇静", "体位性低血压"];
const leaks = [];
for (const t of TPL.TEMPLATES) {
  const base = DOC.defaultDoc();
  const d = t.defaults ?? {};
  const doc = { ...base, ...d, templateId: t.id, options: { ...base.options, ...(d.options ?? {}) }, extra: { ...DOC.emptyExtra(), ...(d.extra ?? {}) }, drugs: probeAll, diagnoses: ["抑郁症", "焦虑症"] };
  const out = t.build(doc);
  const hit = [...allRisks.filter((r) => out.includes(r)), ...FRAG.filter((f) => out.includes(f))];
  const printed = probe.filter((x) => out.includes(x.name)).length;
  if (hit.length || printed !== probe.length) leaks.push(t.id + "(" + (hit.join("/") || "药品名只打印 " + printed + "/" + probe.length) + ")");
}
check(leaks.length === 0, "⑥ 5 个模板实渲染：药品名照常打印，odRisk 文案与风险关键词 0 泄漏", leaks.join("; "));
// ⑤ 统计各类条数
console.log("");
console.log("== 统计 ==");
const byClass = new Map();
for (const d of DRUGS) {
  const k = d.class;
  const v = byClass.get(k) ?? { all: 0, od: 0 };
  v.all += 1;
  if ((d.odRisk ?? "").trim()) v.od += 1;
  byClass.set(k, v);
}
console.log("药品分类（总数 / 带 odRisk）：");
for (const [k, v] of byClass) console.log("  " + k + "：" + v.all + " / " + v.od);
console.log("药品合计：" + DRUGS.length + " 种，其中带 odRisk " + withOd + " 种（上轮新增 " + NEW_DRUGS.length + " 种，本轮补齐 " + OD_FILLED_DRUGS.length + " 种）");
console.log("本次新增药品按类：" + NEW_DRUGS.map((n) => byName.get(n).class).reduce((m, c) => m.set(c, (m.get(c) ?? 0) + 1), new Map()).size + " 个类别 -> " + [...NEW_DRUGS.map((n) => byName.get(n).class).reduce((m, c) => m.set(c, (m.get(c) ?? 0) + 1), new Map())].map(([c, n]) => c + " " + n).join("，"));
console.log("诊断分组（" + DIAGNOSES.length + " 组 / " + diagSet.size + " 条）：");
for (const g of DIAGNOSES) console.log("  " + g.group + "：" + g.items.length + " 条" + (NEW_DIAGNOSES.filter((d) => g.items.includes(d)).length ? "（本次新增：" + NEW_DIAGNOSES.filter((d) => g.items.includes(d)).join("、") + "）" : ""));
console.log("方案合计：" + REGIMENS.length + " 条，其中本次新增 " + NEW_REGIMENS.length + " 条");
console.log("odRisk 文案长度：最短 " + Math.min(...lens) + " 字 / 最长 " + maxLen + " 字 / 共 " + lens.length + " 条");
console.log("odRisk 覆盖率：" + coveredAll + "/" + DRUGS.length + "（" + Math.round((coveredAll / DRUGS.length) * 100) + "%），白名单例外 " + OD_WHITELIST.length + " 条");
console.log("仍无 odRisk 的药名清单：" + (stillMissing.length ? stillMissing.join("、") : "（空）"));
console.log("本轮补齐的 18 种：" + OD_FILLED_DRUGS.map((n) => n + "(" + [...byName.get(n).odRisk].length + "字)").join("、"));

console.log("");
console.log(fails.length === 0 ? "ALL OD-RISK CHECKS PASSED" : "FAILED: " + fails.length + " -> " + fails.join(" | "));
process.exit(fails.length === 0 ? 0 : 1);
