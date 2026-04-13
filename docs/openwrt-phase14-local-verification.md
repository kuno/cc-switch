# OpenWrt Phase 14 Local Verification

Phase 14 stays local-only. The verification gate for this branch is:

1. `rtk pnpm exec vitest run tests/shared/providers/SharedProviderManager.test.tsx tests/shared/providers/ui/SharedProviderCard.test.tsx tests/shared/runtime/SharedRuntimeSurface.test.tsx tests/shared/runtime/ui/SharedRuntimeAppCard.test.tsx tests/openwrt/settings.providerState.test.ts tests/openwrt/providerUiBundle.test.ts`
2. `rtk pnpm build:openwrt-provider-ui`
3. `rtk pnpm typecheck`

Current local guardrails cover:

- host-owned LuCI shell layout, mount ordering, and fallback ownership seams
- shared token-field defaults and stored-secret state across Claude, Codex, and Gemini
- responsive mount hooks and staged embed-safe selectors for provider/runtime surfaces
- OpenWrt dialog body-portal ownership, centered viewport-safe staged selectors, and overlay ownership
- staged bundle safety for the canonical OpenWrt JS/CSS artifacts

Deferred assertion:

- Host-shell dark-mode token convergence in `openwrt/luci-app-ccswitch/htdocs/luci-static/resources/view/ccswitch/settings.js` is not locked here yet because the current host shell stylesheet is still light-only on this branch. That assertion should land with lanes 1-3 once the LuCI-host dark treatment is finalized.
