import { bj3 } from "@/templates/bj3";
import { bj6 } from "@/templates/bj6";
import { cq } from "@/templates/cq";
import { zy } from "@/templates/zy";
import { zz } from "@/templates/zz";
import type { Template } from "@/templates/types";
import type { PrescriptionDoc } from "@/lib/doc";

/** 模板注册表：新增模板只需写一个文件并在这里登记一行 */
export const TEMPLATES: Template[] = [bj6, zz, bj3, zy, cq];

export const getTemplate = (id: string): Template => TEMPLATES.find((t) => t.id === id) ?? bj6;

/** 按文档选中的模板生成 Typst 源码 */
export function buildTypst(doc: PrescriptionDoc): string {
  return getTemplate(doc.templateId).build(doc);
}
