# OpenWrt Shared-UI Parity Blueprint

## Goal

Move the OpenWrt provider UI from a LuCI-native page toward the desktop provider experience without importing desktop-only assumptions into the router build.

This blueprint is intentionally scoped to the provider/preset surface first. It does not propose a full desktop port in one step.

## Current Baseline

### Desktop provider/preset UI today

- The desktop provider surface is orchestrated from `src/App.tsx`, with the default view rendering `src/components/providers/ProviderList.tsx`.
- Provider cards and actions live in `src/components/providers/ProviderCard.tsx` and `src/components/providers/ProviderActions.tsx`.
- Add/edit flows are driven by `src/components/providers/AddProviderDialog.tsx`, `src/components/providers/EditProviderDialog.tsx`, and the large app-aware form in `src/components/providers/forms/ProviderForm.tsx`.
- Provider/preset catalogs already exist as structured TS data in:
  - `src/config/claudeProviderPresets.ts`
  - `src/config/codexProviderPresets.ts`
  - `src/config/geminiProviderPresets.ts`
  - `src/config/universalProviderPresets.ts`
- The renderer already has a data boundary:
  - transport: `src/lib/api/providers.ts`
  - query state: `src/lib/query/queries.ts`
  - user actions: `src/hooks/useProviderActions.ts`
- The desktop backend boundary is also clear:
  - Tauri commands: `src-tauri/src/commands/provider.rs`
  - provider business logic: `src-tauri/src/services/provider/mod.rs`
  - provider model: `src/types.ts` and `src-tauri/src/provider.rs`

### OpenWrt provider UI today

- The entire OpenWrt experience is still a single LuCI page in `openwrt/luci-app-ccswitch/htdocs/luci-static/resources/view/ccswitch/settings.js`.
- That page currently mixes three concerns in one file:
  - UCI-backed service settings
  - OpenWrt-only operational controls
  - provider manager UI and preset definitions
- Browser-side transport is LuCI RPC:
  - `rpc.declare(...)` calls in `settings.js`
  - backed by `openwrt/luci-app-ccswitch/root/usr/share/rpcd/ucode/ccswitch`
- The rpcd bridge shells into the daemon CLI:
  - `cc-switch openwrt [claude|codex|gemini] ...`
  - implemented in `proxy-daemon/src/main.rs`
  - OpenWrt-specific provider logic lives in `proxy-daemon/src/openwrt_admin.rs`
- OpenWrt currently supports only `claude`, `codex`, and `gemini` on this path. `openwrt_admin.rs` explicitly rejects `opencode` and `openclaw`.
- The OpenWrt DTO is intentionally narrower than the desktop `Provider` object:
  - write payload: `OpenWrtProviderPayload`
  - read models: `OpenWrtProviderView`, `OpenWrtProviderListView`
- Presets are duplicated inline in `settings.js` instead of reusing desktop preset data.

## Design Principles

1. Keep LuCI as the OpenWrt shell.
2. Share provider domain logic and provider UI, not the entire desktop shell.
3. Make transport pluggable. Shared UI must not call Tauri directly.
4. Preserve OpenWrt-specific service, restart, ACL, and packaging behavior.
5. Roll out in stages that match current backend capability instead of designing for unsupported parity on day one.

## Target Architecture

### What the target should look like

- The LuCI page remains the entry point at `/cgi-bin/luci/admin/services/ccswitch`.
- The top of the page stays OpenWrt-native:
  - UCI service enable/listen settings
  - outbound proxy settings
  - log level
  - service restart/status messaging
- The provider manager area below that becomes a shared React web UI with a platform adapter.
- The OpenWrt shared UI is served as static assets by the OpenWrt package, while LuCI provides the surrounding page, auth context, and mount point.
- The first shared slice targets only:
  - app switching between `claude`, `codex`, and `gemini`
  - preset selection
  - saved provider list
  - add/edit/delete/activate
  - router-aware restart messaging

### Recommended module boundaries

#### 1. Shared provider domain

Create a shared, framework-light layer for provider behavior.

Recommended responsibility:

- provider/editor view models
- preset metadata and grouping
- provider capability flags
- payload normalization
- secret-safe edit rules such as “blank means keep stored secret”
- list state derivation for active/current/configured status

Recommended location:

- `src/shared/providers/domain/`

Recommended files:

- `src/shared/providers/domain/types.ts`
- `src/shared/providers/domain/presets.ts`
- `src/shared/providers/domain/capabilities.ts`
- `src/shared/providers/domain/provider-mappers.ts`
- `src/shared/providers/domain/provider-editor.ts`

This layer should reuse logic and types already visible in:

- `src/types.ts`
- `src/config/*ProviderPresets.ts`
- the provider-state normalization patterns in `openwrt/.../settings.js`

#### 2. Shared provider UI

Extract a provider manager UI that can run in both desktop and OpenWrt.

Recommended responsibility:

- provider list and cards
- preset selector
- editor layout
- empty/loading/error states
- capability-gated actions

Recommended location:

- `src/shared/providers/ui/`

Important constraint:

- This layer must not import Tauri APIs, tray logic, deep-link logic, terminal launching, or desktop-only panels.

#### 3. Shared provider data hooks

Keep React Query patterns, but move them behind an adapter interface.

Recommended location:

- `src/shared/providers/data/`

Recommended interface:

```ts
type ProviderPlatformAdapter = {
  listProviderState(appId: "claude" | "codex" | "gemini"): Promise<ProviderState>;
  saveProvider(appId: string, draft: ProviderEditorPayload, providerId?: string): Promise<void>;
  activateProvider(appId: string, providerId: string): Promise<void>;
  deleteProvider(appId: string, providerId: string): Promise<void>;
  restartServiceIfNeeded(): Promise<void>;
  getCapabilities(appId: string): Promise<ProviderCapabilities>;
};
```

Desktop and OpenWrt can then each provide their own adapter without forking the UI tree.

#### 4. Desktop adapter

Keep desktop-specific transport in a separate adapter layer that wraps the existing code.

Recommended location:

- `src/platform/desktop/providers/`

This adapter should reuse:

- `src/lib/api/providers.ts`
- `src/lib/query/queries.ts`
- `src/hooks/useProviderActions.ts`

#### 5. OpenWrt adapter

Create a dedicated OpenWrt transport adapter instead of teaching shared UI about LuCI RPC directly.

Recommended location:

- `src/platform/openwrt/providers/`

This adapter should:

- call the existing rpcd methods from `settings.js`
- map `OpenWrtProviderView` into the shared UI model
- expose capability flags based on backend support
- keep current secret handling semantics

#### 6. OpenWrt shell

Shrink `openwrt/.../settings.js` into a LuCI shell file.

It should keep:

- UCI form sections
- service status display
- restart button
- the app selector if needed for page-level routing
- the DOM mount point for the shared provider UI

It should stop owning:

- duplicated preset catalogs
- provider list rendering
- provider editor rendering
- provider state parsing rules that belong in shared domain code

## Reuse Strategy

### Reuse directly

- Preset data model and most preset content from `src/config/claudeProviderPresets.ts`, `src/config/codexProviderPresets.ts`, and `src/config/geminiProviderPresets.ts`
- Provider list and editor interaction model from `src/components/providers/*`
- Validation and form-state patterns from `src/components/providers/forms/ProviderForm.tsx`
- Cross-app provider direction from `src/config/universalProviderPresets.ts` and `src/components/universal/*`
- Existing query/mutation split between renderer and backend

### Reuse with reshaping

- The desktop `Provider` type should not be copied wholesale into OpenWrt phase 1/2.
- OpenWrt should map its reduced provider DTO into a shared provider summary/editor model.
- Preset catalogs should gain explicit platform gating, for example:
  - supported on desktop
  - supported on OpenWrt
  - requires OAuth
  - requires feature not yet present on OpenWrt

### Keep OpenWrt-specific

- UCI-backed service configuration
- outbound proxy controls
- log level
- init-script restart semantics
- rpcd ACLs and session/auth model
- packaging and filesystem layout under `openwrt/`
- secret masking and “leave blank to keep stored credential” behavior tied to router storage

### Do not port in the first shared-UI slice

- tray menu updates
- “open terminal” actions
- desktop deep links
- Tauri event listeners
- OpenCode/OpenClaw additive-mode provider UX
- usage dashboard, failover queue, and model-test panels
- drag-sort parity

Those features either have no OpenWrt backend today or would force the shared UI to absorb desktop-only assumptions too early.

## Transport Layer Plan

### Phase 1 and 2 transport

Keep the OpenWrt backend transport on the current rpcd/ucode bridge:

- browser -> LuCI rpcd method
- rpcd ucode -> `cc-switch openwrt ...`
- daemon -> database/settings

Reason:

- it already exists
- it already fits LuCI auth and ACLs
- it keeps the first migration about UI sharing, not backend replacement

### Shared transport contract

The shared UI should speak in terms of provider operations, not transport details.

Desktop transport:

- `@tauri-apps/api/core.invoke`
- richer provider objects
- local event subscriptions

OpenWrt transport:

- LuCI RPC methods
- reduced provider DTOs
- explicit restart semantics
- no event stream

### Later transport option

If rpcd/ucode becomes a bottleneck, introduce a daemon-owned JSON API behind LuCI/uhttpd only after the shared UI is already stable.

That would be a transport swap inside the OpenWrt adapter, not a UI rewrite.

## Migration Phases

### Phase 0: current state

- LuCI page is fully native
- presets are duplicated
- desktop and OpenWrt provider UIs evolve separately

### Phase 1: extract shared provider domain assets

Deliverables:

- shared preset metadata module
- shared provider summary/editor types
- shared capability model
- shared normalization helpers

Code impact:

- desktop imports move from `src/config/*Presets.ts` toward shared domain modules
- OpenWrt `settings.js` stops owning preset data directly and consumes generated/shared data

Why first:

- It removes the highest-drift area with the lowest rollout risk.

### Phase 2: embed a shared provider manager in LuCI

Deliverables:

- new OpenWrt-specific React entrypoint
- OpenWrt adapter over existing rpcd methods
- LuCI shell page that mounts the shared provider manager

Scope:

- `claude`, `codex`, `gemini` only
- list/add/edit/delete/activate
- restart messaging
- preset selection

Non-goals:

- failover
- usage dashboard
- OpenCode/OpenClaw
- universal provider sync

### Phase 3: close the provider/preset parity gap

Deliverables:

- better visual parity with desktop cards and editor flow
- preset grouping/category hints
- shared icon/color treatment
- search/filter if bundle budget allows
- capability-gated affordances for unsupported actions

Backend additions that may be needed:

- richer metadata fields if OpenWrt wants icon/category persistence
- explicit capability endpoint rather than inferring support from failures

### Phase 4: extend shared UI beyond provider management

Only after phases 1-3 are stable, evaluate parity for:

- usage views
- model test
- failover
- broader app coverage

This phase should be blocked on OpenWrt backend/API maturity, not on frontend ambition.

## Build and Packaging Recommendations

- Do not reuse the current desktop renderer build as-is for OpenWrt.
- The current `vite.config.ts` assumes one renderer root (`src`) and one output (`dist`).
- Add a dedicated OpenWrt web entry/build target so the OpenWrt bundle can tree-shake Tauri-only imports aggressively.

Recommended direction:

- keep desktop build path unchanged
- add a separate OpenWrt web build config or second entry
- package generated assets into the LuCI package under a static web path
- let `settings.js` mount the built bundle into the LuCI page

This avoids shipping desktop shell code and Tauri dependencies into the router package.

## Risks

### 1. Preset drift

Risk:

- desktop and OpenWrt keep diverging because preset data lives in two places today

Mitigation:

- make preset extraction Phase 1
- add tests that assert OpenWrt-visible preset subsets come from shared data

### 2. Bundle size and router browser constraints

Risk:

- full desktop renderer patterns are heavier than LuCI-native JS

Mitigation:

- use a dedicated OpenWrt entry
- keep scope to provider management first
- avoid importing unrelated desktop panels
- gate animation and heavy widgets

### 3. DTO mismatch

Risk:

- desktop `Provider.settingsConfig` is richer than OpenWrt’s normalized provider payload

Mitigation:

- define a shared provider-manager model instead of forcing OpenWrt onto raw desktop `Provider`
- keep OpenWrt adapter responsible for mapping and write-only secret handling

### 4. Feature mismatch leading to dead UI

Risk:

- shared UI shows controls that OpenWrt cannot honor

Mitigation:

- make capability flags first-class
- hide or disable actions per platform/app

### 5. Rewrite risk inside `settings.js`

Risk:

- replacing the LuCI page all at once would mix service/UCI changes with UI migration

Mitigation:

- keep `settings.js` as a shell in the first shared-UI rollout
- swap only the provider manager region first

## Recommended Next Implementation Slice

If this blueprint is executed, the first code lane should be:

1. extract shared preset data and provider manager view models
2. add an OpenWrt-safe provider capability model
3. keep the current LuCI shell
4. mount a shared provider manager for `claude`, `codex`, and `gemini`

That path gives real parity progress while staying aligned with the current backend split in:

- `src/`
- `src-tauri/`
- `proxy-daemon/`
- `openwrt/luci-app-ccswitch/`
