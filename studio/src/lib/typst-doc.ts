/**
 * 兼容层：旧代码 import { buildTypst } from "@/lib/typst-doc" 仍然可用。
 * 真正的多模板分发在 src/templates/index.ts。
 */
export { buildTypst, getTemplate, TEMPLATES } from "@/templates";
