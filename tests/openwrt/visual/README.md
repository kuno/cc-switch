# OpenWrt Visual Harness

The visual harness is a standalone Vite page that renders one deterministic
OpenWrt UI component state at a time for Playwright snapshots.

## URL schema

Use query params to pick what the harness renders:

`/?component=<ComponentName>&state=<stateName>&theme=<light|dark>`

Current smoke example:

`/?component=AlertStrip&state=stopped&theme=light`

## Adding a new component state

1. Add a scenario in `tests/openwrt/visual/harness/entries.tsx`.
2. Add a Playwright spec in `tests/openwrt/visual/<component>.spec.ts`.
3. Refresh baselines with `pnpm test:visual:update`.

The harness keeps theme selection at the page level and expects each scenario
to return a deterministic React element with stable fixture data.

Baseline PNGs are stored under
`tests/openwrt/visual/__snapshots__/<project>/<spec-file>/`.
