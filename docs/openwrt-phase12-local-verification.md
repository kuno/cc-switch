# OpenWrt Phase 12 Local Verification

Use these local-only checks for the Phase 12 interaction hardening contract.

## Commands

1. `rtk pnpm test:phase12:verification`
2. `rtk pnpm build:openwrt-provider-ui`
3. `rtk pnpm typecheck`

## What These Guardrails Cover

- `test:phase12:verification`
  - shared provider manager interaction semantics for keyboard app switching, labeled search clearing, and dialog close behavior
  - shared runtime interaction semantics for refresh and failover controls without router-dependent validation
  - OpenWrt shell and staged bundle assertions for host-shell ownership, focus-visible selectors, dialog portal selectors, and responsive host-fit selectors
- `build:openwrt-provider-ui`
  - the staged OpenWrt provider bundle and stylesheet still build from the current shared surfaces
- `typecheck`
  - the shared provider/runtime verification surface stays type-safe in the exit gate

## Phase 12 Exit Gate

Phase 12 lane 3 is complete with local proof only. No router validation step is required.
