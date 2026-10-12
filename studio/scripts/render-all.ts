/**
 * 把每个模板按其默认数据渲染成 out/tpl-<id>.{typ,png}（144dpi）。
 * 各模板开发时反复跑这个脚本即可看到自己的版面效果。
 *   cd studio && npx esbuild scripts/render-all.ts --bundle --format=esm --platform=node --outfile=scripts/render-all.mjs '--alias:@=./src' && node scripts/render-all.mjs [模板id]
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { defaultDoc, emptyExtra, type PrescriptionDoc } from "@/lib/doc";
import { TEMPLATES } from "@/templates";

const out = path.resolve("out");
fs.mkdirSync(out, { recursive: true });
const typst = path.resolve("resources", process.platform === "win32" ? "typst.exe" : "typst");
const only = process.argv[2];

export function docFor(templateId: string): PrescriptionDoc {
  const t = TEMPLATES.find((x) => x.id === templateId) ?? TEMPLATES[0];
  const d = (t.defaults ?? {}) as Partial<PrescriptionDoc> & { extra?: Partial<ReturnType<typeof emptyExtra>> };
  const base = defaultDoc();
  return {
    ...base,
    ...d,
    templateId: t.id,
    options: { ...base.options, ...(d.options ?? {}) },
    extra: { ...emptyExtra(), ...(d.extra ?? {}) },
  } as PrescriptionDoc;
}

let bad = 0;
for (const t of TEMPLATES) {
  if (only && t.id !== only) continue;
  const src = t.build(docFor(t.id));
  const typ = path.join(out, `tpl-${t.id}.typ`);
  const png = path.join(out, `tpl-${t.id}.png`);
  fs.writeFileSync(typ, src, "utf8");
  try {
    execFileSync(typst, ["compile", typ, png, "--ppi", "144"], { stdio: "pipe" });
    const kb = (fs.statSync(png).size / 1024).toFixed(0);
    console.log(`✓ ${t.id.padEnd(4)} ${t.name}  → out/tpl-${t.id}.png (${kb} KB)`);
  } catch (e) {
    bad++;
    console.log(`✗ ${t.id} ${t.name}`);
    console.log(String((e as { stderr?: Buffer }).stderr ?? e).slice(0, 900));
  }
}
process.exit(bad ? 1 : 0);
