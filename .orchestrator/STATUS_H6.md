# STATUS_H6

## Scope landed

H6 adds rendered-shell coverage for the OpenWrt page shell without changing
production code under `src/openwrt-provider-ui/`.

Landed test coverage:

- Visual harness shell fixture in `tests/openwrt/visual/harness/entries.tsx`
- Harness runtime updates in `tests/openwrt/visual/harness/App.tsx`
- Full-shell Playwright spec in `tests/openwrt/visual/shell-layout.spec.ts`
- Shared realistic shell fixtures in:
  - `tests/openwrt/component/fixtures/pageShell.ts`
  - `tests/openwrt/component/fixtures/renderPageShell.tsx`
- Shell interaction RTL coverage in
  `tests/openwrt/component/openwrt-page-shell.test.tsx`
- Shell hard-rule RTL coverage in
  `tests/openwrt/component/openwrt-page-shell.hardrules.test.tsx`

No `src/openwrt-provider-ui/` files were edited.
No changes were made to `tests/openwrt/providerUiBundle.test.ts`.

## Harness states added

Visual harness component key:

- `shell`

States:

- `default` — running daemon, healthy host, populated cards, activity, logs
- `stopped` — daemon stopped, alert strip visible

The shell visual spec also opens live shell controls before capture for:

- activity drawer
- provider side panel
- responsive 720px shell layout

The harness now also:

- applies the OpenWrt body theme class used by the native page shell
- seeds the shell theme preference via local storage before render
- fixes `Date.now()` to a stable timestamp so activity copy is deterministic
- uses a fullscreen shell canvas path so shell screenshots capture the viewport
  state instead of a clipped subpanel

## Theme behavior confirmed

Covered in `tests/openwrt/component/openwrt-page-shell.test.tsx`:

- Header renders `OpenWrt / Services`, `CC Switch`, and the theme toggle
- Initial theme is read from local storage key
  `ccswitch-openwrt-native-page-theme`
- Theme application is asserted on `document.body.dataset.ccswitchTheme`
- Dark theme class application is asserted on
  `document.body.classList`
- Theme toggle works through:
  - pointer click
  - `Enter`
  - `Space`

## Shell interaction coverage

Covered in `tests/openwrt/component/openwrt-page-shell.test.tsx`:

- Clicking a real app card routes through `setSelectedApp`
- Opening the provider panel from the shell shows the real dialog and restores
  focus to the invoking shell control on close
- Opening the activity drawer from the shell shows the real dialog and restores
  focus to the invoking shell control on close

Open question resolved while reading source:

- `OpenWrtPageShell.tsx` does not implement shell-level global keyboard
  shortcuts, so no shortcut assertions were added

## Hard-rule coverage

Covered in `tests/openwrt/component/openwrt-page-shell.hardrules.test.tsx`
against the full rendered shell document root:

- no `.owt-legacy-preserved`
- no `Configure routes and provider details`
- no `Failover`
- no `OpenClaw`
- no `Hermes`
- no `autoFailover`
- no `maxRetries`
- no `SharedProviderManager` text or DOM markers
- app-card set is exactly `['claude', 'codex', 'gemini']`

These shell-level assertions are the last-line defense above the component-wave
tests.

## Snapshot inventory

Added Linux-rendered shell snapshots for both `openwrt-light` and
`openwrt-dark`:

- `shell-default.png`
- `shell-activity-drawer.png`
- `shell-provider-panel.png`
- `shell-alert-strip.png`
- `shell-default-narrow.png`

## Seam notes

- The repo wrapper `pnpm test:visual:update:linux` currently fails in this
  environment because the Jammy container cannot create a global `pnpm`
  symlink through `corepack enable`.
- Playwright's configured `webServer.command` also assumes a `pnpm` binary in
  PATH and was killed when driven directly inside this container.
- Verification still completed without repo changes by running an equivalent
  Docker flow that:
  - used `corepack pnpm`
  - injected a temporary `/tmp/pnpm` shim in the container
  - prebuilt the visual harness
  - started `preview` explicitly
  - let Playwright reuse that running server

No repo scripts or package metadata were modified for this seam; H7 can fix the
central wrapper path.

## Verification completed

- `pnpm install --frozen-lockfile`
- `pnpm typecheck`
- `pnpm build:openwrt-provider-ui`
- `pnpm vitest run tests/openwrt/providerUiBundle.test.ts`
- `pnpm test:component`
- Linux snapshot refresh via equivalent Jammy Docker command using
  `corepack pnpm`
- Linux Playwright verification via equivalent Jammy Docker command using
  `corepack pnpm`
- post-Docker restore:
  `CI=true pnpm install --frozen-lockfile`
- macOS recheck:
  - `pnpm typecheck`
  - `pnpm build:openwrt-provider-ui`
  - `pnpm vitest run tests/openwrt/providerUiBundle.test.ts`
  - `pnpm test:component`
