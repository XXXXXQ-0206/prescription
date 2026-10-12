import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { defaultDoc, emptyExtra, type PrescriptionDoc } from "@/lib/doc";
import { zz } from "@/templates/zz";

const base = (() => {
  const d = (zz.defaults ?? {}) as Partial<PrescriptionDoc> & { extra?: Partial<ReturnType<typeof emptyExtra>> };
  const b = defaultDoc();
  return { ...b, ...d, templateId: zz.id, options: { ...b.options, ...(d.options ?? {}) }, extra: { ...emptyExtra(), ...(d.extra ?? {}) } } as PrescriptionDoc;
})();
const mk = (over: Partial<PrescriptionDoc>): PrescriptionDoc => ({ ...base, ...over } as PrescriptionDoc);
const drug = (i: number, note?: string) => ({ id: "d" + i, name: "复方多粘菌素B软膏" + i, spec: "10g/支", price: 26.4, qty: 1, usage: "外用 每天二次", prefix: "(基)", unit: "支", note });
const variants: Array<[string, PrescriptionDoc]> = [
  ["v1-single", mk({ diagnoses: ["湿疹"], patientName: "王小明", drugs: [{ id: "a", name: "氯雷他定片", spec: "10mg*6片/盒", price: 12, qty: 1, usage: "10mg口服 每天一次", unit: "盒" }] })],
  ["v2-max", mk({
    diagnoses: ["酒渣鼻(玫瑰痤疮 疗程用药)", "高血压病2级(中危)", "2型糖尿病伴血糖控制不佳", "慢性胃炎", "高脂血症", "焦虑状态"],
    patientName: "欧阳娜娜娜娜娜", dept: "皮肤科门诊(专家门诊)",
    drugs: [1,2,3,4,5,6].map((i) => drug(i, "备注文字" + i)),
  })],
  ["v3-five", mk({ diagnoses: ["痤疮", "脂溢性皮炎", "毛囊炎"], drugs: [1,2,3,4,5].map((i) => drug(i, i % 2 ? undefined : "点涂")) })],
];
const out = path.resolve("out");
const typst = path.resolve("resources", process.platform === "win32" ? "typst.exe" : "typst");
for (const [name, doc] of variants) {
  const typ = path.join(out, `__zz_${name}.typ`), png = path.join(out, `__zz_${name}.png`);
  fs.writeFileSync(typ, zz.build(doc), "utf8");
  try { execFileSync(typst, ["compile", typ, png, "--ppi", "144"], { stdio: "pipe" }); console.log("ok", name); }
  catch (e) { console.log("FAIL", name, String((e as { stderr?: Buffer }).stderr ?? e).slice(0, 400)); }
}
