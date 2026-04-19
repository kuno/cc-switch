# OpenWrt Phase 13 Surface State/Copy Contract

## Goal

Freeze a local-only Phase 13 slice that makes the LuCI-hosted runtime and provider surfaces read like one coherent product surface by unifying copy and state phrasing without changing backend, rpcd, UCI, bundle globals, or interaction/layout behavior established in Phases 10-12.

## Scope

Phase 13 may change text, message taxonomy, and copy ownership for the OpenWrt shared surfaces and their LuCI shell framing in these areas only:

- section titles and descriptions
- badges and status labels
- empty, loading, error, warning, and fallback copy
- restart-required and restart-in-progress notices
- dialog titles, descriptions, confirm/cancel/supporting copy
- shared-shell phrasing alignment between provider and runtime surfaces

In scope files:

- `src/shared/providers/SharedProviderManager.tsx`
- `src/shared/providers/ui/*`
- `src/shared/runtime/SharedRuntimeSurface.tsx`
- `src/shared/runtime/ui/*`
- `src/openwrt-provider-ui/index.ts`
- `openwrt/luci-app-ccswitch/htdocs/luci-static/resources/view/ccswitch/settings.js`
- local-only tests covering copy/state contracts under `tests/shared/*` and `tests/openwrt/*`

## Non-Goals

- no backend, rpcd, UCI, daemon, or transport DTO changes
- no new router capabilities, no new feature flags, no new runtime controls
- no interaction, layout, focus, or responsive-contract changes beyond text-length-safe adjustments
- no bundle entry/global API changes, including `__CCSWITCH_OPENWRT_SHARED_PROVIDER_UI__`
- no new copy that depends on validating behavior against a real router
- no desktop provider/runtime refactors outside the OpenWrt shared surface slice

## Baseline Assumptions

- LuCI remains the host shell and owner of router control, restart actions, and router-facing status.
- Shared React surfaces remain the owner of provider/runtime cards, state shells, inline notes, and dialog copy inside the mounted regions.
- Fallback mode remains available exactly as it works today; Phase 13 only tightens wording and severity framing.
- Existing Phase 10-12 layout and interaction hardening is preserved.

## Ownership Seams

### Shared provider surface

Owner files:

- `src/shared/providers/SharedProviderManager.tsx`
- `src/shared/providers/ui/SharedProviderStates.tsx`
- `src/shared/providers/ui/SharedProviderCard.tsx`
- `src/shared/providers/ui/SharedProviderEditorPanel.tsx`
- `src/shared/providers/ui/SharedProviderToolbar.tsx`

Owns:

- provider-surface title/description inside the shared mount
- provider mutation success/error notices
- provider empty/loading/error/access states
- provider dialog and editor supporting copy
- provider-card badge labels and per-card supporting text

Must not own:

- LuCI host-shell service/restart controls
- LuCI host-shell fallback gating explanation outside the shared mount

### Shared runtime surface

Owner files:

- `src/shared/runtime/SharedRuntimeSurface.tsx`
- `src/shared/runtime/ui/SharedRuntimeStates.tsx`
- `src/shared/runtime/ui/SharedRuntimeAppCard.tsx`
- `src/shared/runtime/ui/SharedRuntimeServiceSummaryCard.tsx`
- `src/shared/runtime/ui/SharedRuntimeHealthBadge.tsx`
- `src/shared/runtime/ui/SharedRuntimeStatusChip.tsx`

Owns:

- runtime-surface title/description inside the shared mount
- loading/empty/error/refresh-failed copy
- runtime badges, chips, and app-card state labels
- read-only fallback/supporting copy shown within the runtime mount

Must not own:

- LuCI host-shell explanation of why restart and router-owned controls remain above

### OpenWrt bundle bridge

Owner file:

- `src/openwrt-provider-ui/index.ts`

Owns:

- shell-facing mutation message phrasing passed through `showMessage`
- bridge wording that converts mutation events plus shell restart state into user-facing notices

Must preserve:

- mount signatures
- global bundle registration
- shell message kinds (`success`, `error`, `info`)

### LuCI host shell

Owner file:

- `openwrt/luci-app-ccswitch/htdocs/luci-static/resources/view/ccswitch/settings.js`

Owns:

- page-level framing copy above the shared mounts
- bundle-status summary text
- fallback-manager framing copy
- LuCI-owned restart/support/status explanation

Must not duplicate:

- provider/runtime empty/loading/error phrasing already owned by shared surfaces
- app-specific prose that should live in the shared provider/runtime mounts

## Copy and State Rules

### Product voice

- Read as one CCSwitch OpenWrt product surface, not mixed LuCI copy plus separate shared-app copy.
- Prefer direct operational language over implementation language.
- Avoid internal terms like "cutover gate", "phase", "bundle regression", or "adapter" in user-facing copy unless already unavoidable in host-only diagnostic text.
- Use sentence case and short, action-oriented descriptions.

### Severity normalization

- `success`: completed provider mutation or completed restart action
- `warning`: refresh failure with stale data still visible, restart still required, fallback/compatibility mode, degraded runtime health, read-only limitation that still leaves the page usable
- `error`: blocking load failure or failed mutation that prevented the requested action
- `info`/neutral: explanatory copy, empty states, loading states, static help text

Do not use success styling for "restart required". That state is a warning, even when the save itself succeeded.

### Phrasing rules

- Prefer "provider" consistently; do not alternate between provider, endpoint, surface, and manager for the same action.
- Use "restart the service" consistently for post-mutation application text.
- Use "refresh" consistently for runtime reload actions; avoid mixing with reload/retry except on hard-error retry buttons.
- Use "available" for data readiness, "active" for selected provider, and "running/stopped" for service state.
- Empty states should explain what is missing and the next local action.
- Error states should state what failed first, then the local recovery action.
- Fallback notices should state that LuCI fallback mode is active and why, without implying unsupported new behavior.

### Cross-surface consistency

- Provider and runtime titles/descriptions should sound like adjacent sections of one page.
- Restart notices from shared provider mutations and LuCI shell summaries must use the same severity and core sentence.
- Runtime refresh failure notes and provider mutation failure notes should share the same "action failed + recovery path" structure.
- Badge wording should be normalized across provider cards and runtime cards where the same state is represented.

### Dialog/supporting copy

- Dialog titles should be imperative and concise.
- Destructive dialogs must name the provider and the outcome.
- Supporting copy should explain local effect only; do not promise router-verified behavior beyond saved state and restart requirement.

## Delivery Constraints

- Text changes must fit current cards, banners, dialogs, and mobile layouts without introducing new breakpoints or structural wrappers.
- Existing data flow, query keys, mutation ordering, and shell-state plumbing remain unchanged.
- If copy normalization exposes a missing state distinction, Phase 13 may only remap the wording/styling of existing states, not create new backend-derived states.

## Parallel Lane Split

### Lane 1: Shared surface copy/state primitives

Scope:

- shared provider/runtime titles, descriptions, empty/loading/error copy
- badge/status-label normalization
- mutation notice phrasing inside shared surfaces
- dialog/supporting copy inside shared provider UI

Primary files:

- `src/shared/providers/SharedProviderManager.tsx`
- `src/shared/providers/ui/*`
- `src/shared/runtime/SharedRuntimeSurface.tsx`
- `src/shared/runtime/ui/*`

### Lane 2: OpenWrt shell copy alignment

Scope:

- LuCI page framing copy
- bundle/fallback summary text
- restart/supporting shell copy
- bridge message phrasing in the bundle mount layer

Primary files:

- `src/openwrt-provider-ui/index.ts`
- `openwrt/luci-app-ccswitch/htdocs/luci-static/resources/view/ccswitch/settings.js`

### Lane 3: Verification and copy guardrails

Scope:

- test assertions for normalized copy/state severity
- bundle/global API non-regression checks
- local-only verification doc update if the verification entry point changes

Primary files:

- `tests/shared/providers/SharedProviderManager.test.tsx`
- `tests/shared/runtime/SharedRuntimeSurface.test.tsx`
- `tests/openwrt/providerUiBundle.test.ts`
- `docs/openwrt-phase12-local-verification.md` or a Phase 13 verification doc if needed

## Test Plan

Local-only exit gate:

1. `rtk pnpm test -- tests/shared/providers/SharedProviderManager.test.tsx`
2. `rtk pnpm test -- tests/shared/runtime/SharedRuntimeSurface.test.tsx`
3. `rtk pnpm test -- tests/openwrt/providerUiBundle.test.ts`
4. `rtk pnpm build:openwrt-provider-ui`
5. `rtk pnpm typecheck`

Guardrails to add or preserve:

- provider mutation notices keep restart-required messaging as warning-level copy, not success-only completion copy
- runtime refresh failure keeps stale data visible and uses warning phrasing
- provider/runtime empty and error states use normalized titles and action text
- LuCI shell fallback summaries stay aligned with shared-surface wording while preserving fallback behavior
- bundle capability/global registration and mount contracts remain unchanged

No real-router verification is required for Phase 13. If a wording choice would need device behavior confirmation, it is out of scope for this phase.

## Exit Criteria

Phase 13 is complete when:

- shared provider/runtime surfaces and LuCI shell read as one coherent OpenWrt product page
- state severity and phrasing are normalized across provider mutations, runtime failures, empty states, and fallback notices
- no backend, rpcd, UCI, layout, interaction, or bundle API contracts changed
- all verification remains local-only and passes on this branch
