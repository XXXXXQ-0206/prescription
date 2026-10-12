#!/usr/bin/env node
/**
 * pack.mjs —— 把 studio 打包成「免安装（portable）」的 Windows 目录。
 *
 * 产物结构：
 *   studio/release/PrescriptionMaster/
 *     electron.exe, *.dll, *.pak, locales/ ...   ← Electron 运行时（整份复制）
 *     app/                                       ← 应用代码（main 指向 app/electron/main.mjs）
 *       package.json  dist/  electron/  resources/  templates/  docs/
 *     Prescription Master.bat                        ← 双击启动器
 *     README-使用说明.txt
 *
 * 零新增依赖：只用 node: 内置模块。
 *
 * 用法：
 *   node scripts/pack.mjs              # 需要 dist 已构建，否则报错退出
 *   node scripts/pack.mjs --build      # 先跑 vite build 再打包
 *   node scripts/pack.mjs --out <dir>  # 自定义产物根目录
 *   node scripts/pack.mjs --no-locales # 只保留 zh-CN/en-US 语言包（体积更小）
 *
 * ★ 关键坑：启动 Electron 之前必须删掉环境变量 ELECTRON_RUN_AS_NODE。
 *   本机（以及任何从 Electron 派生出的进程）会带着 ELECTRON_RUN_AS_NODE=1，
 *   这时 electron.exe 会退化成纯 Node（--version 打印的是 Node 的 v24.x），
 *   应用启动时报 "Cannot read properties of undefined (reading 'whenReady')"。
 *   本脚本在下述三处都做了清理：pack() 内部验证、生成的 .bat、生成的 start 辅助脚本。
 */
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");            // studio/
const APP_NAME = "PrescriptionMaster";
const BAT_NAME = "Prescription Master.bat";

const argv = process.argv.slice(2);
const has = (f) => argv.includes(f);
const getOpt = (f, dflt) => {
  const i = argv.indexOf(f);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : dflt;
};

const DO_BUILD = has("--build");
const NO_LOCALES = has("--no-locales");
const OUT_ROOT = path.resolve(ROOT, getOpt("--out", path.join("release")));
const OUT_DIR = path.join(OUT_ROOT, APP_NAME);
const APP_DIR = path.join(OUT_DIR, "app");

/** 清掉 ELECTRON_RUN_AS_NODE —— 否则 electron.exe 退化成纯 Node */
function cleanEnv(extra = {}) {
  const env = { ...process.env, ...extra };
  delete env.ELECTRON_RUN_AS_NODE;
  return env;
}
const ELECTRON_BIN = process.platform === "win32" ? "electron.exe" : "electron";

function run(bin, args, opts = {}) {
  return new Promise((resolve) => {
    const p = spawn(bin, args, { ...opts, env: opts.env ?? process.env });
    let out = "", err = "";
    p.stdout?.on("data", (d) => (out += d.toString()));
    p.stderr?.on("data", (d) => (err += d.toString()));
    p.on("error", (e) => resolve({ code: -1, out, err: String(e) }));
    p.on("close", (code) => resolve({ code, out, err }));
  });
}

/** 递归复制目录（Node 22+ 自带 cp，这里仍手写以便统计与过滤） */
async function copyDir(src, dest, filter) {
  await fsp.mkdir(dest, { recursive: true });
  const entries = await fsp.readdir(src, { withFileTypes: true });
  for (const e of entries) {
    const s = path.join(src, e.name);
    const d = path.join(dest, e.name);
    if (filter && !filter(s, e)) continue;
    if (e.isDirectory()) await copyDir(s, d, filter);
    else if (e.isSymbolicLink()) await fsp.symlink(await fsp.readlink(s), d).catch(() => {});
    else await fsp.copyFile(s, d);
  }
}

async function statTree(dir) {
  let bytes = 0, files = 0;
  const stack = [dir];
  while (stack.length) {
    const cur = stack.pop();
    let entries;
    try { entries = await fsp.readdir(cur, { withFileTypes: true }); } catch { continue; }
    for (const e of entries) {
      const p = path.join(cur, e.name);
      if (e.isDirectory()) stack.push(p);
      else {
        files++;
        try { bytes += (await fsp.stat(p)).size; } catch {}
      }
    }
  }
  return { bytes, files };
}

const mb = (n) => (n / 1024 / 1024).toFixed(1) + " MB";
const log = (...a) => console.log("[pack]", ...a);

async function main() {
  const t0 = Date.now();
  log("studio 根目录:", ROOT);
  log("产物目录:", OUT_DIR);
  log("ELECTRON_RUN_AS_NODE 当前值 =", JSON.stringify(process.env.ELECTRON_RUN_AS_NODE ?? "(未设置)"), "（打包/验证时会清掉）");

  // ---- 0. 前置检查 ---------------------------------------------------------
  const electronDist = path.join(ROOT, "node_modules", "electron", "dist");
  if (!fs.existsSync(path.join(electronDist, ELECTRON_BIN))) {
    console.error("[pack] 未找到 Electron 运行时：" + electronDist + "，请先 npm install");
    process.exit(1);
  }

  if (DO_BUILD) {
    log("== 先跑前端构建：npm run build ==");
    const npm = process.platform === "win32" ? "npm.cmd" : "npm";
    const r = await run(npm, ["run", "build"], { cwd: ROOT, stdio: "inherit", env: process.env });
    if (r.code !== 0) { console.error("[pack] 构建失败，退出码 " + r.code); process.exit(1); }
  }

  const distIndex = path.join(ROOT, "dist", "index.html");
  if (!fs.existsSync(distIndex)) {
    console.error(
      "[pack] 渲染层尚未构建：缺少 " + distIndex + "\n" +
      "       请先执行  npm run build  （或使用  node scripts/pack.mjs --build）"
    );
    process.exit(1);
  }

  // ---- 1. 清空旧产物 -------------------------------------------------------
  if (fs.existsSync(OUT_DIR)) {
    log("清理旧产物 ...");
    await fsp.rm(OUT_DIR, { recursive: true, force: true });
  }
  await fsp.mkdir(APP_DIR, { recursive: true });

  // ---- 2. Electron 运行时 → 产物根 -----------------------------------------
  log("复制 Electron 运行时（约 300+ MB，请稍候）...");
  const tE = Date.now();
  const keepLocales = new Set(["zh-CN.pak", "en-US.pak", "zh-TW.pak"]);
  await copyDir(electronDist, OUT_DIR, (src, dirent) => {
    if (!NO_LOCALES) return true;
    if (path.basename(path.dirname(src)) === "locales") return keepLocales.has(dirent.name);
    return true;
  });
  log("  Electron 复制完成 " + ((Date.now() - tE) / 1000).toFixed(1) + "s");

  // ★ 千万不要删 Electron 自带的 resources/ 目录。
  //   踩过的坑：曾经为了"瘦身"删掉 resources/default_app.asar（占位应用，110 KB），
  //   结果 electron.exe --version 变成静默失败（exit 1、无任何输出），
  //   应用也起不来。实测：补回既有 resources/default_app.asar 后立刻恢复正常，
  //   所以这个目录必须原样保留。
  const resDir = path.join(OUT_DIR, "resources");
  if (!fs.existsSync(resDir)) {
    console.warn("[pack] ⚠ 警告：Electron 运行时缺少 resources/ 目录，产出的程序可能无法启动");
  }

  // ---- 3. 应用代码 → app/ --------------------------------------------------
  log("复制应用代码 → app/");
  await copyDir(path.join(ROOT, "dist"), path.join(APP_DIR, "dist"));
  await copyDir(path.join(ROOT, "electron"), path.join(APP_DIR, "electron"));
  await copyDir(path.join(ROOT, "resources"), path.join(APP_DIR, "resources"), (src) => {
    // 只保留运行时真正需要的：typst 内核 + 图标；排除原始图标源等大文件
    const n = path.basename(src).toLowerCase();
    return n === "typst.exe" || n === "typst" || n.startsWith("icon.");
  });
  // 注意：不要拷 out/ —— 那是开发期的导出样例目录（几十个测试产物，约 5 MB），
  // 运行时并不需要，只会白白撑大分发包。
  for (const extra of ["templates"]) {
    const p = path.join(ROOT, extra);
    if (fs.existsSync(p)) await copyDir(p, path.join(APP_DIR, extra));
  }

  // app/package.json：main 指向 electron/main.mjs，去掉 devDependencies/scripts
  const srcPkg = JSON.parse(await fsp.readFile(path.join(ROOT, "package.json"), "utf8"));
  const appPkg = {
    name: srcPkg.name,
    version: srcPkg.version,
    private: true,
    type: "module",
    description: srcPkg.description,
    main: "electron/main.mjs",
    dependencies: srcPkg.dependencies || {},
  };
  await fsp.writeFile(path.join(APP_DIR, "package.json"), JSON.stringify(appPkg, null, 2) + "\n", "utf8");

  // ---- 4. 启动器 -----------------------------------------------------------
  const bat = [
    "@echo off",
    "chcp 65001 >nul",
    "setlocal",
    "rem ★ 必须清掉 ELECTRON_RUN_AS_NODE，否则 electron.exe 退化成纯 Node，",
    "rem   报 'Cannot read properties of undefined (reading \"whenReady\")'，窗口不会出现。",
    "set ELECTRON_RUN_AS_NODE=",
    "cd /d \"%~dp0\"",
    "start \"\" \"%~dp0" + ELECTRON_BIN + "\" \"%~dp0app\" %*",
    "endlocal",
    "",
  ].join("\r\n");
  await fsp.writeFile(path.join(OUT_DIR, BAT_NAME), "\ufeff" + bat, "utf8");

  // 辅助：命令行验证脚本（同样清环境变量）
  const verify = [
    "@echo off",
    "chcp 65001 >nul",
    "rem 无人值守自检：生成窗口截图到本目录 shot.png 后自动退出",
    "set ELECTRON_RUN_AS_NODE=",
    "cd /d \"%~dp0\"",
    "\"%~dp0" + ELECTRON_BIN + "\" \"%~dp0app\" --shot",
    "",
  ].join("\r\n");
  await fsp.writeFile(path.join(OUT_DIR, "自检截图.bat"), "\ufeff" + verify, "utf8");

  const readme = [
    "Prescription Master —— 免安装（portable）版",
    "==============================================",
    "",
    "【怎么跑】",
    "1. 把整个 PrescriptionMaster 目录拷贝到目标机器（任意目录，包含中文/空格路径均可）。",
    "2. 双击「Prescription Master.bat」即可启动。首次启动约 2-4 秒。",
    "   也可以在本目录执行 .\\electron.exe .\\app 启动，",
    "   但必须先真正删掉环境变量 ELECTRON_RUN_AS_NODE（cmd: set ELECTRON_RUN_AS_NODE=）。",
    "",
    "【依赖】",
    "- 不需要安装 Node.js / npm / .NET；所有运行时都在目录里。",
    "- 需要 64 位 Windows 10 1809+ / Windows 11。",
    "- 排版内核 typst.exe 已随包（app\\resources\\typst.exe）。",
    "",
    "【常见问题】",
    "- 双击 .bat 闪一下就没了：先跑「自检截图.bat」看报错，或看 docs\\PACKAGING.md。",
    "- 报 Cannot read properties of undefined (reading 'whenReady') → ELECTRON_RUN_AS_NODE 没清干净。",
    "- 安全软件报毒：把整个目录加白名单。",
    "",
  ].join("\r\n");
  await fsp.writeFile(path.join(OUT_DIR, "README-使用说明.txt"), "\ufeff" + readme, "utf8");

  // ---- 5. 统计 -------------------------------------------------------------
  const total = await statTree(OUT_DIR);
  const appStat = await statTree(APP_DIR);
  const electronOnly = total.bytes - appStat.bytes;
  log("");
  log("========== 产物统计 ==========");
  log("目录            : " + OUT_DIR);
  log("总体积          : " + mb(total.bytes) + "（" + total.bytes + " 字节）");
  log("文件总数        : " + total.files);
  log("  其中 Electron : " + mb(electronOnly));
  log("  其中 应用代码 : " + mb(appStat.bytes) + "（" + appStat.files + " 个文件）");
  const typstSize = fs.existsSync(path.join(APP_DIR, "resources", "typst.exe"))
    ? (await fsp.stat(path.join(APP_DIR, "resources", "typst.exe"))).size : 0;
  log("  typst.exe     : " + mb(typstSize) + (typstSize ? "" : "  ← 缺失！"));
  log("  语言包        : " + (NO_LOCALES ? "已裁剪（zh-CN/en-US/zh-TW）" : "完整 " + (await fsp.readdir(path.join(OUT_DIR, "locales"))).length + " 个"));
  log("启动器          : " + BAT_NAME);
  log("耗时            : " + ((Date.now() - t0) / 1000).toFixed(1) + "s");
  log("==============================");

  if (!has("--no-verify")) {
    // ---- 6. 用产物里的 electron.exe 真跑一次 --shot ------------------------
    log("");
    log("== 实测验证：用产出的 electron.exe 跑 --shot ==");
    const bin = path.join(OUT_DIR, ELECTRON_BIN);
    const appArg = APP_DIR;
    const ver = await run(bin, ["--version"], { env: cleanEnv() });
    const verOut = ver.out.trim();
    log("   " + ELECTRON_BIN + " --version → " + (verOut || ver.err.trim() || "(无输出)"));
    if (/^v24\./.test(verOut)) {
      console.error("   ✘ 打印的是 Node 版本号 → ELECTRON_RUN_AS_NODE 没被真正删除（置空字符串无效，必须 delete 或 cmd 的 set VAR=）");
      process.exitCode = 2;
    } else if (!/^v\d+\.\d+\.\d+/.test(verOut)) {
      console.error("   ✘ --version 无有效输出（exit " + ver.code + "）→ Electron 运行时目录不完整；" +
        "请确认 " + path.join(OUT_DIR, "resources") + " 存在且未被删除");
      process.exitCode = 2;
    } else {
      log("   ✔ 运行时自检通过（Electron " + verOut + "）");
    }
    // ★ 主进程用的是 path.join(ROOT, "shot.png")，而 ROOT = 应用根目录 = app/，
    //   所以截图落在 app/shot.png（不是产物根目录）。
    const shotPath = path.join(APP_DIR, "shot.png");
    await fsp.rm(shotPath, { force: true });
    const tS = Date.now();
    const shot = await run(bin, [appArg, "--shot"], { cwd: OUT_DIR, env: cleanEnv() });
    log("   " + ELECTRON_BIN + " <app> --shot → exit " + shot.code + "  (" + ((Date.now() - tS) / 1000).toFixed(1) + "s)");
    if (shot.out.trim()) log("   stdout: " + shot.out.trim().split("\n").slice(-4).join(" | "));
    if (shot.err.trim()) log("   stderr: " + shot.err.trim().split("\n").slice(-4).join(" | "));
    if (fs.existsSync(shotPath)) {
      const sz = (await fsp.stat(shotPath)).size;
      log("   ✔ 截图已生成: " + shotPath + "  " + mb(sz));
      // 验证完就删掉，避免把自检产物一并发出去
      await fsp.rm(shotPath, { force: true });
      log("   已清理自检截图（不随包发出）");
    } else {
      log("   ✘ 未生成截图");
      process.exitCode = 2;
    }
  }

  log("");
  log("完成。分发时把整个 " + APP_NAME + " 目录拷走即可。");
}

main().catch((e) => { console.error("[pack] 失败:", e); process.exit(1); });
