# OpenWrt Shared Provider UI Contract

Scope: freeze the first shared provider UI slice only. This slice covers `claude`, `codex`, and `gemini` provider management inside the existing LuCI page at `/cgi-bin/luci/admin/services/ccswitch`.

## 1. LuCI shell responsibilities

- Keep `openwrt/luci-app-ccswitch/htdocs/luci-static/resources/view/ccswitch/settings.js` as the page entrypoint and owner of the LuCI form lifecycle.
- Continue owning UCI-backed service settings, outbound proxy settings, service status, restart control, ACL/rpcd wiring, and page-level LuCI rendering.
- Provide a single mount container for the shared provider UI below the existing OpenWrt-native settings blocks.
- Pass only OpenWrt shell inputs into the shared UI mount:
  - selected app: `claude` | `codex` | `gemini`
  - router/service status needed for restart messaging
  - transport functions backed by the existing `ccswitch` rpcd methods
- Stop owning provider preset catalogs, provider list rendering, provider editor rendering, and provider-state normalization once the shared slice is mounted.

## 2. Shared React provider UI responsibilities

- Own the provider manager UI for the first slice:
  - app switcher
  - preset selector
  - saved provider list
  - add/edit form
  - delete/activate actions
  - loading, empty, and error states
  - restart-required success messaging
- Reuse the shared provider domain already present in `src/shared/providers/domain`, including preset catalog, preset inference, provider normalization, and shared types.
- Consume a platform adapter interface only. The shared UI must not import LuCI globals, rpcd declarations, Tauri APIs, tray logic, or desktop-only panels.
- Assume the OpenWrt payload shape is the current narrow CRUD shape: `name`, `baseUrl`, `tokenField`, `token`, `model`, `notes`, plus provider ids and active-provider metadata from list/read responses.

## 3. OpenWrt adapter responsibilities

- Keep `src/platform/openwrt/providers` as the only OpenWrt-specific transport layer used by the shared UI.
- Adapt the existing rpcd surface already reflected in the repo:
  - `get_active_provider`
  - `list_providers`
  - `list_saved_providers`
  - `upsert_provider` / `save_provider`
  - `delete_provider`
  - `activate_provider` / `switch_provider`
  - `restart_service`
- Preserve the current compatibility behavior already encoded in the adapter/tests:
  - Phase 2 list/save/delete/activate when available
  - fallback to Phase 1 active-provider bridge when Phase 2 RPCs are absent
  - `provider_id` and `id` compatibility fallbacks
  - blank secret means preserve stored secret
- Return only shared domain types and capabilities to the shared UI.

## 4. Asset/build/mount strategy inside LuCI

- Keep the LuCI package entrypoint as `settings.js`.
- Add one bundled web asset for the first slice under the LuCI static tree, shipped by `luci-app-cc-switch` alongside `settings.js`.
- Mount strategy:
  - `settings.js` renders the existing LuCI sections first
  - `settings.js` creates one dedicated provider mount node
  - `settings.js` loads the shared provider UI bundle and boots it into that node
- Build strategy:
  - build the shared provider UI as a standalone browser bundle with relative asset paths
  - package the emitted bundle into the LuCI static directory during the OpenWrt package build
  - keep bundle ownership separate from the desktop `dist/` output so LuCI packaging does not depend on the desktop shell build artifact layout
- The LuCI shell remains functional even if the shared bundle is missing or fails to mount: service settings and restart controls must still render.

## 5. State ownership boundaries

- LuCI shell owns:
  - UCI form state
  - service status/restart state
  - page mount lifecycle
  - selected app persistence currently tied to the LuCI page
- Shared React provider UI owns:
  - provider list/query state
  - editor draft state
  - preset selection state
  - mutation in-flight/error/success state
- OpenWrt adapter owns:
  - rpc payload shape
  - compatibility fallbacks across RPC variants
  - mapping rpc responses into `SharedProviderState`
- Shared domain owns:
  - provider types
  - preset catalog and preset inference
  - provider normalization/parsing rules
- The shared UI must not write UCI state directly, and the LuCI shell must not parse provider DTOs once the shared slice is in place.

## 6. Acceptance criteria for the first slice

- The LuCI page still serves from `settings.js` and still renders existing OpenWrt-native service/proxy controls.
- Provider management for `claude`, `codex`, and `gemini` is rendered by the shared React slice inside the LuCI page.
- Preset options come from `src/shared/providers/domain`, not duplicated inline in `settings.js`.
- The shared slice can list providers, show the active provider, add a provider, edit a provider, delete a provider, and activate a provider through the OpenWrt adapter.
- The shared slice works against both current Phase 2 RPC responses and the existing Phase 1 fallback path covered by adapter tests.
- A successful provider mutation can trigger restart-required messaging through the LuCI shell without moving restart ownership into the shared UI.
- No desktop-only dependency is imported into the OpenWrt slice.

## 7. Safe parallelization boundaries

- `shared-ui-core`
  - Owns `src/shared/providers/**` and the new shared React provider manager component tree.
  - Can replace preset/provider rendering logic, but cannot edit LuCI rpc declarations or OpenWrt package scripts.
  - Publishes a mountable component/API that accepts adapter + shell props.
- `openwrt-shell-mount`
  - Owns `openwrt/luci-app-ccswitch/htdocs/luci-static/resources/view/ccswitch/settings.js` and OpenWrt package/build wiring for shipping the browser bundle.
  - Keeps UCI/service/restart sections intact, adds the mount node, and boots the shared bundle.
  - Must not reimplement provider domain logic or adapter fallbacks.
- `openwrt-provider-integration`
  - Owns `src/platform/openwrt/providers/**` and the LuCI-to-adapter transport glue used by the mount entry.
  - Finalizes RPC bindings, response mapping, capability exposure, and restart hook integration.
  - Must not own shared component rendering or OpenWrt package asset wiring.
