# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- **CI workflow** — [`.github/workflows/ci.yml`](.github/workflows/ci.yml) runs on every push to `main` and on
  every pull request: `windows-latest` with Node 22 (the version Electron 43 bundles), npm caching and
  `working-directory: studio`. Steps: `npm ci` → `npx tsc --noEmit` → `npm run bundle` → `npm run build` →
  `node scripts/fetch-typst.mjs` → `render-all` → `test-variants` → `check-presets` → `check-odrisk` →
  `check-tcm`. Least-privilege `contents: read`, a concurrency group that cancels superseded runs, and a
  guard that fails the build if a build product (`*.mjs` with a `.ts` source, or any `*.exe`) is committed.
- **`npm run fetch:typst`** — reproducible acquisition of the pinned Typst 0.15.1 runtime
  (`scripts/fetch-typst.mjs`): idempotent (skips when the local binary already reports 0.15.1), `--force` to
  re-download, verifies the official archive against a **pinned byte size and SHA-256** (`ASSET_SIZE` /
  `ASSET_SHA256`) before unpacking it, resolves proxies as `--proxy <url>` → `HTTPS_PROXY` / `HTTP_PROXY` with
  `NO_PROXY` bypasses and `--no-proxy` for a forced direct connection, unpacks the official
  `typst-x86_64-pc-windows-msvc.zip` in pure JavaScript, and prints actionable manual instructions —
  including the ready-made `.exe` attached to the v1.0.0 release — when the download cannot be completed.
- **`npm run bundle`** — `scripts/bundle.mjs` bundles every `scripts/*.ts` entry point into
  `scripts/<name>.mjs` with the project's existing rolldown, incrementally, with `--force`,
  single-entry and CI-friendly `--check` modes.
- **English documentation** — the three in-depth references now have a usable English edition in
  `docs/` (`PACKAGING.md`, `TEMPLATES.md`, `PRESETS.md`) beside their Chinese originals in `docs/zh-CN/`,
  and the README gained *Demo Data*, *Getting the Typst Runtime* and *Security & Privacy* sections plus CI
  and CodeQL badges.
- **Manual release pipeline** — [`.github/workflows/release.yml`](.github/workflows/release.yml) is
  `workflow_dispatch`-only and defaults to `dry_run: true`, which builds the Windows installer and portable
  build in CI, prints the SHA-256 checksums and uploads them as workflow artifacts **without touching any
  release**. Only an explicit `dry_run: false` run reaches the `publish` job (the single job with
  `contents: write`), which creates the release on the dispatched commit or replaces its assets. Documented in
  [`docs/PACKAGING.md`](docs/PACKAGING.md#how-to-cut-a-release) and `docs/zh-CN/PACKAGING.md`.

### Changed

- **Single project identity** — the repository, application, npm package, Electron app ID, portable
  directory, launchers and release artifacts now all use `Prescription`; the former project-name suffix has
  been retired.
- **Build products are no longer committed.** The ten `studio/scripts/*.mjs` files that have a `.ts` source
  are rolldown output: they are now ignored through `studio/scripts/.gitignore` and rebuilt with
  `npm run bundle` after a clone (or after editing a source). The hand-written `.mjs` tools remain tracked.
- `rolldown` is declared as an explicit devDependency instead of relying on the copy that Vite happens to
  hoist, and `studio/package-lock.json` is kept in sync for `npm ci`.
- **TypeScript 5.9 → 7.0** (the native compiler): `baseUrl` was removed from `studio/tsconfig.json` (paths now
  resolve relative to the config file, so the `@/*` alias is unchanged) and `studio/src/vite-env.d.ts` was
  added, because TypeScript 7 reports unresolved side-effect imports such as `import "./ui.css"` as errors.
  Type checking was not weakened: no option was relaxed and no `@ts-ignore` was added.
- `studio/scripts/.gitignore` now **lists the ten generated artifacts explicitly** instead of ignoring
  `*.mjs` with a negation whitelist — a new hand-written tool is tracked by default, which is exactly what the
  previous rule got wrong for `fetch-typst.mjs`. The root `.gitignore` also dropped two redundant rules
  (`studio/analysis/`, covered by `analysis/`, and `verification/*.png`, covered by `verification/**/*.png`).
- `scripts/gen-presets-doc.mjs` now writes the generated Chinese preset reference to
  `docs/zh-CN/PRESETS.md` (the previous `studio/docs/` tree is gone); the English `docs/PRESETS.md` is
  hand-written and safe from regeneration.
- `studio/README.md` was refreshed (it still listed the pre-1.0 preset counts and a removed documentation
  path), and `CONTRIBUTING.md` now points at the new documentation layout and describes `npm run bundle`
  instead of the retired esbuild command.

### Removed

- Removed `README.zh-CN.md`; public documentation is now English-only.

### Security

- **The repository is public**, with CodeQL code scanning, secret scanning and push protection, and
  Dependabot updates for both npm (`/studio`) and GitHub Actions enabled.
- **Hardened Typst escaping** in the `zy` and `bj3` template generators and in the preset-documentation
  generator: backslashes are escaped *before* quotes and Typst markup characters, so a value can no longer
  break out of its string literal (CodeQL `js/incomplete-sanitization`). Rendering output is byte-for-byte
  unchanged for all five templates and all variants.
- Removed three dead locals/imports, replaced the predictable QR-verification temporary file with a private
  `mkdtempSync` directory that is removed afterwards, and made `studio/package-lock.json` diffable again.
- Documented the one remaining `sprintf-js` advisory — dev-only build tooling, no upstream fix — in
  [`SECURITY.md`](SECURITY.md#known-issues).

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

[Unreleased]: https://github.com/XXXXXQ-0206/prescription/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/XXXXXQ-0206/prescription/releases/tag/v1.0.0
