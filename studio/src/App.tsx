import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { ChevronDown, Download, FileCode2, FilePlus2, FolderOpen, Image as ImageIcon, Redo2, RotateCcw, Save, Undo2, Wand2 } from "lucide-react";

import { FormPanel } from "@/components/FormPanel";
import { ConfirmDialog } from "@/components/Picker";
import { PreviewPanel } from "@/components/PreviewPanel";
import { DEPARTMENTS, DIAGNOSES, DOC_TYPES, DRUGS, HOSPITALS, USAGE_PRESETS } from "@/data/presets";
import { blankDoc, defaultDoc, emptyExtra, fromJSON, validate, type PrescriptionDoc } from "@/lib/doc";
import { buildTypst, getTemplate, TEMPLATES } from "@/templates";
import { Button } from "@/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/ui/select";

interface PrescApi {
  info: () => Promise<{ typst: string; typstPath: string; exists: boolean }>;
  render: (source: string) => Promise<{ ok: boolean; svg?: string; error?: string; ms?: number; cached?: boolean }>;
  exportDoc: (p: { source: string; format: string; suggested: string }) => Promise<{ ok: boolean; path?: string; error?: string; canceled?: boolean }>;
  saveJson: (p: { json: string; suggested: string }) => Promise<{ ok: boolean; path?: string }>;
  openJson: () => Promise<{ ok: boolean; json?: string; error?: string }>;
  reveal: (p: string) => Promise<{ ok: boolean }>;
  windowAction: (a: string) => Promise<{ ok: boolean }>;
}
declare global {
  interface Window {
    presc?: PrescApi;
  }
}
const api = (): PrescApi | undefined => (typeof window !== "undefined" ? window.presc : undefined);

/** 主数据（v2）：跨模板共用主数据 + 各模板 extra 快照 */
const STORE_KEY = "prescription-studio:doc:v2";
/** v1：老数据只有一份 extra，读到时按 v1 → v2 迁移并写回 v2 */
const LEGACY_STORE_KEY = "prescription-studio:doc:v1";
/** 全局撤销栈深度 */
const HISTORY_MAX = 30;

/** 印刷日期是"开单当天"的语义：启动时若存的是过去的日期就刷新为今天（未来的日期视为用户有意设定，保留） */
function refreshPrintDate(d: PrescriptionDoc): PrescriptionDoc {
  const today = new Date().toLocaleDateString("sv-SE"); // sv-SE 输出 YYYY-MM-DD
  const cur = (d.printDate || "").trim();
  if (!cur || cur < today) return { ...d, printDate: today };
  return d;
}

function loadStored(): PrescriptionDoc {
  try {
    const v2 = window.localStorage.getItem(STORE_KEY);
    if (v2) {
      const parsed = fromJSON(v2);
      if (parsed) return refreshPrintDate(parsed);
    }
    const v1 = window.localStorage.getItem(LEGACY_STORE_KEY);
    if (v1) {
      const parsed = fromJSON(v1);
      if (parsed) {
        const d = refreshPrintDate(parsed);
        window.localStorage.setItem(STORE_KEY, JSON.stringify(d));
        return d;
      }
    }
  } catch {
    /* localStorage 不可用时回退默认样张 */
  }
  return defaultDoc();
}

interface ResetSpec {
  title: string;
  message: string;
  run: () => void;
}

const MENU_STYLE: CSSProperties = {
  background: "var(--color-surface-elevated, var(--color-surface-card))",
  border: "1px solid var(--color-border-subtle)",
  borderRadius: 12,
  boxShadow: "0 12px 32px rgba(0, 0, 0, .45)",
  display: "flex",
  flexDirection: "column",
  gap: 2,
  left: 0,
  marginTop: 4,
  minWidth: 250,
  padding: 4,
  position: "absolute",
  top: "100%",
  zIndex: 60,
};

/** 重置菜单里的一项（两行：标题 + 说明） */
function MenuItem({ icon, title, hint, onClick }: { icon: ReactNode; title: string; hint: string; onClick: () => void }) {
  const [hover, setHover] = useState(false);
  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        alignItems: "flex-start",
        background: hover ? "var(--color-cx-hover, rgba(255, 255, 255, .06))" : "transparent",
        border: "none",
        borderRadius: 8,
        color: "var(--color-text)",
        cursor: "pointer",
        display: "flex",
        font: "inherit",
        gap: 8,
        padding: "6px 8px",
        textAlign: "left",
        width: "100%",
      }}
      type="button"
    >
      <span style={{ color: "var(--color-text-tertiary)", marginTop: 2 }}>{icon}</span>
      <span style={{ display: "flex", flexDirection: "column", gap: 1, minWidth: 0 }}>
        <span style={{ fontSize: "var(--text-sm)", whiteSpace: "nowrap" }}>{title}</span>
        <span style={{ fontSize: "var(--text-xs)", color: "var(--color-text-tertiary)", whiteSpace: "nowrap" }}>{hint}</span>
      </span>
    </button>
  );
}

export function App() {
  const [doc, setDoc] = useState<PrescriptionDoc>(loadStored);
  const [svg, setSvg] = useState("");
  const [error, setError] = useState("");
  const [zoom, setZoom] = useState<number | "fit">("fit");
  const [ms, setMs] = useState(0);
  const [cached, setCached] = useState(false);
  const [busy, setBusy] = useState(false);
  const [info, setInfo] = useState<{ typst: string; exists: boolean }>({ typst: "", exists: false });
  const [toast, setToast] = useState("");
  const [editCard, setEditCard] = useState<string | null>(null);
  const [hist, setHist] = useState({ past: 0, future: 0 });
  const [menuOpen, setMenuOpen] = useState(false);
  const [pendingReset, setPendingReset] = useState<ResetSpec | null>(null);
  const timer = useRef<number | null>(null);
  const reqRef = useRef(0);

  // 撤销/重做栈 + 当前文档的最新引用（apply 是同步的，连续调用也能串起来）
  const docRef = useRef(doc);
  const pastRef = useRef<PrescriptionDoc[]>([]);
  const futureRef = useRef<PrescriptionDoc[]>([]);
  /** 进入编辑时该卡片的快照：取消/Esc 时回滚到这里 */
  const snapshotRef = useRef<PrescriptionDoc | null>(null);
  const menuRef = useRef<HTMLSpanElement | null>(null);
  docRef.current = doc;

  const tpl = getTemplate(doc.templateId);
  const generated = useMemo(() => buildTypst(doc), [doc]);
  // 用户手动改过的 Typst 源码：非空时优先用它渲染（表单改动不会覆盖，需点「恢复自动生成」）
  const [srcOverride, setSrcOverride] = useState<string | null>(null);
  const source = srcOverride ?? generated;
  const warnings = useMemo(() => validate(doc, tpl.limits), [doc, tpl.limits]);

  useEffect(() => {
    const t = window.setTimeout(() => {
      try {
        window.localStorage.setItem(STORE_KEY, JSON.stringify(doc));
      } catch {
        /* 忽略 */
      }
    }, 400);
    return () => window.clearTimeout(t);
  }, [doc]);

  /** 唯一写入口：所有改动都进撤销栈（同一对象视为无改动） */
  const apply = useCallback((updater: (d: PrescriptionDoc) => PrescriptionDoc) => {
    const cur = docRef.current;
    const next = updater(cur);
    if (next === cur) return;
    pastRef.current = [...pastRef.current, cur].slice(-HISTORY_MAX);
    futureRef.current = [];
    docRef.current = next;
    setDoc(next);
    setHist({ future: 0, past: pastRef.current.length });
  }, []);

  const patch = useCallback((p: Partial<PrescriptionDoc>) => apply((d) => ({ ...d, ...p })), [apply]);
  const setDocReplaced = useCallback((d: PrescriptionDoc) => apply(() => d), [apply]);

  const undo = useCallback(() => {
    const past = pastRef.current;
    if (!past.length) return;
    const prev = past[past.length - 1];
    pastRef.current = past.slice(0, -1);
    futureRef.current = [docRef.current, ...futureRef.current].slice(0, HISTORY_MAX);
    docRef.current = prev;
    setDoc(prev);
    setHist({ future: futureRef.current.length, past: pastRef.current.length });
    setToast("已撤销一步");
  }, []);

  const redo = useCallback(() => {
    const future = futureRef.current;
    if (!future.length) return;
    const next = future[0];
    futureRef.current = future.slice(1);
    pastRef.current = [...pastRef.current, docRef.current].slice(-HISTORY_MAX);
    docRef.current = next;
    setDoc(next);
    setHist({ future: futureRef.current.length, past: pastRef.current.length });
    setToast("已重做一步");
  }, []);

  // ── 只读 / 修改（单卡片编辑 + 快照回滚） ─────────────────────────
  const beginCard = useCallback((id: string) => {
    // 切到别的卡片时，上一张的改动视为「完成」，只把新卡片重新拍快照
    snapshotRef.current = docRef.current;
    setEditCard(id);
  }, []);
  const doneCard = useCallback(() => {
    snapshotRef.current = null;
    setEditCard(null);
  }, []);
  const cancelCard = useCallback(() => {
    const snap = snapshotRef.current;
    snapshotRef.current = null;
    setEditCard(null);
    if (snap) apply(() => snap);
  }, [apply]);

  const render = useCallback(async (src: string) => {
    const a = api();
    if (!a) {
      setError("未检测到 Electron 主进程（请用 npm start 启动桌面程序）");
      return;
    }
    const id = ++reqRef.current;
    setBusy(true);
    const t0 = performance.now();
    const r = await a.render(src);
    if (id !== reqRef.current) return; // 丢弃过期响应，避免旧图覆盖新图
    setBusy(false);
    if (r.ok && r.svg) {
      setSvg(r.svg);
      setError("");
      setCached(Boolean(r.cached));
      setMs(r.ms ?? Math.round(performance.now() - t0));
    } else {
      setError(r.error || "渲染失败");
    }
  }, []);

  useEffect(() => {
    api()?.info().then((i) => setInfo({ typst: i.typst, exists: i.exists }));
  }, []);

  // 输入防抖：200ms 内的连续改动只渲染一次
  useEffect(() => {
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => void render(source), 200);
    return () => {
      if (timer.current) window.clearTimeout(timer.current);
    };
  }, [source, render]);

  const suggested = () => (doc.docType + "_" + (doc.patientName || "患者") + "_" + doc.printDate).replace(/[\\/:*?"<>|]/g, "");

  const doExport = async (format: "pdf" | "png" | "typ") => {
    const a = api();
    if (!a) return;
    const r = await a.exportDoc({ format, source, suggested: suggested() });
    if (r.ok && r.path) setToast("已导出 " + r.path);
    else if (!r.canceled && r.error) setToast("导出失败：" + r.error);
  };

  const doSave = async () => {
    const a = api();
    if (!a) return;
    const r = await a.saveJson({ json: JSON.stringify(doc, null, 2), suggested: suggested() });
    if (r.ok && r.path) setToast("已保存 " + r.path);
  };

  const doOpen = async () => {
    const a = api();
    if (!a) return;
    const r = await a.openJson();
    if (r.ok && r.json) {
      const parsed = fromJSON(r.json);
      if (parsed) {
        doneCard();
        apply(() => parsed);
        setToast("已载入处方数据");
      } else setToast("文件不是有效的处方 JSON");
    }
  };

  /** 切模板：主数据不动，只把当前 extra 存进快照、再取新模板的 extra */
  const switchTemplate = (id: string) => {
    if (id === doc.templateId) return;
    doneCard();
    apply((d) => {
      if (id === d.templateId) return d;
      const t = getTemplate(id);
      const extraByTemplate = { ...d.extraByTemplate, [d.templateId]: { ...d.extra } };
      const saved = extraByTemplate[id];
      const seed = saved && Object.keys(saved).length ? saved : (t.defaults?.extra ?? {});
      return { ...d, extra: { ...emptyExtra(), ...seed }, extraByTemplate, templateId: id };
    });
    setToast("已切换到「" + getTemplate(id).name + "」，主数据保持不变");
  };

  // ── 重置菜单：三种都先弹一次确认 ────────────────────────────────
  const resetBlank = () => {
    setPendingReset({
      message: "将清空患者、诊断、药品与扩展字段，保留医院、医师、版式与当前模板（" + tpl.name + "）。是否继续？",
      run: () =>
        apply((d) => {
          const t = getTemplate(d.templateId);
          return { ...blankDoc(d), extra: { ...emptyExtra(), ...(t.defaults?.extra ?? {}) } };
        }),
      title: "空白新处方",
    });
  };

  const resetSample = () => {
    setPendingReset({
      message: tpl.defaults
        ? "将用「" + tpl.name + "」的示例数据替换当前的患者、诊断、药品与扩展字段。是否继续？"
        : "「" + tpl.name + "」没有自带示例数据，将套用北大六院 origin 样张。是否继续？",
      run: () =>
        apply((d) => {
          const tt = getTemplate(d.templateId);
          if (!tt.defaults) return { ...defaultDoc(), templateId: d.templateId };
          const { extra: dex, ...rest } = tt.defaults;
          return { ...d, ...rest, extra: { ...emptyExtra(), ...(dex ?? {}) }, templateId: d.templateId };
        }),
      title: "当前模板示例",
    });
  };

  const resetOrigin = () => {
    setPendingReset({
      message: "将载入与扫描样张逐字一致的默认数据，模板同时切回「北京大学第六医院 · 非医保处方」。是否继续？",
      run: () => apply(() => defaultDoc()),
      title: "北大六院 origin 样张",
    });
  };

  const confirmReset = () => {
    const spec = pendingReset;
    setPendingReset(null);
    doneCard();
    spec?.run();
  };

  // 重置菜单：点外面关掉
  useEffect(() => {
    if (!menuOpen) return;
    const onDown = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    };
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, [menuOpen]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const ae = document.activeElement as HTMLElement | null;
      const inField = Boolean(ae && (ae.tagName === "INPUT" || ae.tagName === "TEXTAREA" || ae.isContentEditable));
      if (e.key === "Escape") {
        if (document.querySelector('[role="dialog"][data-state="open"]')) return; // 弹层自己消费 Esc
        if (editCard) {
          e.preventDefault();
          cancelCard();
        }
        return;
      }
      if (!(e.ctrlKey || e.metaKey)) return;
      const k = e.key.toLowerCase();
      if (k === "z") {
        if (inField) return; // 输入框内交给浏览器原生撤销
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
        return;
      }
      if (k === "s") {
        e.preventDefault();
        void doSave();
      } else if (k === "e") {
        e.preventDefault();
        void doExport("pdf");
      } else if (k === "p") {
        e.preventDefault();
        void doExport("png");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  useEffect(() => {
    if (!toast) return;
    const t = window.setTimeout(() => setToast(""), 3000);
    return () => window.clearTimeout(t);
  }, [toast]);

  return (
    <div className="app-shell">
      <header className="titlebar">
        <Button disabled={!hist.past} onClick={undo} size="2xs" title={"撤销（Ctrl+Z）· 可回退 " + hist.past + " 步"} uniform variant="ghost">
          <Undo2 size={12} />
        </Button>
        <Button disabled={!hist.future} onClick={redo} size="2xs" title={"重做（Ctrl+Shift+Z）· 可前进 " + hist.future + " 步"} uniform variant="ghost">
          <Redo2 size={12} />
        </Button>
        <span className="divider-v" />
        <Select onValueChange={switchTemplate} value={doc.templateId}>
          <SelectTrigger style={{ minWidth: 230, height: 27, fontSize: 12 }} title="切换单据模板（主数据保持不变，编号等扩展字段按模板各存一份）">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {TEMPLATES.map((t) => (
              <SelectItem key={t.id} value={t.id}>
                {t.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <span className="titlebar__meta">
          {tpl.page.widthPt}×{tpl.page.heightPt}pt
        </span>
        <span className="grow" />
        {toast ? <span className="titlebar__meta">{toast}</span> : null}
        {info.exists ? null : <span className="titlebar__meta">typst 未就绪</span>}
        <span className="divider-v" />
        <span className="no-drag" ref={menuRef} style={{ position: "relative" }}>
          <Button onClick={() => setMenuOpen((v) => !v)} size="2xs" title="重置内容" variant="ghost">
            <RotateCcw size={12} /> 重置 <ChevronDown size={11} />
          </Button>
          {menuOpen ? (
            <div style={MENU_STYLE}>
              <MenuItem
                hint="清空患者与内容，保留当前模板"
                icon={<FilePlus2 size={12} />}
                onClick={() => {
                  setMenuOpen(false);
                  resetBlank();
                }}
                title="空白新处方"
              />
              <MenuItem
                hint={"套用 " + tpl.name + " 的示例数据"}
                icon={<Wand2 size={12} />}
                onClick={() => {
                  setMenuOpen(false);
                  resetSample();
                }}
                title="当前模板示例"
              />
              <MenuItem
                hint="北大六院 origin 样张（默认数据）"
                icon={<FileCode2 size={12} />}
                onClick={() => {
                  setMenuOpen(false);
                  resetOrigin();
                }}
                title="origin 样张"
              />
            </div>
          ) : null}
        </span>
        <Button onClick={doOpen} size="2xs" variant="ghost">
          <FolderOpen size={12} /> 载入
        </Button>
        <Button onClick={doSave} size="2xs" variant="ghost">
          <Save size={12} /> 保存
        </Button>
        <span className="divider-v" />
        <Button onClick={() => doExport("typ")} size="2xs" variant="outline">
          <FileCode2 size={12} /> Typst
        </Button>
        <Button onClick={() => doExport("png")} size="2xs" variant="outline">
          <ImageIcon size={12} /> PNG
        </Button>
        <Button onClick={() => doExport("pdf")} size="2xs" variant="outline">
          <Download size={12} /> PDF
        </Button>
        <span style={{ width: 132 }} />
      </header>

      <div className="app-body">
        <div className="form-pane">
          <div className="form-scroll">
            <div className="form-inner">
              <FormPanel
                doc={doc}
                editingCard={editCard}
                onCancelCard={cancelCard}
                onDoneCard={doneCard}
                onEditCard={beginCard}
                patch={patch}
                setDoc={setDocReplaced}
              />
            </div>
          </div>
        </div>
        <PreviewPanel
          busy={busy}
          cached={cached}
          error={error}
          ms={ms}
          onRefresh={() => void render(source)}
          overrideActive={srcOverride !== null}
          onSaveOverride={setSrcOverride}
          onClearOverride={() => setSrcOverride(null)}
          pageH={tpl.page.heightPt}
          pageW={tpl.page.widthPt}
          typst={info.exists ? "Typst " + info.typst.replace(/^typst\s*/, "") : ""}
          setZoom={setZoom}
          source={source}
          svg={svg}
          warnings={warnings}
          zoom={zoom}
        />
      </div>

      <ConfirmDialog
        confirmText="继续"
        description={pendingReset?.message ?? ""}
        onConfirm={confirmReset}
        onOpenChange={(v) => (v ? undefined : setPendingReset(null))}
        open={Boolean(pendingReset)}
        title={pendingReset?.title ?? "重置"}
      />

      <datalist id="dl-hospital">{HOSPITALS.map((h) => <option key={h} value={h} />)}</datalist>
      <datalist id="dl-dept">{DEPARTMENTS.map((h) => <option key={h} value={h} />)}</datalist>
      <datalist id="dl-doctype">{DOC_TYPES.map((d) => <option key={d.title} value={d.title} />)}</datalist>
      <datalist id="dl-diag">{DIAGNOSES.flatMap((g) => g.items.map((d) => <option key={d} value={d} />))}</datalist>
      <datalist id="dl-drug">{DRUGS.map((d) => <option key={d.name} value={d.name} />)}</datalist>
      <datalist id="dl-usage">{USAGE_PRESETS.map((d) => <option key={d} value={d} />)}</datalist>
    </div>
  );
}
