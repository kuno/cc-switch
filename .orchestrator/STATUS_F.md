# Task F Status

Branch: `impl/ui-alert-strip`

## Scope completed

- Added `src/openwrt-provider-ui/components/AlertStrip.tsx`.
- Replaced only the Task F slot in `src/openwrt-provider-ui/OpenWrtPageShell.tsx` with the new alert strip.
- Appended a dedicated `/* Alert strip — Task F */` block to `src/openwrt-provider-ui/openwrt-provider-ui.css`.
- Rebuilt `openwrt/provider-ui-dist/ccswitch-provider-ui.css` and `openwrt/provider-ui-dist/ccswitch-provider-ui.js`.

## Review fix pass

- Reverted every pre-existing `openwrt-provider-ui.css` formatting change so the net diff against `impl/ui-foundation` is append-only in the Task F region.
- Removed the `.owt-slot-alert` cascade override entirely. The component now portals the alert strip into a dedicated `.owt-alert-strip-host` grid item and hides the placeholder slot node imperatively, so Task A scaffold rules stay untouched.
- Replaced the hardcoded red mixes with accent-token-only mixes, which automatically inherit the existing dark-theme token swap.
- Reduced strip density to the spec band by shrinking vertical padding and the icon shell, with a 30px action button on the single-row desktop layout.

## Behavior covered

- Hidden while the daemon is running and reachable.
- Visible for stopped daemon state.
- Visible for running but unreachable daemon state via degraded host health.
- Visible with spinner while restart is in flight.
- Visible with retry action after restart failure.

## Verification

- `git diff HEAD~1 -- src/openwrt-provider-ui/openwrt-provider-ui.css` shows only appended Task F additions relative to the Task A baseline ✅
- `pnpm typecheck` ✅
- `pnpm build:openwrt-provider-ui` ✅
- `pnpm vitest run tests/openwrt/providerUiBundle.test.ts` ✅ (`14/14`)
- Dark-theme visual smoke via headless Chrome screenshot of a local preview page using the rebuilt CSS (`/tmp/alert-strip-dark.png`) ✅
  Result: the alert strip renders with accent-driven dark blue-gray surfaces, readable copy/action contrast, and compact single-row height in the expected range.
