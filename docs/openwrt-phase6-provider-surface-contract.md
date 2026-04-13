# OpenWrt Phase 6 Provider-Surface Contract

## Goal

Replace the current basic shared provider manager presentation with a visibly desktop-like provider surface for OpenWrt while preserving the existing LuCI shell, OpenWrt adapter contract, and real bundle cutover from Phase 5.

This contract freezes the behavior and ownership boundaries for Phase 6 so the implementation lanes can work in parallel without reopening product decisions.

## Frozen invariants

- Keep the LuCI shell as the page entrypoint and mount host.
- Keep the existing shared bundle contract unchanged:
  - `__CCSWITCH_OPENWRT_SHARED_PROVIDER_UI__`
  - `capabilities.providerManager`
  - `mount(...)`
- Keep the current OpenWrt provider CRUD and rpcd transport contract unchanged.
- Keep unsupported desktop actions hidden on OpenWrt.
- Keep the provider surface limited to `claude`, `codex`, and `gemini`.
- Keep search/filter local to the browser session. Do not persist it.

## Ownership boundaries

### LuCI shell owns

- service settings and outbound proxy sections
- restart controls and service-status messaging
- selected-app persistence
- bundle loading and guarded fallback behavior
- the DOM mount root for the shared provider surface

### Shared provider manager owns

- provider toolbar, search/filter, and app-local UI state
- provider card rendering
- preset grouping and preset description hints
- add/edit panel lifecycle
- empty/loading/error states for the provider region
- capability-driven action visibility

### OpenWrt adapter owns

- rpcd compatibility and fallback transport behavior
- provider-state normalization for shared UI consumption
- mutation-to-shell messaging and restart-required derivation
- capability exposure to the shared manager

## Visual and behavior contract

### Provider toolbar

- Show the current app tabs first.
- Add a compact toolbar row above the provider list with:
  - search input
  - add-provider action
  - summary text for result count when search is active
- Search matches provider name, provider ID, base URL, notes, and preset/provider labels where available.
- Search never mutates provider state or selected provider.

### Provider cards

- Render providers as desktop-like cards, not a plain list block.
- Each card must show:
  - provider name
  - base URL
  - model
  - token-field label
  - provider ID
  - notes only when present
- Visual state:
  - active provider gets the primary active treatment
  - stored-secret state gets a secondary status chip
  - unsupported actions do not render
- Allowed actions on card:
  - edit
  - activate
  - delete
- Do not render duplicate/test/terminal/failover/usage actions in Phase 6.

### Presets

- Presets remain app-specific but render with desktop-like grouping/category treatment.
- Render grouped presets with visible category labels and concise category hints.
- Preset application still fills only the supported OpenWrt draft fields:
  - name
  - base URL
  - token field
  - model
- Preset selection never writes immediately; it only updates the draft editor.

### Add/edit panel

- Replace the inline editor with a dedicated add/edit panel or modal.
- The same surface handles both create and edit.
- Behavior:
  - add opens a blank or preset-driven draft for the selected app
  - edit opens the selected provider draft
  - cancel closes the panel and discards unsaved local changes
  - successful save closes the panel and refreshes provider state
- App switching resets editor state to the newly selected app and closes any open draft from the previous app.

### Empty, loading, and error states

- Loading state must be richer than a plain text line and scoped to the provider region only.
- Empty state must include app-aware copy and a prominent add-provider entrypoint.
- Error state must preserve LuCI shell controls and offer retry for the provider region only.

## Hidden and unsupported action rules

- Hide actions that are unsupported by OpenWrt capabilities.
- Do not show disabled placeholders for:
  - failover controls
  - usage/model-test actions
  - duplicate
  - terminal/deep-link actions
  - universal-provider flows
  - OpenCode/OpenClaw-only affordances

## Lane breakdown

### Lane A: shared-surface primitives

Own:

- shared provider presentation metadata
- preset grouping/category structures
- provider card primitives
- toolbar/search primitives
- add/edit panel primitives
- richer empty/loading/error primitives

Do not touch:

- LuCI shell code
- OpenWrt transport code

Acceptance:

- primitives are reusable from `SharedProviderManager`
- hidden/unsupported action rules are encoded in presentation contracts
- tests cover card states, preset grouping, and search primitives

### Lane B: provider-manager integration

Own:

- `SharedProviderManager` composition
- wiring primitives into the current shared manager
- search/filter behavior
- add/edit panel flow
- app-switch draft reset behavior

Do not touch:

- LuCI shell loading/fallback behavior unless strictly required by the contract
- OpenWrt transport interface

Acceptance:

- provider CRUD still works through the existing adapter
- app switching never leaks drafts across apps
- search/filter is client-side only
- add/edit panel replaces the old inline editor path

### Lane C: OpenWrt shell verification

Own:

- bundle tests
- OpenWrt mount-path verification
- minimal shell adjustments only if the contract requires them
- package/build verification for the real-bundle path

Do not own:

- shared provider rendering details
- desktop-like card/editor implementation

Acceptance:

- real shared bundle remains the normal packaged path
- LuCI shell still mounts the provider surface correctly
- guarded fallback behavior remains intact
- bundle/OpenWrt tests reflect the new panel/card/search behavior where relevant

## Review criteria

- Lane heads must be reviewed independently.
- Any lane that changes its branch head after review requires a fresh review.
- Reviewers should reject:
  - hidden desktop-only actions reappearing as placeholders
  - provider state leaks across app switches
  - new shell ownership of provider rendering
  - placeholder bundle or fallback path becoming the normal success path again

## Manual router acceptance

- the provider surface loads through the real shared bundle
- Claude/Codex/Gemini provider CRUD still works
- preset apply still works
- search/filter behaves locally without persistence
- add/edit panel opens and closes cleanly
- saved providers from earlier installs still render correctly after upgrade
- LuCI service/restart controls remain functional above the provider surface
