# Template System (multi-hospital document layouts)

> Chinese version / 中文版: [docs/zh-CN/TEMPLATES.md](zh-CN/TEMPLATES.md)

Every prescription sheet in Prescription Master is produced by a **template**: one TypeScript module that
bundles a *layout declaration*, a *form-field requirement*, and a *Typst builder*.

| Part | Declared by | Purpose |
| ---- | ----------- | ------- |
| Layout | `page`, `sections`, `limits` | Paper size in points, which form blocks exist, content caps |
| Form fields | `extraKeys` | Which extended (`extra`) header/footer fields this sheet needs, and their labels |
| Builder | `build(doc)` | Pure function returning the Typst source for one `PrescriptionDoc` |

The template selector in the title bar switches layouts; the current page size is shown next to it as
`<width>×<height>pt`. Switching keeps the main data (hospital, patient, diagnoses, drugs) and swaps only the
template-specific extended fields — see [§1.2](#12-how-switching-works).

All UI strings, hospital names, drug names, diagnoses, doctor names and instruction text are **Chinese**, and
that is intentional: the application targets Chinese hospitals. Do not translate or transliterate those
values in new templates ([§7.2](#72-chinese-domain-data-stays-chinese)).

---

## 1. Built-in templates

Five layouts ship in the repository, defined under [`studio/src/templates/`](../studio/src/templates/).

| id | Template name (shown in the UI, Chinese) | Group | Page (pt) | Declared limits (diagnoses / drugs) |
| -- | --------------------------------------- | ----- | --------- | ----------------------------------- |
| `bj6` | 北京大学第六医院 · 非医保处方 | 复刻样张 | 836 × 470.5 | 8 / 5 |
| `zz` | 郑州市中心医院处方笺 | 门诊电子处方 | 419.5 × 595.3 | 12 / 20 |
| `bj3` | 北京大学第三医院处方（医保）门诊 | 门诊电子处方 | 842 × 595.3 | 6 / 6 |
| `zy` | 遵义医科大学第五附属（珠海）医院处方笺 | 门诊电子处方 | 419.5 × 595.3 | 6 / 6 |
| `cq` | 重庆市九龙坡区中医院处方笺（中药） | 中药处方 | 559 × 794 | 8 / 60 |

Layout characteristics:

- **`bj6`** — pixel-level replica of a scanned sheet: four-cell table rules plus a closed paper-edge shadow
  frame, every glyph pinned to a measured coordinate. A "扫码支付" QR code is a deliberate addition that is not
  on the original scan. Source: [`bj6.ts`](../studio/src/templates/bj6.ts) (metadata) and
  [`bj6-impl.ts`](../studio/src/templates/bj6-impl.ts) (geometry + builder).
- **`zz`** — portrait outpatient sheet: QR code on the left, a "普通处方 / 处方当日有效" box in the top-right
  corner, a three-row header (费别 / 姓名 / 科别), a heavy rule under the diagnosis line, two-line Rp drug rows,
  and a footer with 药费 / 医师签名 / 页码 / 打印时间.
- **`bj3`** — landscape (insurance) outpatient sheet: barcode + ID号/病案号, 姓名/身份/社保号,
  单位/性别/年龄/定点编码, 就诊科室/就诊次/就诊日期, diagnosis, then a five-column drug table
  (药品名称/规格 | 数量 | 频率 | 用量 | 给药途径) with two lines per drug.
- **`zy`** — portrait sheet: barcode + 病历号 top-left, bilingual hospital name with an emblem, a plain
  top-right box, two lines per drug (用法 = dose / route / frequency × days), and a footer with pickup
  instructions and the pharmacist signature.
- **`cq`** — TCM sheet: QR code and 发药药房 top-left, a three-column herb grid (name + grams) under `Rx`,
  a dosage/decoction note, 嘱托, drug amount, and a pharmacy-regulation footer.

Rendered previews of the published sheets: [bj6](images/template-bj6.png),
[bj3](images/template-bj3.png), [cq](images/template-cq.png).

### 1.1 Section flags

`sections` controls which blocks the form panel renders ([`FormPanel.tsx`](../studio/src/components/FormPanel.tsx)
reads `tpl.sections` and `tpl.limits`).

| Flag | Form content | bj6 | zz | bj3 | zy | cq |
| ---- | ------------ | --- | -- | --- | -- | -- |
| `patient` | 姓名 / 性别 / 年龄 | ✓ | ✓ | ✓ | ✓ | ✓ |
| `identity` | 科别, 卡号/病历号, 序号 | ✓ | ✓ | ✓ | ✓ | ✓ |
| `visit` | 就诊科室, 就诊次, 日期, 身份, 社保号, 单位, 电话, 体重 | – | ✓ | ✓ | ✓ | ✓ |
| `diagnosis` | 诊断 list | ✓ | ✓ | ✓ | ✓ | ✓ |
| `drugs` | Base drug columns: 名称 / 厂牌 / 规格 / 单价 / 数量 / 用法 | ✓ | ✓ | ✓ | ✓ | ✓ |
| `drugTable` | Extra columns: 单位, 频率, 用量, 给药途径, 天数, 备注 | – | ✓ | ✓ | ✓ | ✓ |
| `tcm` | TCM dose column (grams per herb, multi-column grid) | – | – | – | – | ✓ |
| `footer` | Reserved — declared by every built-in template, not read by the current UI | ✓ | ✓ | ✓ | ✓ | ✓ |

`NO_SECTIONS` in [`types.ts`](../studio/src/templates/types.ts) is an all-false starting point.

### 1.2 How switching works

Implemented by `switchTemplate` in [`App.tsx`](../studio/src/App.tsx):

1. The current `doc.extra` is snapshotted into `doc.extraByTemplate[oldTemplateId]`.
2. The new template's snapshot is restored if it exists; otherwise `emptyExtra()` merged with the new
   template's `defaults.extra` is applied.
3. Main data (`patientName`, `diagnoses`, `drugs`, `doctor`, …) is left untouched, so switching from `zz` to
   `zy` cannot leak Zhengzhou's 处方号 onto a Zunyi sheet.

| Function | Location | Behaviour |
| -------- | -------- | --------- |
| `TEMPLATES` | [`index.ts`](../studio/src/templates/index.ts) | Registry array; the selector lists it in order |
| `getTemplate(id)` | `index.ts` | Looks up by `id`; **falls back to `bj6` for unknown ids** |
| `buildTypst(doc)` | `index.ts` | `getTemplate(doc.templateId).build(doc)` |
| `buildTypst`, `getTemplate`, `TEMPLATES` | [`lib/typst-doc.ts`](../studio/src/lib/typst-doc.ts) | Compatibility re-export for legacy imports |

The generated Typst source is compiled inside Electron for the live SVG preview and for **PDF / PNG /
`.typ` source** exports ([electron/main.mjs](../studio/electron/main.mjs), `presc:export`); PNG defaults to
300 ppi.

---

## 2. Module layout

```
studio/src/templates/
├── types.ts      Template interface, TemplateSections, NO_SECTIONS
├── kit.ts        Shared Typst toolbox (preamble/esc/money/…, barcode & QR helpers)
├── generic.ts    Reference outpatient skeleton — READ-ONLY starting point
├── bj6.ts        bj6 metadata (imports its builder from bj6-impl.ts)
├── bj6-impl.ts   bj6 replica geometry + build()
├── zz.ts         Zhengzhou Central Hospital
├── bj3.ts        Peking University Third Hospital (insurance)
├── zy.ts         Fifth Affiliated (Zhuhai) Hospital of Zunyi Medical University
├── cq.ts         Chongqing Jiulongpo District TCM Hospital
└── index.ts      TEMPLATES registry + getTemplate() + buildTypst()
```

`generic.ts` is a *starting point*: copy the parts you need into your own module. Do not edit it — several
people work on templates in parallel and shared edits collide. `generic.ts` exports a `simpleTemplate(doc, opts)`
helper and a `SimpleOpts` interface (title, optional barcode, optional corner box, `qtyStyle`), but no built-in
template uses it; it exists purely as sample code.

---

## 3. Data model

### 3.1 `PrescriptionDoc` — [`src/lib/doc.ts`](../studio/src/lib/doc.ts)

| Field | Notes |
| ----- | ----- |
| `templateId` | Template id; resolved through `getTemplate()` |
| `docType` | Sheet caption, e.g. `非医保处方`, `普通处方`, `医保处方` |
| `hospital` | Chinese hospital name |
| `patientName`, `gender`, `age`, `dept`, `cardNo`, `serial` | Patient and record fields |
| `diagnoses: string[]` | One diagnosis per row, in Chinese |
| `drugs: DrugItem[]` | Drug rows |
| `doctor` | Prescribing doctor |
| `feeKey: "甲" \| "乙" \| "丙"` | Insurance fee class used by the replica template |
| `printDate`, `validDays` | Issue date and validity in days (`validDays <= 1` renders 当日有效) |
| `options: DocOptions` | `showBarcode`, `showCardNo`, `showPrintDate`, `showSerial`, `showFeeLine`, `showFeeMark`, `showTips`, `showSign`, `showUsage`, `showMoney`, `selfPayLabel`, `tips[]` — read by `bj6`; other templates ignore most of them |
| `extra: DocExtra` | Extended header/footer fields — the only extended data the builder may read |
| `extraByTemplate` | Per-template `extra` snapshots (see §1.2) |

### 3.2 `DrugItem`

Two field families coexist; a template uses whichever fits its sheet.

| Family | Fields | Used by |
| ------ | ------ | ------- |
| Replica / simple | `name`, `brand`, `spec`, `price`, `qty`, `usage` | `bj6`, and the `usage` fallback everywhere |
| Tabular / TCM | `prefix` (`(基)` / `(国采)` / `(集采)` / `②` …), `unit`, `freq`, `dose`, `route`, `days`, `tcm` (grams), `note` | `zz`, `bj3`, `zy`, `cq` |

`odRisk` carries an overdose-risk hint from the preset library. **Templates never read it** — it is an
in-application safety hint and must never be printed on a sheet.

### 3.3 `DocExtra` — the per-template extended fields

A single flat interface; templates declare the subset they need through `extraKeys`.

| Key | Meaning | Labels used by built-in templates |
| --- | ------- | --------------------------------- |
| `rxNo` | Prescription number | 处方号 / 处方序号 / NO / 处方号 |
| `feeCategory` | Fee category (`国家医保`, `门诊自付`, `自费` …) | 费别 |
| `medicalId` | Patient / medical record id | ID号 / 门诊住院病历号 / 取药联条码号 |
| `caseNo` | Case number | 病案号 |
| `idType` | Patient identity class (`异地医保患者` …) | 身份 |
| `ssn` | Social-security number | 社保号 |
| `orgCode` | Designated-institution code | 定点医疗机构编码 |
| `unitName` | Employer / work unit | 单位 |
| `visitNo` | Visit or admission number | 就诊次 / 住院(门诊)号 / 门诊号 |
| `visitDate` | Visit or issue date | 日期 / 就诊日期 / 开具日期 |
| `weight` | Body weight | 体重(kg) |
| `phone` | Phone / address | 电话/地址 |
| `pharmacy` | Dispensing pharmacy | 取药药房 / 发药药房 |
| `note` | Instructions / remarks | 页脚说明 / 嘱托 / 剂数与煎服说明 |
| `amount` | Drug amount; when empty the builder computes `total(doc)` | 药费 / 药品金额 / 合计金额 |
| `pageInfo` | Page counter, default `第1页 共1页` | 页码 |
| `printTime` | Print timestamp | 打印时间 |
| `qrText` | QR payload | 二维码内容 / 二维码内容（扫码支付） |

The form renders one input per `extraKeys` entry, in declaration order, with `f.placeholder ?? f.label` as the
placeholder; values land in `doc.extra[f.key]`.

### 3.4 The `Template` interface — [`types.ts`](../studio/src/templates/types.ts)

| Property | Type | Notes |
| -------- | ---- | ----- |
| `id` | `string` | Registry key; also used in `out/tpl-<id>.png` |
| `name` | `string` | Label in the title-bar selector (Chinese) |
| `hospital` | `string` | Default hospital name (informational) |
| `desc` | `string` | One-line description, shown on hover |
| `group` | `"复刻样张" \| "门诊电子处方" \| "中药处方"` | Category label; currently informational only — the selector lists templates flat |
| `page` | `{ widthPt: number; heightPt: number }` | Page size in points; the preview canvas uses this ratio |
| `sections` | `TemplateSections` | See §1.1 |
| `limits` | `{ maxDiag: number; maxDrugs: number }` | Caps enforced by the form and passed to `validate()` |
| `extraKeys` | `Array<{ key: keyof DocExtra; label: string; placeholder?: string }>` | Extra-field inputs |
| `defaults?` | `Omit<Partial<PrescriptionDoc>, "extra"> & { extra?: Partial<DocExtra> }` | Sample data applied on first use / on switch |
| `build` | `(doc: PrescriptionDoc) => string` | Returns Typst source |

### 3.5 Limits and validation

`validate(doc, limits)` in [`lib/doc.ts`](../studio/src/lib/doc.ts) produces the warnings shown above the
preview; `App.tsx` calls it as `validate(doc, tpl.limits)`. Over-limit rows are **not printed** — they are
simply dropped, and the form shows a Chinese error message. The form also clamps insertions to `limits` and
displays counters such as `3/6`.

`MAX_DIAG_LINES = 8` and `MAX_DRUGS = 5` in `lib/doc.ts` are the legacy single-template defaults; `bj6` uses
them, and `zz` reuses them internally (see the caveat below).

> **Known inconsistency.** `limits` is what the *form* enforces; `build()` decides what actually prints. `zz`
> declares `12 / 20` but its builder currently slices to `MAX_DIAG_LINES` (8) diagnoses and
> `MAX_DRUGS + 1` (6) drugs. Always confirm real capacity with a stress render before advertising it
> ([§5](#5-adding-a-new-template-step-by-step), step 5).

---

## 4. Layout styles

### 4.1 Absolute positioning (`bj6`)

Every block is pinned with `place(dx: …, dy: …)` (or the template's own `add()` helper) to coordinates measured
on the reference scan, where **1 image pixel = 0.5 pt** (`preamble` defines `#let px = 0.5pt`). This is the right
choice when the goal is to reproduce one specific sheet. Overflow is handled by a `maxw` fallback that shrinks
the font size until the text fits its measured cell.

Because the geometry is large, `bj6` is split in two: [`bj6.ts`](../studio/src/templates/bj6.ts) holds the
metadata and imports `buildTypst as build` from [`bj6-impl.ts`](../studio/src/templates/bj6-impl.ts). Use the same
split when your measured tables exceed a few hundred lines.

### 4.2 Flow layout (all other templates)

`zz`, `bj3`, `zy` and `cq` lay content out with Typst `grid` / `box` / `stack`, so the sheet grows with the
content. A flow template must guarantee its own bounds:

- give every free-text run a `maxw` (or a `#set text(...)` wrapping constraint);
- drive vertical rhythm from content (e.g. `zz` shifts the Rp block down by `(rows - 1) × DIAG_PITCH` and scales
  drug pitch when the list is long);
- render the stress cases in §5 step 5 before you trust it.

Both styles emit plain Typst text from `build()`; there is no intermediate representation.

---

## 5. Adding a new template (step by step)

### Step 0 — prerequisites

All commands run from the `studio/` directory (the repository root is the directory that contains
[`README.md`](../README.md)).

```bash
cd studio
npm install
npm run fetch:typst      # downloads the Typst compiler to studio/resources/typst.exe
```

`fetch:typst` runs [`scripts/fetch-typst.mjs`](../studio/scripts/fetch-typst.mjs) and is idempotent: an existing
binary reporting the expected version is kept. It targets `resources/typst.exe` (override with `TYPST_DEST`),
defaults to Typst `0.15.1` (`TYPST_VERSION`), and honours `TYPST_URL` for mirrors or a project release asset.

### Step 1 — create the module

Copy the parts you need from [`generic.ts`](../studio/src/templates/generic.ts) into a new
`studio/src/templates/<id>.ts` and export a `Template`. Keep the Chinese literals Chinese.

**`studio/src/templates/my.ts`**

```ts
import type { PrescriptionDoc } from "@/lib/doc";
import type { Template } from "@/templates/types";
import {
  BARCODE_HELPER, QR_HELPER, barcodeBlock, esc, money, preamble, qrBlock, total,
} from "@/templates/kit";

const W = 419.5;
const H = 595.3;

function build(doc: PrescriptionDoc): string {
  const amount = doc.extra.amount.trim() || money(total(doc));
  const qrText = doc.extra.qrText.trim() || doc.extra.medicalId;

  return [
    preamble(W, H, { margin: "14pt 16pt" }),   // page + font defaults
    BARCODE_HELPER,                            // emit helper definitions once
    QR_HELPER,
    `#grid(columns: (1fr, auto, 1fr), align: (left, center, right),`,
    `  [${doc.cardNo.trim() ? barcodeBlock(doc.cardNo, 96, 22) : []}],`,
    `  text(size: 15pt, weight: "bold")[${esc(doc.hospital)}处方笺],`,
    `  [${qrText ? qrBlock(qrText, 48) : []}],`,
    ")",
    `#v(6pt) 姓名：${esc(doc.patientName)}　性别：${esc(doc.gender)}　年龄：${esc(doc.age)}岁`,
    `#v(2pt) 临床诊断：${esc(doc.diagnoses.filter(Boolean).join("；"))}`,
    `#v(4pt) Rp`,
    // …your drug rows: use d.prefix / d.name / d.spec / trim(d.qty) + d.unit / d.freq / d.dose / d.route / d.days…
    `#v(4pt) 药品金额：${esc(amount)} 元`,
  ].join("\n");
}

export const myTpl: Template = {
  id: "my",
  name: "某某医院处方笺",
  hospital: "某某医院",
  desc: "One-line description shown when hovering the selector",
  group: "门诊电子处方",
  page: { widthPt: W, heightPt: H },
  sections: {
    patient: true, identity: true, visit: true, diagnosis: true,
    drugs: true, drugTable: true, tcm: false, footer: true,
  },
  limits: { maxDiag: 12, maxDrugs: 20 },
  extraKeys: [
    { key: "rxNo", label: "处方号" },
    { key: "visitDate", label: "日期" },
    { key: "amount", label: "药品金额" },
    { key: "qrText", label: "二维码内容" },
  ],
  defaults: {
    hospital: "某某医院",
    patientName: "示例",
    diagnoses: ["示例诊断"],
    extra: { rxNo: "00000000" },
  },
  build,
};
```

Notes:

- `name`, `desc`, `group`, the `extraKeys[].label` values and `defaults` are shown to Chinese users — keep them
  in Chinese even though the code comments and identifiers are English.
- `defaults.extra` may list only the fields you actually declare; `emptyExtra()` fills the rest.
- Import helper definitions (`BARCODE_HELPER`, `QR_HELPER`) once, after `preamble`; `barcodeBlock` / `qrBlock`
  emit calls to them and will not compile without them.

### Step 2 — register it

Add one import and one array entry in [`studio/src/templates/index.ts`](../studio/src/templates/index.ts):

```ts
import { myTpl } from "@/templates/my";

export const TEMPLATES: Template[] = [bj6, zz, bj3, zy, cq, myTpl];
```

Order matters: it is the order of the title-bar selector, and the first entry is the fallback template for
unknown ids.

### Step 3 — rebuild the script bundles

`studio/scripts/*.mjs` are **build artifacts** (rolldown bundles of the sibling `.ts` entries), produced by
[`scripts/bundle.mjs`](../studio/scripts/bundle.mjs) and deliberately **not committed** — see
[`scripts/.gitignore`](../studio/scripts/.gitignore). A fresh clone therefore has to build them once before any
`node scripts/<name>.mjs` invocation works, and again after every change under `studio/src/`:

```bash
npm run bundle                # rebuild stale bundles for every scripts/*.ts entry
npm run bundle -- render-all  # rebuild only the named entry (several names allowed)
npm run bundle -- --force     # ignore timestamps and rebuild everything
npm run bundle -- --check     # verify freshness only, no writes (CI)
```

Hand-written helpers that have no `.ts` source (`bundle.mjs`, `start.mjs`, `pack.mjs`,
`gen-presets-doc.mjs`, `check-presets.mjs`, `check-tcm.mjs`, `check-odrisk.mjs`) are tracked sources, not
artifacts. Dropping a new `.ts` file into `scripts/` is enough to make it an entry — no script change needed.

### Step 4 — render and inspect

```bash
node scripts/render-all.mjs        # every template
node scripts/render-all.mjs my     # only template id "my"
npm run render                     # alias for: npm run bundle && node scripts/render-all.mjs
```

[`scripts/render-all.ts`](../studio/scripts/render-all.ts) builds each template from its own
`defaults` (the same merge the app performs), writes `studio/out/tpl-<id>.typ` and compiles
`studio/out/tpl-<id>.png` at 144 ppi through `resources/typst.exe` (`resources/typst` on non-Windows). It exits
non-zero if any template fails and prints the Typst stderr. Re-running this script after every layout change is
the fastest iteration loop; `npm run dev` additionally gives the live SVG preview.

### Step 5 — stress-test the layout

```bash
npm run stress
```

[`scripts/stress-templates.ts`](../studio/scripts/stress-templates.ts) renders three cases per template into
`studio/out/stress-<id>-<kind>.png`:

| Case | Content |
| ---- | ------- |
| `max` | Diagnoses and drugs pushed to the template's `limits` |
| `min` | One diagnosis and one drug, most fields empty |
| `long` | Oversized diagnosis / drug name / spec / department text |

Related checks: `npm run test:gen` (generator smoke test), `npm run test:qr`, `npm run test:variants`,
`npm run test:extremes`, `npm run diag:long`, and `npm test` for the full suite (all of them bundle first).

### Step 6 — finish up

- Open the selector in `npm run dev`, switch to your template and confirm the title bar shows the expected
  `<w>×<h>pt`; click through every `extraKeys` input.
- Add the template row to the table in [README.md](../README.md) and [README.zh-CN.md](../README.zh-CN.md).
- If you publish a preview, add the rendered PNG under [`docs/images/`](images/).

### Checklist

| # | Item | Done when |
| - | ---- | --------- |
| 1 | `studio/src/templates/<id>.ts` exports a `Template` | `npm run bundle` reports no error |
| 2 | Registered in `TEMPLATES` | The id appears in the selector |
| 3 | `limits` and `sections` match the real sheet | Form shows the right cards and counters |
| 4 | `extraKeys` covers every extended field the layout prints | No field is hard-coded in `build()` that users must edit |
| 5 | `defaults` render a complete example sheet | `node scripts/render-all.mjs <id>` exits 0 |
| 6 | Stress cases hold | `npm run stress` renders `max`/`min`/`long` without clipping |
| 7 | Chinese values untouched | Hospital, drug, diagnosis and label strings still Chinese |

---

## 6. Template toolbox — [`kit.ts`](../studio/src/templates/kit.ts)

Everything a builder normally needs; import it instead of duplicating Typst snippets.

| Export | Signature | Purpose |
| ------ | --------- | ------- |
| `preamble` | `(widthPt, heightPt, opts?: { margin?: string; baseSize?: number }) => string` | `#set page(...)`, `#set text(font: ("SimSun", "Times New Roman"), lang: "zh")`, `#set par(leading: 0.62em)` and `#let px = 0.5pt`. Default margin `0pt` (templates place their own content), default base size `9pt`. A two-value margin `"12pt 14pt"` becomes `(y: 12pt, x: 14pt)` |
| `esc` | `(s: string) => string` | Escape `\` and `"` for Typst string literals — use it on every user value |
| `money` | `(v: number) => string` | Amount with exactly two decimals |
| `circled` | `(i: number) => string` | ①…⑳ (U+2460…), falling back to `(n)` beyond 20 |
| `trim` | `(v: number \| string) => string` | Drops trailing zeros: `12.40 → 12.4`, `6.00 → 6` |
| `tw` | `(text: string) => number` | Rough width in em (CJK 1, ASCII 0.5) for build-time overflow warnings |
| `ruleLine` | `(x1, y1, x2, y2, w = 0.6) => string` | Absolutely positioned `#place(... line ...)` rule |
| `barcodeBlock` | `(text: string, wPt: number, hPt: number) => string` | Code 128 barcode of `wPt × hPt` pt, drawable inside any flow; needs `BARCODE_HELPER` |
| `BARCODE_HELPER` | `string` | The `#let barcode(bars, w, h)` definition (`encodeCode128` module widths → black rectangles) |
| `qrBlock` | `(text: string, sidePt: number) => string` | QR code of `sidePt` pt; needs `QR_HELPER` |
| `QR_HELPER` | `string` | The `#let qrcode(mat, side)` definition (boolean matrix → squares) |
| `total` | `(doc: PrescriptionDoc) => number` | `totalOf(doc.drugs)` = Σ `price × qty` |
| `skeleton` | `(doc: PrescriptionDoc) => string` | Minimal starter body on a 419.5 × 595.3 pt page |

Supporting libraries:

- [`lib/barcode.ts`](../studio/src/lib/barcode.ts) — `encodeCode128(text)` returns `{ widths, modules, codeSet, text }`.
  Pure digits of even length use code set C, everything else code set B; whitespace is stripped. `bj6` also uses
  `barsToRects()` for its pixel-measured barcode box.
- [`lib/qr.ts`](../studio/src/lib/qr.ts) — real encoder, zero dependencies: byte (UTF-8) mode, error-correction
  level M, automatic version 1–10 selection, all 8 masks tried. `qrMatrix(text)` returns an N×N boolean matrix or
  `null`; `qrBlock` then falls back to a bordered box labelled `扫码支付`. A QR code that cannot be encoded is
  **never** replaced by a fake pattern.

---

## 7. Conventions

### 7.1 Fonts

| Content | Font |
| ------- | ---- |
| Chinese text | SimSun (宋体) |
| Digits / Latin | Times New Roman or Arial |
| Barcode digits | Courier New |

All of them ship with Windows and are **not bundled** with the application. The Electron shell is
cross-platform, but without these fonts the layouts shift — font substitution is not solved yet.

### 7.2 Chinese domain data stays Chinese

Hospital names, drug names, diagnoses, doctor names, instructions and every `extraKeys[].label` are Chinese
literals in the source and on the rendered sheet. Keep them verbatim in new templates; do not translate or
invent transliterations. Representative values already in the code:

| Kind | Example (verbatim) |
| ---- | ------------------ |
| Hospital | `北京大学第六医院`, `郑州市中心医院`, `北京大学第三医院`, `遵义医科大学第五附属（珠海）医院`, `重庆市九龙坡区中医院` |
| Patient sample | `张伟` / `男` / `21` / `精神科` |
| Diagnosis | `心境[情感]障碍`, `抑郁状态`, `偏执性反应` |
| Drug | `氢溴酸伏硫西汀片`, brand `石药`, spec `10mg x 14片/盒` |
| TCM herb | `熟地黄` 30.0 g, `牡丹皮` 3.0 g |
| Footer tips | `(1)请遵医嘱服药`, `(2)请在窗口点清药品`, `(3)处方当日有效` |
| Template caption | `北京大学第六医院 · 非医保处方` |

The full preset libraries (hospitals, departments, drugs, herbs, regimens, doctors) are documented in
[`PRESETS.md`](PRESETS.md) and listed under [`studio/src/data/`](../studio/src/data/); they are editable
starting points, not a controlled vocabulary.

### 7.3 Money

`money()` renders exactly two decimals. If `extra.amount` is non-empty it wins; otherwise builders fall back to
`total(doc)`, e.g. `const amount = doc.extra.amount.trim() || money(total(doc))`.

### 7.4 Empty and derived values

Builders fill gaps rather than printing blanks: `zz` derives `rxNo` from `printDate` when the field is empty,
`bj6` falls back from `extra.qrText` to `cardNo` for its QR payload, several templates fall back from
`extra.visitDate` to `printDate`, and a blank `hospital` falls back to the template's own hospital. Follow the
same pattern in new templates so an incomplete form still produces a printable sheet.

---

## 8. Troubleshooting

| Symptom | Cause | Fix |
| ------- | ----- | --- |
| `Cannot find module .../scripts/render-all.mjs` | The bundles were never built — they are not committed | `npm run bundle` |
| `✗ 产物缺失或过期 …` from `npm run bundle -- --check` | `src/` or `scripts/*.ts` changed after the last bundle | `npm run bundle` |
| Typst compile fails with `ENOENT` in `render-all.mjs` | `studio/resources/typst.exe` is missing | `npm run fetch:typst` (or `-- --force`) |
| The app title bar shows `typst 未就绪` | Same — the compiler was not downloaded | `npm run fetch:typst` |
| A new template never appears in the selector | It is not in `TEMPLATES` | Register it in [`index.ts`](../studio/src/templates/index.ts) |
| The wrong template renders after a data import | `getTemplate()` silently falls back to `bj6` for an unknown `templateId` | Check the stored `templateId` against `TEMPLATES` |
| Extended fields look empty right after switching | Each template keeps its own `extra` snapshot | Switch back, or re-enter the fields |
| Text is clipped or overlaps on a flow template | Missing width constraint | Add `maxw` (or shrink-to-fit) and re-run `npm run stress` |
| Chinese glyphs render as boxes / wrong shapes | SimSun is unavailable (non-Windows host) | Run on Windows, or install a SimSun substitute |
| Over-limit rows are missing from the output | `limits` clamps the document | Reduce rows to `limits`, or raise them for your template |
| A QR code came out as a `扫码支付` box | `qrMatrix()` returned `null` (payload too long for version 10, or invalid parameters) | Shorten the payload — the fallback is intentional |

---

## 9. Related documents

| Document | Content |
| -------- | ------- |
| [`docs/PACKAGING.md`](PACKAGING.md) | Building and distributing the desktop application |
| [`docs/PRESETS.md`](PRESETS.md) | Preset libraries (hospitals, departments, drugs, herbs, regimens) |
| [`docs/zh-CN/TEMPLATES.md`](zh-CN/TEMPLATES.md) | Chinese original of this document |
| [`README.md`](../README.md) | Project overview, feature list, template table |
| [`README.zh-CN.md`](../README.zh-CN.md) | Chinese README |
