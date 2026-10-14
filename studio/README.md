# Prescription Master（studio/）

应用本体：固定窗口的 Electron 桌面程序 —— 选医院、诊断、药品、医师等数据，**实时预览**并按医院单据版式
生成处方，导出 **PDF / PNG（300dpi）/ Typst 源码**，也可把整份处方存成 JSON 再载入。

排版内核是 [Typst](https://typst.app)：表单数据 → .typ 源码 → 矢量 SVG 预览 / PDF / PNG，
所以预览与导出**完全一致**，放大不糊，输出的 .typ 还能直接进版本库或用命令行再编译。

> 面向使用者请读根目录的 [`../README.md`](../README.md)。
> 深入文档：[`../docs/zh-CN/TEMPLATES.md`](../docs/zh-CN/TEMPLATES.md)（模板系统）、
> [`../docs/zh-CN/PRESETS.md`](../docs/zh-CN/PRESETS.md)（预设库，改数据看这份）、
> [`../docs/zh-CN/PACKAGING.md`](../docs/zh-CN/PACKAGING.md)（打包与分发）。

---

## 快速开始

```bash
cd studio
npm install
npm run fetch:typst   # 下载 Typst 0.15.1 → resources/typst.exe（约 50MB，不入库）
npm run bundle        # scripts/*.ts → scripts/*.mjs（构建产物，不入库）
npm start             # 构建渲染层并启动桌面程序
```

| 命令 | 说明 |
| --- | --- |
| `npm start` | 构建 + 启动（推荐） |
| `npm run dev` | 连 Vite 开发服务器启动（改前端即时生效） |
| `npm run build` | 只构建渲染层到 `dist/` |
| `npm run bundle` | 打包开发入口：`-- --force` 强制、`-- <name>` 单个、`-- --check` 只校验 |
| `npm run fetch:typst` | 获取/更新 Typst 内核：`-- --force` 重下 |
| `npm run shot` | 启动后自动截图到 `shot.png` 并退出（无人值守自检） |
| `npm test` | 先 bundle，再跑完整本地自检 |
| `node scripts/start.mjs --export-test` | 不开窗口，用 `out/generated.typ` 跑通三种导出 |
| `node scripts/render-all.mjs` | 按各模板默认数据渲染 `out/tpl-<id>.png` |
| `node scripts/check-presets.mjs` | 断言预设库一致性 |
| `npm run pack` | 打包成自包含目录 `release/PrescriptionMaster/` |

> 环境提示：若父进程是 Electron（例如在 IDE 内启动），环境变量里可能带 `ELECTRON_RUN_AS_NODE=1`，
> 会让 `electron.exe` 退化成纯 Node。`scripts/start.mjs` 与 `scripts/pack.mjs` 已自动清掉该变量。

CI（[`.github/workflows/ci.yml`](../.github/workflows/ci.yml)）在 windows-latest + Node 22 上执行：
`npm ci` → `tsc --noEmit` → `npm run bundle` → `npm run build` → `fetch-typst` → `render-all` →
`test-variants` → `check-presets` / `check-odrisk` / `check-tcm`。

---

## 目录

```
studio/
├── electron/
│   ├── main.mjs        主进程：窗口、托盘、IPC、Typst 编译与导出、JSON 存取
│   └── preload.cjs     contextBridge 暴露 window.presc
├── src/
│   ├── App.tsx         外壳：顶栏 + 表单 + 预览，状态与导出编排
│   ├── components/     FormPanel / PreviewPanel / Picker / bits
│   ├── templates/      多模板系统：types/kit/generic + bj6|zz|bj3|zy|cq + index 注册表
│   ├── data/           presets.ts（医院/科室/诊断/药品/方案…）、tcm.ts（中药库）
│   ├── lib/            doc.ts（模型/默认值/校验）、typst-doc.ts（表单→Typst）、barcode.ts、qr.ts
│   ├── styles/         design token、主题、基线与应用层 CSS
│   └── ui/             15 个基础件（button / input / select / switch / dialog / tooltip…）
├── resources/          icon.png / icon.ico（typst.exe 由 npm run fetch:typst 获取，不入库）
└── scripts/            start / pack / bundle / fetch-typst / render-all / test-* / check-*
```

`scripts/` 下与某个 `.ts` 同名的 `.mjs` 是 **rolldown 构建产物**（由 `npm run bundle` 生成），**不入库**；
其余 `.mjs`（`start` / `pack` / `bundle` / `fetch-typst` / `check-*` / `gen-presets-doc`）是手写工具，必须入库。

新增模板的完整步骤见 [`../docs/zh-CN/TEMPLATES.md`](../docs/zh-CN/TEMPLATES.md)；预设数据的中文清单由
`node scripts/gen-presets-doc.mjs` 从 `src/data/presets.ts` 生成到 `../docs/zh-CN/PRESETS.md`，不要手改。

> 界面的设计系统与基础件复用自本地参考工程 codex-desktop-src（该工程未随仓库分发）。
