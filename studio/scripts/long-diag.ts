
import fs from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { TEMPLATES } from "@/templates";
import { defaultDoc, emptyExtra } from "@/lib/doc";
const OUT = path.resolve("out");
const typst = path.resolve("resources", process.platform === "win32" ? "typst.exe" : "typst");
for (const id of ["bj3", "zy"]) {
  const t = TEMPLATES.find((x) => x.id === id);
  const d = t.defaults ?? {};
  const doc = { ...defaultDoc(), ...d, templateId: id, extra: { ...emptyExtra(), ...(d.extra ?? {}) } };
  doc.diagnoses = ["双相情感障碍，目前为轻度抑郁发作", "广泛性焦虑障碍", "强迫性障碍", "躯体形式障碍", "非器质性失眠症", "创伤后应激障碍"];
  const typ = path.join(OUT, "long-" + id + ".typ");
  fs.writeFileSync(typ, t.build(doc), "utf8");
  execFileSync(typst, ["compile", typ, path.join(OUT, "long-" + id + ".png"), "--ppi", "144"], { stdio: "pipe" });
  console.log("rendered", id);
}
