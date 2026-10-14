> Chinese version: [docs/zh-CN/PRESETS.md](zh-CN/PRESETS.md)

# Preset Libraries (PRESETS)

[`studio/src/data/presets.ts`](../studio/src/data/presets.ts) is the single source of truth for every
selectable value in the application: hospitals, departments, diagnoses, drugs, doctors, fee types,
document types, usage strings, tip sets, "common regimen" quick-fill buttons and insurance wording.

The form reads that file directly for its dropdowns, its searchable pickers and the
**常用方案** ("common regimen") one-click fill, so **editing preset data means editing this one file** —
no database, no JSON sidecar, no migration.

> **Language policy — the values stay Chinese on purpose.**
> This application produces prescription sheets for hospitals in mainland China. The preset values
> (hospital names, drug names, diagnosis names, usage text, advice text) are *data*, not UI copy:
> they are printed verbatim on the sheet. They must not be translated, transliterated or
> "English-ised" in the source. This document therefore keeps every value in its original Chinese
> form, with English prose around it, and gives only a few samples per list. The complete Chinese
> listings live in [docs/zh-CN/PRESETS.md](zh-CN/PRESETS.md).

> **Prices are demo data.** Every `price` in `DRUGS` is a placeholder collected for layout
> demonstration. Replace the library with your own hospital drug catalogue before real use; nothing
> in the application treats these numbers as billing data.

---

## 1. Where the data lives, and how the two documents relate

| Path | Role |
| ---- | ---- |
| [`studio/src/data/presets.ts`](../studio/src/data/presets.ts) | The data itself (TypeScript, exports only) |
| [`studio/src/data/tcm.ts`](../studio/src/data/tcm.ts) | Separate herb library for the TCM template — *not* covered here |
| [`studio/scripts/gen-presets-doc.mjs`](../studio/scripts/gen-presets-doc.mjs) | Generates the **Chinese** listing from `presets.ts` |
| [docs/zh-CN/PRESETS.md](zh-CN/PRESETS.md) | Generated Chinese listing: every hospital, drug, diagnosis and regimen, verbatim |
| This file | Hand-written English reference: schema, structure, recipes, checks |

The Chinese listing is a build artefact of the data: run

```bash
cd studio
node scripts/gen-presets-doc.mjs
```

and the generator bundles `presets.ts` with rolldown, imports it, and renders the Markdown tables.
It writes the generated Chinese listing to `docs/zh-CN/PRESETS.md`. This English document is maintained
by hand and is never generated, so the two editions can be regenerated and edited independently.

---

## 2. Inventory

All counts below are the current contents of `presets.ts` (they are printed by the self-check scripts,
see [section 10](#10-self-checks)).

| Export | Meaning | Type | Count |
| ------ | ------- | ---- | ----- |
| `HOSPITALS` | Hospital names | `string[]` | 40 |
| `DEPARTMENTS` | Department names | `string[]` | 22 |
| `DIAGNOSES` | Diagnoses, grouped by clinical category | `DiagnosisGroup[]` | 11 groups / 105 entries |
| `DRUGS` | Drugs with brand, specification, unit price, default usage, class, OD-risk note | `DrugPreset[]` | 77 |
| `DOCTORS` | Physician names for the signature line | `string[]` | 8 |
| `FEE_TYPES` | Fee categories (甲 / 乙 / 丙) | `FeeType[]` | 3 |
| `DOC_TYPES` | Document types (ordinary / emergency / narcotic / psychotropic …) | `DocType[]` | 8 |
| `USAGE_PRESETS` | Usage-and-dosage strings | `string[]` | 25 |
| `TIP_PRESETS` | Prescription advice blocks, three lines each | `string[][]` | 7 blocks |
| `REGIMENS` | "Diagnosis + medication" quick-fill combinations | `RegimenPreset[]` | 68 |
| `GENDERS` | Genders | `string[]` | 2 |
| `INSURANCE_PRESETS` | Insurance wording for the "self-pay" label | `InsurancePreset[]` | 4 |
| `COLD_MEDICINE_HINTS` | Combination cold-medicine ingredient warnings (in-app only) | `ColdMedicineHint[]` | 2 |
| `odRiskOf(name)` | Lookup helper: OD-risk text for a drug name, or `""` | `(string) => string` | — |

Derived figures worth knowing:

- Drug classes: 17, listed in [section 7](#7-drugs-77-in-17-classes).
- OD-risk coverage: **77 / 77** drugs carry a non-empty `odRisk` (the exception whitelist in
  `check-odrisk.mjs` is currently empty).
- Diagnosis groups: 11, listed in [section 6](#6-diagnoses-11-groups--105-entries).

---

## 3. Field schemas

### 3.1 `DrugPreset` — element of `DRUGS`

| Field | Type | Required | Meaning | Example |
| ----- | ---- | -------- | ------- | ------- |
| `name` | `string` | yes | Generic (INN) drug name. **`REGIMENS[].drugs` must match this string exactly.** Printed on the sheet. | `氢溴酸伏硫西汀片` |
| `brand` | `string` | yes | Brand / manufacturer label shown next to the name | `石药` |
| `spec` | `string` | yes | Specification, written as `dose x count/container` | `10mg x 14片/盒` |
| `price` | `number` | yes | Unit price in CNY, two decimals | `9.87` |
| `usage` | `string` | yes | Default usage and dosage; used to pre-fill the drug row | `每日1次 每次1片 口服` |
| `class` | `string` | yes | Drug class; groups the drug picker and drives the OD-risk scope assertion | `抗抑郁药` |
| `odRisk` | `string` | optional in the type, **required by the checks** | One-line overdose-risk note, 60 Chinese characters or fewer. UI-only: never printed (see [section 8](#8-how-the-data-is-consumed)). | `过量可致5-羟色胺综合征：震颤、高热、意识模糊；与曲马多等5-羟色胺能药物合用风险更高` |

There is no `id` field: `name` is the identity. Duplicate names silently break price lookup, so the
self-checks reject them.

### 3.2 `DiagnosisGroup` — element of `DIAGNOSES`

| Field | Type | Meaning |
| ----- | ---- | ------- |
| `group` | `string` | Category name, shown as the sticky group header in the diagnosis picker |
| `items` | `string[]` | Diagnosis names in that category (Chinese psychiatric / ICD-style wording) |

```ts
{ group: "心境障碍", items: ["心境[情感]障碍", "抑郁状态", "双相情感障碍"] },
```

### 3.3 `RegimenPreset` — element of `REGIMENS`

| Field | Type | Meaning |
| ----- | ---- | ------- |
| `name` | `string` | Regimen name; shown as the picker entry and quick-fill button. **Globally unique.** |
| `diagnosis` | `string[]` | Diagnoses to fill in; every entry must match an item of `DIAGNOSES` |
| `drugs` | `string[]` | Drug names to fill in; every entry must match a `DRUGS[].name` |

```ts
{ name: "抑郁状态·基础方案", diagnosis: ["心境[情感]障碍", "抑郁状态"], drugs: ["草酸艾司西酞普兰片", "枸橼酸坦度螺酮胶囊"] },
```

### 3.4 The remaining record types

`FeeType` (`FEE_TYPES`):

| Field | Type | Meaning | Example |
| ----- | ---- | ------- | ------- |
| `key` | `"甲" / "乙" / "丙"` | Value stored in the document (`PrescriptionDoc.feeKey`) | `甲` |
| `label` | `string` | Text printed in the fee-category box | `①(甲)无自付` |
| `selfPay` | `boolean` | Whether the patient pays part of the cost | `false` |
| `desc` | `string` | Tooltip / explanation | `医保甲类，无个人自付` |

`DocType` (`DOC_TYPES`): `{ title: string; hint: string }` — `title` is the value written to the
sheet header, `hint` is the tooltip.

```ts
{ title: "麻醉药品处方", hint: "麻醉药品专用" },
```

`InsurancePreset` (`INSURANCE_PRESETS`): `{ label: string; selfPayText: string }` — the label is the
settlement mode, `selfPayText` is the wording used for the "self-pay" annotation.

```ts
{ label: "自费", selfPayText: "个人自付" },
```

`ColdMedicineHint` (`COLD_MEDICINE_HINTS`): `{ name: string; ingredients: string[]; hint: string }` —
combination cold medicines are deliberately **not** `DRUGS` entries; they exist only to warn about
duplicated ingredients in the UI.

---

## 4. Hospitals, departments, doctors, genders

- `HOSPITALS` — 40 entries, ordered by prominence rather than alphabetically: the best-known
  national centres come first, then the psychiatric centre of each province and autonomous region,
  then major city hospitals. Examples: `北京大学第六医院`, `上海市精神卫生中心`,
  `昆明医科大学第一附属医院精神科`.
- `DEPARTMENTS` — 22 entries, psychiatry-first (`精神科`, `心理科`, `心理咨询门诊`,
  `心身医学科`, `睡眠医学科`, `成瘾医学科`, …), ending with general and administrative units
  (`内科`, `急诊科`, `儿科`, `中医科`, `门诊部`, `住院部`).
- `DOCTORS` — 8 fictional physician names used for the signature line:
  `陈明`, `李静`, `王立群`, `陈曦`, `赵一鸣`, `孙丽华`, `周建国`, `吴敏`.
- `GENDERS` — `["男", "女"]`. The patient form's segmented control currently hard-codes the same two
  literals, so keep both in sync if you ever change this array.

These libraries are **starting points, not a controlled vocabulary**, but the input widgets differ: hospitals,
departments, diagnoses, drug rows and usage strings are free-text fields with autocomplete or a
picker, whereas the physician must be chosen from `DOCTORS` (picker only) and the gender is a fixed
`男` / `女` segmented control fed by hard-coded labels. Dropping a name from an autocompleted list
does not prevent it being typed; dropping one from `DOCTORS` does make it unreachable in the UI.

---

## 5. Usage presets and tip blocks

`USAGE_PRESETS` (25 entries) covers the common psychiatric dosing patterns plus a few injection and
"as needed" forms. The list feeds the autocomplete suggestions of the usage input; the value a new
drug row starts with comes from that drug's own `DrugPreset.usage`. Examples:
`每日1次 每次1片 口服`, `睡前1次 每次1片 口服`, `每日3次 每次6U 餐前皮下注射`, `必要时服用`.

`TIP_PRESETS` (7 blocks, 3 lines each) are the advice blocks printed in the footer of a sheet. Every
block starts with the same first line, then varies the second and third:

```ts
["(1)请遵医嘱服药", "(2)请在窗口点清药品", "(3)处方当日有效"],              // block 1
["(1)请遵医嘱服药", "(2)请勿自行增减剂量", "(3)定期复诊"],                  // block 3
["(1)请遵医嘱服药", "(2)二类精神药品请凭处方取药", "(3)请勿转借他人使用"],   // block 6
```

The tip fields in the form are free-text inputs (three rows); `TIP_PRESETS` is the canonical copy of
the shipped blocks, and `defaultDoc()` in [`studio/src/lib/doc.ts`](../studio/src/lib/doc.ts) seeds
the editor with block 1. If you change block 1, mirror the change in `defaultDoc()`.

---

## 6. Diagnoses: 11 groups / 105 entries

The groups follow the clinical organisation of a psychiatric outpatient sheet, from mood disorders to
organic conditions, and end with a small general-medicine block used by the internal-medicine
templates. Within a group, entries run from the general, broad wording to the more specific ones.

| Group (data value) | Entries | English gloss (not a data value) |
| ------------------ | ------- | -------------------------------- |
| `心境障碍` | 14 | Mood disorders |
| `焦虑与强迫` | 15 | Anxiety and obsessive-compulsive disorders |
| `精神病性障碍` | 10 | Psychotic disorders |
| `睡眠障碍` | 9 | Sleep disorders |
| `儿童青少年` | 10 | Child and adolescent psychiatry |
| `应激与适应` | 9 | Stress and adjustment disorders |
| `成瘾与物质依赖` | 8 | Addiction and substance dependence |
| `进食与冲动控制` | 6 | Eating and impulse-control disorders |
| `器质性与其他` | 14 | Organic and other conditions |
| `内科与躯体疾病` | 8 | Internal medicine and physical illness |
| `变态反应与皮肤` | 2 | Allergy and dermatology |

Sample entries, verbatim: `心境[情感]障碍`, `抑郁状态`, `双相情感障碍，目前为轻度抑郁发作`,
`惊恐障碍[间歇发作性焦虑]`, `注意缺陷多动障碍（混合型）`, `2 型糖尿病`, `荨麻疹`.

Note the punctuation conventions carried over from clinical Chinese: full-width brackets `[]` for
included synonyms, full-width parentheses `（）` for subtypes, and the full-width comma `，` inside
a diagnosis. Copy them as-is when adding an entry — an ASCII comma will not match an existing string
and therefore will not match a regimen either.

The full 105-entry list is in [docs/zh-CN/PRESETS.md](zh-CN/PRESETS.md).

---

## 7. Drugs: 77 in 17 classes

`class` is the only structural key in `DRUGS`; it groups the drug picker and defines the OD-risk
coverage scope in the checks. Current distribution:

| Class (data value) | Count | English gloss (not a data value) |
| ------------------ | ----- | -------------------------------- |
| `抗抑郁药` | 17 | Antidepressants (SSRI / SNRI / NaSSA / TCA) |
| `抗精神病药` | 12 | Antipsychotics |
| `抗焦虑药` | 8 | Anxiolytics |
| `镇静催眠药` | 5 | Sedative-hypnotics |
| `心境稳定剂` | 5 | Mood stabilisers |
| `认知改善药` | 5 | Cognitive enhancers |
| `ADHD用药` | 3 | ADHD medication |
| `解热镇痛药` | 4 | Analgesics / antipyretics |
| `麻醉性镇痛药` | 3 | Narcotic analgesics |
| `镇痛药` | 1 | Non-opioid analgesic |
| `抗组胺药` | 3 | Antihistamines |
| `β受体阻滞剂` | 2 | Beta blockers |
| `钙通道阻滞剂` | 2 | Calcium-channel blockers |
| `强心苷` | 1 | Cardiac glycoside |
| `抗凝血药` | 1 | Anticoagulant |
| `胰岛素` | 2 | Insulins |
| `口服降糖药` | 3 | Oral hypoglycaemics |

A full record (with the `odRisk` text abridged here) looks like this:

```ts
{ name: "氢溴酸伏硫西汀片", brand: "石药", spec: "10mg x 14片/盒", price: 9.87,
  usage: "每日1次 每次1片 口服", class: "抗抑郁药",
  odRisk: "过量可致5-羟色胺综合征：震颤、高热、意识模糊；与曲马多等5-羟色胺能药物合用风险更高" },
```

The `spec` field is not free-form, because `makeDrug()` parses it:

- the quantity unit is taken from the character after the `/` (or `／`) separator, matching
  `盒`, `支`, `瓶`, `袋`, `板` or `包` (fallback `盒`);
- the single dose is taken from the first `片 | 粒 | 袋 | 支 | ml | g` group found in `usage`;
- the route is taken from `口服 | 喷鼻 | 含漱 | 外用 | 肌注 | 静滴 | 皮下注射 | 皮下` in `usage`
  (fallback `口服`).

So keep the house pattern `<dose> x <count><form>/<container>` for `spec` and
`<frequency> 每次<dose> <route>` for `usage`, or the derived unit, dose and route fall back to
defaults.

---

## 8. How the data is consumed

| Consumer | Uses |
| -------- | ---- |
| `FormPanel.tsx` drug picker | One entry per drug, grouped by `class`; the row subtitle shows `spec · price 元 · brand` plus a warning mark when `odRisk` exists; the search index includes `brand`, `class`, the words 过量 / 风险 and the whole `odRisk` text, so a user can search for e.g. 呼吸抑制 and find the drugs that warn about it |
| `FormPanel.tsx` diagnosis picker | `DIAGNOSES` flattened, grouped by `group` |
| `FormPanel.tsx` regimen picker | `REGIMENS` grouped under 常用方案; the subtitle shows the diagnoses and drugs it will insert |
| `FormPanel.tsx` doctor picker | `DOCTORS` |
| `FormPanel.tsx` OD-risk banner | `odRiskOf(doc.drugs[i].name)` — looked up live, so a hand-edited or legacy drug name still resolves |
| `App.tsx` datalists | `HOSPITALS`, `DEPARTMENTS`, `DOC_TYPES`, `DIAGNOSES` (flattened), `DRUGS`, `USAGE_PRESETS` |
| `doc.ts`, `makeDrug(name)` | Exact-name lookup in `DRUGS`; fills `brand`, `spec`, `price`, `usage`, `odRisk`, and derives `unit` / `dose` / `route` |

Applying a regimen **replaces** the current diagnoses and drugs:

```ts
diagnoses: r.diagnosis.slice(0, LIM.maxDiag),
drugs: r.drugs.slice(0, LIM.maxDrugs).map((nm) => makeDrug(nm)),
```

Two consequences for regimen authors:

1. Anything beyond the active template's limits is **silently truncated** — see the limits table below.
2. `makeDrug()` matches by exact name. A typo does not throw; it produces an empty specification and a
   price of `0.00`, which is easy to miss on the sheet. The self-checks exist to catch exactly this.

| Template | Diagnoses / drugs limit |
| -------- | ----------------------- |
| `bj6` Peking University Sixth Hospital | 8 / 5 (= `MAX_DIAG_LINES` / `MAX_DRUGS` in `doc.ts`) |
| `zz` Zhengzhou Central Hospital | 12 / 20 |
| `bj3` Peking University Third Hospital | 6 / 6 |
| `zy` Zunyi Medical University Fifth Affiliated (Zhuhai) Hospital | 6 / 6 |
| `cq` Chongqing Jiulongpo District TCM Hospital | 8 / 60 |

Keep every regimen at **8 diagnoses and 5 drugs at most** so that no template truncates it. See
[TEMPLATES.md](TEMPLATES.md) for the template system itself.

**OD-risk text is never printed.** `src/templates/**` must not reference `odRisk`, and
`check-odrisk.mjs` renders all five templates end-to-end and fails if any risk text (or any of its
characteristic keywords, such as `阿片三联征`, `恶性综合征` or `乳酸酸中毒`) leaks into the Typst
source. This is a deliberate safety boundary: the note is a UI aid, while the sheet keeps the frozen
layout.

---

## 9. Recipes

House style in `presets.ts`: two-space indentation, double quotes, trailing comma on every element.
Array order is display order.

### 9.1 Add a drug

Append one line at the end of `DRUGS`:

```ts
  { name: "盐酸示例片", brand: "示例厂牌", spec: "5mg x 14片/盒", price: 12.34, usage: "每日1次 每次1片 口服", class: "抗抑郁药", odRisk: "过量可致……（60 字以内，仅系统内提示）" },
```

Requirements:

1. `name` is the generic name and must not duplicate an existing drug (a duplicate makes
   `makeDrug()` return the wrong price; the self-check rejects it).
2. `spec`, `usage`, `brand` and `class` must be non-empty strings; `price` must be a positive
   number with two decimals.
3. Write `spec` as `dose x count/container` (`/盒`, `/瓶`, `/支` …) so that unit parsing works.
4. Add `odRisk` (60 Chinese characters or fewer, one line): the OD-risk coverage assertion requires
   every drug in the library to carry one. Reuse the wording of a pharmacologically similar drug if you
   have nothing better, but never leave it empty.
5. If you introduce a **new** `class` value, also add it to `OD_SCOPE_CLASSES` in
   [`studio/scripts/check-odrisk.mjs`](../studio/scripts/check-odrisk.mjs); assertion ①-d fails until
   you do, because it requires every class present in `DRUGS` to be inside the coverage scope.

### 9.2 Add a diagnosis

Add a string to an existing group's `items`, or add a whole group object:

```ts
  {
    group: "新分组名",
    items: ["诊断一", "诊断二"],
  },
```

Entries must be unique across **all** groups (the check flattens the array before comparing), and a new
group must keep the `{ group, items }` shape. Order inside the group is display order.

### 9.3 Add a common regimen (the one with hard constraints)

Append to `REGIMENS`:

```ts
  { name: "方案名", diagnosis: ["抑郁状态"], drugs: ["盐酸舍曲林片", "劳拉西泮片"] },
```

Constraints — the generator looks drugs up by `name` and silently produces an empty specification and
`0.00` when the lookup misses:

- every `drugs` entry must match a `DRUGS[].name` **character for character**;
- every `diagnosis` entry must match an item of `DIAGNOSES` **character for character**;
- `name` must be globally unique; neither array may be empty;
- keep it within the smallest template limits (8 diagnoses, 5 drugs) — see
  [section 8](#8-how-the-data-is-consumed).

The regimen list is organised in six blocks, mirroring the order of the diagnosis groups plus a
general-medicine tail:

| Block | Entries | Examples (verbatim) |
| ----- | ------- | ------------------- |
| Depression and bipolar disorder | 17 | `抑郁状态·基础方案`, `难治性抑郁·增效`, `双相情感障碍·维持期`, `躁狂发作·急性期` |
| Anxiety, OCD, trauma and adjustment | 8 | `广泛性焦虑`, `惊恐障碍`, `强迫性障碍·强化方案`, `创伤后应激障碍` |
| Psychotic disorders | 6 | `精神分裂症·首诊`, `精神分裂症·阳性症状`, `分裂情感性障碍` |
| Sleep, child/adolescent, addiction, eating, cognitive and organic | 13 | `失眠症·短程`, `儿童注意缺陷多动障碍`, `酒精依赖·戒断期`, `老年认知障碍`, `血管性痴呆` |
| Regimens built on the newer `抑郁症` / `焦虑症` entries | 8 | `抑郁症·SSRI 起始`, `焦虑症伴失眠`, `双相障碍·锂盐维持`, `失眠症·非苯二氮䓬类` |
| Internal medicine and allergy | 16 | `发热·解热镇痛`, `高血压·联合降压`, `心房颤动·率控与抗凝`, `2 型糖尿病·基础-餐时胰岛素`, `癌性疼痛·阿片类起始` |

The blocks are a reading aid, not a data structure: `REGIMENS` is one flat array, and the counts above
add up to the 68 entries in list order.

The full 68-row table with the diagnoses and drugs of every regimen is in
[docs/zh-CN/PRESETS.md](zh-CN/PRESETS.md).

### 9.4 Add a hospital, department, usage or tip block

```ts
export const HOSPITALS = [
  // …
  "示例医院",
];

export const DEPARTMENTS = [
  // …
  "示例科室",
];

export const USAGE_PRESETS = [
  // …
  "每日1次 每次1片 口服",
];

export const TIP_PRESETS = [
  // …
  ["(1)请遵医嘱服药", "(2)示例提示", "(3)示例提示"],
];
```

`HOSPITALS`, `DEPARTMENTS` and `USAGE_PRESETS` are flat string arrays; `TIP_PRESETS` is an array of
three-line blocks (one block = one advice set printed in the footer). Duplicates are rejected for
hospitals, departments and diagnoses; usage and tip strings are not checked for uniqueness, but the
check does require every tip block to be non-empty.

---

## 10. Self-checks

Every command runs **from the `studio/` directory inside the repository root** (the root is the level
that contains [README.md](../README.md)). Install dependencies once with `npm install` (Node 20 or
newer; development uses Node 22).

### 10.1 Build artefacts you must generate first

`studio/scripts/*.mjs` files that have a same-named `*.ts` sibling are **rolldown build output and are
not committed**. Those ten entries are `__zz_test`, `_probe_bj3`, `_probe_limits`, `long-diag`,
`render-all`, `stress-templates`, `test-extremes`, `test-gen`, `test-qr` and `test-variants`.
After a fresh clone (or after editing anything under `src/`), generate them before running the scripts
that depend on them:

```bash
cd studio
npm run bundle                 # incremental: rebuild only missing or stale entries
npm run bundle -- render-all   # rebuild selected entries only
npm run bundle -- --force      # ignore timestamps, rebuild everything
npm run bundle -- --check      # CI mode: verify artefacts are current, write nothing
```

The hand-written scripts — `bundle.mjs`, `start.mjs`, `pack.mjs`, `gen-presets-doc.mjs`,
`check-presets.mjs`, `check-tcm.mjs` and `check-odrisk.mjs` — have no `*.ts` source and are
committed, so they run without bundling. `npm run check:presets` still runs `npm run bundle` first,
which makes it the safe entry point in a fresh clone.

The preset checks do **not** need the Typst kernel. Only the rendering checks do; obtain it with

```bash
npm run fetch:typst            # defined in package.json as: node scripts/fetch-typst.mjs
```

which unpacks the Typst CLI to `studio/resources/typst.exe` (about 50 MB, ignored by Git; the
application looks for it in `resources/` during development and next to the packaged resources in a
build). Re-run it with `-- --force` to replace an existing binary; if the download is impossible, fetch
Typst 0.15.x for Windows x64 manually and place the binary at `studio/resources/typst.exe` instead, as
described in the root [README.md](../README.md).

### 10.2 Commands

```bash
cd studio

npm run check:presets     # npm run bundle && node scripts/check-presets.mjs
npm run check:odrisk      # npm run bundle && node scripts/check-odrisk.mjs
npm test                  # bundle + the template/render checks + all three preset checks
npm run build             # Vite build of the renderer into dist/
npx tsc --noEmit          # type-check only (npm run build does not type-check)
```

`check-presets.mjs` can also be run directly (`node scripts/check-presets.mjs`) because it has no
`*.ts` sibling — it only needs `npm install` to have run.

### 10.3 Coverage of `check-presets.mjs`

The script bundles `src/data/presets.ts` into a temporary ESM file with the rolldown dependency that
ships with Vite, imports it, and prints one `PASS` / `FAIL` line per assertion (exit code 1 on any
failure; no new dependency is added). It checks:

| # | Assertion |
| - | --------- |
| 1 | Every `REGIMENS[].drugs` entry exists in `DRUGS[].name` |
| 2 | Every `REGIMENS[].diagnosis` entry exists in `DIAGNOSES[].items` |
| 3 | No duplicate `DRUGS[].name` |
| 4 | No duplicate `HOSPITALS`, `DEPARTMENTS`, `REGIMENS[].name` or diagnosis entry (across all groups) |
| 5 | Every drug has non-empty `spec` / `usage` / `brand` / `class` and a finite price greater than 0 |
| 6 | Every regimen has a non-empty `name` and at least one diagnosis and one drug |
| 7 | Size floors (below) |

| Collection | Floor asserted | Current |
| ---------- | -------------- | ------- |
| `HOSPITALS` | at least 30 | 40 |
| `DEPARTMENTS` | at least 20 | 22 |
| `DIAGNOSES` | at least 8 groups and at least 60 entries | 11 / 105 |
| `DRUGS` | at least 45 | 77 |
| `REGIMENS` | at least 15 | 68 |
| `USAGE_PRESETS` | at least 20 | 25 |
| `TIP_PRESETS` | at least 6 blocks, all non-empty | 7 |

It finishes with a statistics line (`统计：医院 … / 科室 … / 诊断 … 组 … 条 / 药品 … / 方案 … / 用法 … / 提示语 … 组`)
followed by `ALL CHECKS PASSED`, or by `FAILED: n -> …` and exit code 1.

### 10.4 Coverage of `check-odrisk.mjs`

`npm run check:odrisk` is the overdose-risk-specific companion. It asserts that the historical task
lists (the 24 drugs, 24 regimens and 12 diagnoses added in one expansion round, and the 18 drugs whose
`odRisk` was filled in later) are all present, and then:

- every one of those drugs has a non-empty `odRisk`;
- all `odRisk` strings are 60 Chinese characters or fewer, non-blank, and none exceeds the hard
  80-character limit;
- every `class` used in `DRUGS` appears in `OD_SCOPE_CLASSES` (17 classes) and every drug in those
  classes has a non-empty `odRisk`, with a whitelist mechanism that must state a reason per entry
  (currently empty);
- the libraries are duplicate-free and every regimen referenced by the task lists resolves to a real
  drug and a real diagnosis;
- `src/templates/**` contains no reference to `odRisk`, `DrugItem.odRisk` exists in `doc.ts`,
  `odRiskOf(name)` returns text for a known drug and `""` for an unknown one, and
  `COLD_MEDICINE_HINTS` has at least 2 complete entries, none of which is also a `DRUGS` entry;
- end-to-end: all five templates are built from probe documents, and the output must contain the probe
  drug names while containing no `odRisk` string and none of the 21 characteristic risk keywords.

Practical consequences: a new drug without `odRisk` fails assertion ①-g (100 % coverage), and a new
`class` fails ①-d until it is added to `OD_SCOPE_CLASSES`.

### 10.5 Regenerating the Chinese listing

```bash
cd studio
node scripts/gen-presets-doc.mjs
```

The script writes the Chinese listing to `docs/zh-CN/PRESETS.md` (see
[section 1](#1-where-the-data-lives-and-how-the-two-documents-relate)) and never touches this English
reference, so regenerating it is always safe.

---

## 11. Troubleshooting

| Symptom | Cause | Fix |
| ------- | ----- | --- |
| A regimen fills in a drug with an empty specification and `0.00` | The `drugs` string does not match `DRUGS[].name` exactly (typo, ASCII instead of full-width punctuation, extra space) | `npm run check:presets` names the offending regimen and drug |
| A regimen is truncated | It exceeds the active template's limits (`bj6` 8/5, `zz` 12/20, `bj3` and `zy` 6/6, `cq` 8/60) | Shorten the regimen; the form truncates silently by design |
| The picker order does not match expectations | Array order *is* display order | Move the entry within its array |
| `FAIL  REGIMENS 中每个 diagnosis 都存在于 DIAGNOSES` | The diagnosis is missing from `DIAGNOSES`, or spelled with different punctuation | Add it to a group verbatim, or fix the regimen |
| `①-d DRUGS 中所有 class 都在 odRisk 覆盖率断言范围内` fails | A new drug introduced a new `class` value | Add the class to `OD_SCOPE_CLASSES` in `check-odrisk.mjs` |
| `①-g 全库 odRisk 覆盖率 100%（77/77）` fails | A new drug has no `odRisk` | Write a note of 60 characters or fewer |
| `scripts/*.mjs` files are missing after a clone | They are build output and are git-ignored | `npm run bundle` |
| `Cannot find module 'rolldown'` | `npm install` has not run in `studio/` | `cd studio && npm install` |

---

## 12. Related documents

- [docs/zh-CN/PRESETS.md](zh-CN/PRESETS.md) — the complete generated Chinese listings
- [TEMPLATES.md](TEMPLATES.md) — the template system, per-template limits and extended fields
- [PACKAGING.md](PACKAGING.md) — building and shipping the desktop application
- [README.md](../README.md) / [README.zh-CN.md](../README.zh-CN.md) — project overview
- Source of truth: [`studio/src/data/presets.ts`](../studio/src/data/presets.ts)
- Checks and tooling: [`check-presets.mjs`](../studio/scripts/check-presets.mjs),
  [`check-odrisk.mjs`](../studio/scripts/check-odrisk.mjs),
  [`gen-presets-doc.mjs`](../studio/scripts/gen-presets-doc.mjs),
  [`bundle.mjs`](../studio/scripts/bundle.mjs)
