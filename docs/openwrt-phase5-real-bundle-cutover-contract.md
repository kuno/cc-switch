# Phase 5 OpenWrt Real Bundle Cutover Contract

Scope: replace the placeholder OpenWrt provider bundle with the real shared provider manager for router-verifiable provider/preset UI cutover. LuCI remains the page shell. This slice does not redesign desktop-shell parity and does not expand into MCP, prompts, skills, or usage dashboards.

Reference: `docs/openwrt-shared-ui-parity-blueprint.md`

## 1. Post-cutover ownership of `src/openwrt-provider-ui/index.ts`

After cutover, `src/openwrt-provider-ui/index.ts` is the authoritative OpenWrt provider bundle entrypoint. It must stop exporting the placeholder bundle and must own only:

- wiring the real shared provider manager into the OpenWrt bundle
- exposing the real provider/preset UI path for OpenWrt
- mount/glue code needed to bind shared provider UI to the OpenWrt adapter contract

It does not own LuCI page-shell behavior, fallback policy, or unrelated feature expansion.

## 2. `settings.js` ownership after cutover

`settings.js` still owns:

- LuCI page-shell composition, routing, and page lifecycle
- deciding whether the page loads the real bundle path or the temporary fallback path
- any package/build integration needed to load the selected path inside LuCI

`settings.js` stops owning:

- primary provider manager UI logic once the real bundle is enabled
- provider/preset state orchestration that belongs to the shared provider manager
- placeholder bundle behavior beyond temporary fallback dispatch

## 3. OpenWrt adapter preservation requirements

`src/platform/openwrt/providers/**` remains the adapter boundary and must preserve:

- OpenWrt-compatible provider and preset data flow needed by the shared provider manager
- current router-safe side effects, RPC/API calls, and persistence semantics
- compatibility with the LuCI shell lifecycle around mount, refresh, save, and error handling

The cutover must reuse this adapter boundary rather than introduce a parallel OpenWrt-specific manager path.

## 4. Temporary fallback LuCI provider manager

The fallback LuCI provider manager in `settings.js` remains temporarily only as a guarded fallback. It may be used only when one of these exact conditions is true:

- the real bundle fails to load or mount
- the real bundle is explicitly disabled by the Phase 5 cutover gate
- a blocking regression prevents router verification of the real provider/preset flow

Fallback must not remain as the default path once acceptance criteria are met. No new feature work should be added to the fallback path except fixes required to preserve launch safety during cutover.

## 5. Lane ownership boundaries

Lane A owns:

- real bundle cutover in `src/openwrt-provider-ui/**`
- shared mount glue between the OpenWrt bundle entrypoint and the shared provider manager
- enabling the real provider manager path in the bundle contract

Lane B owns:

- LuCI shell and fallback trim in `settings.js`
- package/build integration needed for LuCI to load the real bundle path
- fallback gating logic and removal of obsolete placeholder ownership from `settings.js`

Lane C owns:

- verification and test coverage for the real bundle path
- verification and test coverage for fallback behavior under the allowed conditions above
- package/build coverage proving the real bundle path ships and the guarded fallback still works

Boundary rule: lane A does not redesign `settings.js`, lane B does not re-implement provider manager internals, and lane C does not change product behavior except where required to land verification hooks or test fixes.

## 6. Cutover acceptance criteria

The cutover is accepted only when all of the following are true:

- `src/openwrt-provider-ui/index.ts` exports the real OpenWrt bundle path instead of the placeholder bundle
- LuCI still acts as the page shell, but the primary provider/preset UI is served by the shared provider manager path
- the OpenWrt adapter preserves working provider/preset read, edit, save, and refresh behavior on a real router
- fallback remains reachable only through the guarded conditions defined above
- package/build outputs include the real bundle path and do not regress the LuCI shell integration
- lane C verification covers both the real bundle path and the guarded fallback path

Launch blocker rule: a true blocker exists only if the real bundle cannot be router-verified for provider/preset flows, or if LuCI cannot safely fall back under the guarded conditions.
