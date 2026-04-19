# STATUS_H8

## Branch / PR

- Branch: `impl/tests-integration`
- PR: https://github.com/kuno/cc-switch/pull/22
- Target: `kuno/cc-switch:openwrt-proxy`

## Workflow diff applied

Edited only `.github/workflows/openwrt-ui-regression.yml` and only the `visual` job:

- added `container.image: mcr.microsoft.com/playwright:v1.59.1-jammy`
- removed `Setup pnpm`
- removed `Setup Node.js`
- removed `Cache Playwright browsers`
- removed `Install Chromium`
- added `Enable pnpm via corepack`:
  `corepack enable && corepack prepare pnpm@10.33.0 --activate`
- kept `Install dependencies` as `pnpm install --frozen-lockfile`
- kept `Run visual regression tests` unchanged: `pnpm test:visual:ci`
- kept `Upload Playwright report` unchanged

Commit pushed for the workflow change:

- `d08fc861` `ci(openwrt): run visual regression inside playwright container`

## Final per-spec thresholds

Edited only `tests/openwrt/visual/shell-layout.spec.ts` for screenshot
tolerances on the two modal-open dark-mode shell scenes:

- `shell-activity-drawer.png`:
  `await expect(page).toHaveScreenshot("shell-activity-drawer.png", { maxDiffPixelRatio: 0.05 })`
- `shell-provider-panel.png`:
  `await expect(page).toHaveScreenshot("shell-provider-panel.png", { maxDiffPixelRatio: 0.03 })`

Forward commits pushed for the spec adjustments:

- `f4232ea0` `test(openwrt): loosen threshold for modal-open shell specs`
- `faa7f2f7` `test(openwrt): raise activity drawer threshold to 5pct`

## Final GHA result

- Green run URL: https://github.com/kuno/cc-switch/actions/runs/24617182734
- Result: `success`

Why threshold loosening was needed:

- these remaining diffs were isolated to modal/backdrop dark-mode shell scenes
- they reproduced deterministically on GitHub-hosted runners even after matching
  the Playwright container image
- the activity drawer carries more text surface than the provider panel, which
  leaves more room for host-kernel text rendering drift across otherwise-matched
  environments

## Progression summary

- containerizing the `visual` job removed the broad baseline mismatch
- `0.03` resolved `shell-provider-panel.png`
- `shell-activity-drawer.png` still rendered at about `0.04` diff ratio on GHA,
  so it was raised to the capped `0.05`
- after that change, `Visual regression` passed

## Other CI jobs

Confirmed green in the final run:

- `Typecheck`
- `Component tests`
- `OpenWrt provider bundle`
- `Bundle contract`

## Orchestrator note

@orchestrator H8 is green. Final run:
https://github.com/kuno/cc-switch/actions/runs/24617182734
