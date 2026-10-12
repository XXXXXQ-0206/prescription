## Summary

<!-- What does this pull request change, and why? Keep it short and concrete. -->

## Type of change

- [ ] Bug fix (non-breaking change which fixes an issue)
- [ ] New feature (non-breaking change which adds functionality)
- [ ] Breaking change (fix or feature that would change existing behaviour)
- [ ] Template / layout change
- [ ] Preset data change
- [ ] Documentation / translation
- [ ] Build, CI or tooling

## Related issues

<!-- e.g. Closes #12, Refs #34 -->

## How was this tested?

- [ ] `npx tsc --noEmit`
- [ ] `npm run build`
- [ ] `node scripts/render-all.mjs` (all five templates still render)
- [ ] `node scripts/test-variants.mjs` (if a template was touched)
- [ ] `node scripts/stress-templates.mjs` + visual check (if a template was touched)
- [ ] `node scripts/check-presets.mjs` (if presets were touched)

<!-- Paste the relevant command output below. -->

## Privacy & safety checklist

- [ ] No real patient data, scans or crops of real prescriptions are included.
- [ ] Every new sample value is obviously fictional and keeps the original length/format.
- [ ] No machine-specific absolute paths, usernames, e-mails or credentials were added.
- [ ] No generated artifacts (`dist/`, `out/`, `release/`, `tmp/`, PDFs, executables) were committed.
- [ ] `git ls-files` shows no images, scans, binaries or personal paths.
- [ ] Templates still do not read UI-only fields (for example `drug.odRisk`).
- [ ] Templates changed by this pull request were rendered and visually inspected.

## Screenshots / exported samples

<!-- Drop a PNG of the rendered template here. Use fictional demo data only. -->

## Notes for reviewers

<!-- Anything a reviewer should know: trade-offs, follow-ups, open questions. -->
