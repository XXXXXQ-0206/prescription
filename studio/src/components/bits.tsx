import { Check, ChevronDown, ChevronRight, Pencil, Plus } from "lucide-react";
import { useState, type ReactNode } from "react";

import { Button } from "@/ui/button";
import { Input } from "@/ui/input";
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from "@/ui/select";
import { Switch } from "@/ui/switch";

/** 分组卡片：标题 + 数量徽标 + 可选的右侧动作区 */
export function Card({
  title,
  icon,
  badge,
  actions,
  children,
  defaultOpen = true,
  editing,
  onEdit,
  onDone,
  onCancel,
}: {
  title: string;
  icon?: ReactNode;
  badge?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  defaultOpen?: boolean;
  /** 是否是"正在编辑"的卡片；不传表示这张卡片不需要只读/编辑两态 */
  editing?: boolean;
  onEdit?: () => void;
  onDone?: () => void;
  onCancel?: () => void;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const twoState = typeof editing === "boolean";
  return (
    <section className="card" data-editing={editing ? "1" : undefined}>
      <div className="card__head" onClick={() => setOpen((v) => !v)}>
        {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
        {icon}
        <span className="card__title">{title}</span>
        {twoState && editing ? <span className="card__editing">编辑中</span> : null}
        {badge ? <span className="card__badge">{badge}</span> : null}
        <span className="card__acts" onClick={(e) => e.stopPropagation()}>
          {actions}
          {twoState && !editing ? (
            <Button onClick={onEdit} size="2xs" variant="soft" title="进入编辑">
              <Pencil size={11} /> 修改
            </Button>
          ) : null}
          {twoState && editing ? (
            <>
              <Button onClick={onCancel} size="2xs" variant="ghost" title="放弃本卡改动（Esc）">
                取消
              </Button>
              <Button color="primary" onClick={onDone} size="2xs" variant="solid" title="保存本卡改动">
                <Check size={11} /> 完成
              </Button>
            </>
          ) : null}
        </span>
      </div>
      {open ? <div className="card__body">{children}</div> : null}
    </section>
  );
}

/**
 * 只读 / 编辑两态字段。
 * 只读：灰标签 + 值；空值显示可点的「—」（点一下请求进入该卡编辑态）。
 * 编辑：灰标签 + 输入框。
 */
export function Field({
  label,
  value,
  editing,
  onChange,
  placeholder,
  list,
  type = "text",
  onRequestEdit,
  width,
  hint,
}: {
  label?: string;
  value: string;
  editing: boolean;
  onChange?: (v: string) => void;
  placeholder?: string;
  list?: string;
  type?: string;
  onRequestEdit?: () => void;
  width?: string;
  hint?: string;
}) {
  const empty = !String(value ?? "").trim();
  if (editing) {
    return (
      <span className="field field--edit" style={width ? { flex: `0 0 ${width}` } : undefined}>
        {label ? <span className="field__label">{label}</span> : null}
        <Input
          list={list}
          onChange={(e) => onChange?.(e.target.value)}
          placeholder={placeholder ?? label}
          size="sm"
          type={type}
          value={value}
        />
      </span>
    );
  }
  return (
    <span
      className={`field field--ro${empty ? " field--empty" : ""}${empty && onRequestEdit ? " field--clickable" : ""}`}
      onClick={empty && onRequestEdit ? onRequestEdit : undefined}
      style={width ? { flex: `0 0 ${width}` } : undefined}
      title={empty ? "点击填写" : hint}
    >
      {label ? <span className="field__label">{label}</span> : null}
      <span className="field__value">{empty ? "—" : value}</span>
    </span>
  );
}

export function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="row">
      <span className="row__label">{label}</span>
      <span className="row__ctl">{children}</span>
    </div>
  );
}

export function TextInput({
  value,
  onChange,
  placeholder,
  list,
  type = "text",
  className,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  list?: string;
  type?: string;
  className?: string;
}) {
  return (
    <Input
      className={className}
      list={list}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      size="sm"
      type={type}
      value={value}
    />
  );
}

/** 分段选择：一组按钮里选一个（性别 / 费用类别 / 模板类别） */
export function Segmented<T extends string>({
  options,
  value,
  onChange,
}: {
  options: Array<{ value: T; label: string; title?: string }>;
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <span className="seg">
      {options.map((o) => (
        <Button
          key={o.value}
          onClick={() => onChange(o.value)}
          size="2xs"
          title={o.title}
          variant={o.value === value ? "soft" : "ghost"}
        >
          {o.label}
        </Button>
      ))}
    </span>
  );
}

/** 开关行：标签在左、Switch 在右（比一排 chip 更像设置面板） */
export function SwitchRow({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="switchrow">
      <Switch checked={checked} onCheckedChange={onChange} size="settings" />
      <span className="switchrow__label">{label}</span>
    </label>
  );
}

/** 分组下拉：从库里挑一条即"追加"到列表（选完自动复位） */
export function GroupPicker({
  groups,
  placeholder,
  onPick,
}: {
  groups: Array<{ label: string; items: string[] }>;
  placeholder: string;
  onPick: (v: string) => void;
}) {
  const [v, setV] = useState("");
  const [open, setOpen] = useState(false);
  return (
    <Select
      onOpenChange={setOpen}
      onValueChange={(next) => {
        if (next) onPick(next);
        setV("");
        setOpen(false);
      }}
      open={open}
      value={v}
    >
      <SelectTrigger className="w-full" style={{ height: 26, fontSize: 12 }}>
        <span style={{ display: "flex", alignItems: "center", gap: 4, color: "var(--color-text-tertiary)" }}>
          <Plus size={11} />
          <SelectValue placeholder={placeholder} />
        </span>
      </SelectTrigger>
      <SelectContent>
        {groups.map((g) => (
          <SelectGroup key={g.label}>
            <SelectLabel style={{ padding: "4px 10px", fontSize: 11, color: "var(--color-text-tertiary)" }}>{g.label}</SelectLabel>
            {g.items.map((it) => (
              <SelectItem key={it} value={it}>
                {it}
              </SelectItem>
            ))}
          </SelectGroup>
        ))}
      </SelectContent>
    </Select>
  );
}

/** 小图标按钮（删除、添加等） */
export function IconButton({
  icon,
  onClick,
  title,
  disabled,
}: {
  icon: ReactNode;
  onClick: () => void;
  title?: string;
  disabled?: boolean;
}) {
  return (
    <Button disabled={disabled} onClick={onClick} size="2xs" title={title} uniform variant="ghost">
      {icon}
    </Button>
  );
}
