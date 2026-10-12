import { bj3 } from "@/templates/bj3";
import { TEMPLATES } from "@/templates";
console.log("--- direct import of bj3.ts ---");
try { const s = bj3.build({} as any); console.log("built length", s.length); } catch (e) { console.log("CRASH:", String(e).slice(0,300)); }
console.log("--- via TEMPLATES index ---");
try { const t = TEMPLATES.find(x=>x.id==="bj3")!; const s = t.build({} as any); console.log("built length", s.length); } catch (e) { console.log("CRASH:", String(e).slice(0,300)); }
