# Task D Status

## Scope delivered
- Added a new ProviderSidePanel drawer host with `openForApp(appId, providerId?)` and a placeholder-click fallback while Task B is not merged.
- Implemented three tabs only: Preset, General, Credentials.
- Reused the existing OpenWrt preset catalog and re-grouped it into official / platform templates / compatible gateways.
- Added Codex `auth.json` upload and remove actions, gated on saved providers only.
- Kept failover UI completely out of the drawer.
- Left `.owt-legacy-preserved`, `SharedProviderManager`, LuCI `settings.js`, and the ucode RPC backend untouched.

## Review follow-up
- Added `aria-modal="true"` to the provider drawer dialog.
- Added local focus management in `ProviderSidePanel.tsx`: initial focus moves into the drawer, `Tab` / `Shift+Tab` wrap within the drawer while open, and focus restores to the opener when the drawer closes.
- Replaced the stale Task C comment above the Task D mount with the correct `ProviderSidePanel drawer - Task D` label in `OpenWrtPageShell.tsx`.

## Files changed
- `src/openwrt-provider-ui/components/ProviderSidePanel.tsx`
- `src/openwrt-provider-ui/components/ProviderSidePanelHost.tsx`
- `src/openwrt-provider-ui/components/ProviderSidePanelPresetTab.tsx`
- `src/openwrt-provider-ui/components/ProviderSidePanelGeneralTab.tsx`
- `src/openwrt-provider-ui/components/ProviderSidePanelCredentialsTab.tsx`
- `src/openwrt-provider-ui/OpenWrtPageShell.tsx`
- `src/openwrt-provider-ui/openwrt-provider-ui.css`
- `openwrt/provider-ui-dist/ccswitch-provider-ui.css`
- `openwrt/provider-ui-dist/ccswitch-provider-ui.js`

## Verification
- `pnpm install --frozen-lockfile`
- `pnpm typecheck` ✅
- `pnpm build:openwrt-provider-ui` ✅
- `pnpm vitest run tests/openwrt/providerUiBundle.test.ts` ✅ `14/14`
- Local keyboard smoke check on the mounted drawer host ✅
- Opened the drawer from a focused trigger, confirmed initial focus moved to the close button, confirmed `Shift+Tab` wrapped to the footer action row and `Tab` wrapped back to the first control, then pressed `Escape` and confirmed focus returned to the opener.

## Notes
- Verification required a local `pnpm install --frozen-lockfile` because this worktree did not have `node_modules`.
