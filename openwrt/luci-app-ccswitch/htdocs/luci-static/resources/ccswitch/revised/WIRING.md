# Mockup wiring notes (cross-cutting)

This file lives next to `index.html` and carries the rules that don't belong on a single element. Element-level bindings live inline in `index.html` as `<!-- wire: ... -->`, `<!-- action: ... -->`, `<!-- state: ... -->`, and `<!-- note: ... -->` comments.

## Transport

- Every backend call goes through the `ccswitch` ubus object over LuCI's JSON-RPC endpoint (`/cgi-bin/luci/admin/ubus`, resolved via `L.url('admin/ubus')` when embedded).
- Session token: `window.parent.L.env.sessionid` (fallback to the anonymous 32-zero session token only for local dev).
- Every response is `{ ok: boolean, error?: string, ...payload }`. Treat `ok:false` as a user-facing error — never throw. Show the error inline next to the offending control; do not clear other UI state.
- The full method list is in `/openwrt/luci-app-ccswitch/root/usr/share/rpcd/ucode/ccswitch`. The TypeScript wrappers for the daemon card live in `src/openwrt-islands/daemon-card/ubus.ts` — reuse that pattern when adding new islands.

## Refresh & polling

- `get_runtime_status`: the only call that drives page-wide daemon health. Poll every ~5s while the daemon is stopped or unreachable (alert-strip visible); back off to ~15s when healthy.
- `get_app_runtime_status`, `get_usage_summary`: refresh on app-card mount and after any provider mutation for that app. No standing poll.
- `get_recent_activity`: refresh only while the activity popover is open (~5s interval) or on explicit click; never in the background.
- Side-panel data (`list_providers`, `get_provider_failover`): fetch on open and after every successful mutation; do not poll.

## Optimistic updates

- `activate_provider`, `set_auto_failover_enabled`, `set_max_retries`, `reorder_failover_queue`: apply optimistically, then reconcile against the response. Roll back on `ok:false`.
- `upsert_provider`, `delete_provider`, `upload_codex_auth`, `remove_codex_auth`: **no** optimism — these change persisted shape. Wait for the response before updating the list.

## Dirty-state and confirmation

- Any form with unsaved changes must guard close/cancel with a confirm-discard modal. "Dirty" = shallow-diff of `draft` vs `saved` (same pattern as `DaemonCardIsland.tsx`).
- Destructive actions (`delete_provider`, `remove_codex_auth`, `restartService` when the service is healthy) require explicit confirmation. `restart_service` while the alert strip is already up can skip confirmation — user intent is obvious.

## Tone vocabulary (status chips)

Tone classes are shared across cards, popovers, and the side panel. Keep labels short — the chip is informational, not a sentence.

| Tone      | Typical label          | Meaning                                      |
| --------- | ---------------------- | -------------------------------------------- |
| `success` | "Running", "Healthy", "Active" | Everything good; green dot                |
| `warn`    | "Degraded", "4xx"      | Service up but a health signal is flapping  |
| `fail`    | "Error", "5xx", "Stopped" | Service down OR request failed hard         |
| `muted`   | "Idle", "Saved", "—"   | Neutral state; nothing to report            |
| `info`    | "Draft", "Preset"      | User-facing in-progress state               |

## Apps supported by the backend (authoritative)

`'claude' | 'codex' | 'gemini'` — hard-coded in the rpcd handler (`normalizeApp`). The mockup also shows `OpenClaw` and `Hermes Agent` as "unconfigured" placeholders — those are visual only and must be omitted from the real render until the daemon supports them.

## Placeholders awaiting backend

Elements marked `field-placeholder` in the HTML map to values the daemon does not yet expose. Do not render a guessed value — keep the placeholder text until a real field is wired:

- Side panel → Failover → Route mode (`provider.failover.routeMode`)
- Side panel → Failover → Health gate (`provider.failover.healthGate`)

## Things that are *not* backend-backed (don't call RPC)

- Theme toggle (`#themeToggle`) — `localStorage('ccswitch.theme')`.
- Search box in the provider rail (`#spSearch`) — client-side filter only.
- The `PRESETS` table — a UI template library embedded in the mockup. Hydrates a draft; does not persist anything until `upsert_provider`.
- Website URL (`#f_website`) — derived from the preset library for display only.
- Tweaks panel (`#tweakPanel`) — designer-only knob surface, not shipped.

## Icon resolution

Icons are static SVGs under `resources/ccswitch/revised/icons/`, keyed by a `iconKey` in the mockup's `ICONS` table. The daemon does not vend icon choices — pick based on provider name heuristics (or carry a mapping table in the island). Do not add an RPC for this.
