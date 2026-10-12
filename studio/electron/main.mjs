import { createRequire } from "node:module";
// ESM 下 'electron' 会被解析到 node_modules/electron（只导出可执行文件路径），
// 必须用 createRequire 走 Electron 内置模块拿到真正的 API。
const require = createRequire(import.meta.url);
const { app, BrowserWindow, dialog, ipcMain, shell, Tray, Menu, nativeImage } = require("electron");
import { spawn } from "node:child_process";
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
// 开发态资源在 ROOT/resources；打包后（asar）由 extraResources 放到 process.resourcesPath
const RES = app.isPackaged ? process.resourcesPath : path.join(ROOT, "resources");
const TYPST = path.join(RES, process.platform === "win32" ? "typst.exe" : "typst");
const SHOT = process.argv.includes("--shot");
const DEV = process.argv.includes("--dev");

/** 主窗口 / 托盘 / 是否正在退出（关闭窗口时用它区分“最小化到托盘”与“真的退出”） */
let mainWindow = null;
let tray = null;
let isQuitting = false;
/** --shot / --export-test：无人值守模式，不建托盘、不做“关闭即隐藏”拦截 */
const isHeadless = process.argv.includes("--shot") || process.argv.includes("--export-test");

// ── 单实例 ────────────────────────────────────────────────
// 拿不到锁说明已有一个实例在跑：立刻退出本进程，由已有实例接管（见 second-instance）
const gotTheLock = isHeadless ? true : app.requestSingleInstanceLock();
if (!gotTheLock) {
  // 已有实例在跑：立刻终止本进程（不能只用 app.quit()，那样后续 whenReady 仍会建出窗口）
  app.exit(0);
} else {
  app.on("second-instance", () => {
    // 第二个实例被唤起：显示并置顶已有窗口
    showMainWindow();
  });
}

const WIN_W = 1240;
const WIN_H = 820;

let workDir = null;
async function ensureWorkDir() {
  if (!workDir) workDir = await fsp.mkdtemp(path.join(os.tmpdir(), "presc-"));
  return workDir;
}

/** 调用 typst 编译：把源码写成 .typ，编译成目标格式，回读结果 */
function runTypst(args, onSpawn) {
  return new Promise((resolve) => {
    const p = spawn(TYPST, args, { windowsHide: true });
    if (onSpawn) onSpawn(p);
    let out = "", err = "";
    let killed = false;
    p.stdout.on("data", (d) => (out += d.toString("utf8")));
    p.stderr.on("data", (d) => (err += d.toString("utf8")));
    p.on("error", (e) => resolve({ code: -1, out, err: String(e), killed }));
    p.on("close", (code) => resolve({ code, out, err, killed }));
    p.mark = () => { killed = true; try { p.kill(); } catch {} };
  });
}


/** ── 性能：SVG 预览的渲染缓存 + 请求合并 ──────────────────────────
 * 1. 同一份 .typ 源码只编译一次（LRU 24）；撤销/来回改同一个字段时命中缓存，零开销。
 * 2. 同一时刻只允许一个预览编译在跑：新请求到来时把在飞的那个 kill 掉，
 *    只编译最新的源码（用户连打时不再排队，延迟恒定为单次编译时间）。
 * 3. --warm：启动时先编译一次空文档，把 Typst 的字体扫描/缓存预热掉。
 */
const svgCache = new Map();
const CACHE_MAX = 24;
let inflight = null;
let pending = null;
let inflightChild = null;

const hashOf = (s) => {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36) + ":" + s.length;
};

function cacheGet(k) {
  if (!svgCache.has(k)) return null;
  const v = svgCache.get(k);
  svgCache.delete(k);
  svgCache.set(k, v); // LRU 提升
  return v;
}
function cachePut(k, v) {
  svgCache.set(k, v);
  if (svgCache.size > CACHE_MAX) svgCache.delete(svgCache.keys().next().value);
}

/** 带合并的 SVG 预览渲染：同一时刻只跑一个，永远只编译最新请求 */
function renderPreview(source) {
  const key = hashOf(source);
  const hit = cacheGet(key);
  if (hit) return Promise.resolve(hit);
  return new Promise((resolve) => {
    pending = { source, key, resolve };
    pump();
  });
}

function pump() {
  if (inflight || !pending) return;
  // 有更新的请求在排队：先把在飞的编译掐掉，避免旧结果后到覆盖新画面
  if (inflightChild) { inflightChild.mark(); inflightChild = null; }
  const job = pending;
  pending = null;
  const t0 = Date.now();
  inflight = compileSource(job.source, "svg", 0, true);
  inflight
    .then((r) => {
      if (r.aborted) return; // 被更新的请求打断，结果丢弃
      const payload = r.ok
        ? { ok: true, svg: r.data.toString("utf8"), ms: Date.now() - t0, cached: false }
        : { ok: false, error: r.error };
      if (r.ok) cachePut(job.key, { ...payload, cached: true });
      job.resolve(payload);
    })
    .catch((e) => job.resolve({ ok: false, error: String(e) }))
    .finally(() => {
      inflight = null;
      if (pending) pump();
    });
}

async function compileSource(source, format, ppi, abortable = false) {
  const dir = await ensureWorkDir();
  const stamp = Date.now() + "-" + Math.random().toString(36).slice(2, 8);
  const typ = path.join(dir, `doc-${stamp}.typ`);
  await fsp.writeFile(typ, source, "utf8");
  let outFile, result;
  if (format === "svg") {
    outFile = path.join(dir, `doc-${stamp}.svg`);
    result = await runTypst(["compile", typ, outFile, "--format", "svg"], (child) => {
      if (abortable) inflightChild = child;
    });
  } else if (format === "png") {
    outFile = path.join(dir, `doc-${stamp}.png`);
    result = await runTypst(["compile", typ, outFile, "--format", "png", "--ppi", String(ppi || 300)]);
  } else {
    outFile = path.join(dir, `doc-${stamp}.pdf`);
    result = await runTypst(["compile", typ, outFile, "--format", "pdf"]);
  }
  if (abortable) inflightChild = null;
  if (result.killed) return { ok: false, aborted: true, error: "superseded" };
  if (result.code !== 0) return { ok: false, error: result.err || result.out || "typst 编译失败" };
  if (!fs.existsSync(outFile)) return { ok: false, error: "typst 未生成输出文件" };
  const data = await fsp.readFile(outFile);
  return { ok: true, data, typPath: typ };
}

function createWindow() {
  const win = new BrowserWindow({
    width: WIN_W,
    height: WIN_H,
    minWidth: WIN_W,
    minHeight: WIN_H,
    maxWidth: WIN_W,
    maxHeight: WIN_H,
    resizable: false,
    maximizable: false,
    fullscreenable: false,
    show: false,
    backgroundColor: "#0f0f0f",
    title: "Prescription Master",
    icon: path.join(RES, "icon.png"),
    titleBarStyle: "hidden",
    titleBarOverlay: { color: "#0f0f0f", symbolColor: "#d8d8d8", height: 38 },
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  const distIndex = path.join(ROOT, "dist", "index.html");
  const devUrl = "http://127.0.0.1:5278/";
  if (DEV || !fs.existsSync(distIndex)) win.loadURL(devUrl);
  else win.loadFile(distIndex);

  mainWindow = win;
  win.once("ready-to-show", () => win.show());
  // 点右上角关闭 = 收进托盘（不退出）；真正退出走托盘菜单/退出流程
  win.on("close", (e) => {
    if (!isQuitting && !isHeadless) {
      e.preventDefault();
      win.hide();
    }
  });
  win.on("closed", () => {
    mainWindow = null;
  });
  if (SHOT) {
    win.webContents.once("did-finish-load", async () => {
      await new Promise((r) => setTimeout(r, 4000));
      const img = await win.webContents.capturePage();
      const out = path.join(ROOT, "shot.png");
      await fsp.writeFile(out, img.toPNG());
      console.log("SHOT_SAVED " + out);
      app.quit();
    });
  }
  return win;
}

/** 显示并置顶主窗口（托盘点击 / 第二个实例唤起都用它） */
function showMainWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) {
    if (!SHOT) createWindow();
    return;
  }
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

/** 托盘点击：在主窗口显示/隐藏之间切换 */
function toggleMainWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) return showMainWindow();
  if (mainWindow.isVisible() && !mainWindow.isMinimized()) mainWindow.hide();
  else showMainWindow();
}

/** 彻底退出：先销毁托盘释放资源，再退出应用 */
function quitApp() {
  isQuitting = true;
  if (tray) {
    tray.destroy();
    tray = null;
  }
  app.quit();
}

/** 系统托盘：右键菜单（显示/隐藏、退出），左键单击切换窗口 */
function createTray() {
  if (tray) return;
  const iconPath = path.join(RES, "icon.png");
  let img = nativeImage.createFromPath(iconPath);
  if (img.isEmpty()) img = nativeImage.createEmpty();
  tray = new Tray(img.resize({ width: 16, height: 16 }));
  tray.setToolTip("Prescription Master");
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: "显示/隐藏主窗口", click: () => toggleMainWindow() },
      { type: "separator" },
      { label: "退出", click: () => quitApp() },
    ]),
  );
  tray.on("click", () => toggleMainWindow());
  tray.on("double-click", () => showMainWindow());
}

async function exportSelfTest() {
  const src = await fsp.readFile(path.join(ROOT, "out", "generated.typ"), "utf8");
  const outDir = path.join(ROOT, "out");
  const results = [];
  for (const [fmt, name] of [["pdf", "selftest.pdf"], ["png", "selftest.png"], ["svg", "selftest.svg"]]) {
    const r = await compileSource(src, fmt, 300);
    if (!r.ok) {
      results.push(`${fmt}: FAIL ${r.error}`);
      continue;
    }
    await fsp.writeFile(path.join(outDir, name), r.data);
    results.push(`${fmt}: OK ${r.data.length} bytes -> out/${name}`);
  }
  console.log("EXPORT_SELFTEST\n" + results.join("\n"));
  app.quit();
}

app.whenReady().then(() => {
  if (process.argv.includes("--export-test")) return void exportSelfTest();
  ipcMain.handle("presc:info", async () => {
    const r = await runTypst(["--version"]);
    return { typst: r.out.trim() || r.err.trim(), typstPath: TYPST, exists: fs.existsSync(TYPST) };
  });
  ipcMain.handle("presc:render", async (_e, { source }) => {
    const r = await renderPreview(source);
    return r;
  });
  ipcMain.handle("presc:export", async (e, { source, format, suggested }) => {
    const win = BrowserWindow.fromWebContents(e.sender);
    const filters = format === "pdf" ? [{ name: "PDF", extensions: ["pdf"] }]
      : format === "png" ? [{ name: "PNG", extensions: ["png"] }]
      : [{ name: "Typst", extensions: ["typ"] }];
    const def = (suggested || "prescription") + "." + (format === "typ" ? "typ" : format);
    const { canceled, filePath } = await dialog.showSaveDialog(win, { defaultPath: def, filters });
    if (canceled || !filePath) return { ok: false, canceled: true };
    if (format === "typ") {
      await fsp.writeFile(filePath, source, "utf8");
      return { ok: true, path: filePath };
    }
    const r = await compileSource(source, format, 300);
    if (!r.ok) return { ok: false, error: r.error };
    await fsp.writeFile(filePath, r.data);
    return { ok: true, path: filePath };
  });
  ipcMain.handle("presc:saveJson", async (e, { json, suggested }) => {
    const win = BrowserWindow.fromWebContents(e.sender);
    const { canceled, filePath } = await dialog.showSaveDialog(win, {
      defaultPath: (suggested || "prescription") + ".json",
      filters: [{ name: "处方数据", extensions: ["json"] }],
    });
    if (canceled || !filePath) return { ok: false, canceled: true };
    await fsp.writeFile(filePath, json, "utf8");
    return { ok: true, path: filePath };
  });
  ipcMain.handle("presc:openJson", async (e) => {
    const win = BrowserWindow.fromWebContents(e.sender);
    const { canceled, filePaths } = await dialog.showOpenDialog(win, {
      properties: ["openFile"],
      filters: [{ name: "处方数据", extensions: ["json"] }],
    });
    if (canceled || !filePaths?.length) return { ok: false, canceled: true };
    const text = await fsp.readFile(filePaths[0], "utf8");
    return { ok: true, json: text, path: filePaths[0] };
  });
  ipcMain.handle("presc:reveal", async (_e, p) => { shell.showItemInFolder(p); return { ok: true }; });
  ipcMain.handle("presc:window", async (e, action) => {
    const win = BrowserWindow.fromWebContents(e.sender);
    if (!win) return { ok: false };
    if (action === "minimize") win.minimize();
    if (action === "close") win.close();
    return { ok: true };
  });
  // 预热：先编译一次最小文档，把字体扫描与内部缓存提前做好
  void compileSource("#set page(width: 100pt, height: 60pt)\nHello", "svg")
    .then((r) => console.log("TYPST_PREWARM " + (r.ok ? "ok" : "fail")));
  createWindow();
  if (!isHeadless) createTray();
  if (process.argv.includes("--tray-selftest")) {
    setTimeout(() => {
      console.log("TRAY_CREATED=" + Boolean(tray) + " MENU_ITEMS=" + (tray ? tray.getContextMenu?.() ? 1 : 0 : 0));
      console.log("TRAY_SELFTEST_QUIT_BEGIN");
      quitApp();
      setTimeout(() => { console.log("TRAY_QUIT_OK"); }, 300);
    }, 2500);
  }
  app.on("activate", () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

// 有托盘常驻时，关掉窗口不等于退出应用（窗口本身是 hide 而非 close）；
// 真正退出只由 quitApp()（托盘菜单）或 before-quit 触发。
app.on("window-all-closed", () => {
  if ((isQuitting || isHeadless) && process.platform !== "darwin") app.quit();
});
app.on("before-quit", () => {
  isQuitting = true;
  if (tray) { tray.destroy(); tray = null; }
});
