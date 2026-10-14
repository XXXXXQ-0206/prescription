/**
 * 表单面板（左栏）：每张卡片默认只读，卡片头右侧「修改」只解锁这一张卡片。
 *
 * 只读态：Field 的只读分支（灰标签 + 值，空值显示可点的「—」）；
 * 编辑态：Field 渲染输入框；「取消 / Esc」回滚到进入编辑时的快照（由 App 负责），「完成」保留。
 * 只读态仍允许增删行（卡片头 ＋ 与行尾删除按钮在两态都可用）。
 * 药品的 名称/厂牌/规格 在编辑态也锁定，需点「改此项」单独解锁（解锁后高亮为已手改）。
 */
import {
  AlertTriangle,
  Building2,
  ClipboardList,
  FlaskConical,
  ListChecks,
  Pencil,
  Pill,
  Plus,
  SlidersHorizontal,
  Stethoscope,
  Trash2,
  User,
} from "lucide-react";
import { useEffect, useMemo, useState, type CSSProperties, type ReactNode } from "react";

import { Card, Field, IconButton, Row, Segmented } from "@/components/bits";
import { ConfirmDialog, Picker, type PickerItem } from "@/components/Picker";
import { DIAGNOSES, DOCTORS, DRUGS, FEE_TYPES, odRiskOf, REGIMENS } from "@/data/presets";
import { TCM_CLASSES, TCM_HERBS } from "@/data/tcm";
import { makeDrug, totalOf, type DrugItem, type PrescriptionDoc } from "@/lib/doc";
import { getTemplate } from "@/templates";
import type { TemplateSections } from "@/templates/types";
import { Button } from "@/ui/button";
import { Switch } from "@/ui/switch";

export interface FormPanelProps {
  doc: PrescriptionDoc;
  patch: (p: Partial<PrescriptionDoc>) => void;
  setDoc: (d: PrescriptionDoc) => void;
  /** 当前处于编辑态的卡片 id（null = 全部只读） */
  editingCard: string | null;
  onEditCard: (id: string) => void;
  onDoneCard: () => void;
  onCancelCard: () => void;
}

type Patch = (p: Partial<PrescriptionDoc>) => void;
type PickerKind = "diag" | "drug" | "tcm" | "doctor" | "regimen" | null;

const money = (v: number) => (Math.round(v * 100) / 100).toFixed(2);
const DIAG_TOTAL = DIAGNOSES.reduce((a, g) => a + g.items.length, 0);

/** 版式开关（短选择，留在行内；只读态禁用但仍显示勾选状态） */
type BoolOptKey =
  | "showBarcode"
  | "showCardNo"
  | "showSerial"
  | "showPrintDate"
  | "showFeeLine"
  | "showFeeMark"
  | "showTips"
  | "showSign"
  | "showMoney"
  | "showUsage";

const OPT_SWITCHES: Array<[BoolOptKey, string]> = [
  ["showBarcode", "条码"],
  ["showCardNo", "卡号数字"],
  ["showSerial", "序号"],
  ["showPrintDate", "印刷日期"],
  ["showFeeLine", "费用类别行"],
  ["showFeeMark", "加粗选中类别"],
  ["showTips", "提示语"],
  ["showSign", "（签章）"],
  ["showMoney", "数量金额"],
  ["showUsage", "用法用量"],
];

/** 「已手改」高亮：只用既有 token，不引入新颜色变量 */
const MARK: CSSProperties = {
  alignItems: "center",
  background: "var(--color-background-primary-soft-alpha, rgba(255, 255, 255, .035))",
  borderLeft: "2px solid var(--color-cx-accent, #4a9eff)",
  borderRadius: 3,
  display: "flex",
  flex: "1 1 auto",
  minWidth: 0,
  paddingLeft: 5,
};

/** 药品 / 药味行：名称、厂牌、规格锁定，其余可改 */
function DrugLine({
  d,
  i,
  isEdit,
  sections,
  unlocked,
  onUnlock,
  onPatch,
  onDelete,
  onRequestEdit,
}: {
  d: DrugItem;
  i: number;
  isEdit: boolean;
  sections: TemplateSections;
  unlocked: Set<string>;
  onUnlock: (key: string) => void;
  onPatch: (p: Partial<DrugItem>) => void;
  onDelete: () => void;
  onRequestEdit: () => void;
}) {
  const tcm = sections.tcm;
  /** 可改字段：编辑态给输入框，只读态给「灰标签 + 值」 */
  const field = (label: string, value: string, onChange: (v: string) => void, opts?: { type?: string; list?: string }) => (
    <Field
      editing={isEdit}
      label={label}
      list={opts?.list}
      onChange={onChange}
      onRequestEdit={onRequestEdit}
      type={opts?.type ?? "text"}
      value={value}
    />
  );
  /** 锁定字段：名称 / 厂牌 / 规格 —— 编辑态渲染静态文本 + 「改此项」 */
  const locked = (which: "name" | "brand" | "spec", label: string) => {
    const key = d.id + ":" + which;
    const raw = String(d[which] ?? "");
    // 只读：hint 让被省略号截断的长规格也能悬停看全
    if (!isEdit) return <Field editing={false} hint={raw} label={label} onRequestEdit={onRequestEdit} value={raw} />;
    if (!unlocked.has(key)) {
      return (
        <span className="field field--ro" style={{ alignItems: "center", gap: 6 }}>
          <span className="field__label">{label}</span>
          <span className="field__value" style={{ flex: "1 1 auto" }} title={raw}>
            {raw || "—"}
          </span>
          <Button onClick={() => onUnlock(key)} size="2xs" title={"解锁后可手改" + label} variant="soft">
            <Pencil size={10} /> 改此项
          </Button>
        </span>
      );
    }
    return (
      <span style={MARK}>
        <Field
          editing
          label={label}
          list={which === "name" && !tcm ? "dl-drug" : undefined}
          onChange={(v) => onPatch({ [which]: v } as Partial<DrugItem>)}
          value={raw}
        />
      </span>
    );
  };

  return (
    <div className="item">
      <div className="item__head">
        <span className="item__no">{i + 1}</span>
        <span className="row__ctl">{locked("name", tcm ? "药味" : "名称")}</span>
        <IconButton icon={<Trash2 size={12} />} onClick={onDelete} title={tcm ? "删除这一味" : "删除这一条"} />
      </div>

      {tcm ? (
        <div className="grid3">
          {field("剂量(g)", d.tcm === undefined || d.tcm === null ? "" : String(d.tcm), (v) => onPatch({ tcm: Number(v) || 0 }), {
            type: "number",
          })}
          {field("脚注", d.note ?? "", (v) => onPatch({ note: v }))}
          {field("剂数", String(d.qty), (v) => onPatch({ qty: Math.max(1, Number(v) || 1) }), { type: "number" })}
        </div>
      ) : (
        <>
          <div className="grid3">
            {locked("brand", "厂牌")}
            {locked("spec", "规格")}
            {field("单价", String(d.price), (v) => onPatch({ price: Number(v) || 0 }), { type: "number" })}
          </div>
          {sections.drugTable ? (
            <>
              <div className="grid3">
                {field("前缀", d.prefix ?? "", (v) => onPatch({ prefix: v }))}
                {field("单位", d.unit ?? "", (v) => onPatch({ unit: v }))}
                {field("数量", String(d.qty), (v) => onPatch({ qty: Math.max(1, Number(v) || 1) }), { type: "number" })}
              </div>
              <div className="grid3">
                {field("频率", d.freq ?? "", (v) => onPatch({ freq: v }))}
                {field("用量", d.dose ?? "", (v) => onPatch({ dose: v }))}
                {field("途径", d.route ?? "", (v) => onPatch({ route: v }))}
              </div>
              <div className="grid2">
                {field("天数", d.days ?? "", (v) => onPatch({ days: v }))}
                {field("备注", d.note ?? "", (v) => onPatch({ note: v }))}
              </div>
            </>
          ) : (
            <div className="grid2">
              {field("数量", String(d.qty), (v) => onPatch({ qty: Math.max(1, Number(v) || 1) }), { type: "number" })}
              {field("用法用量", d.usage, (v) => onPatch({ usage: v }), { list: "dl-usage" })}
            </div>
          )}
        </>
      )}

      {/* 过量风险提示：仅界面显示，绝不进入任何会被打印的字段（模板已冻结且实测零泄漏）。
          用 odRiskOf 实时查表，手改药名或读旧存档时也能拿到最新文案。 */}
      {(() => {
        const risk = odRiskOf(d.name);
        return risk ? (
          <div className="item__risk" title={risk}>
            <AlertTriangle size={11} />
            <span>过量风险：{risk}</span>
          </div>
        ) : null;
      })()}

      <div className="item__foot">
        {tcm
          ? (d.name || "药味") + (d.tcm ? " " + d.tcm + "g" : "")
          : "(" + (d.spec || "规格") + ") " + money(d.price) + "元" + (d.qty > 1 ? " ×" + d.qty + " = " + money(d.price * d.qty) + "元" : "")}
      </div>
    </div>
  );
}

export function FormPanel({ doc, patch, setDoc, editingCard, onEditCard, onDoneCard, onCancelCard }: FormPanelProps) {
  const o = doc.options;
  const tpl = getTemplate(doc.templateId);
  const S = tpl.sections;
  const LIM = tpl.limits;
  const total = totalOf(doc.drugs);

  const [picker, setPicker] = useState<PickerKind>(null);
  const [pendingRegimen, setPendingRegimen] = useState<(typeof REGIMENS)[number] | null>(null);
  const [unlocked, setUnlocked] = useState<Set<string>>(new Set());

  // 换一张卡片时清空「改此项」的解锁记录
  useEffect(() => {
    setUnlocked(new Set());
  }, [editingCard]);

  const isEdit = (id: string) => editingCard === id;
  const req = (id: string) => () => onEditCard(id);
  /** editing 变化时换 key → Card 重新挂载，折叠着的卡片点「修改」会自动展开 */
  const slot = (id: string) => id + "-" + (isEdit(id) ? "e" : "r");
  const editProps = (id: string) => ({
    editing: isEdit(id),
    onCancel: onCancelCard,
    onDone: onDoneCard,
    onEdit: () => onEditCard(id),
  });

  const setOpt = (p: Partial<PrescriptionDoc["options"]>) => patch({ options: { ...o, ...p } });
  const setExtra = (p: Partial<PrescriptionDoc["extra"]>) => patch({ extra: { ...doc.extra, ...p } });

  const genderText = doc.gender || "—";

  /** 单选短选择：编辑态行内分段，只读态只显示值 */
  const choice = <T extends string>(
    id: string,
    value: T,
    options: Array<{ value: T; label: string; title?: string }>,
    onChange: (v: T) => void,
  ) =>
    isEdit(id) ? (
      <Segmented onChange={onChange} options={options} value={value} />
    ) : (
      <Field editing={false} onRequestEdit={req(id)} value={options.find((x) => x.value === value)?.label ?? ""} />
    );

  // ── 选择器数据（全部带副标题，便于看清选项内容） ─────────────────
  const diagItems: PickerItem[] = useMemo(
    () =>
      DIAGNOSES.flatMap((g) =>
        g.items.map((d) => ({ group: g.group, id: d, subtitle: g.group, title: d })),
      ),
    [],
  );
  const drugItems: PickerItem[] = useMemo(
    () =>
      DRUGS.map((d) => ({
        group: d.class,
        id: d.name,
        // 过量风险文案进 keywords，用户可搜「过量」「呼吸抑制」等词命中；带风险的药在副标题尾部打 ⚠
        keywords: d.brand + " " + d.class + " 过量 风险 " + (d.odRisk ?? ""),
        subtitle:
          d.spec + " · " + d.price.toFixed(2) + " 元 · " + (d.brand || "无厂牌") + (d.odRisk ? " · ⚠" : ""),
        title: d.name,
      })),
    [],
  );
  const tcmItems: PickerItem[] = useMemo(() => {
    const order = new Map(TCM_CLASSES.map((c, i) => [c, i] as const));
    return TCM_HERBS.map((h) => ({
      group: h.class,
      id: h.name,
      keywords: [h.alias, h.class, h.note].filter(Boolean).join(" "),
      subtitle: "常用 " + h.dose + "g" + (h.note ? " · " + h.note : "") + (h.alias ? " · 别名 " + h.alias : ""),
      title: h.name,
    })).sort((a, b) => (order.get(a.group ?? "") ?? 99) - (order.get(b.group ?? "") ?? 99));
  }, []);
  const doctorItems: PickerItem[] = useMemo(
    () => DOCTORS.map((d) => ({ group: "医师库", id: d, subtitle: "签字栏：医师 " + d, title: d })),
    [],
  );
  const regimenItems: PickerItem[] = useMemo(
    () =>
      REGIMENS.map((r) => ({
        group: "常用方案",
        id: r.name,
        keywords: r.diagnosis.join(" ") + " " + r.drugs.join(" "),
        subtitle: "诊断：" + r.diagnosis.join(" / ") + " · 药品：" + r.drugs.join(" / "),
        title: r.name,
      })),
    [],
  );

  const addDiag = (name: string) =>
    patch({ diagnoses: [...doc.diagnoses.filter((x) => x.trim() !== ""), name].slice(0, LIM.maxDiag) });

  const addDrugs = (names: string[]) => {
    const rows: DrugItem[] = S.tcm
      ? names.map((nm) => {
          const herb = TCM_HERBS.find((h) => h.name === nm);
          return { ...makeDrug(), name: nm, note: herb?.note ?? "", tcm: herb?.dose ?? 0, unit: "g" };
        })
      : names.map((nm) => makeDrug(nm));
    patch({ drugs: [...doc.drugs, ...rows].slice(0, LIM.maxDrugs) });
  };

  const doApplyRegimen = (r: (typeof REGIMENS)[number]) =>
    setDoc({
      ...doc,
      diagnoses: r.diagnosis.slice(0, LIM.maxDiag),
      drugs: r.drugs.slice(0, LIM.maxDrugs).map((nm) => makeDrug(nm)),
    });

  const applyRegimen = (name: string) => {
    const r = REGIMENS.find((x) => x.name === name);
    if (!r) return;
    const dirty = doc.diagnoses.some((x) => x.trim() !== "") || doc.drugs.some((x) => x.name.trim() !== "");
    if (dirty) setPendingRegimen(r);
    else doApplyRegimen(r);
  };

  return (
    <>
      <Card
        {...editProps("hospital")}
        badge={doc.docType}
        icon={<Building2 size={13} />}
        key={slot("hospital")}
        title="医院与单据"
      >
        <div className="grid2">
          <Field
            editing={isEdit("hospital")}
            label="单据类型"
            list="dl-doctype"
            onChange={(v) => patch({ docType: v })}
            onRequestEdit={req("hospital")}
            placeholder="单据类型"
            value={doc.docType}
          />
          <Field
            editing={isEdit("hospital")}
            label="医院"
            list="dl-hospital"
            onChange={(v) => patch({ hospital: v })}
            onRequestEdit={req("hospital")}
            placeholder="医院名称"
            value={doc.hospital}
          />
        </div>
        <Row label="费用类别">
          {choice(
            "hospital",
            doc.feeKey,
            FEE_TYPES.map((f) => ({ label: f.label, title: f.desc, value: f.key as "甲" | "乙" | "丙" })),
            (v) => patch({ feeKey: v }),
          )}
        </Row>
        <div className="grid3">
          <Field
            editing={isEdit("hospital")}
            label="印刷日期"
            onChange={(v) => patch({ printDate: v })}
            onRequestEdit={req("hospital")}
            placeholder="印刷日期"
            value={doc.printDate}
          />
          <Field
            editing={isEdit("hospital")}
            label="有效天数"
            onChange={(v) => patch({ validDays: Math.max(1, Number(v) || 1) })}
            onRequestEdit={req("hospital")}
            placeholder="有效天数"
            type="number"
            value={String(doc.validDays)}
          />
          <Field
            editing={isEdit("hospital")}
            label="自付标注"
            onChange={(v) => setOpt({ selfPayLabel: v })}
            onRequestEdit={req("hospital")}
            placeholder="自付标注"
            value={o.selfPayLabel}
          />
        </div>
      </Card>

      {S.patient ? (
        <Card
          {...editProps("patient")}
          badge={(doc.patientName || "未填") + " · " + genderText + " · " + (doc.age || "-") + "岁"}
          icon={<User size={13} />}
          key={slot("patient")}
          title="患者"
        >
          <div className="grid3">
            <Field
              editing={isEdit("patient")}
              label="姓名"
              onChange={(v) => patch({ patientName: v })}
              onRequestEdit={req("patient")}
              placeholder="姓名"
              value={doc.patientName}
            />
            <Row label="性别">
              {choice(
                "patient",
                doc.gender as "男" | "女",
                [
                  { label: "男", value: "男" as const },
                  { label: "女", value: "女" as const },
                ],
                (v) => patch({ gender: v }),
              )}
            </Row>
            <Field
              editing={isEdit("patient")}
              label="年龄"
              onChange={(v) => patch({ age: v })}
              onRequestEdit={req("patient")}
              placeholder="年龄"
              value={doc.age}
            />
          </div>
          <Row label="科别">
            <Field
              editing={isEdit("patient")}
              list="dl-dept"
              onChange={(v) => patch({ dept: v })}
              onRequestEdit={req("patient")}
              placeholder="科室"
              value={doc.dept}
            />
          </Row>
          {S.identity ? (
            <Row label="病历号">
              <Field
                editing={isEdit("patient")}
                onChange={(v) => patch({ cardNo: v })}
                onRequestEdit={req("patient")}
                placeholder="卡号 / 条码号"
                value={doc.cardNo}
              />
              <Field
                editing={isEdit("patient")}
                label={isEdit("patient") ? undefined : "序号"}
                onChange={(v) => patch({ serial: v })}
                onRequestEdit={req("patient")}
                placeholder="序号"
                value={doc.serial}
                width="112px"
              />
            </Row>
          ) : null}
        </Card>
      ) : null}

      {S.visit ? (
        <Card {...editProps("visit")} icon={<ClipboardList size={13} />} key={slot("visit")} title="就诊信息">
          <div className="grid3">
            <Field
              editing={isEdit("visit")}
              label="就诊日期"
              onChange={(v) => setExtra({ visitDate: v })}
              onRequestEdit={req("visit")}
              value={doc.extra.visitDate}
            />
            <Field
              editing={isEdit("visit")}
              label="就诊次/住院号"
              onChange={(v) => setExtra({ visitNo: v })}
              onRequestEdit={req("visit")}
              value={doc.extra.visitNo}
            />
            <Field
              editing={isEdit("visit")}
              label="ID号/病历号"
              onChange={(v) => setExtra({ medicalId: v })}
              onRequestEdit={req("visit")}
              value={doc.extra.medicalId}
            />
          </div>
          <div className="grid3">
            <Field
              editing={isEdit("visit")}
              label="费别"
              onChange={(v) => setExtra({ feeCategory: v })}
              onRequestEdit={req("visit")}
              value={doc.extra.feeCategory}
            />
            <Field
              editing={isEdit("visit")}
              label="体重(kg)"
              onChange={(v) => setExtra({ weight: v })}
              onRequestEdit={req("visit")}
              value={doc.extra.weight}
            />
            <Field
              editing={isEdit("visit")}
              label="电话/地址"
              onChange={(v) => setExtra({ phone: v })}
              onRequestEdit={req("visit")}
              value={doc.extra.phone}
            />
          </div>
        </Card>
      ) : null}

      {S.diagnosis ? (
        <Card
          {...editProps("diagnosis")}
          actions={
            <IconButton
              icon={<Plus size={12} />}
              onClick={() => setPicker("diag")}
              title={"从诊断库添加（" + DIAG_TOTAL + " 条，按类别分组）"}
            />
          }
          badge={doc.diagnoses.filter((d) => d.trim()).length + "/" + LIM.maxDiag}
          icon={<Stethoscope size={13} />}
          key={slot("diagnosis")}
          title="诊断"
        >
          {doc.diagnoses.map((d, i) => (
            <div className="row" key={i}>
              <span className="item__no">{i + 1}</span>
              <span className="row__ctl">
                <Field
                  editing={isEdit("diagnosis")}
                  list="dl-diag"
                  onChange={(v) => {
                    const next = [...doc.diagnoses];
                    next[i] = v;
                    patch({ diagnoses: next });
                  }}
                  onRequestEdit={req("diagnosis")}
                  placeholder="输入或从诊断库选择"
                  value={d}
                />
              </span>
              <IconButton
                icon={<Trash2 size={12} />}
                onClick={() => patch({ diagnoses: doc.diagnoses.filter((_, k) => k !== i) })}
                title="删除这一行"
              />
            </div>
          ))}
          <div className="hint">
            共 {doc.diagnoses.filter((d) => d.trim()).length} 条有效诊断，该模板最多 {LIM.maxDiag} 行；点右上角 ＋ 从诊断库选择
          </div>
        </Card>
      ) : null}

      {S.drugs ? (
        <Card
          {...editProps("drugs")}
          actions={
            <IconButton
              disabled={doc.drugs.length >= LIM.maxDrugs}
              icon={<Plus size={12} />}
              onClick={() => setPicker(S.tcm ? "tcm" : "drug")}
              title={S.tcm ? "从常用中药添加（" + TCM_HERBS.length + " 味）" : "从药品库添加（" + DRUGS.length + " 种）"}
            />
          }
          badge={
            S.tcm
              ? doc.drugs.length + "/" + LIM.maxDrugs + " 味"
              : doc.drugs.length + "/" + LIM.maxDrugs + " 条 · " + money(total) + " 元"
          }
          icon={S.tcm ? <FlaskConical size={13} /> : <Pill size={13} />}
          key={slot("drugs")}
          title={S.tcm ? "药味（中药）" : "药品"}
        >
          {doc.drugs.map((d, i) => (
            <DrugLine
              d={d}
              i={i}
              isEdit={isEdit("drugs")}
              key={d.id}
              onDelete={() => patch({ drugs: doc.drugs.filter((x) => x.id !== d.id) })}
              onPatch={(p) => patch({ drugs: doc.drugs.map((x) => (x.id === d.id ? { ...x, ...p } : x)) })}
              onRequestEdit={req("drugs")}
              onUnlock={(key) =>
                setUnlocked((prev) => {
                  const next = new Set(prev);
                  next.add(key);
                  return next;
                })
              }
              sections={S}
              unlocked={unlocked}
            />
          ))}
          {doc.drugs.length ? null : (
            <div className="hint">
              还没有内容，点右上角 ＋ 从{S.tcm ? "常用中药库" : "药品库"}添加（只读态也可以增删）
            </div>
          )}
          {S.tcm ? null : (
            <Row label="常用方案">
              <Button
                onClick={() => setPicker("regimen")}
                size="2xs"
                title={"从方案库套用（" + REGIMENS.length + " 条，会替换现有诊断与药品）"}
                variant="soft"
              >
                <ListChecks size={11} /> 套用方案
              </Button>
              <span className="hint">一次带入诊断 + 用药</span>
            </Row>
          )}
        </Card>
      ) : null}

      {tpl.extraKeys.length ? (
        <Card
          {...editProps("extra")}
          badge={tpl.extraKeys.length + " 项"}
          icon={<SlidersHorizontal size={13} />}
          key={slot("extra")}
          title="单据扩展字段"
        >
          <div className="grid2">
            {tpl.extraKeys.map((f) => (
              <Field
                editing={isEdit("extra")}
                key={String(f.key)}
                label={f.label}
                onChange={(v) => setExtra({ [f.key]: v } as Partial<PrescriptionDoc["extra"]>)}
                onRequestEdit={req("extra")}
                placeholder={f.placeholder ?? f.label}
                value={String(doc.extra[f.key] ?? "")}
              />
            ))}
          </div>
        </Card>
      ) : null}

      <Card {...editProps("doctor")} icon={<SlidersHorizontal size={13} />} key={slot("doctor")} title="医师与版式">
        <Row label="医师">
          <span
            onClick={() => setPicker("doctor")}
            style={{ cursor: "pointer", display: "flex", flex: "1 1 auto", minWidth: 0 }}
            title={"从医师库选择（" + DOCTORS.length + " 位）"}
          >
            <Field editing={false} onRequestEdit={() => setPicker("doctor")} value={doc.doctor} />
          </span>
          <IconButton icon={<Pencil size={11} />} onClick={() => setPicker("doctor")} title="从医师库选择" />
        </Row>
        <div className="grid2">
          {OPT_SWITCHES.map(([key, label]) => (
            <label className="switchrow" key={key}>
              <Switch
                checked={Boolean(o[key])}
                onCheckedChange={(v) => setOpt({ [key]: v } as Partial<PrescriptionDoc["options"]>)}
                size="settings"
              />
              <span className="switchrow__label">{label}</span>
            </label>
          ))}
        </div>
        {o.showTips ? (
          <div className="grid3">
            {[0, 1, 2].map((i) => (
              <Field
                editing={isEdit("doctor")}
                key={i}
                label={"提示语 " + (i + 1)}
                onChange={(v) => {
                  const tips = [...o.tips];
                  tips[i] = v;
                  setOpt({ tips });
                }}
                onRequestEdit={req("doctor")}
                placeholder={"提示语 " + (i + 1)}
                value={o.tips[i] ?? ""}
              />
            ))}
          </div>
        ) : null}
      </Card>

      {/* 弹层：长列表全部走选择器（带搜索、分组与副标题） */}
      <Picker
        confirmText="加入"
        emptyText="没有匹配的药品"
        items={drugItems}
        multiple
        onConfirm={addDrugs}
        onOpenChange={(v) => (v ? setPicker("drug") : setPicker(null))}
        open={picker === "drug"}
        searchPlaceholder="搜索药名 / 厂牌 / 规格"
        title={"药品库（" + DRUGS.length + " 种）"}
      />
      <Picker
        confirmText="加入"
        emptyText="没有匹配的药味"
        items={tcmItems}
        multiple
        onConfirm={addDrugs}
        onOpenChange={(v) => (v ? setPicker("tcm") : setPicker(null))}
        open={picker === "tcm"}
        searchPlaceholder="搜索药名 / 别名 / 类别"
        title={"常用中药（" + TCM_HERBS.length + " 味 / " + TCM_CLASSES.length + " 类）"}
      />
      <Picker
        emptyText="没有匹配的诊断"
        items={diagItems}
        onConfirm={(ids) => {
          if (ids[0]) addDiag(ids[0]);
        }}
        onOpenChange={(v) => (v ? setPicker("diag") : setPicker(null))}
        open={picker === "diag"}
        searchPlaceholder="搜索诊断名称 / 类别"
        title={"诊断库（" + DIAG_TOTAL + " 条）"}
      />
      <Picker
        emptyText="没有匹配的医师"
        items={doctorItems}
        onConfirm={(ids) => {
          if (ids[0]) patch({ doctor: ids[0] });
        }}
        onOpenChange={(v) => (v ? setPicker("doctor") : setPicker(null))}
        open={picker === "doctor"}
        searchPlaceholder="搜索医师姓名"
        title={"医师库（" + DOCTORS.length + " 位）"}
      />
      <Picker
        emptyText="没有匹配的方案"
        items={regimenItems}
        onConfirm={(ids) => {
          if (ids[0]) applyRegimen(ids[0]);
        }}
        onOpenChange={(v) => (v ? setPicker("regimen") : setPicker(null))}
        open={picker === "regimen"}
        searchPlaceholder="搜索方案名 / 诊断 / 药品"
        title={"常用方案（" + REGIMENS.length + " 条）"}
      />
      <ConfirmDialog
        confirmText="替换并套用"
        description={
          pendingRegimen
            ? "「" +
              pendingRegimen.name +
              "」将带入 " +
              pendingRegimen.diagnosis.length +
              " 条诊断、" +
              pendingRegimen.drugs.length +
              " 条药品，并替换现有的诊断与药品。是否继续？"
            : ""
        }
        onConfirm={() => {
          if (pendingRegimen) doApplyRegimen(pendingRegimen);
          setPendingRegimen(null);
        }}
        onOpenChange={(v) => (v ? undefined : setPendingRegimen(null))}
        open={Boolean(pendingRegimen)}
        title="套用常用方案"
      />
    </>
  );
}
