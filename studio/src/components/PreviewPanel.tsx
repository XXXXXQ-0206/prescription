import { useEffect, useRef, useState } from "react";
import { AlertTriangle, Code2, Eye, Maximize2, Minus, Plus, RefreshCw, XCircle, Pencil, Check, RotateCcw } from "lucide-react";

import type { Warning } from "@/lib/doc";
import { Button } from "@/ui/button";

/** pt → CSS 像素（96dpi / 72dpi = 4/3） */
const PT2PX = 96 / 72;

export function PreviewPanel({
  svg,
  source,
  error,
  warnings,
  zoom,
  setZoom,
  ms,
  busy,
  cached,
  pageW,
  pageH,
  typst,
  onRefresh,
  overrideActive,
  onSaveOverride,
  onClearOverride,
}: {
  svg: string;
  source: string;
  error: string;
  warnings: Warning[];
  zoom: number | "fit";
  setZoom: (z: number | "fit") => void;
  ms: number;
  busy: boolean;
  cached: boolean;
  pageW: number;
  pageH: number;
  typst?: string;
  onRefresh: () => void;
  /** 用户是否正在用手改的源码渲染 */
  overrideActive: boolean;
  onSaveOverride: (src: string) => void;
  onClearOverride: () => void;
}) {
  const [mode, setMode] = useState<"preview" | "source">("preview");
  const stageRef = useRef<HTMLDivElement>(null);
  const [fit, setFit] = useState(0.55);
  const DOC_W = Math.round(pageW * PT2PX);
  const DOC_H = Math.round(pageH * PT2PX);

  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const update = () => {
      const w = el.clientWidth - 36;
      const h = el.clientHeight - 36;
      setFit(Math.max(0.15, Math.min(w / DOC_W, h / DOC_H)));
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [DOC_W, DOC_H]);

  const scale = zoom === "fit" ? fit : zoom;
  // 源码手动编辑：draft 只在编辑期间存在，点「完成」才提交给上层
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const beginEdit = () => { setDraft(source); setEditing(true); };
  const commit = () => { onSaveOverride(draft); setEditing(false); };
  const cancel = () => { setEditing(false); };
  const errs = warnings.filter((w) => w.level === "error");
  const warns = warnings.filter((w) => w.level === "warn");

  return (
    <div className="preview-pane">
      <div className="toolbar">
        <Button onClick={() => setMode("preview")} size="2xs" variant={mode === "preview" ? "soft" : "ghost"}>
          <Eye size={12} /> 预览
        </Button>
        <Button onClick={() => setMode("source")} size="2xs" variant={mode === "source" ? "soft" : "ghost"}>
          <Code2 size={12} /> Typst 源码
        </Button>
        <span className="divider-v" />
        <Button onClick={() => setZoom("fit")} size="2xs" variant={zoom === "fit" ? "soft" : "ghost"} title="适应窗口">
          <Maximize2 size={12} />
        </Button>
        <Button onClick={() => setZoom(1)} size="2xs" variant={zoom === 1 ? "soft" : "ghost"} title="实际大小">
          100%
        </Button>
        <Button onClick={() => setZoom(Math.max(0.2, Math.round((scale - 0.1) * 100) / 100))} size="2xs" uniform variant="ghost" title="缩小">
          <Minus size={12} />
        </Button>
        <Button onClick={() => setZoom(Math.min(2.5, Math.round((scale + 0.1) * 100) / 100))} size="2xs" uniform variant="ghost" title="放大">
          <Plus size={12} />
        </Button>
        <span className="titlebar__meta">{Math.round(scale * 100)}%</span>
        <span className="grow" />
        {mode === "source" && !editing ? (
          <Button onClick={beginEdit} size="2xs" variant="soft" title="手动编辑 Typst 源码">
            <Pencil size={12} /> 修改
          </Button>
        ) : null}
        {mode === "source" && editing ? (
          <>
            <Button onClick={cancel} size="2xs" variant="ghost">取消</Button>
            <Button color="primary" onClick={commit} size="2xs" variant="solid">
              <Check size={12} /> 完成
            </Button>
          </>
        ) : null}
        {mode === "source" && overrideActive && !editing ? (
          <Button onClick={onClearOverride} size="2xs" variant="ghost" title="放弃手改内容，恢复按表单自动生成">
            <RotateCcw size={12} /> 恢复自动生成
          </Button>
        ) : null}
        <Button onClick={onRefresh} size="2xs" variant="ghost" title="重新渲染">
          <RefreshCw size={12} />
        </Button>
      </div>

      <div className="stage" ref={stageRef}>
        {mode === "source" ? (
          editing ? (
            <textarea
              className="source-edit"
              onChange={(e) => setDraft(e.target.value)}
              spellCheck={false}
              value={draft}
            />
          ) : (
            <pre className="source-view">{source}</pre>
          )
        ) : error ? (
          <pre className="err-box">{error}</pre>
        ) : (
          <div className="paper" style={{ width: Math.round(DOC_W * scale), height: Math.round(DOC_H * scale) }}>
            <div
              dangerouslySetInnerHTML={{ __html: svg }}
              style={{ width: DOC_W, height: DOC_H, transform: `scale(${scale})`, transformOrigin: "top left" }}
            />
          </div>
        )}
      </div>

      <div className="statusbar">
        <span className={`dot ${busy ? "dot--busy" : error ? "dot--err" : ""}`} />
        <span>
          {busy ? "渲染中…" : error ? "渲染失败" : `${ms} ms${cached ? " · 缓存" : ""} · 矢量 SVG · 导出 PDF/PNG 为 300dpi`}
        </span>
        <span className="grow" />
        {typst ? <span>{typst}</span> : null}
        {error ? null : warnings.length ? (
          <span className="issues">
            {errs.map((w, i) => (
              <span className="issue issue--error" key={`e${i}`}>
                <XCircle size={11} /> {w.text}
              </span>
            ))}
            {warns.map((w, i) => (
              <span className="issue issue--warn" key={`w${i}`}>
                <AlertTriangle size={11} /> {w.text}
              </span>
            ))}
          </span>
        ) : (
          <span>版式校验通过</span>
        )}
      </div>
    </div>
  );
}
