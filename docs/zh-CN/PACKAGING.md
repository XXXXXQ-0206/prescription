# 打包与分发（免安装 / portable）

把 **Prescription Master**（`studio`）打包成一个**免安装目录**：拷到任意 64 位 Windows 机器上，双击一个 `.bat` 就能运行，不需要装 Node.js、npm、.NET 或任何运行库。

- 打包脚本：[`scripts/pack.mjs`](../scripts/pack.mjs)
- 产物目录：`studio/release/PrescriptionMaster/`
- 产物里自带一份面向最终用户的 `README-使用说明.txt`

> 本文档中的命令与输出均为**本机实际执行**的真实结果（Windows + Node v22.23.2 + Electron 43.7.9 + Typst 0.15.1）。

---

## 1. 快速开始

```powershell
cd <repo>/studio

# 方式 A：已构建过前端（存在 dist/index.html）
node scripts/pack.mjs

# 方式 B：让打包脚本先跑一遍 vite build 再打包
node scripts/pack.mjs --build

# 也可以走 npm
npm run pack
```

跑完后，**要分发的东西就是 `studio/release/PrescriptionMaster` 这一个目录**，整个拷走即可。

### 实测输出

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
[pack]    stdout: SHOT_SAVED ...\PrescriptionMaster\app\shot.png
[pack]    ✔ 截图已生成: ...\PrescriptionMaster\app\shot.png  0.1 MB

[pack] 完成。分发时把整个 PrescriptionMaster 目录拷走即可。
```

> 复制耗时 `0.2s` 是**操作系统文件缓存命中**的结果（同一份 Electron 刚被读过）。冷启动首次打包大约几十秒到一两分钟，属正常，无需优化。

### 命令行参数

| 参数 | 作用 |
| --- | --- |
| `--build` | 打包前先执行 `npm run build` |
| `--out <dir>` | 自定义产物根目录，默认 `studio/release` |
| `--no-locales` | 只保留 `zh-CN / en-US / zh-TW` 三个语言包 |
| `--no-verify` | 跳过打包后的自动截图验证（无显示环境时用） |

脚本**零新增依赖**，只用 Node 内置模块。

### 前置条件

- 已 `npm install`（需要 `node_modules/electron/dist/electron.exe`）
- `dist/index.html` 已存在，否则脚本直接报错退出：

  ```
  [pack] 渲染层尚未构建：缺少 ...\studio\dist\index.html
         请先执行  npm run build  （或使用  node scripts/pack.mjs --build）
  ```

---

## 2. 产物结构

```
studio/release/PrescriptionMaster/
├── electron.exe                 ← Electron 43.7.9 运行时（主程序，229 MB）
├── *.dll, *.pak, icudtl.dat      Chromium / GPU / 多媒体依赖
├── locales/                     55 个语言包
├── resources/
│   └── default_app.asar         ★ Electron 自带，必须保留（见第 5.2 节）
├── Prescription Master.bat          ← ★ 双击这个启动
├── 自检截图.bat                  ← 无人值守自检：生成截图后自动退出
├── README-使用说明.txt          给最终用户看的一页纸
└── app/                         ← 应用代码（8 个文件，约 50.6 MB）
    ├── package.json             仅保留 name/version/type/main/dependencies，main = electron/main.mjs
    ├── dist/index.html          已构建的渲染层
    ├── dist/assets/             index-*.js（307 KB）+ index-*.css（237 KB）
    ├── electron/main.mjs        主进程（ESM；用 createRequire 拿 electron API）
    ├── electron/preload.cjs     预加载脚本（CJS）
    ├── resources/typst.exe      排版内核（50.1 MB）
    └── resources/icon.png       窗口图标
```

设计要点：

- **Electron 运行时放在产物根目录，应用代码放在旁边的 `app/`**。启动时把 `app` 作为参数传给 `electron.exe`，Electron 将其视为应用根目录，读取其中 `package.json` 的 `main` → `electron/main.mjs`。
- 主进程里 `ROOT = path.resolve(__dirname, "..")` 正好等于 `app/`，所以 `app/resources/typst.exe`、`app/dist/index.html` 都能自动找对 —— **应用源码一行都没改**。
- `app/` 里**不含 vite / React 源码与 node_modules**：渲染层已经打进 `dist/assets/*.js`，运行期不需要。

---

## 3. 怎么启动

### 3.1 双击（推荐给最终用户）

双击 `PrescriptionMaster\Prescription Master.bat`。核心两行：

```bat
set ELECTRON_RUN_AS_NODE=
start "" "%~dp0electron.exe" "%~dp0app" %*
```

- `%~dp0` 取脚本自身所在目录，因此**整个目录可放在任意路径**（含中文、空格），也能整体改名搬迁。
- `start ""` 让 cmd 立即返回，不留黑框。

### 3.2 命令行直接启动

cmd：

```bat
cd /d <产物目录>
set ELECTRON_RUN_AS_NODE=
electron.exe app
```

PowerShell：

```powershell
cd <产物目录>
Remove-Item Env:\ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue   # ★ 必须"删除"，不是置空
.\electron.exe .\app
```

### 3.3 自检（无人值守）

`自检截图.bat` 以 `--shot` 启动：加载界面 → 等 4 秒 → 把窗口截图写入 **`app/shot.png`** → 自动退出。

```powershell
cd <产物目录>
.\自检截图.bat
dir app\shot.png
```

> 截图落在 `app/`（不是产物根目录），因为主进程写的是 `path.join(ROOT, "shot.png")`，而 `ROOT` = `app/`。这是应用既有行为。

### 3.4 导出功能自检

```bat
cd /d <产物目录>
set ELECTRON_RUN_AS_NODE=
electron.exe app --export-test
```

需要 `app/out/generated.typ` 存在（该文件不在分发包里，属于开发期产物）。

---

## 4. 打包脚本做了什么

1. **校验** `node_modules/electron/dist/electron.exe` 与 `dist/index.html`，缺一即报错并给出修复命令。
2. **复制 Electron 运行时**整份到产物根目录（360 MB，含 `resources/` 子目录）。
3. **复制应用代码**到 `app/`：`dist/`、`electron/`、`resources/`（只挑 `typst.exe` 与 `icon.*`）、`templates/`。
4. **重写 `app/package.json`**：只留运行必需字段，`main` → `electron/main.mjs`，剥掉 `devDependencies`/`scripts`。
5. **生成启动器**：`Prescription Master.bat`、`自检截图.bat`、`README-使用说明.txt`（UTF-8 **带 BOM** + `chcp 65001`，保证 cmd 里中文不乱码）。
6. **打印统计**：总体积、文件数、Electron/应用代码占比、typst 体积、语言包数、耗时。
7. **自动验证**：用**产物里的** `electron.exe` 跑 `--version` 与 `--shot`，任一步失败即 `exit 2`。

---

## 5. 两个真实踩过的坑

### 5.1 ★ `ELECTRON_RUN_AS_NODE`：必须**删除**，置空无效

**症状**：窗口完全不出现，或报

```
TypeError: Cannot read properties of undefined (reading 'whenReady')
```

**原因**：该变量是 Electron 的官方开关，一旦**存在**（哪怕值为空串），`electron.exe` 就退化成纯 Node —— 不加载 Electron 模块、不创建窗口。此时 `require("electron")` 只是普通 npm 包（导出 exe 路径），`app` 为 `undefined`。

本机实测（同一个 electron.exe，仅环境变量不同）：

| `ELECTRON_RUN_AS_NODE` | `electron.exe --version` | 说明 |
| --- | --- | --- |
| **不存在**（`delete env.X`） | `v43.7.9` | ✅ 正常 |
| 存在且为 `""` | `v24.21.0` | ❌ 退化 |
| 存在且为 `"1"` | `v24.21.0` | ❌ 退化 |

> **判据很好记**：`electron.exe --version` 打印 **v43.x** 才正常，打印 **v24.x** 就是中招了。

**处理**：

- 脚本内：`delete env.ELECTRON_RUN_AS_NODE` 后再 `spawn`（不能用 `env.X = ""`）。
- `.bat`：用 cmd 的 `set ELECTRON_RUN_AS_NODE=`（cmd 里这会**真正删除**该变量）。
- **PowerShell 的坑**：`$env:X = ""` 只是置空、变量仍存在，**仍然会退化**！必须用
  `Remove-Item Env:\ELECTRON_RUN_AS_NODE`。

参考实现见 [`scripts/start.mjs`](../scripts/start.mjs)（开发模式同样做了处理）。

### 5.2 ★ 千万别删 Electron 自带的 `resources/` 目录

**症状**：产物里 `electron.exe --version` **静默失败**（`exit 1`、stdout 全空、stderr 也全空），应用起不来，**没有任何报错信息**。

**原因**：为了"瘦身"，脚本一度删掉了 `resources/default_app.asar`（Electron 的占位应用，仅 110 KB）。删掉之后 `resources/` 目录变空、继而被一并清理，Electron 找不到运行时资源目录，就静默退出。

**验证过程**（同一个 exe，只差这个目录）：

| 条件 | 结果 |
| --- | --- |
| 删掉 `resources/` | `status=1`，stdout 空 |
| 补回 `electron/dist/resources/` | `status=0`，stdout `v43.7.9` ✅ |

两次实验用的 `electron.exe` **MD5 完全一致**（`844a9a32...`）—— 佐证问题不在二进制，而在目录完整性。

**结论**：`resources/` 及其中的 `default_app.asar` **必须原样保留**。打包脚本现在会检查该目录并在缺失时告警。

---

## 6. 实测验证记录

### 6.1 打包

```powershell
PS> node scripts/pack.mjs
... （见第 1 节完整输出）
[pack] ✔ 运行时自检通过（Electron v43.7.9）
[pack] ✔ 截图已生成: ...\PrescriptionMaster\app\shot.png
```

退出码 **0**。

### 6.2 用产物真跑 `--shot`

```
electron.exe <app> --shot → exit 0  (5.3s)
stdout: SHOT_SAVED ...\PrescriptionMaster\app\shot.png
```

截图 1860×1230，界面完整（左侧表单、右侧 Typst 预览、顶部工具栏），标题栏显示 `Typst 0.15.1 (9dfd3a08) · SimSun 排版`，状态栏显示 `渲染 633 ms · 矢量 SVG · 导出为 PDF/PNG 为 300dpi`、`版式校验通过`。

### 6.3 导出功能（PDF / PNG / SVG）

```
EXPORT_SELFTEST
pdf: OK 78717 bytes -> out/selftest.pdf
png: OK 330297 bytes -> out/selftest.png
svg: OK 348581 bytes -> out/selftest.svg
```

三种格式全部成功，说明随包的 `typst.exe`（0.15.1）工作正常。

### 6.4 便携性验证（模拟目标机器）

把产物**整体复制到另一个干净的 ASCII 路径**（如 `D:\portable_test\`），并且在**带有 `ELECTRON_RUN_AS_NODE=1` 的 shell** 里通过 `.bat` 启动：

```powershell
PS> Copy-Item <产物> D:\portable_test\PrescriptionMaster -Recurse   # 87 个文件 / 431 MB
PS> cd D:\portable_test\PrescriptionMaster
PS> cmd /c Prescription Master.bat        # 该 shell 中 $env:ELECTRON_RUN_AS_NODE = 1
PS> Get-Process electron | Select Id,MainWindowTitle
   Id ProcessName MainWindowTitle
166388 electron    Prescription Master      ← 窗口真实存在
```

✅ 证明：产物自包含、可搬迁，且 `.bat` 启动器确实把 `ELECTRON_RUN_AS_NODE` 处理掉了。

### 6.5 自检批处理

```
PS> cmd /c 自检截图.bat
SHOT_SAVED ...\PrescriptionMaster\app\shot.png
exit=0
```

---

## 7. 常见问题（FAQ）

### Q1. 双击 `.bat` 黑框一闪就没 / 窗口不出现
在 cmd 里手动跑一次看报错：

```bat
cd /d <产物目录>
set ELECTRON_RUN_AS_NODE=
electron.exe app
```

最常见两个原因：
1. **`ELECTRON_RUN_AS_NODE` 没真正删除**（见 5.1；报 `whenReady` 错，或 `--version` 打印 `v24.x`）。
2. **`resources/` 目录被删**（见 5.2；`--version` 静默无输出）。

### Q2. `electron.exe --version` 没有任何输出
几乎必然是 **5.2** 的运行时目录不完整。确认产物根目录下存在 `resources/default_app.asar`。

### Q3. 报 typst 缺失 / 导出 PDF 失败
- 确认 `app/resources/typst.exe` 存在（50.1 MB）。
- 单独执行 `app\resources\typst.exe --version`，应打印 `typst 0.15.1 (9dfd3a08)`。
- 若被杀软删除，加白名单后重新打包。

### Q4. 界面中文变方块 / 字体缺失
Electron 用系统字体渲染。精简版 Windows 或缺少中文字体（SimSun / Microsoft YaHei）时可能出现方块字。处理：安装标准中文字体包。

导出 PDF 的字体由 **typst** 解析：typst 自带一批开源字体；若模板指定了系统字体而目标机器没有，PDF 会回退。建议模板只用随附字体或通用字体。

### Q5. 杀软 / SmartScreen 拦截
未签名的 `electron.exe` 常被误报（中文名 `.bat` 也容易触发脚本启发式扫描）：
- 把整个 `PrescriptionMaster` 目录加入杀软排除项。
- SmartScreen 提示 →「更多信息」→「仍要运行」。
- 正式对外分发建议用 `signtool` 对 `electron.exe` 做代码签名，或改用 Inno Setup / NSIS 打成安装包。

### Q6. 启动很慢 / 白屏
首次冷启动需解压 `.pak` 与 `icudtl.dat`，2–4 秒正常。若一直白屏，检查 `app/dist/index.html` 是否存在 —— 主进程在 `dist` 缺失时会回落到开发服务器 `http://127.0.0.1:5278/`，那在目标机器上必然打不开。

### Q7. 想让包更小
- `--no-locales`：只留 3 个语言包。
- Electron 运行时（360 MB）和 `typst.exe`（50 MB）是体积大头，不可省。
- 进一步可用 7z/LZMA 自解压包，或改用 `electron-builder` 的 NSIS 目标（需引入新依赖，本脚本刻意保持零依赖）。

### Q8. 换机器要重新打包吗？
不需要，产物自包含，**直接复制整个目录**。只有这些情况需要重打：改了 `src/` 后重新 `npm run build`、升级 Electron、改了 `electron/` 主进程、替换 `typst.exe`。

### Q9. 桌面快捷方式 / 开机自启
右键 `Prescription Master.bat` →「发送到」→「桌面快捷方式」；放进 `shell:startup` 可开机自启。图标可用 `app/resources/icon.png` 转成的 `.ico`。

---

## 8. 分发清单（Checklist）

- [ ] `npm run build` 成功，`dist/index.html` 是最新的
- [ ] `node scripts/pack.mjs` 全绿（统计正常 + `--version` 打印 v43.x + 截图验证通过，exit 0）
- [ ] 产物根目录存在 `resources/default_app.asar`
- [ ] `app/resources/typst.exe` 存在且能打印版本号
- [ ] 在目标机器完整复制目录后，双击 `Prescription Master.bat`，窗口出现
- [ ] 目标机器上试一次 PDF 导出
- [ ] 必要时为目录配置杀软白名单
