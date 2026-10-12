# Prescription Master

English | [中文](README.zh-CN.md)

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Electron](https://img.shields.io/badge/Electron-43-47848F.svg)](https://www.electronjs.org/)
[![React](https://img.shields.io/badge/React-19-61DAFB.svg)](https://react.dev/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.9-3178C6.svg)](https://www.typescriptlang.org/)
[![Typst](https://img.shields.io/badge/Typst-0.15-239DAD.svg)](https://typst.app/)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](CONTRIBUTING.md)

> A desktop application that generates hospital prescription sheets from a form, lays them out with
> **Typst**, and exports **PDF / PNG (300 dpi) / Typst source** with pixel-accurate previews.

---

## Project Overview

Prescription Master is an Electron desktop application for producing prescription sheets that match the
paper layouts used by several hospitals. The user fills in a form (hospital, patient, diagnosis, drugs,
prescription options); the application converts that data into a Typst document, compiles it with a
bundled Typst engine, and renders the result as a vector SVG preview plus PDF / PNG exports.

The repository contains two deliverables:

| # | Deliverable | Location | Description |
| - | ----------- | -------- | ----------- |
| 1 | Typst replica of a scanned prescription | [`prescription.typ`](prescription.typ), [`prescription_scan_like.typ`](prescription_scan_like.typ) | A scanned sheet was measured pixel by pixel and re-typeset as vector Typst at 1 px = 0.5 pt. |
| 2 | **Prescription Master** desktop app | [`studio/`](studio/) | Multi-template prescription generator with live preview and PDF/PNG/Typst export. |

The scanned source sheets and every development artefact derived from them are **deliberately not
distributed** (see [Privacy and data](#privacy-and-data)). All sample data shipped in the source code is
fictional and intended for demonstration only.

---

## Features

### Multi-template layout engine

Five hospital layouts are implemented in [`studio/src/templates/`](studio/src/templates/), each with its own
geometry, field set, section flags and content limits. Switching a template applies its own example data and
extended fields.

| Template ID | Layout | Page (pt) | Limits (diagnoses / drugs) |
| ----------- | ------ | --------- | -------------------------- |
| `bj6` | Peking University Sixth Hospital — non-insurance prescription; four-cell table with a closed paper-edge shadow frame (absolute positioning) | 836 × 470.5 | 8 / 5 |
| `zz` | Zhengzhou Central Hospital prescription sheet; QR code, "ordinary / valid today" box, two-line Rp drug rows | 419.5 × 595.3 | 12 / 20 |
| `bj3` | Peking University Third Hospital (insurance) outpatient prescription; landscape, barcode + ID / identity / social-security fields, five-column drug table | 842 × 595.3 | 6 / 6 |
| `zy` | Fifth Affiliated (Zhuhai) Hospital of Zunyi Medical University; barcode, bilingual hospital name, two lines per drug | 419.5 × 595.3 | 6 / 6 |
| `cq` | Chongqing Jiulongpo District TCM Hospital; three-column herb grid, decoction instructions, pharmacy-regulation footer | 559 × 794 | 8 / 60 |

### Preset libraries

Everything is editable — the presets are starting points, not a controlled vocabulary.

| Preset | Content |
| ------ | ------- |
| Hospitals | 40 |
| Departments | 22 |
| Diagnoses | 11 categories, 105 entries |
| Drugs | 77 psychiatric / general medicines with brand, specification, unit price, usage and **overdose (OD) risk notes** |
| Regimens | 68 ready-made "diagnosis + medication" combinations |
| Usage presets | 25 |
| Tip sets | 7 |
| Doctors | 8 (freely replaceable) |

### Rendering and export

- **Form data → Typst source → vector SVG preview / PDF / PNG**, so the preview and the export are byte-identical.
- PNG export at **300 dpi**; PDF is vector; the generated `.typ` file can be version-controlled or recompiled by hand.
- Preview is a real SVG: zoom 20 %–250 %, sharp at any scale.
- Prescription data can be saved to / loaded from JSON; the current draft is restored on the next launch.
- **Code 128** barcode generated from the record number (automatically uses code set C for even-length digits,
  which produces wider, easier-to-scan bars) and an in-house QR encoder — no runtime barcode/QR dependency.

### Desktop integration

- Fixed 1240 × 820 window with a native title-bar overlay.
- **System tray**: closing the window hides it; the tray menu shows/hides the window and really quits.
- **Single instance**: launching a second copy focuses the running window instead of opening a new one.
- Save dialogs for PDF / PNG / Typst / JSON, plus "reveal in folder" after export.
- Hardened renderer: `contextIsolation: true`, `nodeIntegration: false`, `contextBridge` preload only, and a
  restrictive Content-Security-Policy in [`studio/index.html`](studio/index.html).
- Keyboard shortcuts: `Ctrl+S` save data, `Ctrl+E` export PDF, `Ctrl+P` export PNG.

### Performance

1. **Render cache** — identical Typst source is compiled once (LRU of 24 entries); undo or flipping between
   two field values costs nothing.
2. **Request coalescing** — only one preview compilation runs at a time; a newer request kills the in-flight
   process, so continuous typing never queues (measured 250–550 ms per compile).
3. **Warm-up** — a minimal document is compiled before the window appears (`TYPST_PREWARM ok`), so the first
   paint drops from ≈1.9 s cold to ≈0.3 s.
4. **Stale response rejection** — every request is numbered; late results never overwrite a newer preview.

### Safety and validation aids

- **Overdose (OD) risk hints** for the drugs in the preset library, shown in the UI only. The templates never
  read that field, so it is **never printed on a prescription**.
- Layout validation: diagnoses over the template limit, drugs over the limit, missing patient name, over-long
  names or specifications — reported under the preview (red = not printed, orange = warning).
- Amount totals are computed live as price × quantity.

---

## Screenshots

![Prescription Master main window](docs/images/screenshot-app.png)

*Form on the left, live vector preview on the right, export buttons in the top bar.*

| Template `bj6` (replica) | Template `bj3` (insurance, landscape) | Template `cq` (traditional Chinese medicine) |
| --- | --- | --- |
| ![bj6](docs/images/template-bj6.png) | ![bj3](docs/images/template-bj3.png) | ![cq](docs/images/template-cq.png) |

> All screenshots were produced with the built-in fictional demo data.

---

## Installation

### Prerequisites

| Requirement | Notes |
| ----------- | ----- |
| **Windows 10/11 (x64)** | The layouts depend on fonts that ship with Windows: **SimSun (宋体)**, Arial, Courier New. |
| **Node.js ≥ 20** | Node 22 is used for development. |
| **Typst 0.15.x** | Not vendored in this repository (see below). |

### 1. Clone

```bash
git clone https://github.com/XXXXXQ-0206/prescription-master.git
cd prescription-master
```

### 2. Provide the Typst engine

Download the Typst CLI for Windows x64 (v0.15.x) from <https://github.com/typst/typst/releases> and place the
binary at:

```
studio/resources/typst.exe
```

The application looks for `resources/typst.exe` in development and for `typst.exe` next to the packaged
resources in a build. It is deliberately ignored by Git: it is a 50 MB third-party binary.

### 3. Install dependencies and start

```bash
cd studio
npm install
npm start          # builds the renderer and launches the desktop app
```

---

## Usage

1. **Pick a template** in the top bar (`单据模板`). The template switch loads its own example data and fields.
2. **Fill in the left form** — document type and hospital, patient, diagnoses, drugs, doctor and layout options.
   Field groups collapse; every change updates the preview immediately (200 ms debounce).
3. **Check the preview** on the right. Zoom with the toolbar or `Ctrl` + mouse wheel; the status bar shows the
   render time, cache hits, the Typst version and the layout-validation result.
4. **Export** with the `Typst` / `PNG` / `PDF` buttons (or `Ctrl+E` / `Ctrl+P`).
5. **Save or load** the prescription as JSON, or just close the window — the draft is restored next time.

### Command line entry points

| Command (from `studio/`) | Purpose |
| ------------------------- | ------- |
| `npm start` | Build the renderer and launch the desktop app |
| `npm run dev` | Launch against the Vite dev server (hot reload of the UI) |
| `npm run build` | Build the renderer into `dist/` only |
| `npm run shot` | Launch, capture a screenshot to `shot.png`, exit (unattended self-check) |
| `node scripts/start.mjs --export-test` | Compile `out/generated.typ` to PDF/PNG/SVG without a window |
| `node scripts/render-all.mjs` | Render every template with its default data to `out/tpl-<id>.png` |
| `node scripts/test-variants.mjs` | Compile all layout variants |
| `node scripts/check-presets.mjs` | Assert the consistency of the preset libraries |

> **Note**: `scripts/*.mjs` files that have a `.ts` sibling are pre-bundled dev entry points. Regenerate one
> after editing its source with
> `npx esbuild scripts/<name>.ts --bundle --format=esm --platform=node --outfile=scripts/<name>.mjs '--alias:@=./src'`.

---

## Build Instructions

```bash
cd studio

# 1. Type-check (no emit)
npx tsc --noEmit

# 2. Build the renderer
npm run build                 # → studio/dist

# 3. Package the desktop application (NSIS installer + portable exe)
npm run pack                  # → studio/release
```

`npm run pack` calls `scripts/pack.mjs`, which copies the Electron runtime and the application files and
then invokes `electron-builder`. The packaged build expects `studio/resources/typst.exe` to exist, and the
resulting installer/portable artifacts are written to `studio/release/` (ignored by Git).

Packaging details, a portable-build smoke test and troubleshooting notes live in
[`studio/docs/PACKAGING.md`](studio/docs/PACKAGING.md).

---

## Project Structure

```
prescription-master/
├── README.md                     # this file (English)
├── README.zh-CN.md               # Chinese translation
├── LICENSE                       # MIT
├── CONTRIBUTING.md  SECURITY.md  CODE_OF_CONDUCT.md  CHANGELOG.md
├── .github/                      # CI (CodeQL), Dependabot, issue & PR templates
├── docs/
│   └── images/                   # screenshots used by the READMEs
├── prescription.typ              # vector Typst replica (clean electronic version)
├── prescription_scan_like.typ    # replica tuned to match the scan (paper noise, blur)
└── studio/
    ├── electron/
    │   ├── main.mjs              # main process: window, tray, IPC, Typst compile/export, JSON I/O
    │   └── preload.cjs           # contextBridge surface (`window.presc`)
    ├── src/
    │   ├── App.tsx               # shell: top bar + form + preview, state and export orchestration
    │   ├── components/           # FormPanel / PreviewPanel / Picker / bits
    │   ├── templates/            # template system: types, kit, generic + bj6 | zz | bj3 | zy | cq + registry
    │   ├── data/                 # presets.ts (hospitals, diagnoses, drugs, regimens…), tcm.ts (herb library)
    │   ├── lib/                  # doc.ts (model/defaults/validation), barcode.ts, qr.ts
    │   ├── styles/               # design tokens, theme, base, application CSS
    │   └── ui/                   # 15 primitives (button, input, select, switch, dialog, tooltip…)
    ├── docs/                     # TEMPLATES.md, PRESETS.md, PACKAGING.md
    ├── resources/                # icon.png / icon.ico (typst.exe is not committed)
    └── scripts/                  # start / pack / render-all / test-* / check-* dev tooling
```

`refs/`, `origin_pic.png`, `analysis/` and `verification/**/*.png` exist only in a local working copy and are
ignored by Git — see below.

### Privacy and data

The layouts were derived from scanned prescription sheets that contain real patient names and record numbers.
Those scans, all crops derived from them, and the tooling that references their absolute paths are **excluded
from version control**. Every sample value that appears in the source code (patient name, record number,
barcode number, prescription number, physician name) has been replaced with obviously fictional demo data of
the same length and format, so the layouts are unchanged while the identifiers are not real. The
`analysis/` and `verification/**/*.png` trees are local-only development evidence.

---

## Roadmap

- [x] Five hospital templates with per-template extended fields and limits
- [x] Typst-based vector preview, PDF / PNG / Typst export
- [x] Tray, single instance, JSON persistence, OD-risk hints
- [ ] Template plugin API + a template scaffold command
- [ ] Unit tests for the barcode / QR encoders and wire them into CI
- [ ] i18n of the interface (English UI in addition to Chinese)
- [ ] Prescription archive (history, search, re-print) and batch export
- [ ] Optional drug-interaction checks on top of the OD-risk table
- [ ] Build and verify on macOS / Linux (needs font substitution for SimSun)

---

## Contributing

Contributions are welcome — bug reports, template fixes, documentation and translations alike. Please read
[`CONTRIBUTING.md`](CONTRIBUTING.md) first; it describes the branch/PR workflow, the Conventional Commits
convention, the coding style and the self-check commands that must pass.

By participating you agree to the [Code of Conduct](CODE_OF_CONDUCT.md). Security issues must be reported
privately as described in [`SECURITY.md`](SECURITY.md), **not** in a public issue.

---

## License

Released under the [MIT License](LICENSE). © 2026 XXXXXQ-0206.

---

## FAQ

**Is this a medical device?**
No. It is a document generator. See the [Disclaimer](#disclaimer).

**Why is `typst.exe` missing?**
Because it is a 50 MB third-party binary that is not redistributed here. Download it from the
[Typst releases page](https://github.com/typst/typst/releases) and place it at `studio/resources/typst.exe`.

**The preview or the export fails with a typst error.**
Check that `studio/resources/typst.exe` exists and that `typst --version` works. In a packaged build the
binary must be next to the application resources.

**Can I use this on macOS or Linux?**
The Electron shell is cross-platform, but the templates were measured against Windows fonts (SimSun, Arial,
Courier New). Without those fonts the layouts will shift. Font substitution work is on the roadmap.

**Where are the reference scans?**
They are not in this repository, on purpose — they contain real patient data. Only the vector replicas
(`prescription.typ`, `prescription_scan_like.typ`) with fictional sample data are published.

**How do I add another hospital?**
Read [`studio/docs/TEMPLATES.md`](studio/docs/TEMPLATES.md): add a module under `studio/src/templates/`,
export a `Template` object (`id`, `name`, `page`, `limits`, `sections`, `extraKeys`, `defaults`, `build`) and
register it in `studio/src/templates/index.ts`. Then run `node scripts/render-all.mjs <id>` to check it.

**Are the drug prices realistic?**
They are demo values collected with the sample data and may be outdated; the amount fields are editable and
are never used for any billing calculation outside this application.

---

## Acknowledgements

- [Typst](https://typst.app/) — the typesetting engine that makes vector-accurate output possible.
- [Electron](https://www.electronjs.org/), [React](https://react.dev/), [Vite](https://vite.dev/),
  [TypeScript](https://www.typescriptlang.org/), [Tailwind CSS](https://tailwindcss.com/).
- [Radix UI](https://www.radix-ui.com/), [lucide-react](https://lucide.dev/), [sonner](https://sonner.emilkowal.ski/).
- The prescription layouts follow publicly visible paper forms of the respective hospitals; hospital names,
  physician names and all patient identifiers in this repository are fictional demo data.

---

## Disclaimer

**The software is provided "AS IS", without warranty of any kind.** To the maximum extent permitted by
applicable law:

- The software is distributed **without any express or implied warranty**, including but not limited to the
  warranties of merchantability, fitness for a particular purpose, accuracy and non-infringement.
- The author and contributors **accept no liability** for any direct, indirect, incidental, special,
  consequential or punitive damages, or for any loss of data, revenue, profit or reputation, arising from the
  use of, or inability to use, this software.
- **You use this software entirely at your own risk.** You are solely responsible for verifying every output
  before it is used, filed or handed to a patient.
- **This software must not be used for any unlawful purpose.** Producing forged, falsified or misleading
  medical documents, or impersonating a medical institution or practitioner, is illegal and strictly
  prohibited. Users must comply with all applicable laws and regulations of their jurisdiction.
- **This software is NOT a medical device.** It has not been reviewed, certified or approved by any regulatory
  authority (such as NMPA, FDA or CE). It provides no medical advice, diagnosis or treatment recommendation.
- **Prescription content and medication safety are the sole responsibility of the user.** The built-in preset
  libraries, drug information, dosage suggestions and overdose-risk hints are demo data for reference only;
  they may be incomplete, outdated or wrong, and must never be relied upon clinically. Qualified medical
  professionals remain responsible for every prescription they issue.
