# OpenWrt Phase 17 B2.4 Slice Contract

## Purpose

This document defines the smallest evidence-backed implementation slices to move the OpenWrt page from the current static B2.4 prototype bridge toward a truthful live UI.

The priority is overnight-safe progress without user router/UI verification. Any slice that mutates router state is called out separately for later manual verification.

## Refreshed Baseline

- Current branch baseline: `53329e6d`
- Current live LuCI path is hard-cut to the static B2.4 iframe bridge:
  - `openwrt/luci-app-ccswitch/htdocs/luci-static/resources/view/ccswitch/settings.js:24-25`
  - `openwrt/luci-app-ccswitch/htdocs/luci-static/resources/view/ccswitch/settings.js:395-413`
- Host state is injected into the prototype from LuCI + runtime status query params:
  - `settings.js:670-715`
- Provider list, provider detail fields, and per-provider failover payloads are already loaded from real RPC/backend state and posted into the prototype:
  - `settings.js:718-825`
- The non-static LuCI path still contains the real host `form.Map` for `enabled`, `listen_addr`, `listen_port`, `http_proxy`, `https_proxy`, and `log_level`, but static mode bypasses that render path completely:
  - `settings.js:2960-3015`
- B2.4 currently shows editable-looking host and provider controls inside the iframe:
  - `prototype-b24/index.html:1111-1154`
  - `prototype-b24/index.html:1193-1210`
- B2.4 also keeps several actions explicitly mock-local today:
  - add/duplicate/save toasts: `prototype-b24/index.html:2255-2272`
  - logging select only mutates local prototype state: `prototype-b24/index.html:2280-2282`
- The failover pane already has a truthful read contract when `provider.failover` is present:
  - `prototype-b24/index.html:1801-1848`
  - `proxy-daemon/src/openwrt_admin.rs:223-270`
- Existing rpcd/backend already exposes provider CRUD, failover mutations, runtime reads, and restart:
  - rpcd surface: `openwrt/luci-app-ccswitch/root/usr/share/rpcd/ucode/ccswitch:220-340`, `:357-539`
  - backend surface: `proxy-daemon/src/openwrt_admin.rs:380-550`

## Planning Rules

- Do not invent semantics for B2.4 placeholder fields.
- Prefer shell-only slices where the current RPC/backend already exists.
- Keep unsupported controls visible only if they are clearly inert or explicitly labeled placeholder-only.
- Treat router-writing slices as implementation-ready but not complete until later manual verification on a real OpenWrt target.

## Ordered Slice Plan

### Slice 0: Freeze the B2.4 truth boundary

- Type: `docs-only`
- Scope:
  - lock the refreshed B2.4 baseline against `prototype-b24`, `settings.js`, rpcd, and `openwrt_admin.rs`
  - explicitly list which visible controls are real read-only, real mutable, adapter-only, or placeholder-only
- Why first:
  - the B2.4 cutover changed the asset path, spacing, and visible affordances
  - the next implementation slices should not guess which edit-looking controls are actually supported
- Manual verification: `no`

### Slice 1: Make the provider rail truthful and useful without new backend work

- Type: `shell-only`
- Scope:
  - wire `Search provider or endpoint` to local client-side filtering against the already-loaded provider list
  - either turn `All` into a local reset chip or explicitly mark it inert
- Evidence:
  - B2.4 rail exists in `prototype-b24/index.html:1180-1183`
  - provider data already arrives live from `settings.js:718-825`
- Why this early:
  - zero backend risk
  - improves the live list immediately
  - safe to land and test overnight
- Manual verification: `no`

### Slice 2: Remove false edit affordances before adding writes

- Type: `shell-only`
- Scope:
  - make unsupported host controls and provider actions visually honest until they are bridged for real
  - preserve explicit placeholder messaging for Add, Duplicate, and Save
  - decide whether General/Credentials fields stay editable-looking only when paired with a real save bridge; otherwise present them as read-only live values
- Evidence:
  - editable-looking host band: `prototype-b24/index.html:1111-1154`
  - editable-looking provider panes and save buttons: `prototype-b24/index.html:1193-1210`, `:1928-1955`
  - current mock-only actions: `prototype-b24/index.html:2255-2282`
- Why before mutations:
  - this is the smallest way to improve truthfulness without touching router state
  - it avoids a UI that looks writable but still only toasts
- Manual verification: `no`

### Slice 3: Bridge General/Credentials saves to the existing provider RPC surface

- Type: `shell-only`
- Scope:
  - add a postMessage action bridge from `prototype-b24/index.html` to `settings.js`
  - map Add, Duplicate, and Save to the existing provider helpers and rpcd methods already present in the LuCI view
  - only persist fields that have real backend support now:
    - `name`
    - `baseUrl`
    - `tokenField`
    - `token`
    - `model`
    - `notes`
  - keep `Fallback model`, `Health check`, and `Latency budget` placeholder-only
  - treat `Website URL` as presentation-only unless a separate truthful source is defined
- Evidence:
  - existing provider CRUD rpcd methods: `rpcd/ucode/ccswitch:220-267`, `:435-477`
  - provider data already normalized into the prototype payload: `settings.js:795-825`
  - non-placeholder provider save helpers already exist in the LuCI view outside static mode: `settings.js:2312-2457`
- Why here:
  - highest-value live mutation slice with no backend/schema additions
  - turns the main B2.4 workspace into a truthful editor for the subset the router already supports
- Manual verification: `yes`
  - provider save
  - masked-secret preservation
  - activation/restart behavior on a real router

### Slice 4: Bridge Restart, but keep Stop unsupported

- Type: `shell-only`
- Scope:
  - wire the B2.4 `Restart` chip to the existing `restart_service` rpcd path
  - reuse current LuCI banner/error handling where possible
  - keep `Stop` inert until an explicit stop/start contract exists
- Evidence:
  - visible Restart/Stop affordances: `prototype-b24/index.html:1113-1123`
  - restart rpcd method exists: `rpcd/ucode/ccswitch:344-350`, `:535-539`
  - existing restart bridge helper already exists in the LuCI shell path: `settings.js:2799-2819`
  - no stop/start rpcd method exists in the current surface
- Why separate from Slice 3:
  - restart is small and already supported
  - stop is not supported and should not be implied by the same bridge
- Manual verification: `yes`

### Slice 5: Freeze the host-band write strategy before implementing it

- Type: `docs-only`
- Scope:
  - choose one truthful path for `listen_addr`, `listen_port`, `http_proxy`, `https_proxy`, and `log_level`
  - acceptable options:
    - bridge the B2.4 host band into LuCI/UCI save/apply behavior
    - keep the B2.4 band read-only and expose the real LuCI host form outside the iframe until a safe bridge exists
- Evidence:
  - static mode bypasses the real LuCI host form: `settings.js:2960-3015`
  - host band currently only reflects query-param state and local prototype changes: `settings.js:670-715`, `prototype-b24/index.html:2280-2282`
- Why this needs a contract first:
  - these values change router networking behavior
  - the implementation path is not zero-risk the way provider RPC saves are
- Manual verification: `no`

### Slice 6: Implement the chosen host-band write path

- Type: `shell-only`
- Scope:
  - wire the chosen host-band strategy from Slice 5
  - if bridged, persist only the existing LuCI host fields:
    - `enabled`
    - `listen_addr`
    - `listen_port`
    - `http_proxy`
    - `https_proxy`
    - `log_level`
  - do not widen scope beyond the current LuCI host form
- Evidence:
  - real host fields already exist in LuCI form land: `settings.js:2975-3015`
- Why after Slice 5:
  - router-facing save/apply behavior is materially riskier than the provider workspace writes
- Manual verification: `yes`

### Slice 7: Freeze the failover write subset before adding new controls

- Type: `docs-only`
- Scope:
  - keep the B2.4 failover pane truthful to the current backend subset only
  - define which existing backend operations may become editable in B2.4:
    - queue membership
    - queue reorder
    - auto failover enabled
    - max retries
  - explicitly keep these as unsupported/deferred:
    - route mode
    - outbound target
    - priority
    - fallback policy
    - health gate
    - queue role
    - latency budget
    - health check
- Evidence:
  - live failover read fields: `prototype-b24/index.html:1818-1848`
  - placeholder-only failover fields still exist in the mock vocabulary: `prototype-b24/index.html:1851-1879`
  - supported backend failover mutations already exist: `rpcd/ucode/ccswitch:271-340`, `:480-532`; `openwrt_admin.rs:455-550`
- Why this is docs-first:
  - the current B2.4 pane is primarily read-oriented
  - adding write affordances without freezing the exact subset would invite backend invention
- Manual verification: `no`

### Slice 8: Add failover writes only for the already-supported backend subset

- Type: `shell-only`
- Scope:
  - add B2.4 interaction affordances only for the Slice 7 subset
  - bridge those affordances to the existing failover rpcd/backend methods
  - keep unsupported routing-policy vocabulary read-only or visibly placeholder-only
- Evidence:
  - current backend already supports `add_to_failover_queue`, `remove_from_failover_queue`, `reorder_failover_queue`, `set_auto_failover_enabled`, and `set_max_retries`
- Why late:
  - lower urgency than provider CRUD and restart
  - needs a deliberate B2.4 control design, not just hidden plumbing
- Manual verification: `yes`

## Deferred Backend-Only Work

These are not part of the recommended overnight path.

### Backend-only A: Stop/start service contract

- Type: `backend-only`
- Needed only if product insists that the B2.4 `Stop` chip must become real
- Current evidence:
  - `restart_service` exists
  - no `stop_service` or `start_service` rpcd method exists today
- Manual verification: `yes`

### Backend-only B: New first-class B2.4 fields

- Type: `backend-only`
- Applies only if product explicitly wants real semantics for:
  - fallback model
  - health probe / health check
  - latency budget
  - route mode
  - fallback policy
  - health gate
  - queue role
  - separate website URL
- Recommendation:
  - do not start this before slices 0-8 are complete
  - otherwise the team will be building backend semantics to satisfy mock vocabulary instead of shipping the truthful subset first
- Manual verification: `yes`

## Recommended Overnight Cut

If only a few slices can move tonight, take them in this order:

1. Slice 0
2. Slice 1
3. Slice 2
4. Slice 3
5. Slice 4

That sequence improves truthfulness and real provider workflow coverage first, without blocking on new backend semantics or risky router-host config writes.
