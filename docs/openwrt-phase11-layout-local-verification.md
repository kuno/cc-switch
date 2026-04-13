# OpenWrt Phase 11 Layout Local Verification

Use these local-only checks for the Phase 11 layout hardening contract.

## Commands

1. `rtk pnpm test:unit -- tests/openwrt/settings.providerState.test.ts tests/openwrt/providerUiBundle.test.ts`
2. `rtk pnpm build:openwrt-provider-ui`
3. `rtk pnpm typecheck`

## What These Guardrails Cover

- `tests/openwrt/settings.providerState.test.ts`
  - one LuCI host shell
  - runtime mount above provider mount
  - single LuCI-owned restart control
  - no secondary app shell structure or desktop-shell language
- `tests/openwrt/providerUiBundle.test.ts`
  - mounted runtime/provider surfaces expose the expected page, card, and app-switch layout hooks
  - staged bundle and stylesheet keep the shared layout hook selectors needed by the host page
  - compiled stylesheet still ships the responsive grid utilities and narrow-width field collapse contract
  - staged artifacts remain free of forbidden desktop-shell phrases and selectors

## Staged Artifact Files

- `openwrt/provider-ui-dist/ccswitch-provider-ui.js`
- `openwrt/provider-ui-dist/ccswitch-provider-ui.css`
