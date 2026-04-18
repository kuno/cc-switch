# Task G Status

Branch: `impl/ui-integration`
Base: `impl/ui-foundation@c123286e`

## Merge log

- `2f4978ac` merged `impl/ui-apps-grid@f9c7374f`
- `039b00e2` merged `impl/ui-activity-drawer@d455ce68`
- `a4ef7647` merged `impl/ui-provider-side-panel@ab04ccdc`
- `58bf2b05` merged `impl/ui-daemon-card@69d9570e`
- `edf0ca0a` merged `impl/ui-alert-strip@4c7e383d`
- Repeated conflicts occurred in:
  - `src/openwrt-provider-ui/OpenWrtPageShell.tsx`
  - `src/openwrt-provider-ui/openwrt-provider-ui.css`
  - `openwrt/provider-ui-dist/ccswitch-provider-ui.css`
  - `openwrt/provider-ui-dist/ccswitch-provider-ui.js`
- Merge-phase conflict resolution kept the integration branch’s scaffold/diff-bucket versions in conflicted shell/CSS/dist files so the approved feature branch components could land cleanly.
- Final integration was then hand-composed after all merges so every slot replacement, CSS band, and drawer/card host could coexist in one shell.

## Legacy block removal

- Deleted the entire `.owt-legacy-preserved` block from `src/openwrt-provider-ui/OpenWrtPageShell.tsx`.
- Removed the legacy `SharedProviderManager` mount with it.
- The page shell now mounts only the Task G surface:
  - `AlertStrip` in the alert slot
  - `AppsGrid`
  - `DaemonCard`
  - `ActivityDrawerHost`
  - `ProviderSidePanelHost`
- Removed the `.owt-legacy-preserved` CSS block from `src/openwrt-provider-ui/openwrt-provider-ui.css`.

## Test updates for legacy removal

- Updated only the page-shell assertions in `tests/openwrt/providerUiBundle.test.ts` that were anchored on the preserved legacy content.
- Replaced `"Configure routes and provider details"` shell-readiness checks with a real mounted-shell check on `Open Claude providers`.
- Replaced preserved-block text assertions (`Usage summary`, legacy provider list copy, inline request-log copy, `Edit Claude Primary`) with assertions against the integrated cards/drawers that now own the UI.
- Expanded interaction assertions so the contract test proves the real Task G wiring:
  - all three app cards fetch usage/provider/activity data
  - card click opens the provider drawer
  - activity action opens the activity drawer
- Left the embed/portal/dialog/overlay contract assertions intact.
- Result: `pnpm vitest run tests/openwrt/providerUiBundle.test.ts` still passes `14/14`.

## Dev-aid cleanup

- Removed coder-D’s placeholder-click fallback from `src/openwrt-provider-ui/components/ProviderSidePanelHost.tsx`.
- Removed coder-D’s temporary `ccswitch:provider-side-panel-open` window-event bridge from the same file.
- Wired provider opening through the intended Task G path:
  - `AppsGrid.onOpenProviderPanel(appId)` -> `OpenWrtPageShell.handleOpenProviderPanel(appId)` -> `ProviderSidePanelHost.openForApp(appId)`
- Removed coder-F’s portal-sibling DOM splice from `src/openwrt-provider-ui/components/AlertStrip.tsx`.
- Chose Task G Option A:
  - render `AlertStrip` directly inside Task A’s alert slot
  - strip the alert slot’s placeholder framing in CSS
  - collapse the slot entirely when empty via `.owt-slot-alert:empty`
- Removed the old `.owt-alert-strip-host` runtime host usage and related CSS.

## Cross-component wiring summary

- `AppsGrid` now receives live handlers from the shell instead of no-op callbacks.
- App activity action:
  - selects the clicked app in the shell bridge
  - opens `ActivityDrawerHost` through its imperative handle
- App provider action:
  - selects the clicked app in the shell bridge
  - opens `ProviderSidePanelHost` through its imperative handle
- `AlertStrip` and `DaemonCard` both read from the same shell snapshot subscription in `OpenWrtPageShell`; no second daemon-state subscription was introduced.
- App set remains restricted to `claude`, `codex`, and `gemini`.
- No failover tab/toggle/badge/queue controls were added back into the OpenWrt UI.

## CSS integration

- Rebuilt `src/openwrt-provider-ui/openwrt-provider-ui.css` so the Task B/C/D/E/F bands are present in order on top of the Task A foundation.
- Preserved the Task A embed-safe dialog/overlay selectors and host-fit selectors required by the bundle contract.
- Removed only the legacy-preservation styling and alert-slot placeholder framing that Task G explicitly retired.

## Verification log

- `rtk pnpm install --frozen-lockfile` ✅
- `rtk pnpm typecheck` ✅
- `rtk pnpm build:openwrt-provider-ui` ✅
  - current rebuilt bundle:
    - `openwrt/provider-ui-dist/ccswitch-provider-ui.css` `133.09 kB` (`20.54 kB` gzip)
    - `openwrt/provider-ui-dist/ccswitch-provider-ui.js` `464.87 kB` (`128.15 kB` gzip)
- `rtk pnpm vitest run tests/openwrt/providerUiBundle.test.ts` ✅ (`14/14`)
- `rtk pnpm vitest run`:
  - earlier integration run in this workspace completed green before handoff
  - my reruns produced only passing-suite output plus the repo’s usual mocked-error/MSW/Tauri warning noise
  - in this environment the runner does not return cleanly afterward and isolated reruns of `tests/shared/providers/SharedProviderManager.test.tsx` also hang before emitting assertions
  - no Task G failures were observed in the full-suite output captured before the runner stall
- `rtk git diff --stat openwrt-proxy -- openwrt/provider-ui-dist/` showed only the expected rebuilt bundle diffs in:
  - `openwrt/provider-ui-dist/ccswitch-provider-ui.css`
  - `openwrt/provider-ui-dist/ccswitch-provider-ui.js`

## Manual smoke-test findings

- Manual browser smoke executed against the rebuilt dist bundle through a temporary local harness served on `http://127.0.0.1:4173`.
- Verified in headless Chrome:
  - header renders
  - exactly three app cards render: `claude`, `codex`, `gemini`
  - no `openclaw` or `hermes` app cards appear
  - clicking an app activity action opens the activity drawer
  - clicking an app provider action opens the provider drawer
  - daemon card shows status/version and restart succeeds
  - alert strip is hidden when healthy
  - alert strip appears for stopped and unreachable states
  - dark theme toggle applies across the integrated surface
  - no failover UI is visible in the mounted app surface
- Temporary smoke harness files were removed after the run.
