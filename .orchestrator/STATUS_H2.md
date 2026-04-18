# STATUS_H2

## Scope landed

H2 adds regression coverage for the Activity drawer surface without changing
production code under `src/openwrt-provider-ui/`:

- Visual harness states for `ActivityDrawerHost` and `ActivitySidePanel`
- Playwright specs:
  - `tests/openwrt/visual/activity-drawer.spec.ts`
  - `tests/openwrt/visual/activity-side-panel.spec.ts`
- RTL specs:
  - `tests/openwrt/component/activity-drawer-host.test.tsx`
  - `tests/openwrt/component/activity-side-panel.test.tsx`
  - `tests/openwrt/component/activity-drawer.hardrules.test.tsx`
- Shared deterministic activity fixtures:
  - `tests/openwrt/fixtures/activity.ts`

## Harness states added

Added to `tests/openwrt/visual/harness/entries.tsx`:

- `ActivityDrawerHost`
  - `closed`
  - `open-empty`
- `ActivitySidePanel`
  - `populated`
  - `detail`
  - `loading`
  - `error`

The harness freezes `Date.now()` for deterministic relative-time labels and
uses a drawer-scaffold backdrop so the drawer screenshots stay stable.

## Interaction coverage

`activity-drawer-host.test.tsx` covers:

- Host hidden by default and opened/closed through the `shellRef` handle
- Focus trap cycling within the drawer
- `Shift+Tab` wrap to the last focusable row
- `Escape` close and focus restoration to the trigger element that opened it

`activity-side-panel.test.tsx` covers:

- `role="dialog"` and `aria-modal="true"`
- `aria-labelledby` / `aria-describedby` pointing at real nodes
- Empty-state rendering
- Scrim click-to-close behavior
- All-app log aggregation and detail selection
- Refresh/loading in-flight state
- Request-log and request-detail error copy

`activity-drawer.hardrules.test.tsx` asserts the drawer never renders:

- `Failover`
- `OpenClaw`
- `Hermes`
- `Configure routes and provider details`
- `.owt-legacy-preserved`
- `SharedProviderManager`-related DOM

## Findings and seams

- `ActivitySidePanel` does not render any `getRecentActivity`,
  `getUsageSummary`, or `getProviderStats` data in this branch. The drawer UI is
  limited to request logs plus request detail, so the spec items for recent
  activity list / usage summary coverage are not implementable without a
  production change.
- The component does not expose `aria-live` or `aria-busy` attributes. H2
  asserts the existing dialog labeling semantics instead and flags this as a
  production seam.
- The host has no built-in launcher UI; opening is done through the shell ref
  handle. Keyboard-open coverage is therefore exercised at that host boundary
  with a test launcher button, not through `OpenWrtPageShell`.
- The H0 `pnpm test:visual:update:linux` wrapper is still buggy in this
  environment because `corepack enable` tries to write `/usr/bin/pnpm` as a
  non-root user. Per orchestrator direction, H2 did not keep a local wrapper
  change; Linux visual update/verification used the inline Docker form instead.

## Verification completed

- `pnpm install --frozen-lockfile`
- `pnpm typecheck`
- `pnpm build:openwrt-provider-ui`
- `pnpm vitest run tests/openwrt/providerUiBundle.test.ts`
- `pnpm test:component`
- `/opt/homebrew/bin/docker run --rm -u "$(id -u):$(id -g)" -e HOME=/tmp -e COREPACK_HOME=/tmp/corepack -e CI=true -v "$PWD":/work -w /work mcr.microsoft.com/playwright:v1.59.1-jammy bash -lc 'printf "%s\n" "#!/bin/sh" "exec corepack pnpm \"\$@\"" >/tmp/pnpm && chmod +x /tmp/pnpm && export PATH="/tmp:$PATH" && corepack pnpm install --frozen-lockfile && corepack pnpm test:visual:update'`
- `/opt/homebrew/bin/docker run --rm -u "$(id -u):$(id -g)" -e HOME=/tmp -e COREPACK_HOME=/tmp/corepack -e CI=true -v "$PWD":/work -w /work mcr.microsoft.com/playwright:v1.59.1-jammy bash -lc 'printf "%s\n" "#!/bin/sh" "exec corepack pnpm \"\$@\"" >/tmp/pnpm && chmod +x /tmp/pnpm && export PATH="/tmp:$PATH" && corepack pnpm install --frozen-lockfile && corepack pnpm test:visual'`
- `env CI=true pnpm install --frozen-lockfile` to restore macOS `node_modules`
- Re-ran macOS gates after restoring host deps:
  - `pnpm typecheck`
  - `pnpm build:openwrt-provider-ui`
  - `pnpm vitest run tests/openwrt/providerUiBundle.test.ts`
  - `pnpm test:component`
