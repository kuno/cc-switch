# STATUS_H3

## Scope landed

H3 adds regression coverage for the OpenWrt provider side panel only:

- Component specs:
  - `tests/openwrt/component/provider-side-panel-host.test.tsx`
  - `tests/openwrt/component/provider-side-panel.test.tsx`
  - `tests/openwrt/component/provider-side-panel-preset-tab.test.tsx`
  - `tests/openwrt/component/provider-side-panel-general-tab.test.tsx`
  - `tests/openwrt/component/provider-side-panel-credentials-tab.test.tsx`
  - `tests/openwrt/component/provider-side-panel.hardrules.test.tsx`
- Shared test fixtures:
  - `tests/openwrt/provider-panel-fixtures.ts`
  - `tests/openwrt/component/fixtures/providerTransport.ts`
- Visual harness:
  - `tests/openwrt/visual/harness/provider-side-panel.tsx`
  - `tests/openwrt/visual/provider-side-panel.spec.ts`
  - `tests/openwrt/visual/harness/entries.tsx`
  - `tests/openwrt/visual/harness/styles.css`
- Linux baselines:
  - `tests/openwrt/visual/__snapshots__/openwrt-light/provider-side-panel.spec.ts/`
  - `tests/openwrt/visual/__snapshots__/openwrt-dark/provider-side-panel.spec.ts/`

No production files under `src/openwrt-provider-ui/` were edited.
`openwrtProviderPresetCatalog.ts` was consumed as-is.

## Harness states

Visual coverage now includes:

- `closed`
- `preset-tab`
- `claude-presets`
- `codex-presets`
- `gemini-presets`
- `general-empty`
- `general-filled`
- `credentials-empty`
- `credentials-partial`
- `credentials-auth-json`
- `credentials-save-pending`
- `error`

All states render in both light and dark themes and snapshot the panel shell only.
The harness wraps the fixed shell in a local frame and disables panel/scrim transitions for deterministic screenshots.

## Component coverage

- Host:
  - Focus trap wraps from Save back to Close and reverse with `Shift+Tab`
  - `Escape` closes the panel
  - Focus returns to the launch trigger
  - `role="dialog"` and `aria-modal="true"` are asserted
- Shell:
  - Header, footer, loading, error, scrim close, and three-tab shell are covered
  - Click-based tab switching is covered with visible-content assertions
- Preset tab:
  - Real catalog groups render
  - Real preset ids are emitted
  - Host wiring from preset selection into the create/save path is covered
- General tab:
  - Name/model/website/notes callbacks are covered
  - Edits persist across tab switches
  - Save hits the provider transport edit path
- Credentials tab:
  - Base URL, token field, API key, and auth.json mode are covered
  - API key inputs stay `type="password"`
  - Cleartext does not echo into DOM text
  - Save hits the provider transport edit path
  - auth.json upload pending disables actions

## ARIA and keyboard findings

- Host dialog semantics are present and tested: `role="dialog"` and `aria-modal="true"`.
- The tab strip currently exposes `role="tablist"` only.
- The tab buttons are plain buttons, not `role="tab"`, and the panel body does not expose `role="tabpanel"` / `aria-controls` / `aria-labelledby`.
- Left/Right/Home/End tab-key handlers are not implemented in source, so H3 documents that gap instead of inventing a behavior seam.
- `Tab` order is DOM-order button navigation inside the tab strip, not a roving-tabindex tab widget.

## Seam flags

- The task brief said General save should hit `saveHostConfig`; the real provider panel saves through `OpenWrtProviderTransport` and H3 tests the actual transport path.
- The General tab's Website field is presentation-only local state and is not included in the provider save payload.
- Credentials tab has no inline validation-error surface in current source; H3 covers the host `error` banner state plus optimistic pending states instead.
- The host is an inline fixed overlay shell, not a separate portal primitive.

## No-Failover confirmation

`tests/openwrt/component/provider-side-panel.hardrules.test.tsx` asserts every rendered tab contains none of:

- `Failover`
- `OpenClaw`
- `Hermes`
- `autoFailover`
- `maxRetries`
- `queue`
- failover/queue ids or `data-testid`s
- `.owt-legacy-preserved`
- `SharedProviderManager`
- `Configure routes and provider details`

It also asserts the tab strip contains exactly three labels:

- `Preset`
- `General`
- `Credentials`

No Failover surface leaks landed.

## Verification completed

- `pnpm install --frozen-lockfile`
- `pnpm typecheck`
- `pnpm build:openwrt-provider-ui`
- `pnpm vitest run tests/openwrt/providerUiBundle.test.ts`
- `pnpm test:component`
- `pnpm build:openwrt-visual-harness`
- Linux baseline refresh:
  - `/opt/homebrew/bin/docker run --rm -u "$(id -u):$(id -g)" -e HOME=/tmp -e COREPACK_HOME=/tmp/corepack -e CI=true -v "$PWD":/work -w /work mcr.microsoft.com/playwright:v1.59.1-jammy bash -lc 'printf "%s\n" "#!/bin/sh" "exec corepack pnpm \"\$@\"" > /tmp/pnpm && chmod +x /tmp/pnpm && export PATH="/tmp:$PATH" && corepack pnpm install --frozen-lockfile && corepack pnpm test:visual:update'`
- Linux visual verification:
  - `/opt/homebrew/bin/docker run --rm -u "$(id -u):$(id -g)" -e HOME=/tmp -e COREPACK_HOME=/tmp/corepack -e CI=true -v "$PWD":/work -w /work mcr.microsoft.com/playwright:v1.59.1-jammy bash -lc 'printf "%s\n" "#!/bin/sh" "exec corepack pnpm \"\$@\"" > /tmp/pnpm && chmod +x /tmp/pnpm && export PATH="/tmp:$PATH" && corepack pnpm install --frozen-lockfile && corepack pnpm test:visual'`
- macOS deps restored after Docker with:
  - `CI=true pnpm install --frozen-lockfile`
