# OpenWrt Phase 17 B2.4 Surface/Backend Audit

Baseline audited: `53329e6d` (`feat(openwrt): cut over static prototype to b2.4`)

## Baseline facts

- The live LuCI page is still hard-gated into the static prototype bridge:
  - `OPENWRT_STATIC_PROTOTYPE_MODE = true`
  - `OPENWRT_STATIC_PROTOTYPE_PATH = /luci-static/resources/ccswitch/prototype-b24/index.html`
  - source: `openwrt/luci-app-ccswitch/htdocs/luci-static/resources/view/ccswitch/settings.js:24-25`, `:394-413`
- Package assembly now requires and copies the B2.4 prototype asset:
  - source: `openwrt/build-ipk.sh:19`, `:207-208`, `:504-505`
- The B2.4 design reference is explicitly reference-only and not backend-wired:
  - source: `docs/openwrt-b24-design-reference/README.md:19-20`

## Classification

Categories:

- `real now`: visible control already has truthful repo-backed data/behavior in the current B2.4 bridge
- `adapter-only`: current backend/RPC/UCI truth exists, but the visible B2.4 control still needs rebinding or local UI logic
- `needs backend`: visible control would need new backend/RPC semantics
- `placeholder-only`: visible control is intentionally mock/inert and must stay unsupported until rebound deliberately

### 0. Remaining visible controls

- page-local theme toggle: `real now`
  - the B2.4 prototype wires the visible `Light` / `Dark` button to local theme state and rerendering; no backend or RPC support is needed
  - source: `prototype-b24/index.html:1104`, `:2204`, `:2275-2278`
- app picker trigger + app menu rows: `real now`
  - this control already switches between the three supported OpenWrt app scopes using the payload that `settings.js` loads for every app before posting into the prototype
  - source: `settings.js:718-823`; `prototype-b24/index.html:1171`, `:2014-2045`, `:2290-2292`
- footer `Cancel`: `adapter-only`
  - the button is visible in the selected-provider footer, but the current prototype binds no handler to it; eventual semantics are local editor/reset/navigation behavior, not new backend semantics
  - source: `prototype-b24/index.html:1208-1210`, `:2210-2278`
- other still-visible interactive controls in `prototype-b24`: already classified above
  - workspace switcher: `prototype-b24/index.html:1200-1205`, `:2048-2060`
  - section tabs: `prototype-b24/index.html:1205`, `:2147-2158`
  - modal close/cancel: `prototype-b24/index.html:1224`, `:1245-1247`, `:2244-2253`

### 1. Top daemon band

- running state text: `real now`
  - `settings.js` builds `status` from service/runtime truth and passes it into the prototype query
  - source: `settings.js:670-715`; contract proof in `tests/openwrt/staticPrototypeContract.test.ts:174-200`
- health chip: `adapter-only`
  - truth exists, but the chip is synthesized from `running` plus `reachable`; it is presentation over existing status, not a separate daemon field
  - source: `settings.js:675-695`
- restart chip: `adapter-only`
  - real RPC exists via `restart_service`, but the visible B2.4 prototype chip is not bound to it
  - source: `rpcd/ucode/ccswitch:344-353`; no prototype handler in `prototype-b24/index.html`
- stop chip: `placeholder-only`
  - visible in B2.4, but no `start_service`/`stop_service` RPC exists in `rpcd` or `settings.js`
  - source: `prototype-b24/index.html:1115-1117`; `settings.js:230-386`; `rpcd/ucode/ccswitch:355-420`
- logging selector: `adapter-only`
  - current host `log_level` is loaded into the bridge, but the visible selector is not saved by the prototype
  - source: `settings.js:657-665`, `:684-715`; `prototype-b24/index.html:1117-1123`
- daemon-band save chip: `adapter-only`
  - existing LuCI/UCI host save path exists outside the prototype, but the B2.4 chip itself is not wired
  - source: `prototype-b24/index.html:1123`; no handler in `:2140-2276`

### 2. Host controls

- listen address / listen port: `adapter-only`
  - values are live-fed from UCI/runtime into the prototype, but visible inputs are not rebound to LuCI save
  - source: `settings.js:657-665`, `:684-715`; `prototype-b24/index.html:1131-1138`; test proof `staticPrototypeContract.test.ts:180-188`
- HTTP proxy / HTTPS proxy: `adapter-only`
  - values are live-fed from UCI into the prototype, but visible inputs are not rebound to LuCI save
  - source: `settings.js:657-665`, `:691-715`; `prototype-b24/index.html:1145-1152`; test proof `staticPrototypeContract.test.ts:189-194`
- listen endpoint summary: `real now`
  - query-bound from runtime/UCI and rendered truthfully
  - source: `settings.js:686-689`; test proof `staticPrototypeContract.test.ts:180-182`
- service label (`Router daemon`): `adapter-only`
  - static presentation label over existing service context
  - source: `settings.js:688-690`; `prototype-b24/index.html:1161-1164`

### 3. Provider list / search / filter

- provider rows and selected-provider switching: `real now`
  - `settings.js` posts live provider payloads and the prototype renders them into the left rail
  - source: `settings.js:735-823`; `prototype-b24/index.html:1578-1597`, `:2081-2112`; test proof `staticPrototypeContract.test.ts:202-219`
- search box: `adapter-only`
  - no backend gap; this only needs client-side filtering over already-loaded provider data
  - source: design intent in `DESIGN_GUIDE.md:67-69`; visible control in `prototype-b24/index.html:1179-1182`
- `All` filter chip: `placeholder-only`
  - visible, but no filter model or handler exists in the current B2.4 bridge
  - source: `prototype-b24/index.html:1181`; no filter logic in `:2005-2276`

### 4. Selected-provider shell + General

- selected provider name and subtitle: `real now`
  - driven from current app/provider state
  - source: `prototype-b24/index.html:2115-2124`
- workspace switcher (`General` / `Failover` / `Credentials`): `adapter-only`
  - local context switch only; no backend gap
  - source: `prototype-b24/index.html:1439-1442`, `:2048-2060`
- section tabs inside each workspace: `adapter-only`
  - local context switch only; no backend gap
  - source: `prototype-b24/index.html:2147-2158`
- provider name / notes / base URL: `real now`
  - live payload fields
  - source: `settings.js:805-819`; `prototype-b24/index.html:1928-1934`; test proof `staticPrototypeContract.test.ts:209-237`
- website URL: `adapter-only`
  - current B2.4 bridge duplicates `baseUrl`; no distinct backend field exists
  - source: `prototype-b24/index.html:1932-1933`
- credential status, token field, model (inside `General`): `real now`
  - backed by current provider view fields
  - source: `openwrt_admin.rs:63-74`; `settings.js:809-817`; `prototype-b24/index.html:1934-1936`; test proof `staticPrototypeContract.test.ts:224-237`
- health check / fallback model / latency budget: `placeholder-only`
  - explicitly rendered as placeholder text in the prototype; no matching OpenWrt provider DTO or RPC surface
  - source: `prototype-b24/index.html:1937-1939`; `openwrt_admin.rs:44-59`, `:63-74`

### 5. Credentials

- secret policy (`Blank preserves stored secret`): `real now`
  - consistent with current OpenWrt blank-secret behavior and provider view
  - source: `prototype-b24/index.html:1943-1954`; `openwrt_admin.rs:44-59`, `:63-74`; test proof `staticPrototypeContract.test.ts:239-266`
- primary env key / masked token state: `real now`
  - current provider view exposes `tokenField`, `tokenConfigured`, and `tokenMasked`
  - source: `openwrt_admin.rs:63-74`; `settings.js:809-817`
- base URL env / model env: `adapter-only`
  - presentation aliases over existing `baseUrl` and `model`; no new backend field needed
  - source: `prototype-b24/index.html:1948-1949`
- fallback model / health probe / latency budget: `placeholder-only`
  - explicit placeholder fields with no matching OpenWrt DTO/RPC support
  - source: `prototype-b24/index.html:1950-1952`
- notes tab: `real now`
  - backed by current provider notes
  - source: `prototype-b24/index.html:1953`; test proof `staticPrototypeContract.test.ts:263-266`

### 6. Failover

- failover summary card: `real now`
  - `settings.js` loads per-provider failover for every visible provider and posts it into the prototype payload
  - source: `settings.js:735-789`, `:805-819`; `prototype-b24/index.html:1801-1815`; test proof `staticPrototypeContract.test.ts:268-336`
- queue membership / queue position / sort index / queue depth / queue order: `real now`
  - backed by provider-specific failover view
  - source: `openwrt_admin.rs:223-279`; `prototype-b24/index.html:1822-1829`
- provider health / observed / consecutive failures / timestamps / last error: `real now`
  - backed by provider health in the failover view
  - source: `openwrt_admin.rs:132-169`, `:223-279`; `prototype-b24/index.html:1832-1847`
- proxy enabled / auto failover / max retries / active provider ID: `real now`
  - backed by failover view and mutations already exist in rpcd/daemon
  - source: `openwrt_admin.rs:157-169`, `:223-279`, `:455-550`; `rpcd/ucode/ccswitch:271-341`; `prototype-b24/index.html:1837-1840`
- failover queue mutations as currently visible in B2.4 prototype: `adapter-only`
  - backend support exists for add/remove/reorder/auto-failover/max-retries, but the static prototype currently renders read-only facts, not live controls
  - source: `rpcd/ucode/ccswitch:271-341`; `prototype-b24/index.html:1818-1885`

### 7. Modal actions

- Add button opening the modal: `adapter-only`
  - current prototype opens the modal locally; no backend gap
  - source: `prototype-b24/index.html:1172`, `:2215-2241`
- modal shell / title / subtitle / close / cancel: `adapter-only`
  - present and functional locally
  - source: `prototype-b24/index.html:1217-1248`, `:2244-2253`
- preset row: `adapter-only`
  - current prototype has local preset selection; real preset catalog exists in `settings.js`
  - source: `settings.js:35-220`; `prototype-b24/index.html:1226`, `:2225-2239`
- modal fields (`provider name`, `notes`, `website URL`, `base URL`): `adapter-only`
  - current OpenWrt provider payload supports all except a distinct website field; no new backend is needed for `name`, `notes`, `baseUrl`
  - source: `openwrt_admin.rs:44-59`; `prototype-b24/index.html:1227-1243`
- modal `Add draft`: `placeholder-only`
  - explicitly toast-only and does not mutate the provider list
  - source: `prototype-b24/index.html:2255-2258`; test proof `staticPrototypeContract.test.ts:372-392`

### 8. Explicit placeholder actions

- selected-provider `Duplicate`: `placeholder-only`
  - explicit toast-only behavior
  - source: `prototype-b24/index.html:1193-1196`, `:2260-2263`; test proof `staticPrototypeContract.test.ts:366-370`
- selected-provider top `Save`: `placeholder-only`
  - explicit toast-only behavior
  - source: `prototype-b24/index.html:1193-1196`, `:2265-2268`; test proof `staticPrototypeContract.test.ts:354-358`
- footer `Save`: `placeholder-only`
  - explicit toast-only behavior
  - source: `prototype-b24/index.html:1208-1211`, `:2270-2273`; test proof `staticPrototypeContract.test.ts:360-364`

## B2.3 -> B2.4 audit delta

- The old B2.3 matrix treated selected-provider save/duplicate and modal add-draft as future adapter work.
- The refreshed B2.4 baseline makes their current package status explicit: they are still mock-local and should be treated as `placeholder-only` until rebound.
- Source: `docs/openwrt-b23-prototype-binding-matrix.md:263-307`; `tests/openwrt/staticPrototypeContract.test.ts:339-393`
