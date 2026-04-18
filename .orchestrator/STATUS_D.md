# Task D Status

## Scope delivered
- Added a new ProviderSidePanel drawer host with `openForApp(appId, providerId?)` and a placeholder-click fallback while Task B is not merged.
- Implemented three tabs only: Preset, General, Credentials.
- Reused the existing OpenWrt preset catalog and re-grouped it into official / platform templates / compatible gateways.
- Added Codex `auth.json` upload and remove actions, gated on saved providers only.
- Kept failover UI completely out of the drawer.
- Left `.owt-legacy-preserved`, `SharedProviderManager`, LuCI `settings.js`, and the ucode RPC backend untouched.

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

## Notes
- Verification required a local `pnpm install --frozen-lockfile` because this worktree did not have `node_modules`.
