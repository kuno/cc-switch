# Task C Status

Status: complete

## Scope delivered

- Added `ActivitySidePanel` as a right-anchored activity drawer with:
  - app-scoped and merged all-app activity filters
  - live request log pagination through the existing shell bridge
  - request detail view
  - loading, empty, and error states
  - `Escape` close, overlay close, dialog semantics, and focus trapping
- Added `ActivityDrawerHost` to own drawer state and expose `openForApp(appId)` / `close()` via ref.
- Replaced only the Task C placeholder after `</main>` in `OpenWrtPageShell.tsx`.
- Appended the Task C CSS band to `src/openwrt-provider-ui/openwrt-provider-ui.css`.
- Rebuilt `openwrt/provider-ui-dist/*`.

## Files changed

- `src/openwrt-provider-ui/components/ActivitySidePanel.tsx`
- `src/openwrt-provider-ui/components/ActivityDrawerHost.tsx`
- `src/openwrt-provider-ui/OpenWrtPageShell.tsx`
- `src/openwrt-provider-ui/openwrt-provider-ui.css`
- `openwrt/provider-ui-dist/ccswitch-provider-ui.css`
- `openwrt/provider-ui-dist/ccswitch-provider-ui.js`

## Verification

- `pnpm typecheck` ✅
- `pnpm build:openwrt-provider-ui` ✅
- `pnpm vitest run tests/openwrt/providerUiBundle.test.ts` ✅ `14/14`

## Notes

- The bridge on this branch is app-scoped for request logs and detail. The drawer’s `All apps` filter is implemented client-side by merging paginated per-app bridge responses, without changing the LuCI shim or RPC backend.
