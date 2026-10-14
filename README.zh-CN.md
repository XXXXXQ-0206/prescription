# Prescription Master（处方单据生成器）

[English](README.md) | 中文

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Electron](https://img.shields.io/badge/Electron-43-47848F.svg)](https://www.electronjs.org/)
[![React](https://img.shields.io/badge/React-19-61DAFB.svg)](https://react.dev/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.9-3178C6.svg)](https://www.typescriptlang.org/)
[![Typst](https://img.shields.io/badge/Typst-0.15-239DAD.svg)](https://typst.app/)
[![CI](https://github.com/XXXXXQ-0206/prescription-master/actions/workflows/ci.yml/badge.svg)](https://github.com/XXXXXQ-0206/prescription-master/actions/workflows/ci.yml)
[![CodeQL](https://github.com/XXXXXQ-0206/prescription-master/actions/workflows/codeql.yml/badge.svg)](https://github.com/XXXXXQ-0206/prescription-master/actions/workflows/codeql.yml)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](CONTRIBUTING.md)

> 一个桌面程序：填表生成医院处方单据，用 **Typst** 排版，导出 **PDF / PNG（300dpi）/ Typst 源码**，
> 预览与导出完全一致。

---

## 项目概览

Prescription Master 是一个 Electron 桌面程序，用来生成与多家医院纸质单据版式一致的处方笺。用户在表单里
填写医院、患者、诊断、药品与版式选项，程序把数据转换成 Typst 文档，调用随程序分发的 Typst 内核编译，
输出矢量 SVG 实时预览，并可导出 PDF / PNG。

仓库里有**两件成果**：

| # | 成果 | 位置 | 说明 |
| - | --- | --- | --- |
| 1 | 扫描件的 Typst 复刻 | [`prescription.typ`](prescription.typ)、[`prescription_scan_like.typ`](prescription_scan_like.typ) | 把扫描件逐像素测量后重排成矢量 Typst（1 原图像素 = 0.5pt） |
| 2 | **Prescription Master** 桌面程序 | [`studio/`](studio/) | 多模板处方生成器：实时预览 + PDF/PNG/Typst 导出 |

原始扫描件以及由它派生的全部开发产物**刻意不随仓库分发**（见[隐私与数据](#隐私与数据)）。源码中出现的
所有示例数据均为虚构演示值。

---

## 功能

### 多模板版式引擎

[`studio/src/templates/`](studio/src/templates/) 里实现了 5 套医院版式，每套都有自己的几何参数、专属扩展字段、
分区开关与内容上限。切换模板时会自动套用该模板的示例数据与扩展字段。

| 模板 ID | 版式 | 页面(pt) | 上限（诊断 / 药品） |
| ------- | ---- | -------- | ------------------- |
| `bj6` | 北京大学第六医院 · 非医保处方：四格表格 + 纸张边缘闭合阴影框（绝对定位） | 836 × 470.5 | 8 / 5 |
| `zz` | 郑州市中心医院处方笺：二维码 + 「普通处方/当日有效」方框 + Rp 两行式药品 | 419.5 × 595.3 | 12 / 20 |
| `bj3` | 北京大学第三医院处方（医保）门诊：横向、条码 + ID/身份/社保号、药品五列表格 | 842 × 595.3 | 6 / 6 |
| `zy` | 遵义医科大学第五附属（珠海）医院处方笺：条码 + 中英文院名、每味药两行 | 419.5 × 595.3 | 6 / 6 |
| `cq` | 重庆市九龙坡区中医院处方笺：中药三栏药味宫格 + 剂数煎服说明 + 药事规定页脚 | 559 × 794 | 8 / 60 |

### 预设库

全部预设都可自由改写——它们只是起点，不是受控词表。

| 预设 | 内容 |
| ---- | ---- |
| 医院 | 40 家 |
| 科室 | 22 个 |
| 诊断 | 11 大类 105 条 |
| 药品 | 77 种，含厂牌、规格、单价、用法，以及**过量（OD）风险提示** |
| 常用方案 | 68 组「诊断 + 用药」 |
| 用法 | 25 种 |
| 提示语 | 7 组 |
| 医师 | 8 位（可自由输入替换） |

### 渲染与导出

- **表单数据 → Typst 源码 → 矢量 SVG 预览 / PDF / PNG**，预览与导出完全一致。
- PNG 导出固定 **300dpi**；PDF 为矢量；生成的 `.typ` 可直接进版本库或用命令行再编译。
- 预览是真正的 SVG：20%–250% 缩放，任意倍率不糊。
- 处方数据可存成 / 载入 JSON；下次启动自动恢复上次编辑的内容。
- 条码按病历号生成 **Code 128**（偶数位纯数字自动用 Code C，条更宽更好扫），二维码为自研编码器，
  运行期不依赖任何条码/二维码第三方库。

### 桌面集成

- 固定 1240 × 820 窗口，原生标题栏叠加（titleBarOverlay）。
- **系统托盘**：点关闭只收进托盘；托盘菜单可显示/隐藏窗口与真正退出。
- **单实例**：再次启动会唤起已有窗口，而不是开出第二个程序。
- PDF / PNG / Typst / JSON 均走系统保存对话框，导出后可一键定位文件。
- 渲染层加固：`contextIsolation: true`、`nodeIntegration: false`、仅通过 preload 的 `contextBridge` 通信，
  并在 [`studio/index.html`](studio/index.html) 里下发严格的 Content-Security-Policy。
- 快捷键：`Ctrl+S` 保存数据、`Ctrl+E` 导出 PDF、`Ctrl+P` 导出 PNG。

### 性能

1. **渲染缓存** —— 同一份 Typst 源码只编译一次（LRU 24 条）；撤销、来回改同一个字段都是零开销。
2. **请求合并** —— 同一时刻只允许一个预览编译；新请求到来时把在飞的那个 kill 掉，连续打字不排队
   （实测单次编译 250–550ms）。
3. **启动预热** —— 窗口创建前先编译一次最小文档（日志 `TYPST_PREWARM ok`），首屏从约 1.9s 降到约 0.3s。
4. **过期响应丢弃** —— 每次请求编号，回来晚的旧结果不会覆盖新画面。

### 安全与校验辅助

- 预设库药品带**过量（OD）风险提示**，仅在界面显示；模板不读取该字段，**绝不会打印到处方上**。
- 版式校验：诊断超出模板上限、药品超出上限、未填患者姓名、姓名/规格过长等，会在预览下方分级提示
  （红字 = 超限不打印，橙字 = 提醒）。
- 金额按「单价 × 数量」实时汇总。

---

## 截图

![Prescription Master 主界面](docs/images/screenshot-app.png)

*左栏表单、右栏矢量实时预览，顶栏是导出按钮。*

| 模板 `bj6`（复刻样张） | 模板 `bj3`（医保、横向） | 模板 `cq`（中药） |
| --- | --- | --- |
| ![bj6](docs/images/template-bj6.png) | ![bj3](docs/images/template-bj3.png) | ![cq](docs/images/template-cq.png) |

> 所有截图均使用内置的虚构演示数据生成。

---

## 演示数据

本仓库发布的一切内容都是**虚构的演示数据**：

- **全部患者与医师姓名、病历号、条码号、处方号、证件号都是虚构的**。它们与版式实测所用的真实单据保持
  相同的格式与长度，以便列宽对齐，但不属于任何人。
- **医院名称与单据上的公开总机／临床药师咨询电话仅作示意**，用于说明某个模板复刻的是哪一张纸质单据；
  不代表与上述机构存在任何隶属、背书或合作关系。
- **示例处方只用于演示排版引擎**：截图、`prescription.typ`、`prescription_scan_like.typ`、各模板的
  示例数据，以及预设库（药品名、规格、价格、用法用量、过量风险提示）都是演示值，可能不完整或已过期，
  **绝不可作为临床依据**——见[免责声明](#免责声明)。

---

## 安装

### 环境要求

| 依赖 | 说明 |
| ---- | ---- |
| **Windows 10/11 (x64)** | 版式依赖 Windows 自带字体：**SimSun（宋体）**、Arial、Courier New |
| **Node.js ≥ 20** | 开发使用 Node 22 |
| **Typst 0.15.x** | 本仓库不随附（见下） |

### 1. 克隆

```bash
git clone https://github.com/XXXXXQ-0206/prescription-master.git
cd prescription-master
```

### 2. 获取 Typst 内核

```bash
cd studio
npm run fetch:typst      # 下载 Typst 0.15.1 并解出 resources/typst.exe
```

手动方案与代理说明见[获取 Typst 内核](#获取-typst-内核)。

### 3. 安装依赖并启动

```bash
cd studio
npm install
npm start          # 构建渲染层并启动桌面程序
```

---

## 获取 Typst 内核

模板由 [Typst](https://typst.app/) 命令行内核编译，而该内核**不随仓库分发**（50MB 第三方二进制，已被
Git 忽略）。一条命令即可取到固定版本：

```bash
cd studio
npm run fetch:typst              # Typst 0.15.1 → studio/resources/typst.exe
npm run fetch:typst -- --force   # 即使本地已有也重新下载
npm run fetch:typst -- --proxy http://127.0.0.1:7897   # 显式指定代理
npm run fetch:typst -- --no-proxy                      # 忽略环境变量里的代理
```

脚本是幂等的：若 `resources/typst.exe` 已能输出 `typst 0.15.1 (…)` 就直接退出，不联网。它会下载官方
[Typst 0.15.1 Release](https://github.com/typst/typst/releases/tag/v0.15.1) 的
`typst-x86_64-pc-windows-msvc.zip` 资源，**按脚本里固化的字节数与 SHA-256 校验**（官方未提供
`.sha256` 文件），用纯 JavaScript 解出 `typst.exe`，最后再跑一次 `typst --version` 复核。代理优先级为
`--proxy <url>` → `HTTPS_PROXY` / `HTTP_PROXY`（含 `NO_PROXY` 例外），`--no-proxy` 强制直连；
`TYPST_URL` 可指向镜像或内网副本。

没有网络时二选一：

- 从 [Typst releases](https://github.com/typst/typst/releases) 下载 `typst-x86_64-pc-windows-msvc.zip`，
  把里面的 `typst.exe` 复制到 `studio/resources/typst.exe`；或
- 下载[本项目 v1.0.0 Release](https://github.com/XXXXXQ-0206/prescription-master/releases/tag/v1.0.0) 附件中的
  免解压 `typst-0.15.1-windows-x64.exe`，另存为 `studio/resources/typst.exe`。

用 `studio/resources/typst.exe --version` 确认输出 `typst 0.15.1`。开发态程序读 `resources/typst.exe`；
打包后读应用资源目录下的 `typst.exe`（`extraResources`）。

---

## 使用

1. **顶栏选模板**，切换时会载入该模板的示例数据与专属字段。
2. **填左栏表单** —— 单据与医院、患者、诊断、药品、医师与版式；分组可折叠，改动即时生效（200ms 防抖）。
3. **看右栏预览** —— 工具栏缩放，状态栏给出渲染耗时、缓存命中、Typst 版本与版式校验结果。
4. **导出** —— 顶栏 `Typst` / `PNG` / `PDF`（或 `Ctrl+E` / `Ctrl+P`）。
5. **存/载 JSON**，或直接关窗口：草稿会在下次启动时恢复。

### 命令行入口

| 命令（在 `studio/` 下执行） | 用途 |
| --------------------------- | ---- |
| `npm start` | 构建渲染层并启动桌面程序 |
| `npm run dev` | 连 Vite 开发服务器启动（改前端即时生效） |
| `npm run build` | 只构建渲染层到 `dist/` |
| `npm run shot` | 启动后截图到 `shot.png` 并退出（无人值守自检） |
| `node scripts/start.mjs --export-test` | 不开窗口，用 `out/generated.typ` 跑通 PDF/PNG/SVG 导出 |
| `node scripts/render-all.mjs` | 按各模板默认数据渲染 `out/tpl-<id>.png` |
| `node scripts/test-variants.mjs` | 编译全部版式变体 |
| `node scripts/check-presets.mjs` | 断言预设库一致性 |
| `node scripts/check-odrisk.mjs` | 断言过量风险表（覆盖、适用范围、重复项） |
| `node scripts/check-tcm.mjs` | 断言中药库 |
| `npm run bundle` | 把 `scripts/*.ts` 全部打成 `scripts/<name>.mjs` |
| `npm run fetch:typst` | 下载固定版本的 Typst 内核到 `resources/` |
| `npm test` | 先 bundle，再跑完整本地自检（变体、极值、生成器与各项 check） |

> **说明**：与某个 `.ts` 同名的 `scripts/<name>.mjs` 是**构建产物**（用 [rolldown](https://rolldown.rs/)
> 打包），不是源码，不入库。clone 之后、以及每次改完 `scripts/*.ts`，先跑一次 `npm run bundle` 再执行这些
> 入口；`npm run bundle -- <name>` 只重打一个，`npm run bundle -- --check` 只校验产物是否存在且最新。

---

## 构建说明

```bash
cd studio

# 0. 获取 Typst 内核（每个 clone 一次）
npm run fetch:typst

# 1. 类型检查（不产出文件）
npx tsc --noEmit

# 2. 打包开发入口（scripts/*.ts → scripts/*.mjs）
npm run bundle

# 3. 构建渲染层
npm run build                 # → studio/dist

# 4. 打包桌面程序
npm run pack                  # → studio/release/PrescriptionMaster/
```

`npm run pack` 调用 `scripts/pack.mjs`：零新增依赖，把 Electron 运行时与应用文件复制成一个
**自包含、可整目录搬走**的 `studio/release/PrescriptionMaster/`（已被 Git 忽略），生成启动器并做冒烟自检。
需要 NSIS 安装包 / 便携版 exe 时，再跑 `npx electron-builder --win`：它读取 `studio/package.json` 的
`build` 段，并通过 `extraResources` 带上 `resources/typst.exe`。两条路径都要求
`studio/resources/typst.exe` 存在。

打包细节、便携性验证与排错笔记见 [`docs/zh-CN/PACKAGING.md`](docs/zh-CN/PACKAGING.md)；模板开发见
[`docs/zh-CN/TEMPLATES.md`](docs/zh-CN/TEMPLATES.md)，预设库见
[`docs/zh-CN/PRESETS.md`](docs/zh-CN/PRESETS.md)。

以上步骤与 CI 在每次 push 到 `main` 及每个 PR 上执行的一致——见
[`.github/workflows/ci.yml`](.github/workflows/ci.yml)。

---

## 目录结构

```
prescription-master/
├── README.md                     # 英文说明
├── README.zh-CN.md               # 中文说明（本文件）
├── LICENSE                       # MIT
├── CONTRIBUTING.md  SECURITY.md  CODE_OF_CONDUCT.md  CHANGELOG.md
├── .github/                      # CI + CodeQL 工作流、Dependabot、issue 与 PR 模板
├── docs/
│   ├── PACKAGING.md              # 英文：打包与分发
│   ├── TEMPLATES.md              # 英文：模板系统
│   ├── PRESETS.md                # 英文：预设库
│   ├── zh-CN/                    # 上述三份文档的中文原文
│   └── images/                   # README 使用的截图
├── prescription.typ              # 复刻版 Typst（干净电子版）
├── prescription_scan_like.typ    # 复刻版 Typst（贴近扫描件：纸底噪点、印刷增益）
└── studio/
    ├── electron/
    │   ├── main.mjs              # 主进程：窗口、托盘、IPC、Typst 编译与导出、JSON 存取
    │   └── preload.cjs           # contextBridge 暴露 window.presc
    ├── src/
    │   ├── App.tsx               # 外壳：顶栏 + 表单 + 预览，状态与导出编排
    │   ├── components/           # FormPanel / PreviewPanel / Picker / bits
    │   ├── templates/            # 模板系统：types、kit、generic + bj6 | zz | bj3 | zy | cq + 注册表
    │   ├── data/                 # presets.ts（医院/诊断/药品/方案…）、tcm.ts（中药库）
    │   ├── lib/                  # doc.ts（数据模型/默认值/校验）、barcode.ts、qr.ts
    │   ├── styles/               # design token、主题、基线与应用层 CSS
    │   └── ui/                   # 15 个基础件（button、input、select、switch、dialog、tooltip…）
    ├── resources/                # icon.png / icon.ico（typst.exe 由脚本获取，不入库）
    └── scripts/                  # start / pack / fetch-typst / render-all / test-* / check-* 开发工具
                                  # （与 .ts 同名的 .mjs 是 rolldown 构建产物）
```

`refs/`、`origin_pic.png`、`analysis/`、`verification/**/*.png` 只存在于本地工作副本，已被 Git 忽略。

### 隐私与数据

版式测量自含真实患者姓名与病历号的处方扫描件。这些扫描件、由它们裁切出的图片，以及引用其绝对路径的工具
**都不进版本控制**。源码里出现的每一个示例值（患者姓名、病历号、条码号、处方号、医师姓名）都已替换成
**等长同格式的虚构演示数据**：版式不变，标识不再真实。`analysis/` 与 `verification/**/*.png` 是仅本地保留的
开发证据。另见[演示数据](#演示数据)与[安全与隐私](#安全与隐私)。

---

## 安全与隐私

- **程序不联网。** 没有更新检查、没有遥测、没有统计、没有崩溃上报；整个项目里唯一的外连是面向开发者的
  `npm run fetch:typst` 下载，程序本身始终离线运行内置的 Typst 内核。
- **不上传任何数据。** 处方数据不离开本机：草稿存在渲染层的 `localStorage`，只有在你导出 PDF / PNG /
  Typst、保存 JSON，或在系统保存对话框里确认时才会写盘。
- **渲染层是沙箱化的**：`contextIsolation: true`、`nodeIntegration: false`、只通过 `contextBridge`
  暴露接口，并启用严格的 Content-Security-Policy——见 [`studio/index.html`](studio/index.html) 与
  [`studio/electron/preload.cjs`](studio/electron/preload.cjs)。
- **患者数据不进仓库。** 扫描件、裁切图、渲染结果与本机绝对路径都由 `.gitignore` 排除，入库的示例值全部
  虚构——见[演示数据](#演示数据)。

漏洞上报请按 [`SECURITY.md`](SECURITY.md) 私下进行，**不要**开公开 Issue。

---

## 路线图

- [x] 5 套医院模板，各自的扩展字段与上限
- [x] 基于 Typst 的矢量预览与 PDF / PNG / Typst 导出
- [x] 托盘、单实例、JSON 持久化、OD 风险提示
- [ ] 模板插件 API + 模板脚手架命令
- [ ] 条码/二维码编码器单元测试并接入 CI
- [ ] 界面国际化（在中文之外增加英文 UI）
- [ ] 处方归档（历史、检索、重打）与批量导出
- [ ] 在 OD 风险表之上增加可选的药物相互作用检查
- [ ] macOS / Linux 构建与验证（需要 SimSun 的字体替代方案）

---

## 贡献

欢迎贡献——提 Issue、修模板、补文档、加翻译都算。请先阅读 [`CONTRIBUTING.md`](CONTRIBUTING.md)：
里面写了分支与 PR 流程、Conventional Commits 规范、代码风格，以及必须通过的自检命令。

参与本项目即表示你同意 [行为准则](CODE_OF_CONDUCT.md)。安全问题请按 [`SECURITY.md`](SECURITY.md) 私下上报，
**不要**开公开 Issue。

---

## 许可证

以 [MIT 许可证](LICENSE) 发布。© 2026 XXXXXQ-0206。

---

## 常见问题

**这是医疗器械吗？**
不是。它只是一个单据生成器。请见[免责声明](#免责声明)。

**为什么仓库里没有 `typst.exe`？**
它是 50MB 的第三方二进制，本项目不再分发。跑一次 `npm run fetch:typst` 即可
（见[获取 Typst 内核](#获取-typst-内核)），它会下载固定版本到 `studio/resources/typst.exe`。

**预览或导出报 typst 错误怎么办？**
先确认 `studio/resources/typst.exe` 存在且 `typst --version` 能跑通；打包版要求该二进制位于应用资源目录下。

**能在 macOS / Linux 上用吗？**
Electron 外壳本身跨平台，但版式是按 Windows 字体（SimSun、Arial、Courier New）实测的，缺字体会导致版式偏移。
字体替代方案列在路线图里。

**扫描件在哪里？**
刻意没有放进仓库——它们含真实患者信息。仓库里只发布带虚构示例数据的矢量复刻
（`prescription.typ`、`prescription_scan_like.typ`）。

**怎么加一家新医院？**
读 [`docs/zh-CN/TEMPLATES.md`](docs/zh-CN/TEMPLATES.md)：在 `studio/src/templates/` 下新建模块，导出 `Template`
对象（`id`、`name`、`page`、`limits`、`sections`、`extraKeys`、`defaults`、`build`），并在
`studio/src/templates/index.ts` 注册；然后用 `node scripts/render-all.mjs <id>` 检查版面。

**药品价格真实吗？**
是采集示例数据时记下的演示值，可能已经过期；金额字段可手改，本程序也不会用它做任何结算。

---

## 致谢

- [Typst](https://typst.app/) —— 让矢量级精确输出成为可能的排版内核。
- [Electron](https://www.electronjs.org/)、[React](https://react.dev/)、[Vite](https://vite.dev/)、
  [TypeScript](https://www.typescriptlang.org/)、[Tailwind CSS](https://tailwindcss.com/)。
- [Radix UI](https://www.radix-ui.com/)、[lucide-react](https://lucide.dev/)、[sonner](https://sonner.emilkowal.ski/)。
- 各模板版式参照对应医院公开可见的纸质单据形式实现；本仓库中的医院名、医师名与全部患者标识均为虚构演示数据。

---

## 免责声明

**本软件按「原样」（AS IS）提供，不附带任何形式的担保。** 在适用法律允许的最大范围内：

- 本软件**不提供任何明示或暗示的担保**，包括但不限于对适销性、特定用途适用性、准确性与不侵权的担保。
- 作者与贡献者**不承担任何责任**：因使用或无法使用本软件而产生的任何直接、间接、附带、特殊、后果性或
  惩罚性损害，以及数据、收入、利润或商誉损失，作者与贡献者均不负责。
- **使用风险由使用者自行承担。** 在把任何输出用于归档、提交或交付患者之前，必须由使用者自行核验。
- **不得将本软件用于任何违法用途。** 制作伪造、变造或具有误导性的医疗文书，或冒用医疗机构、医务人员
  身份，均属违法，严格禁止。使用者必须遵守其所在司法辖区的全部适用法律与法规。
- **本软件不是医疗器械。** 它未经任何监管机构（如 NMPA、FDA、CE）审评、认证或批准，不提供任何医疗建议、
  诊断或治疗推荐。
- **处方内容与用药安全由使用者自行负责。** 内置预设库、药品信息、用法用量建议与过量风险提示均为演示数据，
  仅供参考，可能不完整、过期或有误，绝不可作为临床依据。开具处方的执业医务人员始终对其开出的每一张处方负责。
