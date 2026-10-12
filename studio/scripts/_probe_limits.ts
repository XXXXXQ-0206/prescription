import { TEMPLATES } from "@/templates";
console.log(JSON.stringify(TEMPLATES.map(t => ({id:t.id, page:t.page, limits:t.limits, hospital:t.hospital})), null, 1));
