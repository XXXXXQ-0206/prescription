# Prescription Master（Prescription Studio）

一个固定窗口的 Electron 桌面程序：选医院、诊断、药品、医师等数据，**实时预览**并按医院单据的版式
生成处方，导出 **PDF / PNG（300dpi）/ Typst 源码**，也可以把整份处方存成 JSON 再载入。

排版内核是 [Typst](https://typst.app)：表单数据 → .typ 源码 → 矢量 SVG 预览 / PDF / PNG，
所以预览和导出**完全一致**，放大不糊，输出的 .typ 还能直接进版本库或用命令行再编译。

---

## 快速开始

```bash
cd studio
npm install          # 首次
npm start            # 构建前端并启动桌面程序
```

其它脚本：

| 命令 | 说明 |
| --- | --- |
| `npm start` | 构建 + 启动（推荐） |
| `npm run dev` | 连 Vite 开发服务器启动（改前端即时生效） |
| `npm run build` | 只构建渲染层到 `dist/` |
| `npm run shot` | 启动后自动截图到 `shot.png` 并退出（无人值守自检） |
| `node scripts/start.mjs --export-test` | 不开窗口，用 `out/generated.typ` 跑通三种导出 |

> 环境提示：若父进程是 Electron（例如 IDE 内启动），环境变量里可能带 `ELECTRON_RUN_AS_NODE=1`，
> 会让 `electron.exe` 退化成纯 Node。`scripts/start.mjs` 已自动清掉该变量。

---

## 模板（多医院单据适配）

顶部「单据模板」一行切换版式，切换时会自动套用该模板的示例数据与扩展字段。详见 [docs/TEMPLATES.md](docs/TEMPLATES.md)。

| 模板 | 版式 | 页面(pt) | 上限 |
| --- | --- | --- | --- |
| 北京大学第六医院 · 非医保处方 | 复刻样张：四格表格 + 纸张边缘闭合阴影框（绝对定位） | 836 × 470.5 | 8 诊断 / 5 药品 |
| 郑州市中心医院处方笺 | 二维码 + 右上角「普通处方/当日有效」方框 + Rp 两行式药品 | 419.5 × 595.3 | 12 / 20 |
| 北京大学第三医院处方（医保）门诊 | 横向：左侧条码与 ID/身份/社保号，药品为五列表格（名称规格/数量/频率/用量/给药途径） | 842 × 595.3 | 6 / 6 |
| 遵义医科大学第五附属（珠海）医院处方笺 | 条码 + 中英文院名，每味药两行（用法：剂量 途径 频次×天数） | 419.5 × 595.3 | 6 / 6 |
| 重庆市九龙坡区中医院处方笺（中药） | 中药三栏药味宫格 + 剂数煎服说明 + 药事规定页脚 | 559 × 794 | 8 / 60 |

## 性能

预览是「表单改动 → Typst 编译 → 矢量 SVG」的链路，做了四件事把延迟压到单次编译：

1. **渲染缓存**：同一份 .typ 源码只编译一次（主进程 LRU 24）。撤销、来回改同一个字段、切回来都是 0ms 命中。
2. **请求合并**：同一时刻只允许一个预览编译在跑。新请求到来时把在飞的那个直接 kill，只编译最新源码——
   连续打字不再排队，延迟恒定（实测 250–550ms，视文档复杂度）。
3. **启动预热**：窗口创建前先编译一次最小文档（日志 `TYPST_PREWARM ok`），把 Typst 的字体扫描与内部缓存提前做掉。
   首屏渲染从约 1.9s（冷启动）降到约 0.3s。
4. **过期响应丢弃**：渲染层给每次请求编号，回来晚了的旧结果不会覆盖新画面。

输入防抖 200ms；状态栏实时显示 `渲染 n ms / 缓存命中`，可直接观察。

## 界面

- **左栏（表单）**：单据与医院 / 患者信息 / 诊断 / 药品 / 医师与版式，分组可折叠，改动即时生效。
- **右栏（预览）**：矢量实时预览，可适应窗口或 20%–250% 缩放，底部给出渲染耗时与版式校验结果。
- **顶栏**：载入 / 保存（JSON）、导出 Typst / PNG / PDF。
- 快捷键：`Ctrl+S` 保存数据、`Ctrl+E` 导出 PDF、`Ctrl+P` 导出 PNG。

### 可选项与预设

| 类别 | 内容 |
| --- | --- |
| 医院 | 16 家（北大六院、安定、回龙观、上海精卫……），可直接输入其它医院 |
| 科室 | 12 个（精神科、心理科、睡眠医学科、儿童青少年心理科……） |
| 诊断 | 6 大类 40+ 条（心境障碍 / 焦虑强迫 / 精神病性 / 睡眠 / 儿童青少年 / 应激与其他），支持自由输入 |
| 药品 | 28 种精神科常用药，含厂牌、规格、单价、用法；选中即自动带出规格价格 |
| 常用方案 | 8 组「诊断 + 用药」一键带入 |
| 医师 | 8 位，可自由输入 |
| 单据类型 | 非医保 / 医保 / 普通 / 急诊 / 儿科 / 麻醉药品 / 一类、二类精神药品处方 |
| 费用类别 | ①(甲)无自付 ②(乙)有自付 ③(丙)全自付（可加粗选中项） |
| 版式开关 | 条码、卡号数字、序号、印刷日期、费用类别行、提示语、签章、数量金额、用法用量 |

条码按病历号自动生成 **Code 128**（偶数位纯数字自动用 Code C，条更宽更好扫）。

---

## 版式说明

- 页面固定 **836pt × 470.5pt**（= 样张 1672×941px，1 像素 = 0.5pt）。
- 四边有闭合的纸张边缘阴影细线框（实测变暗比例生成的矢量渐变，不是扫描噪点）。
- 表格线沿用原始单据实测位置；诊断最多 8 行、药品最多 5 条，超限会在预览下方红字提示且不打印超出部分。
- 字体：中文 **SimSun（宋体）**、`Rp` 与合计金额 **Arial Bold**、条码数字 **Courier New**，均为 Windows 自带。

---

## 目录结构

```
studio/
├── electron/
│   ├── main.mjs        主进程：窗口、IPC、Typst 编译与导出、JSON 存取
│   └── preload.cjs     contextBridge 暴露 window.presc
├── src/
│   ├── App.tsx         外壳：顶栏 + 表单 + 预览，状态与导出编排
│   ├── components/     FormPanel / PreviewPanel / bits（分组、字段、开关）
│   ├── templates/     多模板系统：types/kit/generic + bj6|zz|bj3|zy|cq + index 注册表
│   │   └── 详见 docs/TEMPLATES.md
│   ├── data/presets.ts 医院、科室、诊断、药品、医师、方案、提示语等预设库
│   ├── lib/
│   │   ├── doc.ts          数据模型、默认值、金额计算、版式校验
│   │   ├── barcode.ts      Code 128 编码（无依赖）
│   │   └── typst-doc.ts    表单 → Typst 源码（版式锚点全部来自样张实测）
│   ├── styles/         tokens/theme/base/app（复用 codex-desktop-src 设计系统）+ studio.css
│   └── ui/             button/input/select/switch/scroll-area…（同上，15 个基础件）
├── resources/
│   ├── typst.exe       Typst 0.15 排版内核（随程序分发，离线可用）
│   └── icon.png
└── scripts/            start.mjs（启动）、test-gen.ts（离线生成 .typ 自检）
```

### 前端复用

界面直接复用了 `codex-desktop-src`（本地参考工程，未随仓库分发）的设计系统与基础件：

- `src/styles/{tokens,theme,base,app}.css` 原样搬运（design token、明暗主题、字号阶、滚动条、焦点环）；
- `src/ui/*` 的 15 个组件（button / input / label / select / switch / separator / scroll-area /
  textarea / checkbox / dialog / popover / tooltip / kbd / skeleton / radio-group）及其 `ui.css`；
- `src/lib/utils.ts` 的 `cn()`；依赖栈同为 React 19 + Tailwind v4 + Vite 8 + radix-ui。

---

## 自检

```bash
node scripts/start.mjs --shot                 # 截图，检查界面
node scripts/start.mjs --export-test          # 导出 PDF/PNG/SVG 到 out/
cd .. && node scripts/test-gen.ts 等          # 见 studio/scripts/test-gen.ts
```

`scripts/test-gen.ts` 会把默认处方渲染成 `out/generated.typ`，用同一版式与样张对比：
与逐像素复刻版的差异 MAE ≈ 2.4/255（差异主要来自新生成的 Code 128 条码与药品序号）。
