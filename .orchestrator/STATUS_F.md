# Task F Status

Branch: `impl/ui-alert-strip`

## Scope completed

- Added `src/openwrt-provider-ui/components/AlertStrip.tsx`.
- Replaced only the Task F slot in `src/openwrt-provider-ui/OpenWrtPageShell.tsx` with the new alert strip.
- Appended a dedicated `/* Alert strip — Task F */` block to `src/openwrt-provider-ui/openwrt-provider-ui.css`.
- Rebuilt `openwrt/provider-ui-dist/ccswitch-provider-ui.css` and `openwrt/provider-ui-dist/ccswitch-provider-ui.js`.

## Behavior covered

- Hidden while the daemon is running and reachable.
- Visible for stopped daemon state.
- Visible for running but unreachable daemon state via degraded host health.
- Visible with spinner while restart is in flight.
- Visible with retry action after restart failure.

## Verification

- `pnpm typecheck` ✅
- `pnpm build:openwrt-provider-ui` ✅
- `pnpm vitest run tests/openwrt/providerUiBundle.test.ts` ✅ (`14/14`)
