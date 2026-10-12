// scripts/check-tcm.mjs —— 中药库一致性断言（先把 tcm.ts 打包成 ESM，再逐条校验）
import { rolldown } from "rolldown";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const root = path.resolve(import.meta.dirname, "..");
const outdir = mkdtempSync(path.join(tmpdir(), "tcm-check-"));
const outfile = path.join(outdir, "tcm.mjs");
const bundle = await rolldown({ input: path.join(root, "src/data/tcm.ts"), logLevel: "silent" });
await bundle.write({ file: outfile, format: "esm" });
await bundle.close();
const mod = await import(pathToFileURL(outfile).href);
rmSync(outdir, { recursive: true, force: true });

const { TCM_HERBS, TCM_CLASSES, tcmByName } = mod;

const fails = [];
const check = (cond, label, extra = "") => {
  console.log(`${cond ? "PASS" : "FAIL"}  ${label}${extra ? "  " + extra : ""}`);
  if (!cond) fails.push(label);
};

// 独立白名单：只有这些药味允许带 note，且 note 取值必须与下表一致
// （药典 / 中药学 规定的特殊煎法：先煎、后下、包煎、另煎、烊化、冲服）
const NOTE_WHITELIST = new Map([
  ["石膏", "先煎"], ["川乌", "先煎"], ["附子", "先煎"], ["龙骨", "先煎"], ["磁石", "先煎"],
  ["石决明", "先煎"], ["牡蛎", "先煎"], ["龟甲", "先煎"], ["鳖甲", "先煎"],
  ["薄荷", "后下"], ["鱼腥草", "后下"], ["大黄", "后下"], ["砂仁", "后下"], ["白豆蔻", "后下"],
  ["肉桂", "后下"], ["钩藤", "后下"],
  ["辛夷", "包煎"], ["车前子", "包煎"], ["滑石", "包煎"], ["海金沙", "包煎"], ["蒲黄", "包煎"],
  ["五灵脂", "包煎"], ["枇杷叶", "包煎"], ["葶苈子", "包煎"],
  ["人参", "另煎"], ["西洋参", "另煎"],
  ["阿胶", "烊化"],
  ["三七", "冲服"], ["芒硝", "冲服"],
]);
const NOTE_KINDS = new Set(["先煎", "后下", "包煎", "另煎", "烊化", "冲服"]);

// 1) 条数
check(TCM_HERBS.length >= 100 && TCM_HERBS.length <= 150, `TCM_HERBS 条数在 100~150（实际 ${TCM_HERBS.length}）`);

// 2) 无重名（正名唯一；别名不得与任何药名/别名撞车）
const nameSeen = new Map();
const dupNames = [];
TCM_HERBS.forEach((h) => (nameSeen.has(h.name) ? dupNames.push(h.name) : nameSeen.set(h.name, h)));
check(dupNames.length === 0, "TCM_HERBS 无重名（正名唯一）", dupNames.join("; "));

const keySeen = new Map();
const dupKeys = [];
for (const h of TCM_HERBS) {
  for (const k of [h.name, ...(h.alias ? [h.alias] : [])]) {
    if (keySeen.has(k) && keySeen.get(k) !== h.name) dupKeys.push(`${k}（${keySeen.get(k)} / ${h.name}）`);
    else keySeen.set(k, h.name);
  }
}
check(dupKeys.length === 0, "正名与别名构成的检索键全局唯一", dupKeys.join("; "));

// 3) TCM_CLASSES 与数据里的 class 完全一致（双向覆盖）
const usedClasses = [...new Set(TCM_HERBS.map((h) => h.class))];
const missing = usedClasses.filter((c) => !TCM_CLASSES.includes(c));
const unused = TCM_CLASSES.filter((c) => !usedClasses.includes(c));
check(missing.length === 0, "数据中的 class 都在 TCM_CLASSES 中", missing.join("; "));
check(unused.length === 0, "TCM_CLASSES 中的分类都有药味", unused.join("; "));
check(new Set(TCM_CLASSES).size === TCM_CLASSES.length, "TCM_CLASSES 无重复");

// 4) 剂量区间与精度（1~60g，整数或一位小数）
const badDose = TCM_HERBS.filter((h) => !(Number.isFinite(h.dose) && h.dose >= 1 && h.dose <= 60)).map((h) => `${h.name}=${h.dose}`);
check(badDose.length === 0, "所有 dose 在 1~60 之间", badDose.join("; "));
const badPrec = TCM_HERBS.filter((h) => Math.round(h.dose * 10) !== h.dose * 10).map((h) => `${h.name}=${h.dose}`);
check(badPrec.length === 0, "所有 dose 为整数或一位小数", badPrec.join("; "));

// 5) note 白名单：有 note 的必须在白名单且取值一致；白名单里的必须真的带 note
const noted = TCM_HERBS.filter((h) => h.note !== undefined);
const badNote = noted.filter((h) => NOTE_WHITELIST.get(h.name) !== h.note).map((h) => `${h.name}=${h.note}`);
check(badNote.length === 0, `有 note 的药味均属于特殊煎法白名单且取值一致（${noted.length} 味）`, badNote.join("; "));
const badKind = noted.filter((h) => !NOTE_KINDS.has(h.note)).map((h) => `${h.name}=${h.note}`);
check(badKind.length === 0, "note 取值仅限 先煎/后下/包煎/另煎/烊化/冲服", badKind.join("; "));
const unapplied = [...NOTE_WHITELIST.keys()].filter((n) => {
  const h = nameSeen.get(n);
  return !h || h.note !== NOTE_WHITELIST.get(n);
});
check(unapplied.length === 0, "白名单中的药味都已带对应 note", unapplied.join("; "));

// 6) 字段完整性 + tcmByName 检索
const badField = TCM_HERBS.filter((h) => !h.name?.trim() || !h.class?.trim()).map((h) => String(h.name));
check(badField.length === 0, "每味药的 name / class 非空", badField.join("; "));

const badLookup = [];
for (const h of TCM_HERBS) {
  if (tcmByName(h.name)?.name !== h.name) badLookup.push(`正名:${h.name}`);
  if (h.alias && tcmByName(h.alias)?.name !== h.name) badLookup.push(`别名:${h.alias}`);
}
check(badLookup.length === 0, "tcmByName 命中所有正名与别名", badLookup.join("; "));
check(tcmByName("不存在的药") === undefined && tcmByName("") === undefined && tcmByName("  ") === undefined, "tcmByName 未命中/空串返回 undefined");
check(tcmByName(" 熟地 ")?.name === "熟地黄", "tcmByName 别名检索（熟地 → 熟地黄）", `实际 ${tcmByName(" 熟地 ")?.name}`);

// 统计输出
console.log("");
console.log(`分类分布（共 ${TCM_CLASSES.length} 类 / ${TCM_HERBS.length} 味）：`);
for (const c of TCM_CLASSES) {
  const list = TCM_HERBS.filter((h) => h.class === c).map((h) => h.name).join("、");
  console.log(`  ${c}（${TCM_HERBS.filter((h) => h.class === c).length}）：${list}`);
}
const byKind = {};
for (const h of noted) (byKind[h.note] ||= []).push(h.name);
console.log("");
console.log("特殊煎法：" + Object.entries(byKind).map(([k, v]) => `${k} ${v.length} 味（${v.join("、")}）`).join("；"));
console.log(`别名覆盖：${TCM_HERBS.filter((h) => h.alias).length} / ${TCM_HERBS.length}`);
console.log("");
console.log(fails.length === 0 ? "ALL CHECKS PASSED" : `FAILED: ${fails.length} -> ${fails.join(" | ")}`);
process.exit(fails.length === 0 ? 0 : 1);
