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

## GHA result

- Run URL: https://github.com/kuno/cc-switch/actions/runs/24617009909
- Result: `failure`

The container switch did take effect:

- job initialized `mcr.microsoft.com/playwright:v1.59.1-jammy`
- `Enable pnpm via corepack` succeeded
- `Install dependencies` succeeded

## New visual failure after the container switch

Stopped here per instructions. I did not regenerate baselines and did not touch
Playwright config, tests, or package metadata.

`Visual regression` still fails, but it is now down to 2 screenshot mismatches
instead of the original broad baseline mismatch:

- `[openwrt-dark] tests/openwrt/visual/shell-layout.spec.ts:19:3`
  `@shell OpenWrt page shell`
  `renders the activity drawer opened from the shell`
- `[openwrt-dark] tests/openwrt/visual/shell-layout.spec.ts:39:3`
  `@shell OpenWrt page shell`
  `renders the provider panel opened from the shell`

Log details captured from the failing run:

- `92 passed (59.5s)`
- `2 failed`
- `shell-provider-panel.png`: `18575 pixels (ratio 0.02 of all image pixels) are different`
- artifact report uploaded:
  https://github.com/kuno/cc-switch/actions/runs/24617009909/artifacts/6514417559

## Other CI jobs

Confirmed green in the same run:

- `Typecheck`
- `Component tests`
- `OpenWrt provider bundle`
- `Bundle contract`

## Orchestrator note

@orchestrator Visual container switch is pushed, but the run is not green.
Investigate remaining shell-layout visual diffs from:
https://github.com/kuno/cc-switch/actions/runs/24617009909
