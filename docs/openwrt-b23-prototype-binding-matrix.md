# OpenWrt B2.3 Prototype Binding Matrix

## Purpose

This document maps the static B2.3 prototype in [docs/openwrt-b23-artifacts/prototype/index.html](/Users/qingguan/Repos/Github/kuno/cc-switch/docs/openwrt-b23-artifacts/prototype/index.html) to the real OpenWrt UI and backend surface.

It exists to prevent another ambiguous "safe subset" implementation. Every visible prototype region should be classified before it is wired back to live behavior.

## Classification Rules

- `real now`
  The current OpenWrt LuCI/RPC/backend surface already supports this without schema changes.
- `adapter-only`
  The data exists, but the UI needs normalization or composition work to present it in the prototype shape.
- `needs backend`
  The visible control requires a backend or RPC addition before it can become live.
- `placeholder`
  The control may remain visible for design continuity, but it must stay inert and must not imply unsupported behavior.

## Frozen Assumptions

- LuCI remains the host shell.
- The top block uses custom-rendered host cards, not exposed LuCI form widgets.
- The bottom workspace is the primary product surface.
- Unsupported controls may stay visible as inert placeholders.
- The current static prototype is the visual source of truth until a newer designer artifact replaces it.

## Region Matrix

### 1. Page head

- `OpenWrt / Services`, `CC Switch`, subtitle
  - classification: `adapter-only`
  - notes: current LuCI page title and intro copy should be replaced by prototype-matching copy inside the custom host shell

- page-local `Light` / `Dark` toggle
  - classification: `adapter-only`
  - notes: the prototype already implements a page-local theme switch in static HTML; the live workspace should keep that behavior without depending on LuCI theme internals

### 2. Daemon control band

- running state text
  - classification: `real now`
  - source: existing service/runtime status

- `Healthy` chip
  - classification: `adapter-only`
  - source: service/runtime reachability and last-known status
  - notes: use current runtime/service truth, not an invented health model

- `Restart`
  - classification: `real now`
  - source: existing `restart_service`

- `Stop`
  - classification: `placeholder`
  - notes: visible only if the design keeps it; it must remain inert until the LuCI RPC path really exposes stop/start semantics

- listen endpoint summary
  - classification: `real now`
  - source: current host config `listen_addr` + `listen_port`

- `Service` value (`Router daemon`)
  - classification: `adapter-only`
  - notes: static descriptor only; no extra backend work required

### 3. Host settings cards

- `Listen settings`
  - `Listen address`
    - classification: `real now`
  - `Listen port`
    - classification: `real now`

- `Outbound proxy`
  - `HTTP proxy`
    - classification: `real now`
  - `HTTPS proxy`
    - classification: `real now`

- `Service flags`
  - `Proxy enabled`
    - classification: `adapter-only`
    - notes: use current runtime/service state only if it is already trustworthy in OpenWrt; otherwise keep as placeholder or prune in a later design revision
  - `Logging`
    - classification: `real now`
    - source: current host `log_level` / logging-enabled semantics

### 4. Workspace shell

- workspace title and section framing
  - classification: `adapter-only`
  - notes: this is composition work; no backend gap

- app picker
  - classification: `real now`
  - source: existing app selection state (`claude`, `codex`, `gemini`)

- `Add` button
  - classification: `adapter-only`
  - notes: existing provider editor flows can back this once the prototype shell is live again

### 5. Provider list

- provider rows
  - classification: `real now`
  - source: existing provider list state

- provider active/saved/draft chips
  - classification: `adapter-only`
  - notes: derive from existing provider/runtime state; do not invent new storage states unless the current data already supports them

- search box
  - classification: `adapter-only`
  - notes: local client-side filter only

- `All` filter chip
  - classification: `placeholder`
  - notes: keep inert until a real filter model exists

### 6. Selected-provider detail shell

- selected provider name
  - classification: `real now`

- selected provider subtitle by workspace
  - classification: `adapter-only`
  - notes: pure presentation

- `Duplicate`
  - classification: `adapter-only`
  - notes: can be implemented via current provider editor/save flows; no backend schema change required

- top `Save`
  - classification: `adapter-only`
  - notes: should use the same real provider save semantics as the editor workflow

- bottom `Cancel`
  - classification: `adapter-only`

- bottom `Save`
  - classification: `adapter-only`

### 7. `General` workspace

- workspace label `General`
  - classification: `real now`
  - notes: vocabulary already frozen

- provider name
  - classification: `real now`

- notes
  - classification: `real now`

- base URL
  - classification: `real now`

- model
  - classification: `real now`

- website URL
  - classification: `adapter-only`
  - notes: either derive from existing provider/base URL metadata or keep as display-only until the designer approves pruning/relocation

- API key field shown inside `General`
  - classification: `placeholder`
  - notes: real secret handling belongs under `Credentials`; keep visible only if the prototype still demands it

- `Health check`
  - classification: `placeholder`

- `Fallback model`
  - classification: `placeholder`

- `Latency budget`
  - classification: `placeholder`

### 8. `Failover` workspace

- workspace label `Failover`
  - classification: `real now`

- selected-provider failover summary
  - classification: `adapter-only`
  - source: existing runtime/failover state plus Phase 15 provider-oriented failover view

- queue membership
  - classification: `real now`
  - source: existing add/remove queue support and provider failover detail read model

- queue reorder
  - classification: `real now`
  - source: Phase 15 `reorder_failover_queue`

- auto failover toggle
  - classification: `real now`

- max retries
  - classification: `real now`
  - source: Phase 15 `set_max_retries`

- health status
  - classification: `real now`
  - source: current provider/app health surface

- `Route mode`
  - classification: `placeholder`

- `Outbound target`
  - classification: `adapter-only`
  - notes: presentation can point back to the host proxy card above; do not create a second source of truth

- `Priority`
  - classification: `adapter-only`
  - notes: derive from queue order when possible

- `Fallback policy`
  - classification: `placeholder`

- `Health gate`
  - classification: `placeholder`

- `Queue role`
  - classification: `placeholder`

- `Latency budget`
  - classification: `placeholder`

- `Health check`
  - classification: `placeholder`

### 9. `Credentials` workspace

- workspace label `Credentials`
  - classification: `real now`

- secret policy copy (`Blank preserves stored secret`)
  - classification: `real now`
  - source: current OpenWrt blank-secret behavior

- token field label / chosen env key
  - classification: `real now`

- masked token state
  - classification: `real now`

- base URL env mapping
  - classification: `adapter-only`

- model env mapping
  - classification: `adapter-only`

- `Fallback model`
  - classification: `placeholder`

- `Health probe`
  - classification: `placeholder`

- `Latency budget`
  - classification: `placeholder`

### 10. Add-provider modal

- modal shell, title, close/cancel actions
  - classification: `adapter-only`

- preset chips
  - classification: `real now`
  - source: current preset catalog and editor flows

- provider name
  - classification: `real now`

- notes
  - classification: `real now`

- website URL
  - classification: `adapter-only`

- base URL
  - classification: `real now`

- `Add draft`
  - classification: `adapter-only`
  - notes: should map to the current provider save/editor draft flow without inventing a new storage model

## Audit Delta: 2026-04-14

This matrix still describes the intended B2.3 live-binding target. The current packaged prototype is behind that target in a few specific places.

### Verified live now

- page head, daemon band, and host settings cards are live-bound from the LuCI host shell query payload built in `settings.js`
- provider list rows are live-bound from `payload.apps[appId].providers[*]`
- `General` is live for provider name, notes, base URL, model, token status, and token field presentation
- `Credentials` is live for blank-secret policy copy, token field label, masked token state, base URL, and model presentation
- per-provider failover facts are now included in the prototype payload under `payload.apps[appId].providers[*].failover`

### Verified not live yet

- selected-provider `Duplicate`, top `Save`, bottom `Save`, and modal `Add draft` are still mock-local prototype actions, not live OpenWrt mutations
- the add-provider modal remains presentation-only for package purposes even though the shared bundle has real editor flows elsewhere

### Contract risk against the matrix

- section 6 shell actions and section 10 modal actions should be treated as placeholder-only for the next package unless they are rebound to real OpenWrt mutations

## Minimal Verification Gate For Next Package

The next package build should wait for a verification gate that proves only the current live subset and explicitly guards the non-live subset.

### Required automated verification

- verify the static-prototype host query bindings in `settings.js` for running state, health, listen endpoint, proxy values, proxy-enabled state, and logging
- verify the posted iframe payload shape for `payload.apps[appId].providers[*]` covering `providerId`, `name`, `baseUrl`, `tokenField`, `tokenConfigured`, `tokenMasked`, `model`, `notes`, `active`, and nested `failover`
- verify the nested failover payload contract exactly for `providerId`, `proxyEnabled`, `autoFailoverEnabled`, `maxRetries`, `activeProviderId`, `inFailoverQueue`, `queuePosition`, `sortIndex`, `failoverQueueDepth`, `providerHealth`, and `failoverQueue[*]`
- verify the packaged prototype receiver renders provider list, `General`, and `Credentials` from live payload data
- verify the packaged prototype receiver consumes and renders live `provider.failover` under `Failover` from the payload contract (status, queue, health, policy, notes, and summary)
- verify prototype-only action buttons (`Add`, `Duplicate`, top `Save`, bottom `Save`) stay non-contractual for this milestone and are not used as package acceptance criteria

### Automated coverage landed

- `tests/openwrt/settings.providerState.test.ts` now guards the host query contract in `settings.js` and the exact nested `provider.failover` payload shape posted into the prototype iframe
- `tests/openwrt/staticPrototypeContract.test.ts` now boots the packaged prototype HTML, verifies live consumption for host bindings, provider list, `General`, `Credentials`, and `Failover`, and proves `Add`, `Duplicate`, and `Save` remain mock-only

### Package milestone trigger

Trigger the next package build when the static-prototype bridge has an automated verification pass for:

- live host bindings
- live provider list / `General` / `Credentials` payload consumption
- live `Failover` consumption from the posted `provider.failover` payload
- explicit proof that `Add`, `Duplicate`, and `Save` remain placeholder/mock-only unless separately rebound

As of 2026-04-14, that gate is covered by the two tests above. The next milestone is package-safe as long as those checks stay green and product files are unchanged.

## Small Action Plan

### Step 1. Shell cleanup

- remove LuCI default footer actions for this page
- keep the static prototype visible
- keep prototype asset packaging intact in `build-ipk.sh`

### Step 2. Live host binding

- replace static top-band values with real host/service values
- replace host-card values with real host/UCI values
- keep `Stop` placeholder-only

### Step 3. Workspace shell port

- replace the iframe/static bottom workspace with a real implementation that preserves the prototype DOM structure and layout
- keep the page-local theme toggle

### Step 4. Provider list binding

- wire provider rows from the current provider list
- keep `All` filter placeholder-only unless a real filter model is added

### Step 5. `General` binding

- wire real provider name, notes, base URL, model
- keep unsupported fields visible as placeholders only

### Step 6. `Credentials` binding

- wire token-field label, masked token state, and blank-secret policy
- keep unsupported fields visible as placeholders only

### Step 7. `Failover` binding

- wire selected-provider failover state, queue membership, reorder, auto-failover, max retries, and health
- keep speculative routing semantics placeholder-only

### Step 8. Modal/editor rebinding

- wire add/edit provider flows back into the prototype modal and save actions

### Step 9. Verification

- assert prototype shell markers
- assert no LuCI footer actions on the page
- assert top host values come from real host state
- assert unsupported controls remain inert

## Exit Condition

This matrix is complete when every visible B2.3 prototype region is either:

- live and truthful
- explicitly placeholder-only
- or intentionally removed by a newer approved design revision
