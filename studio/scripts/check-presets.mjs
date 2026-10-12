// scripts/check-presets.mjs —— 预设库一致性断言（先把 presets.ts 打包成 ESM，再逐条校验）
import { rolldown } from "rolldown";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const root = path.resolve(import.meta.dirname, "..");
const outdir = mkdtempSync(path.join(tmpdir(), "presets-check-"));
const outfile = path.join(outdir, "presets.mjs");
const bundle = await rolldown({ input: path.join(root, "src/data/presets.ts"), logLevel: "silent" });
await bundle.write({ file: outfile, format: "esm" });
await bundle.close();
const p = await import(pathToFileURL(outfile).href);
rmSync(outdir, { recursive: true, force: true });

const fails = [];
const check = (cond, label, extra = "") => {
  console.log(`${cond ? "PASS" : "FAIL"}  ${label}${extra ? "  " + extra : ""}`);
  if (!cond) fails.push(label);
};

const { HOSPITALS, DEPARTMENTS, DIAGNOSES, DRUGS, REGIMENS, USAGE_PRESETS, TIP_PRESETS } = p;

// 1) REGIMENS.drugs 必须命中 DRUGS[].name
const drugNames = new Set(DRUGS.map((d) => d.name));
const badDrugs = [];
for (const r of REGIMENS) for (const nm of r.drugs) if (!drugNames.has(nm)) badDrugs.push(`${r.name} -> ${nm}`);
check(badDrugs.length === 0, "REGIMENS 中每个 drug 名都存在于 DRUGS", badDrugs.join("; "));

// 2) REGIMENS.diagnosis 必须命中 DIAGNOSES
const diagItems = new Set(DIAGNOSES.flatMap((g) => g.items));
const badDiag = [];
for (const r of REGIMENS) for (const d of r.diagnosis) if (!diagItems.has(d)) badDiag.push(`${r.name} -> ${d}`);
check(badDiag.length === 0, "REGIMENS 中每个 diagnosis 都存在于 DIAGNOSES", badDiag.join("; "));

// 3) DRUGS 无重名
const seen = new Map();
const dupDrugs = [];
DRUGS.forEach((d, i) => (seen.has(d.name) ? dupDrugs.push(d.name) : seen.set(d.name, i)));
check(dupDrugs.length === 0, "DRUGS 无重名", dupDrugs.join("; "));

// 4) HOSPITALS / DEPARTMENTS / REGIMENS / 诊断条目 无重复
const dup = (arr) => [...new Set(arr.filter((x, i) => arr.indexOf(x) !== i))];
check(dup(HOSPITALS).length === 0, "HOSPITALS 无重复", dup(HOSPITALS).join("; "));
check(dup(DEPARTMENTS).length === 0, "DEPARTMENTS 无重复", dup(DEPARTMENTS).join("; "));
check(dup(REGIMENS.map((r) => r.name)).length === 0, "REGIMENS 名称无重复", dup(REGIMENS.map((r) => r.name)).join("; "));
check(dup(DIAGNOSES.flatMap((g) => g.items)).length === 0, "DIAGNOSES 条目无重复", dup(DIAGNOSES.flatMap((g) => g.items)).join("; "));

// 5) 每条药品的 spec / price / usage / brand / class 非空
const badFields = DRUGS.filter(
  (d) =>
    !d.spec?.trim() ||
    !d.usage?.trim() ||
    !d.brand?.trim() ||
    !d.class?.trim() ||
    typeof d.price !== "number" ||
    !Number.isFinite(d.price) ||
    d.price <= 0,
).map((d) => d.name);
check(badFields.length === 0, "每个 drug 的 spec/price/usage/brand/class 非空且价格有效", badFields.join("; "));

// 6) REGIMENS 非空字段
const badReg = REGIMENS.filter((r) => !r.name?.trim() || !r.diagnosis.length || !r.drugs.length).map((r) => r.name);
check(badReg.length === 0, "每个 REGIMEN 的 name/diagnosis/drugs 均非空", badReg.join("; "));

// 7) 规模下限
const diagCount = DIAGNOSES.flatMap((g) => g.items).length;
check(HOSPITALS.length >= 30, `HOSPITALS >= 30（实际 ${HOSPITALS.length}）`);
check(DEPARTMENTS.length >= 20, `DEPARTMENTS >= 20（实际 ${DEPARTMENTS.length}）`);
check(DIAGNOSES.length >= 8 && diagCount >= 60, `DIAGNOSES >= 8 组且合计 >= 60 条（实际 ${DIAGNOSES.length} 组 / ${diagCount} 条）`);
check(DRUGS.length >= 45, `DRUGS >= 45（实际 ${DRUGS.length}）`);
check(REGIMENS.length >= 15, `REGIMENS >= 15（实际 ${REGIMENS.length}）`);
check(USAGE_PRESETS.length >= 20, `USAGE_PRESETS >= 20（实际 ${USAGE_PRESETS.length}）`);
check(TIP_PRESETS.length >= 6 && TIP_PRESETS.every((t) => t.length > 0), `TIP_PRESETS >= 6 组且非空（实际 ${TIP_PRESETS.length}）`);

console.log("");
console.log(`统计：医院 ${HOSPITALS.length} / 科室 ${DEPARTMENTS.length} / 诊断 ${DIAGNOSES.length} 组 ${diagCount} 条 / 药品 ${DRUGS.length} / 方案 ${REGIMENS.length} / 用法 ${USAGE_PRESETS.length} / 提示语 ${TIP_PRESETS.length} 组`);
console.log(fails.length === 0 ? "\nALL CHECKS PASSED" : `\nFAILED: ${fails.length} -> ${fails.join(" | ")}`);
process.exit(fails.length === 0 ? 0 : 1);
