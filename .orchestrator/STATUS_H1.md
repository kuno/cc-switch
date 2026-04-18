# STATUS_H1

## Scope landed

H1 adds regression coverage for:

- `tests/openwrt/visual/harness/entries.tsx`
- `tests/openwrt/visual/apps-grid.spec.ts`
- `tests/openwrt/component/app-card.test.tsx`
- `tests/openwrt/component/apps-grid.test.tsx`
- `tests/openwrt/component/apps-grid.hardrules.test.tsx`
- `tests/openwrt/fixtures/openwrtProviderUi.ts`
- Linux-rendered baselines under
  `tests/openwrt/visual/__snapshots__/{openwrt-light,openwrt-dark}/apps-grid.spec.ts/`

No production code under `src/openwrt-provider-ui/` changed.

## Harness states added

### AppsGrid

- `/?component=AppsGrid&state=default&theme=light`
- `/?component=AppsGrid&state=default&theme=dark`
- `/?component=AppsGrid&state=claude-active&theme=light`
- `/?component=AppsGrid&state=claude-active&theme=dark`
- `/?component=AppsGrid&state=codex-active&theme=light`
- `/?component=AppsGrid&state=codex-active&theme=dark`

### AppCard

- `/?component=AppCard&state=default&theme=light`
- `/?component=AppCard&state=default&theme=dark`
- `/?component=AppCard&state=healthy&theme=light`
- `/?component=AppCard&state=healthy&theme=dark`
- `/?component=AppCard&state=degraded&theme=light`
- `/?component=AppCard&state=degraded&theme=dark`
- `/?component=AppCard&state=attention&theme=light`
- `/?component=AppCard&state=attention&theme=dark`
- `/?component=AppCard&state=unavailable&theme=light`
- `/?component=AppCard&state=unavailable&theme=dark`
- `/?component=AppCard&state=loading&theme=light`
- `/?component=AppCard&state=loading&theme=dark`
- `/?component=AppCard&state=not-configured&theme=light`
- `/?component=AppCard&state=not-configured&theme=dark`

Hover and focus-visible snapshots reuse the `AppCard/default` harness state and
apply interaction in Playwright.

## Specs added

- Visual: `tests/openwrt/visual/apps-grid.spec.ts`
- RTL: `tests/openwrt/component/app-card.test.tsx`
- RTL: `tests/openwrt/component/apps-grid.test.tsx`
- Hard rules: `tests/openwrt/component/apps-grid.hardrules.test.tsx`

## ARIA / keyboard summary

`AppCard` exposes native `button` semantics for the provider surface (`Open <App> providers`).
`AppsGrid` tabs in DOM order across the three cards and their activity buttons.
Click, `Enter`, and `Space` delegate through the callback seam to `bridge.setSelectedApp`.
Current production `AppsGrid` / `AppCard` do not emit selected-card ARIA such as
`aria-pressed`, `aria-checked`, or `aria-current`, so H1 verifies the native
button role plus callback wiring instead of asserting nonexistent selected-state
attributes.

## Seams and gaps

- `AppsGrid` hardcodes `['claude', 'codex', 'gemini']`, so the unusual-bridge test
  verifies the grid still renders only those three cards and only requests
  transport data for those three app ids.
- The component does not own selection state. Selection happens in the shell via
  `onOpenProviderPanel` / `onOpenActivity`, so the RTL tests wire those callbacks
  to the shared bridge fixture rather than expecting `AppsGrid` / `AppCard` to
  call `setSelectedApp` internally.
- The H0 `pnpm test:visual:update:linux` wrapper is currently broken because its
  `corepack enable` path tries to write to `/usr/bin/pnpm` as a non-root user.
  H1 did not modify `package.json`; Linux baseline refresh and verification were
  run with inline Docker commands instead.

## Screenshot tolerance

No new `toHaveScreenshot({ maxDiffPixelRatio: ... })` overrides were added.
H1 uses the shared Playwright default from `playwright.config.ts`.

## Verification completed

- `pnpm install --frozen-lockfile`
- `pnpm typecheck`
- `pnpm build:openwrt-provider-ui`
- `pnpm vitest run tests/openwrt/providerUiBundle.test.ts`
- `pnpm test:component`
- `/opt/homebrew/bin/docker run --rm -u "$(id -u):$(id -g)" -e HOME=/tmp -e COREPACK_HOME=/tmp/corepack -e CI=true -v "$PWD":/work -w /work mcr.microsoft.com/playwright:v1.59.1-jammy bash -lc 'mkdir -p /tmp/corepack/bin && corepack enable --install-directory /tmp/corepack/bin && export PATH="/tmp/corepack/bin:$PATH" && pnpm install --frozen-lockfile && pnpm test:visual:update'`
- `/opt/homebrew/bin/docker run --rm -u "$(id -u):$(id -g)" -e HOME=/tmp -e COREPACK_HOME=/tmp/corepack -e CI=true -v "$PWD":/work -w /work mcr.microsoft.com/playwright:v1.59.1-jammy bash -lc 'mkdir -p /tmp/corepack/bin && corepack enable --install-directory /tmp/corepack/bin && export PATH="/tmp/corepack/bin:$PATH" && pnpm install --frozen-lockfile && pnpm test:visual'`
- `env CI=true pnpm install --frozen-lockfile` to restore macOS `node_modules`
- Re-ran macOS `pnpm typecheck`
- Re-ran macOS `pnpm build:openwrt-provider-ui`
- Re-ran macOS `pnpm vitest run tests/openwrt/providerUiBundle.test.ts`
- Re-ran macOS `pnpm test:component`
