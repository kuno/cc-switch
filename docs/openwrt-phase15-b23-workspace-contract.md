# OpenWrt Phase 15 B2.3 Workspace Contract

## Purpose

This phase turns the approved `B2.3` design handoff into an implementation-safe contract for the next OpenWrt UI slice.

The goal is not to blindly copy the mockup. The goal is to preserve the chosen information architecture and visual direction while grounding each visible pane in the current OpenWrt backend and LuCI host constraints.

## Design Baseline

- Visual baseline: `B2.3`
- Source handoff: [openwrt-b23-implementation-handoff.md](/Users/qingguan/Repos/Github/kuno/cc-switch/docs/openwrt-b23-implementation-handoff.md)
- Repo-tracked artifacts:
  - [option-b23-light.png](/Users/qingguan/Repos/Github/kuno/cc-switch/docs/openwrt-b23-artifacts/option-b23-light.png)
  - [option-b23-dark.png](/Users/qingguan/Repos/Github/kuno/cc-switch/docs/openwrt-b23-artifacts/option-b23-dark.png)
  - [option-b23-rationale.txt](/Users/qingguan/Repos/Github/kuno/cc-switch/docs/openwrt-b23-artifacts/option-b23-rationale.txt)

## Phase Thesis

The page should split into two clear vertical blocks:

- top block: minimal LuCI-owned daemon and host controls
- bottom block: desktop-inspired provider workspace

This phase keeps the current router host boundary intact and avoids mock-only fields that are not supported by the OpenWrt backend today.

## Terminology Freeze

This phase adopts the following user-facing vocabulary for the selected-provider detail area:

- `General`
- `Failover`
- `Credentials`

Terms explicitly not used as the primary UI vocabulary in this phase:

- `Env`
- `Routing`
- `Providers` as a right-pane label

Internal/backend naming may still use existing code terminology where needed. The freeze above applies to the visible workspace labels and implementation planning.

## Information Architecture

### Top block: host shell

The top block stays LuCI-owned and intentionally minimal.

It may show:

- service running state
- restart control
- listen address and port
- optional upstream proxy settings
- enabled or disabled host config state

It must not become a dump of every advanced setting or every runtime detail.

### Bottom block: provider workspace

The bottom block follows the desktop main-window pattern more closely:

- compact app picker
- provider list
- selected-provider detail area
- provider editor and dialogs

This is the main product workspace. It should carry most of the visual identity, layout effort, and interaction density.

## Backend-Safe Scope

### Safe to implement immediately

- two-block shell
- compact app picker
- provider list layout
- selected-provider shell
- `General` pane backed by current OpenWrt provider detail data
- light and dark theme support through shared tokens
- responsive workspace behavior

### General pane contract

The `General` pane uses the existing selected-provider detail contract as its data source.

Current baseline already available through `get_provider`:

- `name`
- `base_url`
- `token_field`
- `token_configured`
- `token_masked`
- `model`
- `notes`
- active/configured state from the reduced provider view

General-pane edits must keep current OpenWrt behavior:

- blank secret preserves the existing stored secret
- reads return masked token state, not raw secrets
- partial updates must not force secret re-entry

### Credentials pane contract

The `Credentials` pane is allowed in the layout, but it should not invent new backend fields.

This phase may:

- reuse the existing selected-provider detail RPC as baseline
- present app-specific credential/config labels more clearly
- add a normalization layer in the frontend or thin backend DTO if needed

This phase must not:

- invent new first-class backend fields just to match the mockup
- expose raw secrets
- require new secret entry on every edit

### Failover pane contract

The `Failover` pane is allowed in the layout, but its live data and controls must reflect the actual OpenWrt backend, not desktop-only assumptions.

Current failover/runtime data already available per app:

- `active_provider_id`
- `active_provider_health`
- `auto_failover_enabled`
- `max_retries`
- `failover_queue`
- `failover_queue_depth`
- `proxy_enabled`

Current failover mutations already available:

- add to queue
- remove from queue
- set auto failover enabled

The following are valid backend additions for this phase or the immediately following backend slice:

- provider-oriented failover detail read model for the selected provider
- `reorder_failover_queue(app, provider_ids[])`
- `set_max_retries(app, value)`

The following are explicitly deferred unless separately approved:

- latency budget
- custom health check
- route mode
- fallback policy
- health gate
- queue role
- distinct fallback model

`set_app_proxy_enabled(app, enabled)` remains optional and decision-dependent. It should not be treated as automatically safe without confirming whether it belongs to the shared workspace or should remain LuCI-owned.

## Host Boundary Freeze

This phase keeps these host truths intact:

- `Restart` exists on the current LuCI RPC path
- `Stop` does not exist on the current LuCI RPC path
- LuCI host form still owns:
  - `enabled`
  - `listen_addr`
  - `listen_port`
  - `http_proxy`
  - `https_proxy`
  - `log_level`

The B2.3 design must not be implemented in a way that implies unsupported host controls are already available.

## Visual Rules

- avoid redundant informational tiles
- no overflow or overlap at supported viewport sizes
- top block should stay visually lighter and more compact than the bottom workspace
- bottom workspace should follow the desktop reference more closely than LuCI’s older form layout
- both light and dark theme variants must be supported by the same tokenized system

## Recommended Implementation Order

1. Implement the two-block shell and compact app picker.
2. Rebuild the provider workspace around the `General` pane using current provider detail data.
3. Add a real `Credentials` pane presentation on top of the existing selected-provider detail contract.
4. Add missing backend/RPC support needed for the real `Failover` pane.
5. Refine responsive and theme behavior after the new workspace structure is live.

## Suggested Lane Split

### Lane A: workspace shell and app picker

- top/bottom split
- compact app picker
- bottom workspace framing
- light/dark token application

### Lane B: selected-provider General/Credentials surface

- provider list to detail flow
- `General` pane
- `Credentials` pane backed by current detail data
- editor/dialog alignment with the new workspace

### Lane C: failover backend contract and pane wiring

- provider-oriented failover read model
- queue reorder
- max retries mutation
- live `Failover` pane wiring

### Lane D: verification and bundle guardrails

- bundle/runtime guards for the new shell
- light/dark token guardrails
- responsive/layout assertions
- pane contract verification

## Exit Condition

This phase is complete when:

- the OpenWrt page matches the two-block B2.3 structure
- the top block is minimal and truthful to current host controls
- the bottom workspace becomes the primary product surface
- `General` is fully real
- `Credentials` is real without new secret/schema regressions
- `Failover` is either real against supported backend contracts or visually present but clearly gated behind only the supported subset
- light and dark theme both render coherently

