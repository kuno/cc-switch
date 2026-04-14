# OpenWrt B2.3 Implementation Handoff

## Purpose

This handoff packages the design-first work for the OpenWrt CC Switch page into a single implementation-planning baseline.

This is a planning document, not an implementation spec for every detail. It is intended to help the main agent start the implementation phase from a stable UI direction and a validated set of backend constraints.

## Chosen Baseline

- Final UI baseline: `B2.3`
- Why:
  - keeps the approved two-block shell
  - keeps the calmer `B2.1` visual tone
  - keeps the more scalable `B2.2` app-picker pattern
  - strips most mock-only explanation text so the surface reads closer to production

## Local Artifacts

These artifacts were produced on the shared workstation for review and reference:

- Static light mock: `/Volumes/tmp/option-b23-light.png`
- Static dark mock: `/Volumes/tmp/option-b23-dark.png`
- Clickable prototype: `/Volumes/tmp/cc-switch-clickable-b23/index.html`
- Design rationale: `/Volumes/tmp/cc-switch-design-options/option-b23-rationale.txt`

## UI Structure

### Page shell

- Top block: LuCI-owned daemon and host settings
- Bottom block: provider workspace

### App-level structure

- Current OpenWrt app scope remains `claude`, `codex`, `gemini`
- `B2.3` uses a compact app picker instead of equal-width tabs
- This is intended to scale better if more apps are added later

### Right-pane terminology

The final mock uses desktop-aligned terminology for the selected-provider detail area:

- `General`
- `Failover`
- `Credentials`

This intentionally replaces the earlier mock shorthand:

- `Providers`
- `Routing`
- `Env`

## Validated OpenWrt Constraints

The current OpenWrt host shell already aligns with the top block:

- UCI host fields:
  - `enabled`
  - `listen_addr`
  - `listen_port`
  - `http_proxy`
  - `https_proxy`
  - `log_level`
- Current references:
  - `openwrt/luci-app-ccswitch/htdocs/luci-static/resources/view/ccswitch/settings.js`
  - `openwrt/proxy-daemon/files/etc/config/ccswitch`

The current OpenWrt app scope is fixed to:

- `claude`
- `codex`
- `gemini`

Current references:

- `proxy-daemon/src/openwrt_admin.rs`
- `openwrt/luci-app-ccswitch/root/usr/share/rpcd/ucode/ccswitch`
- `docs/openwrt-shared-ui-parity-blueprint.md`

Operational control caveat:

- `Restart` exists on the current LuCI RPC path
- `Stop` does not currently exist on the LuCI RPC path

## Implementation-Safe Scope

The following parts of `B2.3` are safe to implement immediately:

- page shell and visual hierarchy
- compact app picker
- provider list
- selected-provider shell
- top LuCI-owned host settings area
- `General` pane

## Backend-Led Gaps

The `Failover` and `Credentials` panes should not be treated as fully ready from frontend layout alone.

### Credentials

What exists now:

- reduced OpenWrt provider DTO:
  - `name`
  - `base_url`
  - `token_field`
  - `token`
  - `model`
  - `notes`
- the daemon already maps these into app-specific env/config internally

What is missing:

- a first-class OpenWrt detail/env read model for the selected provider
- a clean normalized env/config DTO for UI consumption
- a dedicated detail RPC, or equivalent richer provider-detail contract

### Failover

What exists now:

- app runtime status already exposes:
  - `proxy_enabled`
  - `auto_failover_enabled`
  - `max_retries`
  - `active_provider_id`
  - `active_provider_health`
  - `failover_queue_depth`
  - `failover_queue`
- current mutations already exist for:
  - add to failover queue
  - remove from failover queue
  - set auto failover enabled

What is missing:

- no provider-oriented failover detail DTO for the selected provider
- no reorder RPC for failover queue priority
- no OpenWrt mutation RPC for `max_retries`
- no clear OpenWrt mutation RPC for per-app proxy enable/disable from the workspace

## Mock-Only Fields To Avoid Treating As Real

The following fields from earlier mock passes should not be implemented as first-class OpenWrt fields unless backend/schema work is added deliberately:

- latency budget
- custom health check / health probe
- route mode
- fallback policy
- health gate
- queue role
- distinct fallback model

## Recommended Implementation Order

1. Implement the `B2.3` shell and `General` pane.
2. Add backend/RPC support for `Credentials`.
3. Add backend/RPC support for `Failover`.
4. Wire the right-pane tabs to real OpenWrt contracts.
5. Do responsive/mobile refinement after desktop/tablet parity lands.

## Main-Agent Checklist

### Implement now

- adopt `B2.3` as the OpenWrt UI baseline
- keep the two-block shell
- keep the app picker
- keep desktop-aligned terminology:
  - `General`
  - `Failover`
  - `Credentials`

### General pane

- back it with current OpenWrt provider fields
- use current secret-safe edit rules

### Credentials pane

- add provider detail/env RPC support
- return normalized app-specific credential/config data for the selected provider
- keep blank-secret-preserves-existing behavior

### Failover pane

- add provider-oriented failover detail support
- add routing/failover mutations still missing on the OpenWrt path

### Host shell

- keep only real LuCI/OpenWrt controls
- do not assume `Stop` exists unless that RPC is added

## Key References

- [docs/openwrt-shared-ui-parity-blueprint.md](/Users/qingguan/Repos/Github/kuno/cc-switch/docs/openwrt-shared-ui-parity-blueprint.md)
- [openwrt/luci-app-ccswitch/htdocs/luci-static/resources/view/ccswitch/settings.js](/Users/qingguan/Repos/Github/kuno/cc-switch/openwrt/luci-app-ccswitch/htdocs/luci-static/resources/view/ccswitch/settings.js)
- [openwrt/luci-app-ccswitch/root/usr/share/rpcd/ucode/ccswitch](/Users/qingguan/Repos/Github/kuno/cc-switch/openwrt/luci-app-ccswitch/root/usr/share/rpcd/ucode/ccswitch)
- [proxy-daemon/src/openwrt_admin.rs](/Users/qingguan/Repos/Github/kuno/cc-switch/proxy-daemon/src/openwrt_admin.rs)
