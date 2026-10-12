import { Check, Search, SearchX, X } from "lucide-react";
import {
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactElement,
} from "react";

import { Button } from "@/ui/button";
import { Checkbox } from "@/ui/checkbox";
import { Dialog, DialogClose, DialogContent } from "@/ui/dialog";
import { Input } from "@/ui/input";
import { ScrollArea } from "@/ui/scroll-area";

export interface PickerItem {
  /** 唯一键：onConfirm 回传的就是它 */
  id: string;
  /** 主标题：药名 / 诊断名 / 医师名 / 方案名 */
  title: string;
  /** 副标题：如 "0.5g*48粒/盒 · 5.20元 · 石药" */
  subtitle?: string;
  /** 分组名（组内保持 items 原顺序；缺省归到最后一组"其他"） */
  group?: string;
  /** 额外搜索词（拼音首字母、别名…） */
  keywords?: string;
  /** 置灰不可选 */
  disabled?: boolean;
}

export interface PickerProps {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  /** 弹层标题，如 "添加药品" */
  title: string;
  items: PickerItem[];
  /** true=多选（带复选框、可批量加入）；false=单选（点一行即选中） */
  multiple?: boolean;
  /** 搜索框占位符，默认 "搜索…" */
  searchPlaceholder?: string;
  /** 无结果时的提示，默认 "没有匹配的选项" */
  emptyText?: string;
  /** 确认按钮文案，默认 multiple ? "添加所选" : "确定" */
  confirmText?: string;
  onConfirm: (ids: string[]) => void;
}

/** 没有 group 的条目归到这一组，且永远排在最后一组。 */
const OTHER_GROUP = "其他";
/** 列表可视高度上限（需求：约 46vh，超出后列表内部滚动）。 */
const LIST_MAX_HEIGHT = "46vh";

const META_ROW: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  minHeight: 18,
  fontSize: 11,
  lineHeight: "16px",
  color: "var(--color-text-tertiary)",
};

/** 分组标题：sticky 吸顶。底色必须不透明（取对话框表面色），否则滚动内容会透出来。 */
const GROUP_HEAD: CSSProperties = {
  position: "sticky",
  top: 0,
  zIndex: 1,
  display: "flex",
  alignItems: "center",
  gap: 6,
  padding: "5px 12px",
  borderBottom: "1px solid var(--color-border-subtle)",
  background: "var(--color-surface-elevated)",
  color: "var(--color-text-secondary)",
  fontSize: 11,
  lineHeight: "16px",
  fontWeight: 600,
  letterSpacing: "0.02em",
  userSelect: "none",
};

const GROUP_HEAD_COUNT: CSSProperties = {
  color: "var(--color-text-tertiary)",
  fontWeight: 400,
  fontVariantNumeric: "tabular-nums",
};

const ROW: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  padding: "7px 12px",
  cursor: "pointer",
  userSelect: "none",
  transition: "background-color 0.12s ease, color 0.12s ease",
};

const ROW_TITLE: CSSProperties = {
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
  fontSize: 13,
  lineHeight: "18px",
  color: "var(--color-text)",
};

const ROW_SUBTITLE: CSSProperties = {
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
  fontSize: 11,
  lineHeight: "15px",
  color: "var(--color-text-secondary)",
};

const EMPTY: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  gap: 6,
  padding: "30px 16px",
  color: "var(--color-text-tertiary)",
  fontSize: 12,
  lineHeight: "18px",
  textAlign: "center",
};

interface PickerGroup {
  name: string;
  items: PickerItem[];
}

/** 按 group 分组：组的先后 = 首次出现顺序，组内保持 items 原顺序；"其他"永远最后。 */
function groupBy(items: PickerItem[]): PickerGroup[] {
  const groups: PickerGroup[] = [];
  const index = new Map<string, PickerGroup>();
  for (const item of items) {
    const name = item.group?.trim() || OTHER_GROUP;
    let group = index.get(name);
    if (!group) {
      group = { name, items: [] };
      index.set(name, group);
      groups.push(group);
    }
    group.items.push(item);
  }
  const other = groups.findIndex((g) => g.name === OTHER_GROUP);
  if (other >= 0 && other !== groups.length - 1) {
    const [tail] = groups.splice(other, 1);
    groups.push(tail);
  }
  return groups;
}

/** 搜索匹配：title + subtitle + keywords，大小写不敏感（空查询 = 全部）。 */
function matches(item: PickerItem, query: string): boolean {
  if (!query) return true;
  const haystack = `${item.title}\n${item.subtitle ?? ""}\n${item.keywords ?? ""}`;
  return haystack.toLowerCase().includes(query);
}

/** 从 dir 方向找到第一个可选项的下标（找不到返回 -1）。 */
function firstEnabled(list: PickerItem[], dir: 1 | -1): number {
  if (dir === 1) {
    for (let i = 0; i < list.length; i++) if (!list[i].disabled) return i;
  } else {
    for (let i = list.length - 1; i >= 0; i--) if (!list[i].disabled) return i;
  }
  return -1;
}

/**
 * 通用弹层选择器：顶部搜索 + 分组列表（组标题吸顶）+ 固定底部按钮区。
 *
 * 交互：
 *   · 打开即聚焦搜索框；输入即时过滤；Esc / 点遮罩关闭（radix Dialog 自带），关闭后搜索词与选择清空
 *   · 列表按 group 分组，组内保持传入顺序，组标题 sticky 显示组名与条数；无 group 的进最后一组"其他"
 *   · 单选：点行即选中（↑↓ 移动、Enter 确认、双击直接回传 [id]）
 *   · 多选：行首复选框，点整行切换；顶部"已选 n 项"+ 清空；底部"添加所选（n）"，n=0 时禁用
 *   · 列表 ScrollArea 内部滚动，最大高 46vh；底部按钮在 DialogContent 的 footer 里，不随列表滚动
 *
 * 无障碍：搜索框 role=combobox + aria-controls/aria-activedescendant，列表 role=listbox，
 *   行 role=option + aria-selected；标题走 DialogContent 的 DialogTitle。
 *
 * 键盘游标与"选中"是两个概念：游标（activeId）用 --color-cx-hover，多选勾选 / 单选已选中的行
 *   用 --color-cx-selected；鼠标悬停用状态驱动（内联样式没法写 :hover，而 :hover 的优先级
 *   又盖不住"选中"档，所以统一在渲染时算背景色）。
 */
export function Picker({
  open,
  onOpenChange,
  title,
  items,
  multiple = false,
  searchPlaceholder,
  emptyText,
  confirmText,
  onConfirm,
}: PickerProps): ReactElement {
  const uid = useId().replace(/[^0-9A-Za-z_-]/g, "") || "picker";
  const [query, setQuery] = useState("");
  /** 多选：已勾选的 id 集合 */
  const [picked, setPicked] = useState<ReadonlySet<string>>(() => new Set<string>());
  /** 键盘游标 / 单选当前项 */
  const [activeId, setActiveId] = useState<string | null>(null);
  const [hoverId, setHoverId] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const rowRefs = useRef(new Map<string, HTMLDivElement>());

  const normalized = query.trim().toLowerCase();
  const filtered = useMemo(
    () => (normalized ? items.filter((item) => matches(item, normalized)) : items),
    [items, normalized],
  );
  const groups = useMemo(() => groupBy(filtered), [filtered]);
  /** 显示顺序（= 分组后的顺序），键盘上下移动按它走 */
  const flat = useMemo(() => groups.flatMap((group) => group.items), [groups]);
  const indexOf = useMemo(() => {
    const map = new Map<string, number>();
    flat.forEach((item, i) => map.set(item.id, i));
    return map;
  }, [flat]);

  const optionId = (i: number) => `${uid}-opt-${i}`;
  const listId = `${uid}-list`;
  const activeIndex = activeId === null ? -1 : flat.findIndex((item) => item.id === activeId);

  // 每次打开都从干净状态开始：清空搜索词、选择与游标，并把焦点交给搜索框。
  // 用 layout effect（早于 DialogContent 的自动聚焦 useEffect），既能在上屏前复位（不会闪一下旧状态），
  // 又不会把焦点从搜索框抢回对话框容器。
  useLayoutEffect(() => {
    if (!open) return;
    setQuery("");
    setPicked(new Set<string>());
    setActiveId(null);
    setHoverId(null);
    inputRef.current?.focus();
  }, [open]);

  // 键盘游标移动后把它滚进可视区（block: nearest 不会惊动外层滚动）
  useEffect(() => {
    if (!activeId) return;
    rowRefs.current.get(activeId)?.scrollIntoView({ block: "nearest" });
  }, [activeId, flat]);

  const singleId = useMemo(() => {
    if (multiple || activeId === null) return null;
    const item = flat.find((it) => it.id === activeId);
    return item && !item.disabled ? item.id : null;
  }, [multiple, activeId, flat]);

  const canConfirm = multiple ? picked.size > 0 : singleId !== null;
  const count = picked.size;

  const confirm = () => {
    if (multiple) {
      if (count === 0) return;
      // 回传顺序 = items 传入顺序（与搜索/勾选先后无关，调用方拿到的结果稳定）
      onConfirm(items.filter((item) => picked.has(item.id) && !item.disabled).map((item) => item.id));
    } else {
      if (!singleId) return;
      onConfirm([singleId]);
    }
    onOpenChange(false);
  };

  const moveCursor = (delta: 1 | -1) => {
    if (flat.length === 0) return;
    const current = flat.findIndex((item) => item.id === activeId);
    if (current < 0) {
      const start = firstEnabled(flat, delta);
      if (start >= 0) setActiveId(flat[start].id);
      return;
    }
    let i = current;
    for (;;) {
      const next = i + delta;
      if (next < 0 || next >= flat.length) return; // 到头了，停在原地
      i = next;
      if (!flat[i].disabled) {
        setActiveId(flat[i].id);
        return;
      }
    }
  };

  const toggle = (item: PickerItem) => {
    if (item.disabled) return;
    setActiveId(item.id);
    if (!multiple) return;
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(item.id)) next.delete(item.id);
      else next.add(item.id);
      return next;
    });
  };

  const pickNow = (item: PickerItem) => {
    // 单选：双击直接确认这一行
    if (multiple || item.disabled) return;
    onConfirm([item.id]);
    onOpenChange(false);
  };

  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      moveCursor(event.key === "ArrowDown" ? 1 : -1);
      return;
    }
    if (event.key === "Enter") {
      // 焦点在按钮上（取消 / 确定 / 清空）时让按钮自己处理，别在这里重复触发
      const target = event.target as HTMLElement | null;
      if (target?.closest?.("button")) return;
      event.preventDefault();
      confirm();
    }
  };

  const label = confirmText ?? (multiple ? "添加所选" : "确定");

  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent
        style={{ maxWidth: 560, width: "min(560px, calc(100vw - 32px))" }}
        title={title}
        footer={
          <>
            <DialogClose asChild>
              <Button size="sm" variant="ghost">
                取消
              </Button>
            </DialogClose>
            <Button color="primary" disabled={!canConfirm} onClick={confirm} size="sm" variant="solid">
              {multiple ? `${label}（${count}）` : label}
            </Button>
          </>
        }
      >
        {/* radix ScrollArea 的内容层写死 display:table（为了量横向滚动），这里改成 block：
            否则超长标题会把内容层撑得比视口宽（出现横向滚动），sticky 分组头也少一层不确定因素。 */}
        <style>{`[data-picker="${uid}"] [data-radix-scroll-area-viewport] > div { display: block !important; }`}</style>
        <div onKeyDown={onKeyDown} style={{ display: "flex", flexDirection: "column", gap: 8, minHeight: 0 }}>
          <Input
            aria-activedescendant={activeIndex >= 0 ? optionId(activeIndex) : undefined}
            aria-autocomplete="list"
            aria-controls={listId}
            aria-expanded
            aria-label={title}
            autoFocus
            leading={<Search aria-hidden size={14} />}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={searchPlaceholder ?? "搜索…"}
            ref={inputRef}
            role="combobox"
            size="sm"
            trailing={
              query ? (
                <Button
                  aria-label="清空搜索"
                  iconSize="xs"
                  onClick={() => {
                    setQuery("");
                    inputRef.current?.focus();
                  }}
                  size="2xs"
                  uniform
                  variant="ghost"
                >
                  <X aria-hidden size={12} />
                </Button>
              ) : null
            }
            value={query}
          />

          <div style={META_ROW}>
            <span>{normalized ? `匹配 ${flat.length} / 共 ${items.length} 项` : `共 ${items.length} 项`}</span>
            {multiple ? (
              <span style={{ display: "inline-flex", alignItems: "center", gap: 4, marginLeft: "auto" }}>
                <span style={{ color: count > 0 ? "var(--color-cx-accent)" : undefined }}>已选 {count} 项</span>
                <Button disabled={count === 0} onClick={() => setPicked(new Set<string>())} size="2xs" variant="transparent">
                  清空
                </Button>
              </span>
            ) : null}
          </div>

          <ScrollArea
            data-picker={uid}
            style={{ maxHeight: LIST_MAX_HEIGHT }}
            viewportProps={{ style: { maxHeight: LIST_MAX_HEIGHT, overflowX: "hidden", overflowY: "auto" } }}
          >
            {flat.length === 0 ? (
              <div style={EMPTY}>
                <SearchX aria-hidden size={20} />
                <span>{emptyText ?? "没有匹配的选项"}</span>
              </div>
            ) : (
              <div aria-label={title} aria-multiselectable={multiple || undefined} id={listId} role="listbox">
                {groups.map((group) => (
                  <div aria-label={group.name} key={group.name} role="group">
                    <div style={GROUP_HEAD}>
                      <span>{group.name}</span>
                      <span style={GROUP_HEAD_COUNT}>{group.items.length}</span>
                    </div>
                    {group.items.map((item) => {
                      const selected = multiple ? picked.has(item.id) : item.id === activeId;
                      const cursor = item.id === activeId;
                      const background = selected
                        ? "var(--color-cx-selected)"
                        : cursor || item.id === hoverId
                          ? "var(--color-cx-hover)"
                          : "transparent";
                      // "选中"档用的是实底灰（--color-background-secondary-solid），配套前景是 *-solid
                      const titleColor = selected ? "var(--color-text-secondary-solid)" : "var(--color-text)";
                      const subtitleColor = selected ? "var(--color-text-secondary-solid)" : "var(--color-text-secondary)";
                      return (
                        <div
                          aria-disabled={item.disabled || undefined}
                          aria-selected={selected}
                          id={optionId(indexOf.get(item.id) ?? 0)}
                          key={item.id}
                          onClick={() => toggle(item)}
                          onDoubleClick={() => pickNow(item)}
                          onMouseLeave={() => setHoverId((prev) => (prev === item.id ? null : prev))}
                          onMouseMove={() => setHoverId((prev) => (prev === item.id ? prev : item.id))}
                          ref={(el) => {
                            if (el) rowRefs.current.set(item.id, el);
                            else rowRefs.current.delete(item.id);
                          }}
                          role="option"
                          style={{
                            ...ROW,
                            background,
                            cursor: item.disabled ? "not-allowed" : "pointer",
                            opacity: item.disabled ? 0.42 : 1,
                          }}
                        >
                          {multiple ? (
                            <Checkbox
                              aria-hidden
                              checked={selected}
                              disabled={item.disabled}
                              style={{ flex: "0 0 auto", pointerEvents: "none" }}
                              tabIndex={-1}
                            />
                          ) : null}
                          <span style={{ display: "flex", flexDirection: "column", gap: 1, minWidth: 0, flex: "1 1 auto" }}>
                            <span style={{ ...ROW_TITLE, color: titleColor }}>{item.title}</span>
                            {item.subtitle ? (
                              <span style={{ ...ROW_SUBTITLE, color: subtitleColor, opacity: selected ? 0.82 : 1 }}>
                                {item.subtitle}
                              </span>
                            ) : null}
                          </span>
                          {!multiple && selected ? (
                            <Check aria-hidden size={14} style={{ color: "var(--color-text-secondary-solid)", flex: "0 0 auto" }} />
                          ) : null}
                        </div>
                      );
                    })}
                  </div>
                ))}
              </div>
            )}
          </ScrollArea>
        </div>
      </DialogContent>
    </Dialog>
  );
}
/**
 * 轻量确认弹层（集成层需要）：Picker 只负责"选"，这里负责"确认"。
 * 与 Picker 共用同一套 Dialog/Button 样式。
 */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmText = "确定",
  cancelText = "取消",
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  title: string;
  description?: string;
  confirmText?: string;
  cancelText?: string;
  onConfirm: () => void;
}) {
  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent
        footer={
          <>
            <Button onClick={() => onOpenChange(false)} size="sm" variant="ghost">
              {cancelText}
            </Button>
            <Button
              color="primary"
              onClick={() => {
                onConfirm();
                onOpenChange(false);
              }}
              size="sm"
              variant="solid"
            >
              {confirmText}
            </Button>
          </>
        }
        title={title}
      >
        {description ? <p style={{ margin: 0, lineHeight: 1.7, color: "var(--color-text-secondary)" }}>{description}</p> : null}
      </DialogContent>
    </Dialog>
  );
}
