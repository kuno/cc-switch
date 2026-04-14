# OpenWrt Phase 20: Native ubus Method Contract

Baseline: `cc4dbc1f` on `phase20-ubus-contract`

## Problem

The current OpenWrt admin surface works but has two architectural debts:

1. **Shell-spawn indirection**: Every ubus method in `rpcd/ucode/ccswitch` shells out via `popen()` to the `cc-switch` binary. The binary serializes JSON to stdout; the ucode wrapper stuffs that stdout into an envelope string field (`provider_json`, `providers_json`, `status_json`). The TypeScript adapter then `JSON.parse()`s the string back into an object. This is a round-trip through three serialization boundaries for what should be a single structured return.

2. **Iframe bridge**: The LuCI page loads a static prototype HTML file in an iframe and shuttles state through `postMessage` + query parameters. Host settings are saved through a `postMessage` -> UCI write -> `postMessage` reply cycle. This works but blocks native React/LuCI integration.

This contract defines the target ubus method surface that eliminates debt (1) and creates the preconditions for eliminating debt (2).

## Design Principles

- **ubus is a transport, not the domain model.** Method signatures map 1:1 to stable domain types defined in `src/shared/providers/domain/types.ts` and `proxy-daemon/src/openwrt_admin.rs`. If a future HTTP admin API exists, it exposes the same domain objects over a different transport.
- **Structured objects, not embedded JSON strings.** Every return value is a native ubus object. No `*_json` string fields.
- **Read models separated from mutation methods.** Reads are idempotent and ACL-gated to `read`; mutations are ACL-gated to `write`.
- **No invented semantics.** If the Rust backend does not have a field (e.g., per-provider cost/quota, fallback model, health probe URL), the ubus surface does not expose it.

## Frozen Method Surface

Object: `ccswitch`

### Read Methods (ACL: read)

| # | Method | Params | Return type | Backend source |
|---|--------|--------|-------------|----------------|
| R1 | `list_providers` | `app` | `ProviderListView` | `openwrt_admin::list_providers` |
| R2 | `get_provider` | `app`, `provider_id` | `ProviderView` | `openwrt_admin::get_provider` |
| R3 | `get_active_provider` | `app` | `ProviderView` | `openwrt_admin::get_active_provider` |
| R4 | `get_provider_failover` | `app`, `provider_id` | `ProviderFailoverView` | `openwrt_admin::get_provider_failover` |
| R5 | `get_runtime_status` | _(none)_ | `RuntimeStatusView` | `openwrt_admin::get_runtime_status` |
| R6 | `get_app_runtime_status` | `app` | `AppRuntimeStatusView` | `openwrt_admin::get_app_runtime_status` |
| R7 | `get_available_failover_providers` | `app` | `ProviderListView` | `openwrt_admin::get_available_failover_providers` |
| R8 | `get_host_config` | _(none)_ | `HostConfigView` | UCI `ccswitch.main` |

### Mutation Methods (ACL: write)

| # | Method | Params | Return type | Backend source |
|---|--------|--------|-------------|----------------|
| W1 | `upsert_provider` | `app`, `provider_id?`, `provider` | `ProviderView` | `openwrt_admin::upsert_provider` |
| W2 | `upsert_active_provider` | `app`, `provider` | `ProviderView` | `openwrt_admin::upsert_active_provider` |
| W3 | `activate_provider` | `app`, `provider_id` | `ProviderView` | `openwrt_admin::activate_provider` |
| W4 | `delete_provider` | `app`, `provider_id` | `ProviderDeleteView` | `openwrt_admin::delete_provider` |
| W5 | `add_to_failover_queue` | `app`, `provider_id` | `ProviderFailoverView` | `openwrt_admin::add_to_failover_queue` |
| W6 | `remove_from_failover_queue` | `app`, `provider_id` | `ProviderFailoverView` | `openwrt_admin::remove_from_failover_queue` |
| W7 | `reorder_failover_queue` | `app`, `provider_ids` | `ProviderFailoverView` | `openwrt_admin::reorder_failover_queue` |
| W8 | `set_auto_failover_enabled` | `app`, `enabled` | `ProviderFailoverView` | `openwrt_admin::set_auto_failover_enabled` |
| W9 | `set_max_retries` | `app`, `value` | `ProviderFailoverView` | `openwrt_admin::set_max_retries` |
| W10 | `set_host_config` | `host` | `HostConfigView` | UCI `ccswitch.main` |
| W11 | `restart_service` | _(none)_ | `ServiceResultView` | init.d restart |

### Removed / Not Carried Forward

| Current method | Reason |
|----------------|--------|
| `get_available_providers_for_failover` | Alias of `get_available_failover_providers`. Keep one name. |
| `list_saved_providers` | Declared in LuCI RPC but not implemented in rpcd ucode. Dead reference. |
| `save_provider` | Declared in LuCI RPC but not implemented in rpcd ucode. Dead reference. |
| `switch_provider` | Declared in LuCI RPC but not implemented in rpcd ucode. Dead reference. |

## Domain Types

All types use `camelCase` field names matching the Rust `#[serde(rename_all = "camelCase")]` output. The TypeScript equivalents are already defined in `src/shared/providers/domain/types.ts`.

### ProviderView

```
{
  configured:      boolean
  active:          boolean
  providerId:      string | null
  name:            string
  baseUrl:         string
  tokenField:      string         // e.g. "ANTHROPIC_AUTH_TOKEN"
  tokenConfigured: boolean
  tokenMasked:     string
  model:           string
  notes:           string
}
```

Source: `OpenWrtProviderView` in `proxy-daemon/src/openwrt_admin.rs:61-74`

### ProviderListView

```
{
  activeProviderId: string | null
  providers:        ProviderView[]
}
```

Source: `OpenWrtProviderListView` in `proxy-daemon/src/openwrt_admin.rs:76-81`

### ProviderDeleteView

```
{
  deletedProviderId:  string
  activeProviderId:   string | null
  providersRemaining: number
}
```

Source: `OpenWrtProviderDeleteView` in `proxy-daemon/src/openwrt_admin.rs:83-89`

### ProviderHealthView

```
{
  providerId:          string
  observed:            boolean
  healthy:             boolean
  consecutiveFailures: number
  lastSuccessAt:       string | null
  lastFailureAt:       string | null
  lastError:           string | null
  updatedAt:           string | null
}
```

Source: `OpenWrtProviderHealthView` in `proxy-daemon/src/openwrt_admin.rs:132-143`

### FailoverQueueEntryView

```
{
  providerId:   string
  providerName: string
  sortIndex:    number | null
  active:       boolean
  health:       ProviderHealthView
}
```

Source: `OpenWrtFailoverQueueStatusView` in `proxy-daemon/src/openwrt_admin.rs:145-153`

### ProviderFailoverView

```
{
  providerId:          string
  proxyEnabled:        boolean
  autoFailoverEnabled: boolean
  maxRetries:          number
  activeProviderId:    string | null
  inFailoverQueue:     boolean
  queuePosition:       number | null
  sortIndex:           number | null
  providerHealth:      ProviderHealthView
  failoverQueueDepth:  number
  failoverQueue:       FailoverQueueEntryView[]
}
```

Source: `OpenWrtProviderFailoverView` in `proxy-daemon/src/openwrt_admin.rs:155-169`

### ServiceStatusView

```
{
  running:        boolean
  reachable:      boolean
  listenAddress:  string
  listenPort:     number
  proxyEnabled:   boolean
  enableLogging:  boolean
  statusSource:   string
  statusError:    string | null      // omitted when absent
}
```

Source: `OpenWrtServiceStatusView` in `proxy-daemon/src/openwrt_admin.rs:99-111`

### AppRuntimeStatusView

```
{
  app:                    string
  providerCount:          number
  proxyEnabled:           boolean
  autoFailoverEnabled:    boolean
  maxRetries:             number
  activeProviderId:       string | null
  activeProvider:         ProviderView
  activeProviderHealth:   ProviderHealthView | null
  usingLegacyDefault:     boolean
  failoverQueueDepth:     number
  failoverQueue:          FailoverQueueEntryView[]
  observedProviderCount:  number
  healthyProviderCount:   number
  unhealthyProviderCount: number
}
```

Source: `OpenWrtAppRuntimeStatusView` in `proxy-daemon/src/openwrt_admin.rs:113-130`

### RuntimeStatusView

```
{
  service: ServiceStatusView
  runtime: ProxyStatus             // internal proxy status from proxy-daemon
  apps:    AppRuntimeStatusView[]
}
```

Source: `OpenWrtRuntimeStatusView` in `proxy-daemon/src/openwrt_admin.rs:92-97`

### HostConfigView (new: UCI read surface)

```
{
  enabled:    boolean
  listenAddr: string
  listenPort: string
  httpProxy:  string
  httpsProxy: string
  logLevel:   string
}
```

Source: UCI section `ccswitch.main` options. Currently read in `settings.js:674-679`.

### ProviderEditorPayload (mutation input)

```
{
  name:       string
  baseUrl:    string
  tokenField: string
  token:      string
  model:      string
  notes:      string
}
```

Source: `OpenWrtProviderPayload` in `proxy-daemon/src/openwrt_admin.rs:44-59`

### ServiceResultView (simple result envelope)

```
{
  ok:     boolean
  error:  string | null
  output: string | null
}
```

## Response Envelope

All methods return directly structured domain objects on success. The current `ok`/`error` envelope fields are retained at the ubus transport level:

**Success:**
```json
{ "ok": true, ...domain_fields }
```

**Error:**
```json
{ "ok": false, "error": "message" }
```

The key change is that domain fields are **inlined as structured objects**, not stuffed into a `*_json` string. For example, `list_providers` today returns:

```json
{ "ok": true, "providers_json": "{\"activeProviderId\":...}" }
```

Target:

```json
{ "ok": true, "activeProviderId": "openwrt-claude-abc", "providers": [...] }
```

## What Changes Where

### rpcd ucode (`rpcd/ucode/ccswitch`)

The ucode wrapper currently calls `popen()` and captures stdout as a string. Two implementation paths:

**Path A (minimal, no daemon changes):** Parse the daemon stdout JSON in ucode using `json()` and merge the parsed object into the return envelope. This eliminates the `*_json` string fields without changing the daemon binary.

```javascript
// Before
function runProviderCommand(command) {
    let result = runReadCommand(command);
    if (!result.ok) return commandFailure(result);
    return { ok: true, provider_json: result.output };
}

// After (Path A)
function runProviderCommand(command) {
    let result = runReadCommand(command);
    if (!result.ok) return commandFailure(result);
    let parsed = json(result.output);
    if (parsed == null) return { ok: false, error: 'invalid JSON from daemon' };
    parsed.ok = true;
    return parsed;
}
```

**Path B (future: native ubus):** The daemon registers directly as a ubus object via `libubus`, eliminating the shell-spawn entirely. This is a larger change and not required for the contract migration.

**Recommended:** Path A first. Path B is optional/future.

### rpcd ucode: new methods

Add `get_host_config` and `set_host_config` to read/write UCI `ccswitch.main` directly in ucode without shelling out. ucode has native UCI access via `uci.cursor()`.

### TypeScript adapter (`src/platform/openwrt/providers/adapter.ts`, `runtime/adapter.ts`)

Remove all `JSON.parse(response.*_json)` fallback paths. The adapter reads structured fields directly from the RPC result. Retain the `ok`/`error` envelope check.

### ACL (`rpcd/acl.d/luci-app-ccswitch.json`)

Add `get_host_config` to read ACL, `set_host_config` to write ACL.

### LuCI view (`settings.js`)

Add `rpc.declare` entries for `get_host_config` and `set_host_config`. Remove the direct `uci.load`/`uci.get`/`uci.set` calls for host settings; use the new ubus methods instead.

## Ordered Migration Slices

### Slice 1: Structured provider reads (no daemon changes)

**Type:** rpcd ucode + TypeScript adapter
**Risk:** low (read-only, no router state mutation)
**Scope:**
- Modify `runProviderCommand`, `runProvidersCommand`, `runStatusCommand`, `runResultCommand` in rpcd ucode to parse daemon stdout with `json()` and return structured objects
- Keep `ok`/`error` envelope; drop `provider_json`, `providers_json`, `status_json`, `result_json` fields
- Update TypeScript `OpenWrtRpcResult` and `OpenWrtRuntimeRpcResult` to expect structured fields
- Remove `JSON.parse(response.*_json)` fallback paths in adapters
- Retain backward-compat: adapters can check for the string field and fall back during rollout if needed

**Methods affected:** R1-R7, plus read paths of W1-W9 return values

**Why first:** This is the highest-value change. It eliminates the double-serialization for every read and every mutation response in a single cut. It requires zero daemon binary changes.

### Slice 2: Host config ubus methods

**Type:** rpcd ucode + LuCI view
**Risk:** low (UCI read/write already works via LuCI; this just moves the surface)
**Scope:**
- Add `get_host_config` read method to rpcd ucode using `uci.cursor()` to read `ccswitch.main`
- Add `set_host_config` write method to rpcd ucode using `uci.cursor()` to write `ccswitch.main`
- Add both to ACL
- Add `rpc.declare` entries in `settings.js`
- Replace direct `uci.load`/`uci.get`/`uci.set` calls in the prototype bridge with the new ubus methods
- Return structured `HostConfigView` object

**Why second:** This lifts the last UCI-direct dependency out of the LuCI view into the ubus surface, making the full admin surface accessible through a single transport. It unblocks future non-LuCI admin UIs.

### Slice 3: Clean up dead RPC declarations

**Type:** LuCI view only
**Risk:** none
**Scope:**
- Remove `rpc.declare` entries for methods that do not exist in rpcd ucode: `list_saved_providers`, `save_provider`, `switch_provider`
- Remove duplicate parameter-variant declarations (`callUpsertProviderById` vs `callUpsertProviderByProviderId`, etc.) and consolidate to one declaration per rpcd method
- Remove `get_available_providers_for_failover` alias from rpcd ucode; keep `get_available_failover_providers`

**Why third:** Cleanup after the structural work is done. No functional change.

### Slice 4: Remove `*_json` string fields from TypeScript types

**Type:** TypeScript only
**Risk:** none (dead code removal after Slice 1)
**Scope:**
- Remove `provider_json`, `providers_json`, `status_json`, `list_json`, `result_json` from `OpenWrtRpcResult` and `OpenWrtRuntimeRpcResult`
- Remove any remaining backward-compat parse paths
- Tighten the `[key: string]: unknown` index signatures to explicit fields

**Why fourth:** Waits for Slice 1 to be deployed and verified on real hardware before removing fallback paths.

### Slice 5: Iframe removal (deferred)

**Type:** LuCI view + prototype HTML
**Risk:** high (full UI rewrite)
**Scope:**
- Replace the static prototype iframe with a native LuCI view or embedded React bundle that calls the ubus surface directly
- Remove `postMessage` bridge, query-parameter injection, and the prototype HTML asset
- This slice depends on Slices 1-2 being complete and verified, plus a design decision on whether the replacement is a LuCI JS view or a React SPA served from LuCI

**Explicitly deferred.** The ubus contract from Slices 1-2 is a prerequisite. The iframe works today and is not blocking. Iframe removal is a UI project, not a backend contract project.

## What This Contract Does NOT Cover

- **Provider quota/cost semantics:** No backend truth exists. Not invented here.
- **Health probe URL / fallback model / latency budget:** Visible as B2.4 placeholders but no backend DTO. Leave as placeholder-only per phase 17 audit.
- **Native ubus daemon registration (Path B):** Optional future optimization. The shell-spawn with JSON parse (Path A) is sufficient for the method contract.
- **HTTP admin API:** The domain models are transport-agnostic. An HTTP API can be built later over the same types. Not in scope.
- **Start/stop service controls:** Only `restart_service` exists in the backend. No `start_service` or `stop_service` rpcd methods today.
