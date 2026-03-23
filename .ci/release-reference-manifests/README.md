# Release Reference Manifests

This directory stores optional per-target reference manifests used by
`scripts/release-manifest-drift.mjs` to detect unexpected packaging drift.

Supported filenames:

- `linux.json`
- `mac.json`
- `win.json`

How to initialize:

1. Run desktop packaging in CI and download `.smoke/release-manifest.json`.
2. Rename it to one of the target names above.
3. Commit the file after manual review.

Or use scripts directly (recommended):

- init:
  - `npm run verify:desktop:reference:init:linux`
  - `npm run verify:desktop:reference:init:mac`
  - `npm run verify:desktop:reference:init:win`
- update:
  - `npm run verify:desktop:reference:update:linux`
  - `npm run verify:desktop:reference:update:mac`
  - `npm run verify:desktop:reference:update:win`

Notes:

- If a target reference file is missing, drift check is marked as `skipped`.
- Drift thresholds are configured in `.ci/release-drift-policy.json`.
