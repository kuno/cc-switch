# OpenWrt Phase 22 Rebase Completion Status

## Purpose

This note marks the end of the current OpenWrt rebase-maintenance phase.

It does **not** mean this branch is fully mergeable back into `upstream/main`.
It means the branch now sits at a coherent maintenance boundary:

- daemon-owned OpenWrt control-plane code is localized under `proxy-daemon`
- router-specific HTTP/API extensions use explicit injection points
- remaining links into `src-tauri` are intentional shared runtime dependencies,
  not half-finished extraction work

## Completed In This Phase

The following checkpoints define the current boundary:

- `817c6444` `refactor(openwrt): extract shared daemon config core`
- `58fa5f2c` `refactor(openwrt): localize daemon settings foundation`
- `53a06dcc` `refactor(openwrt): localize daemon config helpers`
- `2efe6fe1` `feat(openwrt): add admin metadata endpoint`
- `d33ef468` `feat(openwrt): expose app proxy config API`
- `e1a32896` `feat(openwrt): add request log admin surface`

In practice this means the router daemon now owns:

- OpenWrt admin/read APIs in `proxy-daemon/src/openwrt_admin.rs`
- OpenWrt HTTP route mounting in `proxy-daemon/src/openwrt_http.rs`
- CLI entrypoints in `proxy-daemon/src/main.rs`
- LuCI fallback/RPC plumbing in `openwrt/luci-app-ccswitch`
- OpenWrt provider/request-log UI surface in `src/openwrt-provider-ui`

## Remaining Intentional Couplings

### 1. `proxy-daemon/src/shared_core.rs`

This bridge still path-imports:

- `src-tauri/src/database/mod.rs`
- `src-tauri/src/proxy/mod.rs`

These remain on purpose.

Reason:

- `database` is still the shared SQLite runtime/storage core
- `proxy` is still the shared proxy runtime core
- both are fast-moving upstream-owned subsystems
- extracting them now would create a larger downstream fork and increase future
  rebase conflict risk

### 2. `proxy-daemon/src/services/mod.rs`

This bridge still path-imports:

- `src-tauri/src/services/omo.rs`
- `src-tauri/src/services/provider/mod.rs`
- `src-tauri/src/services/proxy.rs`
- `src-tauri/src/services/stream_check.rs`
- `src-tauri/src/services/subscription.rs`
- `src-tauri/src/services/usage_stats.rs`

These are also intentional for now.

Reason:

- `services/proxy.rs` is the shared runtime orchestration layer and already
  exposes the right OpenWrt extension seam through
  `ProxyServer::with_route_mounter(...)`
- `services/usage_stats.rs` is now reused directly for OpenWrt request-log APIs
- `database/dao/stream_check.rs` depends on `services::stream_check` types
- proxy rate-limit/runtime code depends on `services::subscription`
- `services/provider` and `services/omo` still contain shared business logic we
  want upstream to keep owning

## Why This Counts As Complete

Before this phase, the branch still contained a mix of:

- daemon-owned OpenWrt API work
- temporary bridge code
- unresolved questions about which side should own router behavior

After this phase:

- router-only admin/API behavior is localized under `proxy-daemon`
- OpenWrt HTTP routes are added without forking `ProxyServer`
- the remaining shared imports are deliberate and explainable
- there is no obvious low-risk extraction left that would reduce rebase pain
  without also increasing downstream ownership of upstream service code

That is the right stopping point for this rebase-maintenance pass.

## Rules For Future Work

If the router needs richer daemon APIs later, prefer this pattern:

1. Add router behavior in `proxy-daemon/src/openwrt_admin.rs`
2. Expose it through `proxy-daemon/src/openwrt_http.rs`
3. Keep mounting through `ProxyServer::with_route_mounter(...)`
4. Reuse upstream `database`, `proxy`, and shared service logic where possible

Do **not** start by copying more of `src-tauri/src/services/*` into the daemon.
That would reduce short-term friction for one change while increasing long-term
rebase cost.

## If Further Decoupling Is Needed Later

The next safe extraction direction is still:

- small leaf shared modules first
- shared types/helpers first
- avoid extracting the full proxy stack or database core unless upstream also
  wants that split

Good candidates remain the same kind of low-risk modules already handled in
earlier phases:

- config-facing shared types
- small helper modules with narrow dependencies

High-risk candidates that should stay upstream-owned unless strategy changes:

- `src-tauri/src/proxy/*`
- `src-tauri/src/database/*`
- large parts of `src-tauri/src/services/provider/*`

## Verification State At This Boundary

The request-log/admin surface and shared SQL fix were verified before this phase
was closed with:

- `rtk cargo test --manifest-path proxy-daemon/Cargo.toml`
- `rtk pnpm vitest run tests/openwrt/settings.providerState.test.ts tests/openwrt/providerUiBundle.test.ts`
- `rtk pnpm build:openwrt-provider-ui`

This document itself is non-functional and does not change runtime behavior.
