# How to annotate wiring in your mockup

We're migrating your HTML mockups into React components against a backend RPC layer (LuCI `ubus`). Your mockup is the design source of truth; the engineer binds it to real data. The gap between those two jobs is where we lose time — annotations close it.

Please add inline HTML comments to your mockup describing the **observable behavior** of each interactive or data-bound element. You don't need to know the backend's method or field names — describe what the user sees and when, and the engineer will map it to the transport.

## The four comment tags

Use one of these four, not prose paragraphs. Short is better than thorough.

- `<!-- wire: ... -->` — what data fills this element
- `<!-- action: ... -->` — what happens when the user interacts with it
- `<!-- state: ... -->` — when this element appears / hides / changes tone
- `<!-- note: ... -->` — anything non-obvious that isn't one of the above

Place the comment immediately above the element it describes.

## What to write

**Describe behavior, not implementation.** You own the observable contract; the engineer owns the wire format.

Good — describes behavior:

```html
<!-- state: chip is red when the service is down, yellow when it's up but not responding -->
<!-- action: click restarts the daemon; button stays disabled until the request finishes -->
<!-- wire: shows the number of providers this app has -->
```

Not helpful — assumes a specific RPC shape:

```html
<!-- wire: status.service.reachable -->
<!-- action: call restart_service() -->
```

(The engineer will add those field names themselves. If you write them and the backend later renames a field, your mockup is lying.)

## What to annotate

Every interactive or data-bound element: form inputs, buttons, chips with tone/state, lists populated from data, elements that appear conditionally, modals, popovers. Skip pure layout and decorative elements.

If the same rule applies across many elements (e.g. "tone vocabulary", "all destructive buttons need confirmation", "all forms guard close with discard-confirm"), put it in a sibling `WIRING.md` file next to the mockup — don't repeat it on every element.

## Things to call out explicitly

Please mark these explicitly rather than leaving them to inference:

- **Client-only elements** — anything not backed by real data. Example: `<!-- note: client-only; saved to localStorage -->`.
- **Presentation-only fields** — shown but not persisted. Example: `<!-- note: presentation only, not saved -->`.
- **Placeholders** — elements waiting on future backend support. Example: `<!-- state: disabled until backend exposes this -->`.
- **Write-only inputs** — like a secret/API token field where typed value is sent on save but stored value is never read back. Example: `<!-- note: write-only; leave blank to preserve stored value -->`.
- **Cross-element dependencies** — when one element's state depends on another. Example: `<!-- state: hidden until an item is selected in the rail on the left -->`.
- **Dirty-state / confirmation rules** — when a close/cancel should prompt to discard changes, when an action needs a confirm dialog.

## Example — a chip with dynamic tone and a click action

```html
<!--
  wire:   shows the overall health of this app (e.g. "Running", "Degraded", "Error", "Idle")
  state:  tone follows status:
            running and healthy        -> green, "Running"
            running but failing calls  -> yellow, "Degraded"
            not configured             -> grey, "Idle"
            daemon down                -> red, "Error"
  action: click opens the recent-activity popover anchored below this chip
-->
<button class="chip success dot">Running</button>
```

The engineer can bind that to the right RPC field without asking you what "Degraded" means.

## Example — a form footer

```html
<!--
  action: Save persists all three tabs atomically. Cancel discards changes; if the form is
          dirty, confirm-discard modal first. Delete is destructive; hide it for the currently
          active provider (user must activate another provider first).
-->
<footer class="sp-foot">
  <button class="pill danger">Delete</button>
  <button class="pill">Cancel</button>
  <button class="pill primary">Save</button>
</footer>
```

## Example — a placeholder element

```html
<!-- state: placeholder until backend exposes this field; keep muted and non-interactive -->
<div class="field-placeholder">Route mode — coming soon</div>
```

## Style rules

- One annotation per element or per logical group. Don't wrap every `<div>`.
- Keep each comment under ~6 lines. If it's longer, something belongs in `WIRING.md` instead.
- Use the same vocabulary as the UI (e.g. if your status chips have tones "success / warn / fail / muted / info", use those words, and define them once in `WIRING.md`).
- Don't use the annotation to describe what the element looks like — the markup already does that.

## The test

Before sending a mockup: skim your annotations and ask — *could an engineer wire this up without coming back to ask me clarifying questions?* If no, add the missing `state:` or `note:` comment. If yes, you're done.

---

# Appendix — Where to find every state the UI can reach

You don't need to read Rust to design the UI, but when you're annotating a `state:` comment and want to be sure you've covered every case, there is exactly one place to look for each kind of state. Each file below is authoritative — if a state isn't there, the UI cannot show it.

You have repo access, so **open the file yourself** rather than guessing. Grep or a plain "find in files" for the struct name is enough.

## 1. The RPC surface — what calls exist at all

`openwrt/luci-app-ccswitch/root/usr/share/rpcd/ucode/ccswitch`

This is a UCI/ucode file (JavaScript-like). You don't need to read the bodies — just skim the bottom `return { ccswitch: { ... } }` block. Every key (e.g. `get_runtime_status`, `list_providers`, `activate_provider`, `restart_service`, `set_host_config`, `upload_codex_auth`) is a method the UI can call. If you want the UI to do something that isn't in that list, it's a backend gap — flag it with `<!-- state: disabled until backend exposes this -->`.

Supported apps are hardcoded in the `normalizeApp` function near the top: **claude, codex, gemini**. Anything else is rejected — don't design for "any app".

## 2. The daemon/service state — the chip next to the daemon card

`proxy-daemon/src/openwrt_admin.rs`, struct `OpenWrtServiceStatusView` (around line 206).

These are the only fields describing the daemon itself:

| Field | What it means for the UI |
| --- | --- |
| `running` | Is the daemon process up |
| `reachable` | Can LuCI talk to the daemon's local HTTP status port |
| `listenAddress`, `listenPort` | Where the daemon is bound — shown as `host:port` |
| `version` | Daemon binary version string |
| `proxyEnabled` | Global "master switch" is on |
| `enableLogging` | Request logging is on |
| `statusSource` | Internal: which probe produced this snapshot — usually not shown |
| `statusError` | Present only when the probe failed — show as error tone if present |

**States the chip can be in** fall out of `running` × `reachable`:

- `running=true, reachable=true` → green (healthy)
- `running=true, reachable=false` → yellow (started, not responding)
- `running=false` → red (down)
- `statusError` present → red with the error message

There is no other "service" state. If the design shows a fourth tone, it needs a `note:` explaining how it's derived.

## 3. Per-app runtime state — the app cards and status chips

`proxy-daemon/src/openwrt_admin.rs`, struct `OpenWrtAppRuntimeStatusView` (around line 221).

One of these exists per app (claude / codex / gemini). Key fields you'll design against:

| Field | UI usage |
| --- | --- |
| `providerCount` | "5 providers" label |
| `proxyEnabled` | App-level toggle (can differ from global) |
| `autoFailoverEnabled` | Failover switch |
| `maxRetries` | Retry count input |
| `activeProviderId`, `activeProvider` | Which provider is currently selected; empty if none configured |
| `activeProviderHealth` | Health of the active provider (see §4). Can be `null` if never observed |
| `usingLegacyDefault` | True when the app is still on the built-in default provider — usually shown as a muted "Default" badge |
| `failoverQueueDepth`, `failoverQueue` | Failover panel list |
| `observedProviderCount`, `healthyProviderCount`, `unhealthyProviderCount` | Summary badges / pie chart |

If no provider is configured, `activeProviderId` is `null` and `activeProvider.configured` is `false` — that's the "Idle / not set up" state.

## 4. Provider health — the per-row dot / badge

`proxy-daemon/src/openwrt_admin.rs`, struct `OpenWrtProviderHealthView` (around line 240).

| Field | UI usage |
| --- | --- |
| `observed` | Has the daemon ever made a request through this provider |
| `healthy` | Latest observation was a success |
| `consecutiveFailures` | Drives "degraded" tone past a threshold |
| `lastSuccessAt`, `lastFailureAt`, `lastError`, `updatedAt` | Tooltip / detail content |

**All possible provider-health tones** derive from these three booleans only:

- `observed=false` → grey "unknown" (never tried)
- `observed=true, healthy=true` → green
- `observed=true, healthy=false, consecutiveFailures=1` → yellow (one miss)
- `observed=true, healthy=false, consecutiveFailures>1` → red (repeated failures)

There is no fifth state. If the design shows one, it needs explanation.

## 5. Provider record — what fields a form binds to

`proxy-daemon/src/openwrt_admin.rs`, struct `OpenWrtProviderView` (around line 91).

Everything the provider form can read or write:

`configured`, `active`, `providerId`, `name`, `baseUrl`, `tokenField`, `tokenConfigured`, `tokenMasked`, `model`, `notes`, `authMode`, `codexAuth`.

Notes for designing the form:

- `tokenConfigured=true` + `tokenMasked="sk-…xxxx"` is how a write-only secret field is represented. Leaving the input empty on save must preserve the stored token (see `note: write-only` in the guide above).
- `codexAuth` only appears for the codex app — use the `supportsCodexAuthUpload` flag from `OpenWrtAppMetaView` (§7) to decide whether to render the upload affordance.
- `authMode` is optional; absent for most apps.

## 6. Proxy runtime counters — live dashboard numbers

`src-tauri/src/proxy/types.rs`, struct `ProxyStatus` (around line 60).

This is what appears nested inside `OpenWrtRuntimeStatusView.runtime` — counters that update while the daemon runs: `running`, `address`, `port`, `activeConnections`, `totalRequests`, `successRequests`, `failedRequests`, `successRate`, `uptimeSeconds`, `currentProvider`, `currentProviderId`, `lastRequestAt`, plus the last error message.

Use these for "live usage" widgets. They are cheap to poll but still require a round-trip; don't bind them to elements that need to update at more than ~1 Hz.

## 7. Per-app capability flags — when to hide an element

`proxy-daemon/src/openwrt_admin.rs`, struct `OpenWrtAppMetaView` (around line 186).

Boolean flags that tell the UI whether an app supports a feature: `supportsFailover`, `supportsCodexAuthUpload`, `supportsUsageSummary`, `supportsProviderStats`, `supportsRecentActivity`.

**Use these to gate UI, not hardcoded app names.** If you want to show the Failover tab only for apps that support it, the annotation is:

```html
<!-- state: hidden when the current app does not support failover -->
```

…not "hidden for gemini".

## 8. Host / global config — the Settings panel

Defaults live in UCI: `openwrt/proxy-daemon/files/etc/config/ccswitch`.

Fields exposed to the UI (via `get_host_config` / `set_host_config`): `enabled`, `listenAddr`, `listenPort`, `httpProxy`, `httpsProxy`, `logLevel`.

The ucode handler reads these via the UCI cursor — see `hostConfigViewFromCursor` in the RPC file above.

## 9. Usage stats — the Analytics panel (optional, gated by capability flag)

`src-tauri/src/services/usage_stats.rs`, structs `ProviderStats`, `ModelStats`.

Fields for per-provider rows: `providerId`, `providerName`, `requestCount`, `totalTokens`, `totalCost`, `successRate`, `avgLatencyMs`.

Only show this section when the app's `supportsProviderStats` flag is true (§7).

## A suggested workflow

1. Pick the UI element you're about to annotate.
2. Decide which of the nine sections above it draws from. Most elements map to exactly one.
3. Open that file. Read the struct. Every field is a design decision you either use or deliberately ignore.
4. Enumerate the states. If your design shows N tones/shapes and the struct supports only M<N distinct combinations, you have invented a state — either drop it or write a `note:` explaining how it's derived from existing fields.
5. If your design needs a state the struct doesn't expose, that's a backend gap. Annotate it as a placeholder (`<!-- state: disabled until backend exposes this -->`) and flag it in `WIRING.md`.

Following this keeps the mockup and the backend in the same shape, and means the engineer never has to guess what "Degraded" means.
