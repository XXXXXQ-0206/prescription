# Packaging and Distribution (Portable / No-Install)

> 中文版：[docs/zh-CN/PACKAGING.md](zh-CN/PACKAGING.md)

**Prescription Master** (`studio`) is an Electron + React desktop application that fills in Chinese hospital
prescription forms, lays them out with Typst, and exports PDF / PNG / SVG. This page describes **Path A**: how
`studio` is packed into a **self-contained, no-install directory**, so that it can be copied to any 64-bit
Windows machine and started by double-clicking a single `.bat` — no Node.js, npm, .NET or other runtime has to
be installed on the target machine.

| Item | Value |
| --- | --- |
| Pack script | [`studio/scripts/pack.mjs`](../studio/scripts/pack.mjs) |
| Output directory | `studio/release/PrescriptionMaster/` |
| Launcher for end users | `Prescription Master.bat` |
| Unattended self-check | `自检截图.bat` |
| End-user readme inside the build | `README-使用说明.txt` |
| Recorded run environment | Windows x64 · Node v22.23.2 · Electron 43.7.9 · Typst 0.15.1 |

Two conventions used throughout this page:

- **All commands are run from `studio/`**, not from the repository root. Write the repository root (the
  directory that contains `README.md`) as `<repo>`.
- Relative links in this file are relative to `docs/`. The Chinese originals live in `docs/zh-CN/`
  ([`PACKAGING.md`](zh-CN/PACKAGING.md), [`TEMPLATES.md`](zh-CN/TEMPLATES.md), [`PRESETS.md`](zh-CN/PRESETS.md));
  screenshots live in `docs/images/`.

The console output, tables and measurements below were captured from a real run on the environment listed
above — see [Verification record](#verification-record). Log wording follows the script and may differ by one
line between revisions.

## Two packaging paths

The repository ships two independent ways to produce a distributable Windows build. They do not call each
other.

| | Path A — `scripts/pack.mjs` (this page) | Path B — electron-builder |
| --- | --- | --- |
| Command | `npm run pack` / `node scripts/pack.mjs` | no npm script; the `build` block in `studio/package.json` is electron-builder config |
| Output | `studio/release/PrescriptionMaster/` (plain directory) | `Prescription-Master-Setup-<version>.exe` (NSIS), `Prescription-Master-Portable-<version>.exe`, `win-unpacked/` |
| Dependencies | none beyond Node built-ins | `electron-builder` (`^26.15.3`, devDependency) |
| Kernel | copies `resources/typst.exe` into `app/resources/` | `extraResources` copies `resources/typst.exe` and `resources/icon.png` next to `app.asar` |
| Typical use | hand-off on a USB stick, locked-down hospital PCs, no installer | signed installer / single-file portable `.exe` |

Notes on Path B:

- `studio/release/` in the current working tree contains the electron-builder artifacts from that
  configuration (`Prescription-Master-Setup-1.0.0.exe`, `Prescription-Master-Portable-1.0.0.exe`,
  `win-unpacked/`).
- The `build` block targets x64 only: `nsis` (with `oneClick: false`, user-level install, desktop + start-menu
  shortcuts) and `portable`, uses `resources/icon.ico` as the app icon and `resources` as `buildResources`.
- Because no npm script wraps electron-builder, invoke its CLI from `studio/` (for example
  `npx electron-builder --win`) if you want to rebuild those artifacts.
- [`studio/scripts/pack.mjs`](../studio/scripts/pack.mjs) imports only `node:fs`, `node:fs/promises`,
  `node:path`, `node:child_process` and `node:url`: Path A never spawns electron-builder, and the two paths
  are independent. The root [README](../README.md) documents both.

Both paths require `studio/resources/typst.exe` to exist before packing (see below). They differ in where the
kernel ends up, and `studio/electron/main.mjs` resolves it accordingly:

```js
// dev / unpacked directory (pack.mjs): <app root>/resources/typst.exe
// installed or portable build (electron-builder): process.resourcesPath/typst.exe
const RES = app.isPackaged ? process.resourcesPath : path.join(ROOT, "resources");
```

## Prerequisites

Run these once from `studio/`, in this order, on a fresh clone:

```powershell
cd <repo>/studio

npm install           # Electron runtime + dev tooling (electron-builder, rolldown, vite, ...)
npm run fetch:typst   # fetch the Typst kernel → studio/resources/typst.exe   (required before packing)
npm run bundle        # regenerate the scripts/*.mjs build products           (see "Build products")
npm run build         # build the renderer → studio/dist/index.html
```

`npm run pack` (or `node scripts/pack.mjs --build`, which folds the last step into the pack run) then produces
the portable directory.

| Step | What it provides | Symptom if skipped |
| --- | --- | --- |
| `npm install` | `node_modules/electron/dist/electron.exe` (the runtime that gets copied) | `[pack] 未找到 Electron 运行时：...node_modules\electron\dist，请先 npm install`, exit 1 |
| `npm run fetch:typst` | `studio/resources/typst.exe`, the 50.1 MB typesetting kernel | packed app starts but preview/export fails; `[pack]   typst.exe : 0.0 MB  ← 缺失！` |
| `npm run bundle` | `scripts/*.mjs` build products (only needed if you run those scripts) | `Cannot find module ...\scripts\render-all.mjs` |
| `npm run build` | `studio/dist/index.html` and `dist/assets/*` | `[pack] 渲染层尚未构建：缺少 ...\studio\dist\index.html`, exit 1 |

### The Typst kernel is not in the repository

`studio/resources/typst.exe` (50.1 MB) is **not tracked by Git** — the repository root `.gitignore` excludes
`*.exe`. It is fetched by the npm script declared in `studio/package.json`:

```json
"fetch:typst": "node scripts/fetch-typst.mjs"
```

The kernel must be present for both packaging paths: `pack.mjs` copies it to `app/resources/typst.exe`, and
electron-builder ships it through `extraResources`. Verify it independently:

```powershell
cd <repo>/studio
.\resources\typst.exe --version      # → typst 0.15.1 (9dfd3a08)
```

`npm run fetch:typst` is idempotent: it exits immediately when `resources/typst.exe` already reports
`typst 0.15.1`, re-downloads with `-- --force`, verifies the official archive against the byte size and
SHA-256 pinned in the script, and resolves proxies as `--proxy <url>` → `HTTPS_PROXY` / `HTTP_PROXY`
(honouring `NO_PROXY`, with `--no-proxy` for a forced direct connection; `TYPST_URL` can point at a mirror). If the download is impossible it prints manual alternatives, including
the plain `typst-0.15.1-windows-x64.exe` attached to this project's v1.0.0 release.

### Build products: `scripts/*.mjs` are generated

`studio/scripts/` mixes two kinds of files, and the distinction matters on a fresh clone:

- **Hand-written tools that are committed**: `bundle.mjs`, `start.mjs`, `pack.mjs`, `gen-presets-doc.mjs`,
  `check-presets.mjs`, `check-tcm.mjs`, `check-odrisk.mjs`.
- **rolldown build products that are *not* committed**: every `*.mjs` that has a same-named `.ts` source. In
  this tree there are **10** of them — `long-diag.mjs`, `render-all.mjs`, `stress-templates.mjs`,
  `test-extremes.mjs`, `test-gen.mjs`, `test-qr.mjs`, `test-variants.mjs`, `__zz_test.mjs`, `_probe_bj3.mjs`,
  `_probe_limits.mjs` — each generated from `scripts/<name>.ts`.

The rule lives in [`studio/scripts/.gitignore`](../studio/scripts/.gitignore): `*.mjs` is ignored, with explicit
negations for the hand-written ones. After a clone, `npm run bundle` must be run once before any of those ten
scripts (and before the npm scripts that chain it: `render`, `diag:long`, `stress`, `test*`, `check:*`).

```powershell
cd <repo>/studio
npm run bundle                  # incremental: only stale/missing entries are rebuilt
npm run bundle -- render-all    # rebuild selected entries only (one or more names)
npm run bundle -- --force       # ignore timestamps, rebuild everything
npm run bundle -- --check       # CI: verify products are up to date, write nothing
```

How freshness is decided: `bundle.mjs` takes the newest mtime across `src/**`, `scripts/*.ts`,
`package.json` and `tsconfig.json` and rebuilds any `<name>.mjs` older than that. Each entry is bundled
separately (ESM, `platform: "node"`, alias `@` → `src/`) so that every product is self-contained. Adding a new
`.ts` file under `scripts/` is enough — no script change is needed.

> Packing itself does **not** need `npm run bundle` (it copies `dist/`, `electron/`, `resources/` and
> `templates/`). It is listed here because the clone-and-run instructions for the TypeScript tooling start with
> it, and because a stale `dist/` is usually produced by those very scripts.

## Quick start

Three equivalent ways to produce the portable directory:

```powershell
cd <repo>/studio

# A. renderer already built (studio/dist/index.html exists)
node scripts/pack.mjs

# B. let the pack script run the vite build first
node scripts/pack.mjs --build

# C. via npm
npm run pack
```

When it finishes, **the thing you distribute is the single directory
`studio/release/PrescriptionMaster/`** — copy it whole.

### Recorded output

```
[pack] studio 根目录: <repo>/studio
[pack] 产物目录: <repo>/studio/release/PrescriptionMaster
[pack] ELECTRON_RUN_AS_NODE 当前值 = "1" （打包/验证时会清掉）
[pack] 复制 Electron 运行时（约 300+ MB，请稍候）...
[pack]   Electron 复制完成 0.2s
[pack] 复制应用代码 → app/

[pack] ========== 产物统计 ==========
[pack] 总体积          : 410.9 MB（430865003 字节）
[pack] 文件总数        : 86
[pack]   其中 Electron : 360.3 MB
[pack]   其中 应用代码 : 50.6 MB（8 个文件）
[pack]   typst.exe     : 50.1 MB
[pack]   语言包        : 完整 55 个
[pack] 启动器          : Prescription Master.bat
[pack] 耗时            : 0.3s
[pack] ==============================

[pack] == 实测验证：用产出的 electron.exe 跑 --shot ==
[pack]    electron.exe --version → v43.7.9
[pack]    ✔ 运行时自检通过（Electron v43.7.9）
[pack]    electron.exe <app> --shot → exit 0  (5.3s)
[pack]    stdout: SHOT_SAVED <out>\app\shot.png
[pack]    ✔ 截图已生成: <out>\app\shot.png  0.1 MB

[pack] 完成。分发时把整个 PrescriptionMaster 目录拷走即可。
```

Key lines translated, for readers who do not read Chinese:

| Log line | Meaning |
| --- | --- |
| `studio 根目录` / `产物目录` | Source `studio/` root / output directory |
| `ELECTRON_RUN_AS_NODE 当前值 = ...` | The inherited value of the variable; the script deletes it for packing and for every verification spawn |
| `复制 Electron 运行时（约 300+ MB，请稍候）...` | Copying the whole Electron runtime (the long step) |
| `总体积` / `文件总数` | Total size / total file count |
| `其中 Electron` / `其中 应用代码` / `typst.exe` | Split: Electron runtime / application code / kernel |
| `语言包` | Locale packs (`完整 55 个` = all 55, versus `已裁剪` when `--no-locales` is used) |
| `启动器` / `耗时` | Launcher file name / elapsed time |
| `运行时自检通过` | Runtime self-check passed |
| `截图已生成` | Screenshot written (it is deleted again before the script exits) |
| `完成。分发时把整个 ... 目录拷走即可` | Done — copy the whole directory |

> The `0.2s` copy time is the **OS file cache** hitting (the same Electron tree had just been read). A cold
> first pack takes tens of seconds to a minute or two. That is normal; it does not need optimising.

### Command-line reference

| Option | Effect |
| --- | --- |
| `--build` | Run `npm run build` (vite) before packing |
| `--out <dir>` | Custom output root; default is `<repo>/studio/release`. The build lands in `<dir>/PrescriptionMaster/` |
| `--no-locales` | Keep only three locale packs: `zh-CN`, `en-US`, `zh-TW` |
| `--no-verify` | Skip the automatic `--version` + `--shot` verification (use on machines without a display) |

Unknown arguments are ignored. The script has **zero added dependencies** — Node built-ins only — and requires
a 64-bit Windows host with the `electron` devDependency installed.

Failure exit codes: `1` for a failed precondition (missing Electron runtime, missing `dist/index.html`, failed
`--build`) or an unhandled exception; `2` when the post-pack verification fails.

### Preconditions

- `npm install` has been run, so that `node_modules/electron/dist/electron.exe` exists.
- `dist/index.html` has been built, otherwise the script aborts immediately:

  ```
  [pack] 渲染层尚未构建：缺少 <repo>\studio\dist\index.html
         请先执行  npm run build  （或使用  node scripts/pack.mjs --build）
  ```

  ('Renderer not built: `...\studio\dist\index.html` is missing. Run `npm run build`, or use
  `node scripts/pack.mjs --build`.')

No administrator rights are needed: everything is written under `studio/release/`.

## Output layout

```
studio/release/PrescriptionMaster/
├── electron.exe                 ← Electron 43.7.9 runtime (main program, 228 MB on disk)
├── *.dll, *.pak, icudtl.dat      Chromium / GPU / multimedia dependencies
├── locales/                     locale packs (55 by default)
├── resources/
│   └── default_app.asar         Electron's own placeholder app — MUST be kept (see Pitfalls)
├── Prescription Master.bat      ← double-click this to start
├── 自检截图.bat                  unattended self-check: writes a screenshot, then exits
├── README-使用说明.txt           one-page readme for end users
└── app/                         ← application code (8 files, ~50.6 MB)
    ├── package.json             only name/version/type/main/dependencies; main = electron/main.mjs
    ├── dist/index.html          built renderer
    ├── dist/assets/             index-<hash>.js + index-<hash>.css
    ├── electron/main.mjs        main process (ESM; gets the electron API via createRequire)
    ├── electron/preload.cjs     preload script (CJS)
    ├── resources/typst.exe      typesetting kernel (50.1 MB)
    └── resources/icon.png       window / tray icon
```

Design notes:

- **The Electron runtime sits at the root of the build, the application code sits next to it in `app/`.** The
  launcher passes `app` as an argument to `electron.exe`; Electron treats that directory as the application
  root and reads `main` from its `package.json` → `electron/main.mjs`.
- In the main process `ROOT = path.resolve(__dirname, "..")` resolves to exactly `app/`, so
  `app/resources/typst.exe` and `app/dist/index.html` are found automatically — **not a single line of the
  application source had to change**.
- `app/` deliberately contains **no vite/React sources and no `node_modules`**: the renderer is already
  bundled into `dist/assets/*.js`, and nothing else is needed at runtime.
- `templates/` is copied into `app/` when it exists at `studio/templates/`. It is optional: this tree has no
  such directory, which is why the recorded build contains 8 application files.
- Sizes and hashed asset names change with every renderer build. Only the split between runtime / application
  code / kernel is stable, and Electron (~360 MB) plus `typst.exe` (~50 MB) dominate it.

> **Naming note.** The output directory is named after the `APP_NAME` constant in
> [`pack.mjs`](../studio/scripts/pack.mjs) — change it there and every path in this document follows.

## Starting the build

### Double-click (what end users do)

Double-click `PrescriptionMaster\Prescription Master.bat`. The launcher generated by `pack.mjs` (UTF-8 with
BOM, `chcp 65001`, CRLF) is:

```bat
@echo off
chcp 65001 >nul
setlocal
rem ★ 必须清掉 ELECTRON_RUN_AS_NODE，否则 electron.exe 退化成纯 Node，
rem   报 'Cannot read properties of undefined (reading "whenReady")'，窗口不会出现。
set ELECTRON_RUN_AS_NODE=
cd /d "%~dp0"
start "" "%~dp0electron.exe" "%~dp0app" %*
endlocal
```

- `%~dp0` is the directory of the script itself, so **the whole directory can live at any path** (including
  Chinese characters and spaces) and can be renamed or moved as a unit.
- `start ""` returns to the command prompt immediately, so no console window is left behind.
- `set ELECTRON_RUN_AS_NODE=` genuinely *deletes* the variable in cmd (see Pitfalls).
- Extra arguments are forwarded: anything you pass to the `.bat` reaches `electron.exe`.

### From a command line

cmd:

```bat
cd /d <out>
set ELECTRON_RUN_AS_NODE=
electron.exe app
```

PowerShell:

```powershell
cd <out>
Remove-Item Env:\ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue   # ★ must DELETE, not blank it
.\electron.exe .\app
```

### Unattended self-check (`--shot`)

`自检截图.bat` starts the app with `--shot`: load the window, wait 4 seconds, capture it, write the PNG, exit.

```bat
@echo off
chcp 65001 >nul
rem 无人值守自检：生成窗口截图到本目录 shot.png 后自动退出
set ELECTRON_RUN_AS_NODE=
cd /d "%~dp0"
"%~dp0electron.exe" "%~dp0app" --shot
```

Run it and look for the file:

```powershell
cd <out>
.\自检截图.bat
dir app\shot.png
```

> The screenshot lands in **`app/shot.png`** (not in the build root), because the main process writes to
> `path.join(ROOT, "shot.png")` and `ROOT` is `app/`. Additionally, `pack.mjs` deletes a screenshot produced
> by its own verification pass, so the self-check image is never shipped by accident. This is existing
> application behaviour, not a packaging quirk.

### Export self-check (`--export-test`)

```bat
cd /d <out>
set ELECTRON_RUN_AS_NODE=
electron.exe app --export-test
```

This runs the main process in headless mode (no tray, no "close hides the window" interception), compiles an
existing Typst document to all three formats at 300 dpi and prints a summary. It requires
`app/out/generated.typ` to exist — that file is a development artifact produced by the test tooling and is
**not** part of the distributed build, so this check normally runs against a development tree, not against a
shipped directory.

## What the pack script does

1. **Validates** `node_modules/electron/dist/electron.exe` and `dist/index.html`; a missing one aborts with the
   exact fix command printed. `--build` runs `npm run build` first.
2. **Deletes the previous build** (`release/PrescriptionMaster/`) and recreates it.
3. **Copies the whole Electron runtime** (~360 MB, including its `resources/` directory) to the build root.
   The script warns if `resources/` is missing afterwards.
4. **Copies the application code** into `app/`: `dist/`, `electron/`, `templates/` (if present), and only
   `typst.exe` / `typst` / `icon.*` out of `resources/`. The development `out/` directory is deliberately
   skipped — it holds dozens of test renders (~5 MB) that are useless at runtime.
5. **Rewrites `app/package.json`**, keeping only what the runtime needs (`name`, `version`, `private`, `type`,
   `description`, `main` → `electron/main.mjs`, `dependencies`) and dropping `devDependencies`, `scripts` and
   the electron-builder `build` block.
6. **Generates the launchers**: `Prescription Master.bat`, `自检截图.bat` and `README-使用说明.txt`, all UTF-8
   **with BOM**, so that Chinese text stays readable in `cmd` under `chcp 65001`.
7. **Prints statistics**: total size, file count, Electron / app-code split, kernel size, locale-pack count,
   launcher name, elapsed time.
8. **Verifies the result automatically** (unless `--no-verify`): runs `--version` and `--shot` with the
   **newly packed** `electron.exe`, with `ELECTRON_RUN_AS_NODE` deleted from the child environment. Any failed
   step sets exit code `2`; a produced screenshot is deleted afterwards so it is not shipped.

## Pitfalls

Two problems were hit while building this packaging flow. Both are field-tested, both are silent failures, and
both are guarded against in the current script.

### 1. `ELECTRON_RUN_AS_NODE` must be **deleted**, blanking it is not enough

**Symptom.** No window appears at all, or the app dies with:

```
TypeError: Cannot read properties of undefined (reading 'whenReady')
```

**Cause.** The variable is an official Electron switch. As soon as it **exists** — even with an empty value —
`electron.exe` degrades into plain Node: it does not load the Electron modules and does not create windows.
`require("electron")` then resolves to the ordinary npm package (which only exports the executable path) and
`app` is `undefined`.

Measured on the same machine, same `electron.exe`, only the environment differing:

| `ELECTRON_RUN_AS_NODE` | `electron.exe --version` | Result |
| --- | --- | --- |
| **Absent** (`delete env.X`) | `v43.7.9` | ✅ normal |
| Present, value `""` | `v24.21.0` | ❌ degraded |
| Present, value `"1"` | `v24.21.0` | ❌ degraded |

> **Easy test:** `electron.exe --version` printing **v43.x** is healthy; printing **v24.x** means you are
> hitting this.

**Fix.**

- In scripts: `delete env.ELECTRON_RUN_AS_NODE` before `spawn` — `env.X = ""` is *not* a fix. `pack.mjs` does
  this in `cleanEnv()` for both verification spawns; [`scripts/start.mjs`](../studio/scripts/start.mjs) does the
  same for development runs.
- In `.bat` files: `set ELECTRON_RUN_AS_NODE=` — in cmd this genuinely removes the variable.
- **PowerShell trap:** `$env:X = ""` only blanks the value, the variable still exists and the process **still
  degrades**. Use `Remove-Item Env:\ELECTRON_RUN_AS_NODE` instead.

### 2. Never delete Electron's own `resources/` directory

**Symptom.** In the build, `electron.exe --version` **fails silently**: `exit 1`, empty stdout, empty stderr.
The app does not start and **nothing is reported anywhere**.

**Cause.** In an attempt to slim the build down, the script once removed `resources/default_app.asar`
(Electron's placeholder app, only 110 KB). With that file gone the `resources/` directory became empty and was
cleaned up too, so Electron could no longer find its runtime resource directory and exited silently.

**How it was verified** (same executable, only this directory differing):

| Condition | Result |
| --- | --- |
| `resources/` deleted | `status=1`, empty stdout |
| `electron/dist/resources/` restored | `status=0`, stdout `v43.7.9` ✅ |

The `electron.exe` used in both runs had an **identical MD5** (`844a9a32...`), which confirms the problem was
directory completeness, not the binary.

**Conclusion.** `resources/` and the `default_app.asar` inside it **must be preserved byte for byte**.
`pack.mjs` now checks for that directory and prints a warning when it is missing.

## Verification record

### Packing

```powershell
PS> node scripts/pack.mjs
... （full output in "Quick start" above）
[pack] ✔ 运行时自检通过（Electron v43.7.9）
[pack] ✔ 截图已生成: <out>\app\shot.png
```

Exit code **0**.

### `--shot` with the packed executable

```
electron.exe <app> --shot → exit 0  (5.3s)
stdout: SHOT_SAVED <out>\app\shot.png
```

The screenshot was 1860×1230 and the UI was complete: form on the left, Typst preview on the right, toolbar on
top. The title bar showed `Typst 0.15.1 (9dfd3a08) · SimSun 排版` and the status bar showed
`渲染 633 ms · 矢量 SVG · 导出为 PDF/PNG 为 300dpi` and `版式校验通过` ('render 633 ms · vector SVG · PDF/PNG
export at 300 dpi', 'layout check passed').

### Export (PDF / PNG / SVG)

```
EXPORT_SELFTEST
pdf: OK 78717 bytes -> out/selftest.pdf
png: OK 330297 bytes -> out/selftest.png
svg: OK 348581 bytes -> out/selftest.svg
```

All three formats succeed, which shows the bundled `typst.exe` (0.15.1) works from inside the build.

### Portability (simulating a target machine)

The build was copied as a whole to another, clean ASCII path (`D:\portable_test\`) and started through the
`.bat` **from a shell that had `ELECTRON_RUN_AS_NODE=1` set**:

```powershell
PS> Copy-Item <out> D:\portable_test\PrescriptionMaster -Recurse   # 87 files / 431 MB
PS> cd D:\portable_test\PrescriptionMaster
PS> cmd /c Prescription Master.bat        # $env:ELECTRON_RUN_AS_NODE = 1 in this shell
PS> Get-Process electron | Select Id,MainWindowTitle
   Id ProcessName MainWindowTitle
166388 electron    Prescription Master      ← the window really exists
```

✅ The build is self-contained and relocatable, and the `.bat` launcher really does neutralise
`ELECTRON_RUN_AS_NODE`.

### Self-check batch file

```
PS> cmd /c 自检截图.bat
SHOT_SAVED <out>\app\shot.png
exit=0
```

## FAQ

### Q1. Double-clicking the `.bat` flashes a console window and nothing appears

Run it manually in `cmd` to see the error:

```bat
cd /d <out>
set ELECTRON_RUN_AS_NODE=
electron.exe app
```

The two most common causes:

1. **`ELECTRON_RUN_AS_NODE` was not really deleted** (see Pitfall 1) — you get the `whenReady` error, or
   `--version` prints `v24.x`.
2. **The `resources/` directory was deleted** (see Pitfall 2) — `--version` prints nothing at all.

### Q2. `electron.exe --version` produces no output

Almost certainly an incomplete runtime directory — the case in Pitfall 2. Check that
`resources/default_app.asar` exists under the build root.

### Q3. "typst missing" / PDF export fails

- Check that `app/resources/typst.exe` exists (50.1 MB).
- Run it on its own: `app\resources\typst.exe --version` should print `typst 0.15.1 (9dfd3a08)`.
- If an antivirus quarantined it, whitelist the directory and pack again.

### Q4. Chinese text renders as boxes / fonts are missing

Electron renders with system fonts. On trimmed-down Windows images without Chinese fonts (SimSun / Microsoft
YaHei) you may see tofu boxes — install the standard Chinese font pack.

PDF export resolves fonts through **typst**, which ships a set of open-source fonts. If a template requests a
system font that the target machine lacks, the PDF falls back. Prefer templates that stick to bundled or
generic fonts.

### Q5. Antivirus / SmartScreen blocks the build

The unsigned `electron.exe` is frequently flagged, and Chinese-named `.bat` files tend to trip script
heuristics as well:

- Add the whole `PrescriptionMaster` directory to the antivirus exclusion list.
- For SmartScreen prompts: "More info" → "Run anyway".
- For public distribution, code-sign `electron.exe` with `signtool`, or wrap the app in an installer with Inno
  Setup / NSIS (Path B in this document).

### Q6. Slow startup / blank window

The first cold start has to decompress `.pak` files and `icudtl.dat`; 2–4 seconds is normal. If the window stays
blank, check that `app/dist/index.html` exists — without `dist` the main process falls back to the development
server `http://127.0.0.1:5278/`, which can never load on a target machine.

### Q7. Making the build smaller

- `--no-locales` keeps only three locale packs.
- The Electron runtime (~360 MB) and `typst.exe` (~50 MB) dominate the size, and neither can be dropped.
- Further reduction means a 7-Zip/LZMA self-extracting archive, or electron-builder's NSIS target (that pulls
  in new dependencies — `pack.mjs` is deliberately zero-dependency).

### Q8. Do I have to re-pack for another machine?

No. The build is self-contained: **copy the whole directory**. Re-pack only when you change `src/` and rerun
`npm run build`, upgrade Electron, change the `electron/` main process, or replace `typst.exe`.

### Q9. Desktop shortcut / start with Windows

Right-click `Prescription Master.bat` → "Send to" → "Desktop (create shortcut)". Put a shortcut in
`shell:startup` to launch it at logon. An `.ico` converted from `app/resources/icon.png` can be used as the
shortcut icon.

## Distribution checklist

- [ ] `npm run build` succeeded and `dist/index.html` is up to date
- [ ] `studio/resources/typst.exe` exists (fetched with `npm run fetch:typst`) and prints its version
- [ ] `node scripts/pack.mjs` is all green (statistics look sane, `--version` prints `v43.x`, screenshot
      verification passes, exit 0)
- [ ] `resources/default_app.asar` exists under the build root
- [ ] `app/resources/typst.exe` exists and can print its version
- [ ] After copying the whole directory to the target machine, double-clicking `Prescription Master.bat`
      opens the window
- [ ] Export one PDF on the target machine
- [ ] Antivirus whitelist configured for the directory where needed

## Appendix: Chinese file names and in-app strings

The application targets Chinese hospitals, and its UI, data and several shipped file names are Chinese **by
design**. Do not translate or transliterate them — renaming `自检截图.bat` or translating the in-app labels
would break the generated launchers and confuse end users. Values that appear in packaging artifacts:

| Item | Value | Where it comes from |
| --- | --- | --- |
| Unattended self-check launcher | `自检截图.bat` | written by `pack.mjs` |
| End-user readme | `README-使用说明.txt` | written by `pack.mjs` (UTF-8 with BOM) |
| Tray menu entries | `显示/隐藏主窗口`, `退出` | `studio/electron/main.mjs` |
| Window title | `Prescription Master` (Latin) | `studio/electron/main.mjs` |
| Locale packs | `zh-CN.pak`, `en-US.pak`, `zh-TW.pak` kept by `--no-locales` | Electron runtime |

Sample domain values shown in the UI are Chinese as well — hospital names, diagnoses, drug names and
medication instructions. A few verbatim examples, so that the encoding is obvious when you diff logs or
screenshots:

- Facility names such as `北京大学第六医院`, `首都医科大学附属北京安定医院`, `南京脑科医院`
- Diagnoses such as `抑郁状态`, `心境[情感]障碍`, `焦虑状态`
- Drugs such as `草酸艾司西酞普兰片`, `盐酸舍曲林片`, `奥氮平片`
- Usage / medication instructions such as `每日1次 每次1片 口服`, `每晚1次 每次1片 口服`

The complete, authoritative lists live in the Chinese documentation and in
`studio/src/data/presets.ts`: see [`docs/zh-CN/PRESETS.md`](zh-CN/PRESETS.md) for hospitals, departments,
diagnoses, drugs and regimens, and [`docs/zh-CN/TEMPLATES.md`](zh-CN/TEMPLATES.md) for the template catalogue
(preview images in `docs/images/`).
