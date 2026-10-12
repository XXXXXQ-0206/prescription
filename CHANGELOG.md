# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Planned

- Template plugin API and a template scaffold command.
- Unit tests for the Code 128 and QR encoders, wired into CI.
- English user interface in addition to the Chinese one.
- Prescription archive (history, search, re-print) and batch export.
- Optional drug-interaction checks on top of the overdose-risk table.
- macOS / Linux builds (requires a font-substitution strategy for SimSun).

## [1.0.0] - 2026-10-12

First public release.

### Added

- **Multi-template layout engine** with five hospital prescription sheets, each defining its own page
  geometry, extended fields, section flags and content limits:
  - `bj6` — Peking University Sixth Hospital, non-insurance prescription (836 × 470.5 pt, 8 diagnoses / 5 drugs),
    a pixel-measured replica including the closed paper-edge shadow frame.
  - `zz` — Zhengzhou Central Hospital prescription sheet (419.5 × 595.3 pt, 12 / 20) with QR code, a
    "ordinary / valid today" box and two-line Rp drug rows.
  - `bj3` — Peking University Third Hospital insurance outpatient prescription (842 × 595.3 pt, 6 / 6),
    landscape, barcode and ID / identity / social-security fields, five-column drug table.
  - `zy` — Fifth Affiliated (Zhuhai) Hospital of Zunyi Medical University (419.5 × 595.3 pt, 6 / 6) with
    barcode, bilingual hospital name and two lines per drug.
  - `cq` — Chongqing Jiulongpo District TCM Hospital (559 × 794 pt, 8 / 60) with a three-column herb grid,
    decoction instructions and a pharmacy-regulation footer.
- **Typst-based rendering pipeline**: form data → Typst source → vector SVG preview → PDF / PNG (300 dpi) /
  Typst source export, so what you preview is exactly what you export.
- **Desktop shell**: fixed 1240 × 820 window, native title-bar overlay, system tray (close-to-tray),
  single-instance lock, native save/open dialogs, reveal-in-folder, and `Ctrl+S` / `Ctrl+E` / `Ctrl+P`
  shortcuts.
- **Preset libraries**: 40 hospitals, 22 departments, 11 diagnosis categories with 105 entries, 77 drugs with
  brand, specification, unit price, usage and **overdose (OD) risk notes**, 68 ready-made regimens, 25 usage
  presets, 7 tip sets and 8 doctors — all freely editable in the form.
- **Overdose-risk hints** for the drug library, displayed in the UI only and never printed on a prescription.
- **Live layout validation**: diagnosis/drug limits per template, missing patient name, over-long names or
  specifications, with red (not printed) and orange (warning) severities.
- **In-tree encoders**: Code 128 barcode (automatic code set C for even-length digits) and a complete QR code
  encoder, with no third-party runtime dependency.
- **Data persistence**: prescription JSON save/load plus automatic draft restore on the next launch.
- **Performance work**: LRU render cache (24 entries), in-flight request coalescing with cancellation, Typst
  font warm-up before the window appears, and stale-response rejection — 250–550 ms per preview compile,
  ~0.3 s first paint.
- **Packaging**: `scripts/pack.mjs` + `electron-builder` producing an NSIS installer and a portable
  executable; the portable build is self-contained and relocatable.
- **Documentation**: bilingual READMEs, template and preset references, packaging notes, and self-check
  scripts (`render-all`, `test-variants`, `stress-templates`, `check-presets`, `check-odrisk`, `check-tcm`).
- **Vector Typst replicas** of the reference sheet (`prescription.typ`, `prescription_scan_like.typ`) with
  fictional sample data.

### Security

- Renderer hardened with `contextIsolation: true`, `nodeIntegration: false`, a `contextBridge`-only preload
  and a restrictive Content-Security-Policy.
- All sample patient names, record numbers, barcode numbers, prescription numbers and physician names in the
  source were replaced with obviously fictional demo values of identical length and format.
- Reference scans, scan-derived crops and machine-specific absolute paths are excluded from version control
  through `.gitignore` and were removed from the documentation.
- Added a security policy, a code of conduct, CodeQL analysis and Dependabot updates.

[Unreleased]: https://github.com/XXXXXQ-0206/prescription-master/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/XXXXXQ-0206/prescription-master/releases/tag/v1.0.0
