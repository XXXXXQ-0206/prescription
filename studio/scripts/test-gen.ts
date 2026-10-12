import fs from "node:fs";
import path from "node:path";
import { buildTypst } from "@/lib/typst-doc";
import { defaultDoc } from "@/lib/doc";

const out = path.resolve("out");
fs.mkdirSync(out, { recursive: true });
const doc = defaultDoc();
const src = buildTypst(doc);
fs.writeFileSync(path.join(out, "generated.typ"), src, "utf8");
console.log("typst source bytes:", src.length);
console.log(src.split("\n").slice(0, 12).join("\n"));
console.log("...");
console.log(src.split("\n").filter((l) => l.startsWith("#T(")).slice(0, 8).join("\n"));
