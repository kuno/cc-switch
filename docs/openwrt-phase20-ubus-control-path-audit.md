# Phase 20 — OpenWrt Control Path & ubus Migration Audit

Audited at: `cc4dbc1f` (branch `phase20-ubus-audit`)
Date: 2026-04-15

## Executive summary

Every provider and failover mutation the LuCI UI makes today follows the same
indirect path:

    browser → LuCI rpc.js → rpcd/ucode/ccswitch → popen("cc-switch openwrt …") → daemon DB

The rpcd ucode plugin (`root/usr/share/rpcd/ucode/ccswitch`) is a thin
shell-exec wrapper — every method constructs a CLI command string, spawns
`/usr/bin/cc-switch` via `popen()`, captures its stdout JSON, and returns the
raw string to the browser under a `*_json` key. The browser then
`JSON.parse()`s that string a second time.

Host configuration (listen address, port, proxy, log level) takes a separate
path through UCI (`/etc/config/ccswitch`), written by LuCI's standard
`uci.set()`/`uci.save()` and applied through an init.d restart.

Runtime status uses a third path: the daemon CLI itself makes an HTTP GET to
`http://127.0.0.1:{port}/status` to query the running daemon, assembles a
composite view, and prints it as JSON.

The static prototype (B2.4) introduces a fourth path: an iframe embedded in
the LuCI view communicates with the host page via `postMessage` for host config
saves and service restarts.

## Architecture diagram

```
┌─────────────────────────────────────────────────────────┐
│  Browser                                                │
│  ┌──────────────────┐    ┌───────────────────────────┐  │
│  │ settings.js      │    │ prototype-b24/index.html  │  │
│  │ (LuCI view)      │◄──►│ (iframe)                  │  │
│  │                  │msg │                            │  │
│  └──────┬───────────┘    └────────────────────────────┘  │
│         │ rpc.declare()                                  │
└─────────┼────────────────────────────────────────────────┘
          │ JSON-RPC over HTTP
          ▼
┌─────────────────────────────────┐
│  rpcd (ucode plugin)           │
│  root/usr/share/rpcd/ucode/    │
│  ccswitch                      │
│                                │
│  every method → popen()        │
│  "cc-switch openwrt <cmd>"     │
│  returns {ok, *_json: string}  │
└─────────┬──────────────────────┘
          │ shell exec
          ▼
┌─────────────────────────────────┐
│  /usr/bin/cc-switch             │
│  (Rust daemon CLI)              │
│                                 │
│  openwrt_admin.rs               │
│  reads/writes SQLite DB         │
│  get-runtime-status also does   │
│  HTTP GET → daemon /status      │
└─────────────────────────────────┘
```

## Control path inventory

### 1. Host configuration

| Field | Truth source | Read path | Write path | Backend exists? |
|-------|-------------|-----------|------------|-----------------|
| enabled | UCI `ccswitch.main.enabled` | `uci.get()` | `uci.set()` → init.d restart | Yes (UCI) |
| listen_addr | UCI `ccswitch.main.listen_addr` | `uci.get()` | `uci.set()` + `uci.save()` | Yes (UCI) |
| listen_port | UCI `ccswitch.main.listen_port` | `uci.get()` | `uci.set()` + `uci.save()` | Yes (UCI) |
| http_proxy | UCI `ccswitch.main.http_proxy` | `uci.get()` | `uci.set()` + `uci.save()` | Yes (UCI) |
| https_proxy | UCI `ccswitch.main.https_proxy` | `uci.get()` | `uci.set()` + `uci.save()` | Yes (UCI) |
| log_level | UCI `ccswitch.main.log_level` | `uci.get()` | `uci.set()` + `uci.save()` | Yes (UCI) |

**Mechanism**: Standard LuCI/UCI — `uci.load('ccswitch')` at page load, direct
`uci.get/set` in JS. The prototype iframe receives these values via query
params and sends `ccswitch-prototype-host-save` messages back to the host page
for writes.

**Key observation**: The daemon reads these values only at process start (via
environment variables set by init.d). Any config change requires a full service
restart. There is no hot-reload or ubus notification path.

Source: `settings.js:672-680`, `settings.js:806-817`, `init.d/ccswitch:27-63`

### 2. Runtime / service status

| Data point | Truth source | Read path | Backend exists? |
|-----------|-------------|-----------|-----------------|
| Service running | procd service list | `rpc.declare('service','list')` | Yes (procd native) |
| Daemon reachable | HTTP GET to daemon `/status` | CLI → HTTP → JSON | Yes (daemon HTTP) |
| Listen address (live) | Daemon `/status` response | CLI → HTTP → JSON | Yes |
| Proxy enabled (live) | Daemon `/status` response | CLI → HTTP → JSON | Yes |
| Per-app provider count | Daemon DB query | CLI → DB → JSON | Yes |
| Per-app health stats | Daemon DB + in-memory | CLI → DB → JSON | Yes |

**Mechanism**: `get_runtime_status` in rpcd calls `cc-switch openwrt
get-runtime-status`. The daemon CLI (`openwrt_admin.rs:1026-1065`) makes an
HTTP GET to `http://127.0.0.1:{port}/status` with an 800ms timeout, merges
the response with DB state, and prints the composite JSON.

**Indirection cost**: Two process boundaries (rpcd→shell→daemon-cli) plus
one HTTP roundtrip (daemon-cli→daemon-server), all synchronous from rpcd's
perspective. The rpcd ucode plugin blocks on `popen()` for the entire
duration.

Source: `rpcd/ucode/ccswitch:182-184`, `openwrt_admin.rs:976-1065`

### 3. Provider CRUD

| Operation | rpcd method | CLI command | Backend truth |
|-----------|-----------|-------------|---------------|
| List all | `list_providers` | `openwrt <app> list-providers` | SQLite DB |
| Get one | `get_provider` | `openwrt <app> get-provider <id>` | SQLite DB |
| Get active | `get_active_provider` | `openwrt <app> get-active-provider` | SQLite DB |
| Create/update | `upsert_provider` | `openwrt <app> upsert-provider [<id>]` | SQLite DB (stdin JSON) |
| Create/update active | `upsert_active_provider` | `openwrt <app> upsert-active-provider` | SQLite DB (stdin JSON) |
| Delete | `delete_provider` | `openwrt <app> delete-provider <id>` | SQLite DB |
| Activate | `activate_provider` | `openwrt <app> activate-provider <id>` | SQLite DB |

**Mechanism**: Every operation goes through the same `popen()` wrapper in the
rpcd ucode plugin. Write operations pipe JSON through stdin. The browser
receives the daemon's stdout JSON as a string inside `{ ok: true,
provider_json: "<escaped>" }` and must `JSON.parse()` it again.

**Duplicate RPC declarations**: The browser-side `settings.js` declares
multiple fallback RPC stubs for the same operation to handle backend version
skew:
- `callUpsertProviderByProviderId` / `callUpsertProviderById`
- `callDeleteProviderByProviderId` / `callDeleteProviderById`
- `callActivateProviderByProviderId` / `callActivateProviderById`
- `callSwitchProviderByProviderId` / `callSwitchProviderById`

These are tried in sequence via `invokeRpcCandidates()` until one succeeds.
This pattern exists because the rpcd ucode plugin only recognizes
`provider_id` as the parameter name, but the browser cannot know which
variant the installed build supports.

Source: `settings.js:292-381`, `rpcd/ucode/ccswitch:136-269`

### 4. Failover state

| Operation | rpcd method | CLI command | Backend truth |
|-----------|-----------|-------------|---------------|
| Get provider failover | `get_provider_failover` | `openwrt <app> get-provider-failover <id>` | SQLite DB + daemon memory |
| Available failover providers | `get_available_failover_providers` | `openwrt <app> get-available-failover-providers` | SQLite DB |
| Add to queue | `add_to_failover_queue` | `openwrt <app> add-to-failover-queue <id>` | SQLite DB |
| Remove from queue | `remove_from_failover_queue` | `openwrt <app> remove-from-failover-queue <id>` | SQLite DB |
| Reorder queue | `reorder_failover_queue` | `openwrt <app> reorder-failover-queue` | SQLite DB (stdin JSON) |
| Set auto-failover | `set_auto_failover_enabled` | `openwrt <app> set-auto-failover-enabled <bool>` | SQLite DB |
| Set max retries | `set_max_retries` | `openwrt <app> set-max-retries <n>` | SQLite DB |

**Mechanism**: Same shell-exec pattern. The failover queue and health data
live in both the SQLite DB and the running daemon's in-memory state. The CLI
reads from DB and (for health) queries the daemon HTTP endpoint.

Source: `rpcd/ucode/ccswitch:159-328`, `openwrt_admin.rs:575-835`

### 5. Service lifecycle

| Operation | rpcd method | Implementation | Backend exists? |
|-----------|-----------|---------------|-----------------|
| Restart | `restart_service` | `popen('/etc/init.d/ccswitch restart')` | Yes (init.d/procd) |
| Start | — | Not exposed | Exists in init.d but not in rpcd |
| Stop | — | Not exposed | Exists in init.d but not in rpcd |

**Mechanism**: Raw shell exec of the init script. No structured return value
beyond exit code and stdout text.

Source: `rpcd/ucode/ccswitch:344-353`

### 6. Iframe bridge state (B2.4 prototype)

| Message type | Direction | Purpose |
|-------------|-----------|---------|
| `ccswitch-prototype-live-data` | host → iframe | Full workspace data for all apps |
| `ccswitch-prototype-host-state` | host → iframe | Host config + service status |
| `ccswitch-prototype-host-save` | iframe → host | Request UCI host config save |
| `ccswitch-prototype-host-save-result` | host → iframe | Save success/failure |
| `ccswitch-prototype-restart-service` | iframe → host | Request service restart |
| `ccswitch-prototype-restart-result` | host → iframe | Restart success/failure |

**Mechanism**: The settings.js view embeds an iframe pointing to the B2.4
static prototype HTML. Initial data is passed via URL query params. Live data
and host state updates use `window.postMessage`. The iframe cannot call ubus
or UCI directly — it must ask the host page to perform all backend operations.

**Key observation**: The iframe bridge adds latency (message round-trip) and
complexity (dual-parse of JSON state, duplicate render). Provider CRUD from
the prototype goes through the shared provider UI bundle's `transport` object,
which calls back to the host page's rpc declarations — adding another layer.

Source: `settings.js:410-485`, `settings.js:846-888`

### 7. Usage / quota

No usage tracking, quota, or billing surfaces exist in the current OpenWrt
control plane. The daemon has no usage metering endpoint. This surface area
does not exist and is not a migration concern.

## Backend readiness assessment

| Surface area | Backend truth source | Ready for native ubus? | Notes |
|-------------|---------------------|----------------------|-------|
| Host config | UCI `/etc/config/ccswitch` | **Already UCI-native** | No change needed — ubus methods not required |
| Service running | procd `service.list` | **Already ubus-native** | No change needed |
| Daemon reachability | HTTP GET to daemon `/status` | **Needs ubus wrapper** | Daemon exposes HTTP; a ubus method could call it directly instead of shelling out |
| Provider CRUD | SQLite DB via daemon binary | **Needs ubus module** | All CRUD logic exists in `openwrt_admin.rs`; needs a ubus object that links the same logic without CLI/shell |
| Failover state | SQLite DB + daemon memory | **Needs ubus module** | Same as provider CRUD — logic exists, transport doesn't |
| Service restart | init.d script | **Partially ready** | procd has `service.signal`; could use that instead of shell exec |
| Usage/quota | — | **Not applicable** | No backend exists |

## Replacement map

Priority ordering for a ubus-first migration. Items higher in the list give
the most immediate benefit in latency reduction and architecture
simplification.

### Phase A — Eliminate the shell-exec bottleneck (highest impact)

1. **Provider CRUD → native ubus object**
   - Replace the rpcd ucode `popen("cc-switch openwrt ...")` calls with a
     native ubus object that links to the same Rust logic
   - Eliminates: process spawn per RPC call, double JSON serialization,
     stdin piping for writes
   - Backend work: Build a `ubusd` module in the daemon that registers
     `ccswitch.*` methods, or use rpcd's native ubus plugin interface
   - Affected rpcd methods: `list_providers`, `get_provider`,
     `get_active_provider`, `upsert_provider`, `upsert_active_provider`,
     `delete_provider`, `activate_provider`

2. **Failover state → same native ubus object**
   - Same approach as provider CRUD — these share the same backend
   - Affected rpcd methods: `get_provider_failover`,
     `get_available_failover_providers`, `add_to_failover_queue`,
     `remove_from_failover_queue`, `reorder_failover_queue`,
     `set_auto_failover_enabled`, `set_max_retries`

3. **Runtime status → native ubus method**
   - Replace the CLI's HTTP-to-daemon-status roundtrip with a direct ubus
     call from the daemon process itself (it already has the data in memory)
   - Eliminates: shell spawn + internal HTTP GET + 800ms timeout
   - Affected rpcd methods: `get_runtime_status`, `get_app_runtime_status`

### Phase B — Clean up the restart path

4. **Service restart → procd ubus call**
   - Replace `popen('/etc/init.d/ccswitch restart')` with a direct ubus call
     to `service.signal` or equivalent procd interface
   - Lower priority because restart is infrequent and the current path works

### Phase C — Can stay temporarily (low urgency)

5. **Host config (UCI)** — Already uses the native UCI/ubus path. No
   migration needed.

6. **Service running check** — Already uses procd's `service.list` ubus
   method. No migration needed.

7. **Iframe bridge** — The prototype's `postMessage` bridge is a UI
   architecture concern, not a backend transport concern. It can be retired
   when the prototype is replaced with a native LuCI view, but this is
   independent of the ubus migration.

8. **Duplicate RPC fallback stubs** — The `invokeRpcCandidates()` pattern
   in `settings.js` can be simplified once there is a single stable ubus
   interface, but it is harmless in the interim.

## Appendix: rpcd ucode method index

Full list of methods exposed by `root/usr/share/rpcd/ucode/ccswitch`:

| ubus method | Shell command | JSON key returned |
|------------|--------------|-------------------|
| `list_providers` | `cc-switch openwrt <app> list-providers` | `providers_json` |
| `get_provider` | `cc-switch openwrt <app> get-provider <id>` | `provider_json` |
| `get_provider_failover` | `cc-switch openwrt <app> get-provider-failover <id>` | `status_json` |
| `get_active_provider` | `cc-switch openwrt <app> get-active-provider` | `provider_json` |
| `get_runtime_status` | `cc-switch openwrt get-runtime-status` | `status_json` |
| `get_app_runtime_status` | `cc-switch openwrt <app> get-runtime-status` | `status_json` |
| `get_available_failover_providers` | `cc-switch openwrt <app> get-available-failover-providers` | `providers_json` |
| `upsert_provider` | `cc-switch openwrt <app> upsert-provider [<id>]` | `provider_json` |
| `upsert_active_provider` | `cc-switch openwrt <app> upsert-active-provider` | `provider_json` |
| `delete_provider` | `cc-switch openwrt <app> delete-provider <id>` | `result_json` |
| `activate_provider` | `cc-switch openwrt <app> activate-provider <id>` | `provider_json` |
| `add_to_failover_queue` | `cc-switch openwrt <app> add-to-failover-queue <id>` | `status_json` |
| `remove_from_failover_queue` | `cc-switch openwrt <app> remove-from-failover-queue <id>` | `status_json` |
| `reorder_failover_queue` | `cc-switch openwrt <app> reorder-failover-queue` (stdin) | `status_json` |
| `set_auto_failover_enabled` | `cc-switch openwrt <app> set-auto-failover-enabled <bool>` | `status_json` |
| `set_max_retries` | `cc-switch openwrt <app> set-max-retries <n>` | `status_json` |
| `restart_service` | `/etc/init.d/ccswitch restart` | `output` |
