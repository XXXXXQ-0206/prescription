# Security Policy

## Supported versions

| Version | Supported |
| ------- | --------- |
| 1.0.x   | ✅        |
| < 1.0   | ❌        |

Only the latest release receives security fixes.

## Reporting a vulnerability

**Please do not report security vulnerabilities through public GitHub issues, discussions, pull requests or
any other public channel.** A public report puts every user at risk before a fix is available.

Use GitHub's private vulnerability reporting instead:

1. Open <https://github.com/XXXXXQ-0206/prescription-master/security/advisories/new>
   (repository **Security** tab → **Report a vulnerability**), or
2. Contact the maintainer [@XXXXXQ-0206](https://github.com/XXXXXQ-0206) privately on GitHub and ask for a
   private channel if the advisory form is unavailable.

Please include as much of the following as you can:

- the affected version, Windows version and Typst version;
- a description of the vulnerability and its impact;
- step-by-step reproduction instructions or a minimal proof of concept;
- any suggested mitigation or fix;
- whether you intend to publish your findings (and when).

### What to expect

| Stage | Target |
| ----- | ------ |
| Acknowledgement of your report | within 48 hours |
| Initial assessment and severity triage | within 7 days |
| Fix or mitigation plan communicated | within 30 days |
| Coordinated public disclosure | by agreement, normally within 90 days |

We will credit you in the release notes and the advisory unless you prefer to stay anonymous.

## Scope

In scope:

- **Electron hardening** — renderer escape, `contextIsolation` / `nodeIntegration` regressions, preload API
  abuse, unsafe IPC handlers in `studio/electron/`.
- **Process invocation** — argument injection or path traversal through the Typst invocation, temporary-file
  handling, file paths received from the renderer.
- **File handling** — the JSON load/save and export paths (directory traversal, overwriting arbitrary files,
  unsafe default paths).
- **Encoded-content handling** — the in-tree Code 128 and QR encoders (crashes, unbounded memory or output on
  attacker-controlled input).
- **Supply chain** — vulnerabilities in the dependencies declared in `studio/package.json`.
- **Privacy leaks** — real patient data or real personal information committed to the repository.

Out of scope:

- The medical correctness of prescriptions, drug data, dosages or prices (see the Disclaimer in the
  [README](README.md#disclaimer)); these are user-editable demo data.
- Issues that require an already-compromised machine or physical access.
- Findings produced only by automated scanners without a demonstrated impact.
- Social engineering and denial-of-service by resource exhaustion on a local desktop application.

## Known issues

### `sprintf-js` denial of service — dev-only, no upstream fix (reviewed 2026-10-14)

Dependabot reports [GHSA-hp3w-g68c-fv3c](https://github.com/advisories/GHSA-hp3w-g68c-fv3c) (medium):
*sprintf-js vulnerable to denial of service through unbounded precision specifiers*, affecting
`sprintf-js@1.1.3` with **no patched version available**.

- **Where it comes from** — `electron-builder` → `app-builder-lib` → `@electron/get@3` → `global-agent` →
  `roarr` → `sprintf-js`. Every link is a **devDependency** used only while producing the Windows installer.
  It is not part of the renderer bundle, is not shipped inside the installer or the portable build, and is
  never reachable at application runtime.
- **Why it is not fixed yet** — the advisory has no fixed release. The only way to drop the package is to force
  `@electron/get` to a major version its parent does not support (`app-builder-lib@26` requires `^3.0.0`):
  `@electron/get@4+` is ESM-only and needs Node ≥ 22.12, while this project supports Node 20 for building, so
  the override would trade a dormant dev-only advisory for a real build breakage for those users.
- **Compensating controls** — `node_modules` is never packaged; release binaries are built from a reviewed
  commit and published with SHA-256 checksums; no runtime code parses attacker-controlled format strings.
- **Next review** — when `electron-builder` moves to `@electron/get@4+`, revisit and drop the alert; otherwise
  re-review by **2027-01-14**.

## Safe harbour

We will not pursue legal action against researchers who act in good faith, follow this policy, avoid privacy
violations and give us a reasonable time to fix the issue before public disclosure.

## Hardening notes for users

- Only load JSON prescription files you trust: a JSON file is data, but it decides what gets rendered.
- Keep the bundled Typst binary up to date when you replace `studio/resources/typst.exe`.
- Prescriptions may contain personal health information — treat exported PDF/PNG files and saved JSON files
  as sensitive data, and store them accordingly.
