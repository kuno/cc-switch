# OpenWrt Future Rebase Checklist

## Purpose

Use this checklist for future rebases of the OpenWrt branch onto `upstream/main`.

The goal is not to remove all downstream code. The goal is to:

- keep local OpenWrt features on top of upstream
- reduce repeated conflict hotspots
- avoid accidentally forking fast-moving upstream core runtime code

This checklist complements:

- `docs/openwrt-phase22-rebase-completion-status.md`
- `docs/openwrt-phase21-option2-daemon-decoupling-log.md`

## Rebase Goal

At the end of a good rebase:

- `HEAD` is on top of current `upstream/main`
- OpenWrt-specific behavior still works
- downstream-only changes stay localized
- no new unnecessary edits are introduced into upstream-owned core files

## Before Rebase

1. Fetch and confirm the real base.
   - `git fetch upstream`
   - `git rev-list --left-right --count upstream/main...HEAD`

2. Review the current intentional coupling boundary.
   - `proxy-daemon/src/shared_core.rs`
   - `proxy-daemon/src/services/mod.rs`
   - `docs/openwrt-phase22-rebase-completion-status.md`

3. Review recent upstream changes in shared conflict-prone areas.
   - `src-tauri/src/proxy/*`
   - `src-tauri/src/database/*`
   - `src-tauri/src/services/proxy.rs`
   - `src-tauri/src/services/provider/*`
   - `src-tauri/src/services/subscription.rs`
   - `src-tauri/src/services/usage_stats.rs`

4. Review downstream-owned OpenWrt surfaces first.
   - `openwrt/*`
   - `proxy-daemon/src/openwrt_admin.rs`
   - `proxy-daemon/src/openwrt_http.rs`
   - `src/openwrt-provider-ui/*`

## Preferred Conflict Strategy

When conflicts happen, prefer this order:

1. Preserve upstream behavior in upstream-owned core modules.
2. Re-apply router-specific behavior in daemon-owned OpenWrt modules.
3. Reuse extension points instead of patching more upstream internals.

In practice, prefer:

- add router HTTP endpoints in `proxy-daemon/src/openwrt_http.rs`
- put router business logic in `proxy-daemon/src/openwrt_admin.rs`
- keep route injection through `ProxyServer::with_route_mounter(...)`
- keep OpenWrt UI logic in `src/openwrt-provider-ui/*` and `openwrt/luci-app-ccswitch/*`

## Files Safe To Own Downstream

These are normal downstream ownership surfaces:

- `openwrt/build-ipk.sh`
- `openwrt/proxy-daemon/*`
- `openwrt/luci-app-ccswitch/*`
- `proxy-daemon/src/openwrt_admin.rs`
- `proxy-daemon/src/openwrt_http.rs`
- `proxy-daemon/src/main.rs`
- `src/openwrt-provider-ui/*`

Conflicts here are expected and usually safe to resolve downstream-first.

## Files To Treat As Upstream-Owned

Do not expand downstream ownership here unless there is a concrete repeated pain:

- `src-tauri/src/proxy/*`
- `src-tauri/src/database/*`
- `src-tauri/src/services/proxy.rs`
- large parts of `src-tauri/src/services/provider/*`
- `src-tauri/src/services/subscription.rs`
- `src-tauri/src/services/stream_check.rs`
- `src-tauri/src/services/usage_stats.rs`

Reason:

- these files move with upstream product/runtime evolution
- forking them downstream usually increases future rebase cost

## Bridges To Keep Small

These two files should remain narrow bridge modules, not become new feature homes:

### `proxy-daemon/src/shared_core.rs`

Keep it limited to path-based bridging for:

- `src-tauri/src/database/mod.rs`
- `src-tauri/src/proxy/mod.rs`

Do not add new downstream logic here.

### `proxy-daemon/src/services/mod.rs`

Keep it limited to service re-exports and compatibility shims.

Do not solve feature pressure by copying more `src-tauri/src/services/*` into
`proxy-daemon`.

## When To Extract More

Only do more structural decoupling if at least one of these becomes true:

1. The same upstream file conflicts repeatedly across multiple rebases.
2. A new router feature requires repeated edits in the same upstream-owned file.
3. Upstream itself starts splitting a relevant subsystem in a compatible way.

If extraction is needed, prefer:

- leaf helpers first
- shared types first
- narrow config helpers first

Avoid starting with:

- full proxy runtime extraction
- database core extraction
- broad `provider` service forking

## Package Versioning Rule

For standalone OpenWrt IPK builds:

- package version should follow `git describe --tags --always --dirty`
- runtime daemon version should match the same branch state

This is handled by:

- `proxy-daemon/build.rs` for runtime version
- `openwrt/build-ipk.sh` for standalone package version

## Verification After Rebase

Run these checks after finishing a rebase:

1. Branch/base check
   - `git rev-list --left-right --count upstream/main...HEAD`

2. Daemon tests
   - `cargo test --manifest-path proxy-daemon/Cargo.toml`

3. OpenWrt UI tests
   - `pnpm vitest run tests/openwrt/settings.providerState.test.ts tests/openwrt/providerUiBundle.test.ts`

4. OpenWrt UI bundle build
   - `pnpm build:openwrt-provider-ui`

5. Standalone IPK build
   - `./openwrt/build-ipk.sh aarch64`

6. Version checks
   - `git describe --tags --always --dirty`
   - inspect built IPK filenames
   - inspect `Version:` in extracted package control metadata
   - verify daemon/UI version surfaces if the rebase touched version code

## Stop Condition

Stop the rebase-maintenance work when all of the following are true:

- branch is on top of `upstream/main`
- local OpenWrt features are restored
- tests/build pass
- remaining core coupling is still intentional and documented
- no additional low-risk extraction remains

At that point, do not keep refactoring just to chase theoretical cleanliness.
Wait for concrete future pain before reopening deeper decoupling.
