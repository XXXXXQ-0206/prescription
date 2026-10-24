# Contributing to Prescription

First of all, thank you for taking the time to contribute! 🎉

This document explains how to report problems, propose changes and get them merged. By participating you
agree to abide by our [Code of Conduct](CODE_OF_CONDUCT.md).

## Table of contents

- [Ways to contribute](#ways-to-contribute)
- [Reporting bugs](#reporting-bugs)
- [Suggesting features](#suggesting-features)
- [Security issues](#security-issues)
- [Privacy rules — read this first](#privacy-rules--read-this-first)
- [Development setup](#development-setup)
- [Project conventions](#project-conventions)
- [Commit messages](#commit-messages)
- [Pull request workflow](#pull-request-workflow)
- [Self-checks that must pass](#self-checks-that-must-pass)
- [Adding a hospital template](#adding-a-hospital-template)
- [Documentation and translations](#documentation-and-translations)

## Ways to contribute

- Report a bug or a layout deviation (see the issue templates).
- Improve a template's geometry, field set or validation.
- Add or fix preset data (diagnoses, drugs, regimens) — with fictional, verifiable demo values.
- Improve the documentation, the README, or add a translation.
- Review pull requests and triage issues.

## Reporting bugs

Open an issue with the **Bug report** template and include:

- the app version, the Windows version and the Typst version shown in the status bar;
- the template id (`bj6`, `zz`, `bj3`, `zy`, `cq`) and, if possible, the exported `.typ` file;
- the exact steps to reproduce, the expected result and the actual result;
- screenshots if the problem is visual.

> Never attach a real prescription, a scan, or any file containing real patient data. Reproduce the problem
> with the built-in demo data, or with data you invented.

## Suggesting features

Open an issue with the **Feature request** template. Describe the problem you are trying to solve, the
proposed behaviour, and the alternatives you considered. For a new hospital template, please attach a blank
(or fully redacted) copy of the form if you can, or describe the layout precisely.

## Security issues

Do **not** open a public issue. Follow [SECURITY.md](SECURITY.md) and report privately through GitHub
Security Advisories.

## Privacy rules — read this first

This project deals with medical documents, so a few rules are non-negotiable:

1. **Never commit real patient data.** No scans, no photographs, no crops of real prescriptions, no real
   names, record numbers, ID numbers, phone numbers or addresses — not in code, not in fixtures, not in test
   output, not in screenshots, not in commit messages.
2. Sample data must be **obviously fictional** (for example `张伟` / `李娜` / `0000000000`) and must keep the
   same length and format as the value it replaces, so the layout is unaffected.
3. Do not commit machine-specific absolute paths (`C:\Users\<name>\...`). Use relative paths or placeholders
   such as `<repo>/studio`.
4. Do not commit generated artefacts: `dist/`, `out/`, `release/`, `tmp/`, screenshots of your own machine,
   PDFs, executables.
5. Before pushing, run `git ls-files` and confirm the list contains no images, scans, binaries or personal
   paths.

## Development setup

Requirements: Windows 10/11 x64, Node.js ≥ 20, and a Typst 0.15.x CLI placed at `studio/resources/typst.exe`
(see the README — the binary is not distributed with the repository).

```bash
git clone https://github.com/XXXXXQ-0206/prescription.git
cd prescription/studio
npm install
npm start          # build the renderer and launch the app
```

## Project conventions

- **TypeScript strict mode**; `npx tsc --noEmit` must be clean.
- **No new runtime dependency without a reason.** Barcode and QR encoding are implemented in-tree on purpose;
  keep the renderer dependency surface small.
- **Templates are pure functions**: `build(doc)` returns Typst source and must not read `drug.odRisk` or any
  UI-only field, because the templates are also used headlessly by the scripts.
- **Keep layout code and demo data separate.** Layout changes belong in `src/templates/*`; example values live
  in the template's `defaults` / `src/lib/doc.ts`. Never "fix" a layout by editing a sample value.
- Match the surrounding style of the file you edit (the codebase uses 2-space indentation, double quotes and
  Chinese comments in `src/`). Do not reformat unrelated code in the same pull request.
- Add or update the relevant documentation in `docs/` (English) and `docs/zh-CN/` (Chinese) when
  behaviour changes.

## Commit messages

The project uses [Conventional Commits](https://www.conventionalcommits.org/):

```
<type>(<optional scope>): <short imperative summary>

<optional body: what and why, not how>

<optional footer: BREAKING CHANGE: ..., Closes #123>
```

Common types: `feat`, `fix`, `docs`, `style`, `refactor`, `perf`, `test`, `build`, `ci`, `chore`,
`revert`. Example scopes: `templates`, `bj3`, `presets`, `electron`, `preview`, `docs`.

## Pull request workflow

1. Fork the repository (or create a branch if you have write access) and branch off `main`:
   `git checkout -b feat/my-change`.
2. Make your change in small, self-contained commits with Conventional Commit messages.
3. Run the [self-checks](#self-checks-that-must-pass) locally.
4. Push your branch and open a pull request against `main`; fill in the pull request template.
5. CI ([`.github/workflows/ci.yml`](.github/workflows/ci.yml)) and CodeQL must be green; Dependabot keeps the
   dependencies and the Actions up to date. Address review comments by pushing new commits — **never
   force-push a branch that is under review**.
6. Pull requests are **squash-merged** to keep the history of `main` linear and readable.

## Self-checks that must pass

Run all of these from `studio/` before opening a pull request:

```bash
npm run fetch:typst              # Typst 0.15.1 → resources/typst.exe (once per clone)
npx tsc --noEmit                 # type-check
npm run bundle                   # rebuild scripts/*.mjs from scripts/*.ts
npm run build                    # renderer build
node scripts/render-all.mjs      # render all 5 templates with their demo data
node scripts/test-variants.mjs   # compile every layout variant
node scripts/check-presets.mjs   # preset-library consistency assertions
node scripts/check-odrisk.mjs    # overdose-risk table assertions
node scripts/check-tcm.mjs       # traditional-medicine herb library assertions
```

When you change a template, also render the stress cases and inspect the images:

```bash
node scripts/stress-templates.mjs
```

A `scripts/<name>.mjs` that has a `.ts` sibling is a **build product**, not a source file, and is not
committed. Rebuild all of them (or a single one) with:

```bash
npm run bundle                    # every stale entry point
npm run bundle -- render-all      # one entry point
npm run bundle -- --force         # ignore timestamps
npm run bundle -- --check         # verify only, write nothing (used by CI)
```

## Adding a hospital template

1. Read [`docs/TEMPLATES.md`](docs/TEMPLATES.md) (or [`docs/zh-CN/TEMPLATES.md`](docs/zh-CN/TEMPLATES.md)) and
   copy the closest existing template.
2. Create `studio/src/templates/<id>.ts` exporting a `Template` object:
   `id`, `name`, `hospital`, `desc`, `group`, `page`, `limits`, `sections`, `extraKeys`, `defaults`, `build`.
3. Register it in `studio/src/templates/index.ts`.
4. Use **fictional** demo data in `defaults` (same length/format as the real value you are replacing).
5. Verify: `node scripts/render-all.mjs <id>` and `node scripts/stress-templates.mjs`, then look at the
   generated PNGs for overlaps and overflow.
6. Document the template in [`docs/TEMPLATES.md`](docs/TEMPLATES.md) and its Chinese counterpart
   [`docs/zh-CN/TEMPLATES.md`](docs/zh-CN/TEMPLATES.md).

## Documentation and translations

- `README.md` is the public project documentation and is written in English. Keep it in sync with the code
  and with the in-depth references under `docs/` in the same pull request.
- `docs/` holds the in-depth English references (`TEMPLATES.md`, `PRESETS.md`, `PACKAGING.md`) and
  `docs/zh-CN/` their Chinese originals. Keep both languages in sync.
- `docs/zh-CN/PRESETS.md` is generated: run `node scripts/gen-presets-doc.mjs` from `studio/` after changing
  `src/data/presets.ts`, and never hand-edit it. The English `docs/PRESETS.md` is hand-written.
- Keep code samples in documentation runnable as written.

Thank you for contributing!
