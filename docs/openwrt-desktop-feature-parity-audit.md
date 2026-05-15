# OpenWrt/Desktop Feature Parity Audit

## Executive summary

The desktop app is a full workstation controller for six app families: Claude,
Codex, Gemini, OpenCode, OpenClaw, and Hermes. Its frontend exposes providers,
settings, prompts, skills, MCP, agents, universal providers, sessions,
workspace files, OpenClaw tools/env/agents, and Hermes memory. Its Tauri backend
registers commands for provider CRUD, import/export, backups, WebDAV sync,
proxy control, failover, usage analytics, stream checks, model fetch, MCP,
prompts, skills, sessions, universal providers, OAuth/auth center, global
outbound proxy, OpenClaw, Hermes, OMO, and workspace files
(`src/App.tsx`, `src/lib/api/types.ts`, `src-tauri/src/lib.rs`).

The OpenWrt implementation is intentionally narrower. The daemon admin API,
rpcd bridge, shared provider/runtime types, and native LuCI shell only implement
real provider/runtime management for Claude, Codex, and Gemini
(`proxy-daemon/src/openwrt_admin.rs`, `proxy-daemon/src/openwrt_http.rs`,
`openwrt/luci-app-ccswitch/root/usr/share/rpcd/ucode/ccswitch`,
`src/shared/providers/domain/types.ts`, `src/shared/runtime/types.ts`). The
LuCI UI can manage providers, activate and reorder them, upload/remove Claude
and Codex auth JSON, control per-app proxy/failover settings, restart the
service, and inspect request activity and summary usage
(`src/openwrt-provider-ui/OpenWrtPageShell.tsx`,
`src/openwrt-provider-ui/components/AppsGrid.tsx`,
`src/openwrt-provider-ui/components/ProviderSidePanel.tsx`,
`openwrt/luci-app-ccswitch/htdocs/luci-static/resources/view/ccswitch/settings.js`).

The highest-value OpenWrt gaps are not the desktop-only shell features. They are
operational router features that already fit the daemon/LuCI split: richer
usage analytics, stream/model checks, endpoint latency/model fetch, backup and
restore, circuit-breaker/log diagnostics, provider duplicate/import helpers,
and bounded global outbound proxy testing. These should be implemented as
small daemon admin endpoints plus LuCI surfaces, with conservative timeouts and
storage limits.

As of 2026-05-15, five backend-only parity slices have completed in isolated
Paseo worker worktrees but have not yet been integrated into `openwrt-proxy`:
stream/model health checks, endpoint latency/model discovery, backup/restore,
circuit/log diagnostics, and outbound proxy testing. This document tracks that
progress separately from features already present on the main branch.

The largest parity differences need backend design before implementation:
OpenCode/OpenClaw/Hermes support, MCP/prompts/skills, managed OAuth/device flow,
WebDAV sync, universal providers, and session/workspace/Hermes memory features.
Those desktop features assume local user files, browser/device flows, OS
dialogs, terminal launch, or workstation lifecycle hooks that do not map cleanly
onto a router daemon (`src-tauri/src/app_config.rs`,
`src/components/mcp/UnifiedMcpPanel.tsx`,
`src/components/skills/UnifiedSkillsPanel.tsx`,
`src/components/sessions/SessionManagerPage.tsx`,
`src/components/workspace/WorkspaceFilesPanel.tsx`,
`src/components/hermes/HermesMemoryPanel.tsx`).

## Audit scope and source anchors

This audit compares implemented code, not roadmap intent. Desktop scope was
checked through the React app shell, API types, provider forms, settings,
usage, and registered Tauri commands (`src/App.tsx`, `src/lib/api/types.ts`,
`src/components/providers/forms/ProviderForm.tsx`,
`src/components/settings/SettingsPage.tsx`,
`src/components/usage/UsageDashboard.tsx`, `src-tauri/src/lib.rs`). OpenWrt
scope was checked through packaging, the LuCI page, rpcd ucode bridge, native
OpenWrt React shell, OpenWrt platform adapters, proxy daemon admin routes, and
OpenWrt tests (`openwrt/README.md`,
`openwrt/proxy-daemon/files/etc/init.d/ccswitch`,
`openwrt/luci-app-ccswitch/htdocs/luci-static/resources/view/ccswitch/settings.js`,
`openwrt/luci-app-ccswitch/root/usr/share/rpcd/ucode/ccswitch`,
`src/openwrt-provider-ui/`, `src/platform/openwrt/`,
`proxy-daemon/src/openwrt_http.rs`, `proxy-daemon/src/openwrt_admin.rs`,
`tests/openwrt/`).

## Parity tracking status

Status legend:

- `implemented`: present on `openwrt-proxy` at the time of this audit.
- `backend ready`: completed in a Paseo worker worktree and awaiting review,
  integration, and deployment.
- `needs UI`: requires LuCI design/mockup before implementation should proceed.
- `needs design`: requires backend/product design before implementation.
- `not planned`: intentionally desktop-only or low-value for OpenWrt.

| Area | Current status | Tracking note |
| --- | --- | --- |
| Stream/model health checks | backend ready | Worker `83c605d` added `GET/POST /openwrt/admin/apps/:app/providers/:provider_id/stream-check`, rpcd bridge methods, conservative bounds, latest-result readback, and focused tests. |
| Endpoint latency and model discovery | backend ready | Worker `92e19f7` added provider-scoped `/latency` and `/models` admin endpoints, rpcd bridge methods, redacted structured responses, and tests. |
| Backup/export/restore | backend ready | Worker `5f8aee9` added backup list/create/import/download/delete/restore APIs for daemon DB/data under `/etc/cc-switch`, safety backup before restore, metadata/schema validation, rpcd bridge, and tests. |
| Circuit-breaker and log diagnostics | backend ready | Worker `2a45da7` added richer circuit-breaker diagnostics, request-log diagnostics, `failuresOnly`, bounded daemon log tail, rpcd bridge, and tests. |
| Global outbound proxy test | backend ready | Worker `cb60fb8` added `/openwrt/admin/outbound-proxy/test`, rpcd bridge, redaction, bounded single-shot behavior, and tests. |
| Provider duplicate/import helpers | needs UI | Worth doing, but the user wants designer mockups before visible LuCI changes. |
| Usage trends/model stats/pricing visibility | needs UI | Backend and presentation scope should be split after mockup; existing OpenWrt usage summary/provider stats remain implemented. |
| OpenCode/OpenClaw/Hermes, MCP, prompts, skills, OAuth, WebDAV, universal providers | needs design | Do not start LuCI work until router ownership, secrets, storage, and client-file behavior are specified. |

## Feature inventory

| Desktop feature | OpenWrt status | gap | implementation value | OpenWrt suitability | recommended priority |
| --- | --- | --- | --- | --- | --- |
| Six desktop app IDs: Claude, Codex, Gemini, OpenCode, OpenClaw, Hermes (`src/App.tsx`, `src/lib/api/types.ts`, `src-tauri/src/app_config.rs`) | Real OpenWrt management is Claude/Codex/Gemini only; OpenCode/OpenClaw are inert home cards and Hermes is absent from the OpenWrt shell (`proxy-daemon/src/openwrt_admin.rs`, `src/openwrt-provider-ui/components/AppsGrid.tsx`, `src/openwrt-provider-ui/components/AppCard.tsx`) | OpenCode/OpenClaw/Hermes provider/runtime management missing | Medium, but only if router-side workflows are defined | Needs backend design because additive desktop apps manage local tool config files | P2 design |
| Provider CRUD, switch, sort, search, duplicate, presets across all desktop apps (`src/components/providers/ProviderList.tsx`, `src/components/providers/ProviderActions.tsx`, `src/components/providers/forms/ProviderForm.tsx`) | CRUD, activate, reorder, search, and presets exist for Claude/Codex/Gemini; duplicate and several desktop metadata flows are absent (`proxy-daemon/src/openwrt_http.rs`, `src/platform/openwrt/providers/adapter.ts`, `src/openwrt-provider-ui/components/ProviderSidePanel.tsx`) | Partial parity | High for duplicate and metadata preservation | Suitable; mostly LuCI-only for duplicate, both daemon and LuCI for persisted metadata | P1 |
| Rich provider form fields: raw settings JSON, app-specific config editors, common snippets, full URL, endpoint auto-select, custom endpoints, usage script, provider test config, pricing config (`src/components/providers/forms/ProviderForm.tsx`, `src/components/providers/forms/ProviderAdvancedConfig.tsx`) | OpenWrt provider payload is normalized to name, base URL, website, token field/token, model, notes, auth mode, and auth content (`proxy-daemon/src/openwrt_admin.rs`, `src/openwrt-provider-ui/components/ProviderSidePanelConfigureTab.tsx`) | Advanced provider metadata and scripts missing | Medium-high for test/pricing metadata; low for raw JSON editor | Suitable if constrained and validated; raw desktop JSON editing is risky in LuCI | P1/P2 |
| Endpoint speed test and `/v1/models` model fetch (`src-tauri/src/commands/provider.rs`, `src-tauri/src/services/speedtest.rs`, `src-tauri/src/commands/model_fetch.rs`, `src-tauri/src/services/model_fetch.rs`) | Not implemented on `openwrt-proxy` in the audited baseline. Backend-only implementation is now ready in worker `92e19f7` with provider-scoped latency/model endpoints and rpcd bridge. | Missing from main branch; backend ready for review | High for provider setup on routers | Suitable with strict concurrency and timeout limits | P1 integrate backend, then UI |
| Proxy service start/stop, app takeover, per-app proxy config (`src/components/settings/ProxyTabContent.tsx`, `src/components/proxy/ProxyPanel.tsx`, `src-tauri/src/lib.rs`) | OpenWrt uses procd/UCI service enablement, listen addr/port, outbound env proxy, per-app proxy enabled, and service restart (`openwrt/proxy-daemon/files/etc/init.d/ccswitch`, `openwrt/proxy-daemon/files/etc/config/ccswitch`, `proxy-daemon/src/openwrt_admin.rs`, `src/openwrt-provider-ui/components/DaemonCard.tsx`) | Desktop live-config takeover model is not present | Low to medium | Router service control is already more appropriate than desktop takeover | P0 maintain |
| Auto failover queue, max retries, provider health, circuit breaker stats/reset (`src/components/proxy/FailoverQueueManager.tsx`, `src/components/proxy/CircuitBreakerConfigPanel.tsx`, `src-tauri/src/commands/failover.rs`) | OpenWrt exposes queue add/remove/reorder, auto failover, max retries, health, circuit breaker state/reset, and LuCI controls/cards (`proxy-daemon/src/openwrt_http.rs`, `proxy-daemon/src/openwrt_admin.rs`, `src/openwrt-provider-ui/components/AppCard.tsx`, `openwrt/luci-app-ccswitch/root/usr/share/rpcd/ucode/ccswitch`). Backend diagnostics enrichment is ready in worker `2a45da7`. | Mostly implemented; richer diagnostics pending integration/UI | Medium | Suitable; mostly LuCI surface over existing daemon state | P1 integrate backend, then UI |
| Usage dashboard: summary, trends, provider stats, model stats, request logs/detail, pricing config, data sources (`src/components/usage/UsageDashboard.tsx`, `src/lib/api/usage.ts`, `src-tauri/src/commands/usage.rs`) | OpenWrt exposes app-scoped usage summary, provider stats, recent activity, request logs/detail, and quota/status; no trends, model stats, pricing editor, or data-source sync UI/API (`proxy-daemon/src/openwrt_http.rs`, `proxy-daemon/src/openwrt_admin.rs`, `src/openwrt-provider-ui/components/ActivitySidePanel.tsx`) | Partial parity | High | Suitable if aggregated and paginated to avoid router load | P1 |
| Stream/model health checks and global/per-provider check config (`src/hooks/useStreamCheck.ts`, `src/components/usage/ModelTestConfigPanel.tsx`, `src-tauri/src/commands/stream_check.rs`, `src-tauri/src/services/stream_check.rs`) | Shared stream-check service is compiled into proxy-daemon, but no OpenWrt admin route or LuCI UI exposes it in the audited baseline (`proxy-daemon/src/services/mod.rs`, `proxy-daemon/src/openwrt_http.rs`). Backend-only provider stream-check endpoints are ready in worker `83c605d`. | Missing from main branch; backend ready for review | High | Suitable with bounded retries and opt-in execution | P1 integrate backend, then UI |
| Import/export, local DB backups, restore, backup retention (`src/components/settings/ImportExportSection.tsx`, `src/components/settings/BackupListSection.tsx`, `src/lib/api/settings.ts`, `src-tauri/src/database/backup.rs`) | OpenWrt package preserves UCI config and `/etc/cc-switch`, but LuCI has no export/import/backup UI for router DB state in the audited baseline (`openwrt/README.md`, `openwrt/proxy-daemon/files/etc/init.d/ccswitch`). Backend-only daemon DB/data backup APIs are ready in worker `5f8aee9`. | Missing from main branch; backend ready for review | High for router maintenance and rollback | Suitable if restricted to `/etc/cc-switch` and authenticated LuCI users | P1 integrate backend, then UI |
| WebDAV sync and auto-sync (`src/components/settings/WebdavSyncSection.tsx`, `src-tauri/src/commands/webdav_sync.rs`, `src-tauri/src/services/webdav_auto_sync.rs`) | Proxy daemon has a no-op WebDAV auto-sync stub because desktop uses Tauri AppHandle events (`proxy-daemon/src/services/webdav_auto_sync.rs`) | Missing by design | Medium | Needs credential, conflict, and recovery design before router use | P2 design |
| Global outbound proxy entry, test, and local proxy scan (`src/components/settings/GlobalProxySettings.tsx`, `src/lib/api/settings.ts`, `src-tauri/src/lib.rs`) | OpenWrt UCI supports static `http_proxy`/`https_proxy` env passed to the daemon, but no scan/test UI is exposed (`openwrt/proxy-daemon/files/etc/config/ccswitch`, `openwrt/proxy-daemon/files/etc/init.d/ccswitch`, `src/openwrt-provider-ui/OpenWrtPageShell.tsx`). Backend-only outbound proxy test is ready in worker `cb60fb8`. | Partial parity; backend test ready for review | Medium | Static test is suitable; local scan is less useful on routers | P2 integrate backend, then UI |
| MCP unified manager (`src/components/mcp/UnifiedMcpPanel.tsx`, `src-tauri/src/commands/mcp.rs`, `src-tauri/src/app_config.rs`) | No OpenWrt admin route or LuCI UI for MCP; DB schema has MCP tables but OpenWrt contract does not expose them (`src-tauri/src/database/schema.rs`, `proxy-daemon/src/openwrt_http.rs`) | Missing | Unclear | Needs backend design because router may not own client-side MCP files | P2 design |
| Prompt manager (`src/components/prompts/PromptPanel.tsx`, `src-tauri/src/commands/prompt.rs`) | No OpenWrt prompt UI/API, despite shared prompt DB schema (`src-tauri/src/database/schema.rs`, `proxy-daemon/src/openwrt_http.rs`) | Missing | Unclear | Needs design: client prompt files vs proxy-time prompt injection are different products | P2 design |
| Skills manager, repos, zip install, backup/restore, update checks (`src/components/skills/UnifiedSkillsPanel.tsx`, `src-tauri/src/services/skill.rs`, `src-tauri/src/app_config.rs`) | No OpenWrt skills UI/API; schema exists but router workflow is undefined (`src-tauri/src/database/schema.rs`, `proxy-daemon/src/openwrt_http.rs`) | Missing | Low to unclear | Needs design; installing workstation skills on a router likely will not affect LAN clients | P3 design |
| Auth center, generic managed auth, Copilot OAuth, Codex OAuth/device flows (`src/components/settings/AuthCenterPanel.tsx`, `src/components/providers/forms/CopilotAuthSection.tsx`, `src/components/providers/forms/CodexOAuthSection.tsx`, `src-tauri/src/lib.rs`) | OpenWrt supports only API-key style provider storage and Claude/Codex auth JSON upload/remove with payload limits (`proxy-daemon/src/openwrt_admin.rs`, `proxy-daemon/src/openwrt_http.rs`, `src/openwrt-provider-ui/components/ProviderSidePanelConfigureTab.tsx`) | Missing managed-account parity | Medium-high for official-provider users | Needs secrets, browser/device-flow, refresh, and audit design | P2 design |
| Sessions and terminal resume (`src/components/sessions/SessionManagerPage.tsx`, `src-tauri/src/commands/session_manager.rs`) | No OpenWrt session manager; OpenWrt only has proxy request activity/logs (`src/openwrt-provider-ui/components/ActivitySidePanel.tsx`, `proxy-daemon/src/openwrt_http.rs`) | Missing | Low | Not worth as desktop parity; router should show proxy logs, not local CLI transcripts | P3 no |
| Workspace files and daily memory editors (`src/components/workspace/WorkspaceFilesPanel.tsx`, `src/lib/api/workspace.ts`) | No OpenWrt equivalent in the admin routes or LuCI shell (`proxy-daemon/src/openwrt_http.rs`, `src/openwrt-provider-ui/OpenWrtPageShell.tsx`) | Missing | Low | Not worth unless OpenClaw router runtime is redesigned | P3 no/design |
| OpenClaw env/tools/agents/default model (`src/components/openclaw/EnvPanel.tsx`, `src/components/openclaw/ToolsPanel.tsx`, `src/components/openclaw/AgentsDefaultsPanel.tsx`, `src-tauri/src/openclaw_config.rs`) | OpenWrt daemon rejects OpenClaw provider management and LuCI OpenClaw card is inert (`proxy-daemon/src/openwrt_admin.rs`, `src/openwrt-provider-ui/components/AppCard.tsx`) | Missing | Unclear | Needs OpenClaw-on-router product definition | P2 design |
| Hermes providers, dashboard, memory (`src/components/hermes/HermesMemoryPanel.tsx`, `src-tauri/src/hermes_config.rs`, `src-tauri/src/commands/hermes.rs`) | OpenWrt daemon rejects Hermes in admin profile and LuCI has no Hermes card (`proxy-daemon/src/openwrt_admin.rs`, `src/openwrt-provider-ui/components/AppsGrid.tsx`) | Missing | Unclear | Needs Hermes runtime/security design | P3 design |
| Universal providers (`src/components/universal/UniversalProviderPanel.tsx`, `src-tauri/src/database/dao/universal_providers.rs`, `src-tauri/src/lib.rs`) | No OpenWrt admin route or LuCI UI (`proxy-daemon/src/openwrt_http.rs`, `src/openwrt-provider-ui/OpenWrtPageShell.tsx`) | Missing | Medium if it reduces preset duplication | Needs design to avoid an abstraction that cannot sync to router apps | P2 design |
| Deep links and OS protocol import (`src/components/DeepLinkImportDialog.tsx`, `src-tauri/src/deeplink/`, `src-tauri/src/lib.rs`) | No OpenWrt equivalent; LuCI has no OS protocol handler or daemon route (`proxy-daemon/src/openwrt_http.rs`, `openwrt/luci-app-ccswitch/htdocs/luci-static/resources/view/ccswitch/settings.js`) | Missing | Low | Not worth as desktop parity; optional config import URL could be separate | P3 no |
| Desktop UI/platform settings: window controls, tray, auto-launch, terminal, OS dialogs, theme/language, config dir overrides, update checks (`src/components/settings/SettingsPage.tsx`, `src/components/settings/WindowSettings.tsx`, `src/components/settings/TerminalSettings.tsx`, `src-tauri/src/tray.rs`, `src-tauri/src/auto_launch.rs`) | OpenWrt has its own LuCI shell theme toggle and daemon card, and package lifecycle is handled through opkg/procd (`src/openwrt-provider-ui/OpenWrtPageShell.tsx`, `openwrt/README.md`, `openwrt/proxy-daemon/files/etc/init.d/ccswitch`) | Desktop-only features absent | Low | Not worth on OpenWrt except local LuCI preferences | P3 no |

## Missing features worth implementing

### Provider duplicate and metadata preservation - LuCI-only first, both later

Desktop has duplicate actions and broader provider metadata in the list/form
surface (`src/components/providers/ProviderActions.tsx`,
`src/components/providers/forms/ProviderForm.tsx`). OpenWrt already supports
provider list/edit/create/delete/activate/reorder for Claude/Codex/Gemini, and
the native provider panel already has the state needed to prefill a new draft
(`src/platform/openwrt/providers/adapter.ts`,
`src/openwrt-provider-ui/components/ProviderSidePanel.tsx`). A duplicate button
can be LuCI-only by copying the current provider into a new draft and requiring
the user to save. Persisting extra metadata such as provider-level test config
or pricing source would require daemon payload changes.

### Usage analytics subset - both daemon and LuCI

Desktop supports summary, daily trends, provider stats, model stats, request
logs/detail, pricing configuration, provider limit checks, session usage sync,
and data-source summaries (`src/components/usage/UsageDashboard.tsx`,
`src/lib/api/usage.ts`, `src-tauri/src/commands/usage.rs`). OpenWrt already
has summary, provider stats, recent activity, request logs/detail, and quota
surfaces (`proxy-daemon/src/openwrt_http.rs`,
`src/openwrt-provider-ui/components/ActivitySidePanel.tsx`,
`src/openwrt-provider-ui/components/AppCard.tsx`). Add app-scoped trends,
model stats, and read-only pricing visibility first. Keep pricing edits
optional and audited because they alter cost accounting.

### Stream/model checks - both daemon and LuCI

The desktop stream-check implementation is already shared Rust service code
with global and per-provider overrides (`src-tauri/src/services/stream_check.rs`,
`src-tauri/src/commands/stream_check.rs`). Proxy-daemon includes that service
module but OpenWrt does not expose routes (`proxy-daemon/src/services/mod.rs`,
`proxy-daemon/src/openwrt_http.rs`). Add OpenWrt admin endpoints for single
provider check, maybe queued batch check, config read/write, and latest result.
The LuCI UI should make checks explicit and rate-limited because routers have
limited CPU, RAM, and WAN uplink. Backend-only single-provider check and
latest-result endpoints are ready in worker `83c605d`, pending integration.

### Endpoint latency and model fetch - both daemon and LuCI

Desktop provider setup can speed-test endpoints and fetch OpenAI-compatible
model IDs (`src-tauri/src/services/speedtest.rs`,
`src-tauri/src/services/model_fetch.rs`,
`src/components/providers/forms/shared/ModelInputWithFetch.tsx`). This is
valuable on routers because bad endpoints are hard to debug remotely. Implement
only bounded GET-based checks with small concurrency, short timeouts, and no
background polling. Backend-only provider latency/model discovery endpoints are
ready in worker `92e19f7`, pending integration.

### Backup, restore, import, export - both daemon and LuCI

Desktop has config import/export and DB backup/restore surfaces
(`src/components/settings/ImportExportSection.tsx`,
`src/components/settings/BackupListSection.tsx`, `src/lib/api/settings.ts`).
OpenWrt package lifecycle preserves `/etc/config/ccswitch` and `/etc/cc-switch`,
but LuCI does not expose a backup workflow (`openwrt/README.md`,
`openwrt/proxy-daemon/files/etc/init.d/ccswitch`). Add authenticated backup and
restore of the daemon DB/config directory with safety backup on restore. This
directly supports OpenWrt package maintenance and rollback workflows. A
backend-only daemon DB/data backup API is ready in worker `5f8aee9`; UCI
restore remains intentionally out of scope for that slice.

### Circuit-breaker and log diagnostics - mostly LuCI

OpenWrt already exposes circuit-breaker state/reset and provider health through
daemon routes and rpcd methods (`proxy-daemon/src/openwrt_http.rs`,
`proxy-daemon/src/openwrt_admin.rs`,
`openwrt/luci-app-ccswitch/root/usr/share/rpcd/ucode/ccswitch`). The LuCI UI
should surface the reason, last failure, failure counts, and reset affordance
near each provider. If additional log tailing is added, keep it bounded because
the init script writes `/var/log/cc-switch/cc-switch.log` and rotates at 1 MiB
(`openwrt/proxy-daemon/files/etc/init.d/ccswitch`). Backend-only diagnostic
fields, request-log diagnostics, and bounded log tail are ready in worker
`2a45da7`, pending integration.

### Global outbound proxy test - both daemon and LuCI

Desktop has global outbound proxy save/test/scan controls
(`src/components/settings/GlobalProxySettings.tsx`). OpenWrt already passes
`http_proxy` and `https_proxy` from UCI into the daemon process
(`openwrt/proxy-daemon/files/etc/config/ccswitch`,
`openwrt/proxy-daemon/files/etc/init.d/ccswitch`). A simple "test this proxy"
endpoint is worth adding. Desktop-style local proxy scanning is lower value on
a router and should not be a priority. A backend-only single-shot outbound
proxy test endpoint is ready in worker `cb60fb8`, pending integration.

## Missing features not worth implementing

Desktop shell and OS lifecycle features should stay desktop-only: window
controls, tray menu, auto-launch, terminal preference, native file dialogs,
open provider terminal, app restart dialogs, and OS protocol registration
(`src/components/settings/WindowSettings.tsx`,
`src/components/settings/TerminalSettings.tsx`, `src-tauri/src/tray.rs`,
`src-tauri/src/auto_launch.rs`, `src-tauri/src/deeplink/`). OpenWrt already has
opkg/procd/LuCI lifecycle primitives (`openwrt/README.md`,
`openwrt/proxy-daemon/files/etc/init.d/ccswitch`).

Full session manager parity is not worth implementing on OpenWrt. Desktop
sessions read local workstation transcripts, launch terminals, and resume tools
(`src/components/sessions/SessionManagerPage.tsx`). OpenWrt should continue to
show proxy request logs and request detail, which are already router-native
(`src/openwrt-provider-ui/components/ActivitySidePanel.tsx`,
`proxy-daemon/src/openwrt_http.rs`).

Workspace file editing and daily memory parity are also not worth implementing
without a separate OpenClaw-on-router design. The desktop workspace page edits
files under a local OpenClaw workspace and opens local directories
(`src/components/workspace/WorkspaceFilesPanel.tsx`). A router should not become
the user's coding workspace by default.

Deep-link OS protocol handling should not be ported to LuCI. If router import
links are desired, they should be explicit LuCI import flows rather than
desktop-style `ccswitch://` handlers (`src/components/DeepLinkImportDialog.tsx`,
`src-tauri/src/deeplink/`).

Desktop update checks and app config directory overrides are not OpenWrt
features. Package updates, conffiles, and runtime data already have OpenWrt
ownership boundaries (`openwrt/README.md`,
`openwrt/proxy-daemon/files/etc/config/ccswitch`).

## Features needing backend design

### OpenCode, OpenClaw, and Hermes

Desktop treats OpenCode/OpenClaw/Hermes as additive-mode apps whose providers
are written into local app config rather than switching a single current
provider (`src-tauri/src/app_config.rs`,
`src/components/providers/ProviderActions.tsx`). OpenWrt admin code explicitly
rejects OpenCode/OpenClaw/Hermes provider management
(`proxy-daemon/src/openwrt_admin.rs`). Before implementation, define whether
the router is only a proxy for LAN clients, a manager for local tool config
files, or a host for these app runtimes. That decision affects storage paths,
schema, rollback, and whether "add/remove from config" has any meaning.

### MCP, prompts, and skills

Desktop MCP, prompts, and skills are file/config managers for local client
apps, with unified DB tables and app enablement flags
(`src/components/mcp/UnifiedMcpPanel.tsx`,
`src/components/prompts/PromptPanel.tsx`,
`src/components/skills/UnifiedSkillsPanel.tsx`,
`src-tauri/src/database/schema.rs`). OpenWrt has no admin API for these
surfaces (`proxy-daemon/src/openwrt_http.rs`). Backend design must decide
whether the router writes client files, exposes downloadable config, or injects
behavior at proxy time. Those are different security and UX models.

### Managed auth and OAuth

Desktop has generic managed auth, Copilot multi-account device flow, Codex
OAuth account commands, and provider binding (`src-tauri/src/lib.rs`,
`src/components/settings/AuthCenterPanel.tsx`,
`src/components/providers/forms/CopilotAuthSection.tsx`,
`src/components/providers/forms/CodexOAuthSection.tsx`). OpenWrt only stores
API keys and uploaded Claude/Codex auth JSON per provider
(`proxy-daemon/src/openwrt_admin.rs`,
`src/openwrt-provider-ui/components/ProviderSidePanelConfigureTab.tsx`).
Router OAuth needs an explicit design for secret-at-rest protection, refresh
policy, device-flow UX, LAN exposure, audit logging, and account removal.

### WebDAV sync

Desktop WebDAV sync depends on Tauri events and auto-sync hooks
(`src-tauri/src/commands/webdav_sync.rs`,
`src-tauri/src/services/webdav_auto_sync.rs`). Proxy-daemon stubs auto-sync as
no-op because it lacks a Tauri AppHandle (`proxy-daemon/src/services/webdav_auto_sync.rs`).
OpenWrt WebDAV needs a daemon-native scheduler, credentials storage, conflict
resolution, safety backup, and recovery story before LuCI exposes it.

### Universal providers

Desktop universal providers can reduce duplicated preset/provider setup
(`src/components/universal/UniversalProviderPanel.tsx`,
`src-tauri/src/database/dao/universal_providers.rs`). OpenWrt has no admin
contract for them (`proxy-daemon/src/openwrt_http.rs`). Design should decide
whether universal providers are just LuCI templates, real database rows, or a
sync layer that materializes app-specific providers.

## Risks and tradeoffs

Router constraints favor pull-on-demand and bounded operations. Usage queries,
stream checks, endpoint tests, backups, and log reads should be paginated,
rate-limited, and timeout-protected. The OpenWrt init script logs to `/var/log`
and rotates at 1 MiB, while persistent daemon data lives in `/etc/cc-switch`
(`openwrt/proxy-daemon/files/etc/init.d/ccswitch`).

The daemon/LuCI separation is the right boundary. LuCI should remain a thin,
authenticated admin surface over explicit daemon admin routes and rpcd methods;
the current design already follows this pattern
(`proxy-daemon/src/openwrt_http.rs`,
`openwrt/luci-app-ccswitch/root/usr/share/rpcd/ucode/ccswitch`,
`src/platform/openwrt/providers/adapter.ts`). Avoid reintroducing desktop-only
Tauri assumptions into the OpenWrt package.

Secrets need stricter rules on routers than on a personal desktop. Uploaded
auth JSON is already capped at 64 KiB and scoped to Claude/Codex providers
(`proxy-daemon/src/openwrt_http.rs`, `proxy-daemon/src/openwrt_admin.rs`).
Any OAuth or WebDAV feature should specify file permissions, redaction, export
behavior, and removal semantics before implementation.

Persistent storage and package maintenance should be treated as first-class
requirements. `/etc/config/ccswitch` is a conffile, `/etc/cc-switch` is left in
place on removal, and LuCI/rpcd/uhttpd caches are refreshed by package hooks
(`openwrt/README.md`). Backup/restore features should respect those ownership
boundaries.

Not all desktop parity improves router workflows. Terminal launch, workspace
editing, sessions, OS dialogs, and tray/window behavior are useful on a
workstation but add little value to a router admin page
(`src/components/sessions/SessionManagerPage.tsx`,
`src/components/workspace/WorkspaceFilesPanel.tsx`,
`src/components/settings/WindowSettings.tsx`).

## Phased roadmap

### Phase 0 - preserve the current OpenWrt contract

Keep Claude/Codex/Gemini provider/runtime management stable. Do not add new app
IDs to OpenWrt admin metadata until the daemon supports their actual workflows
(`proxy-daemon/src/openwrt_admin.rs`, `src/shared/runtime/types.ts`). Continue
validating package version, daemon version, and schema compatibility before
deploys as required by the OpenWrt deploy guardrails.

### Phase 1 - operational parity for existing OpenWrt apps

Add provider duplicate in LuCI, usage trends/model stats read APIs, stream
check endpoints/config, endpoint latency/model fetch, and circuit-breaker/log
diagnostics. These map directly onto existing desktop value while staying
within Claude/Codex/Gemini and the current daemon/LuCI split
(`src-tauri/src/services/stream_check.rs`,
`src-tauri/src/services/speedtest.rs`, `src-tauri/src/services/model_fetch.rs`,
`proxy-daemon/src/openwrt_http.rs`). Backend-only worker implementations now
exist for stream checks, endpoint/model checks, and diagnostics; the next step
is manual integration and review because they touch overlapping daemon/rpcd
files.

### Phase 2 - router maintenance and recovery

Add LuCI backup/export/import/restore for `/etc/cc-switch` and the daemon DB,
with safety backups before restore and clear compatibility metadata. Then add a
bounded global outbound proxy test. This phase improves OpenWrt package
maintenance without pulling in desktop UI assumptions (`openwrt/README.md`,
`openwrt/proxy-daemon/files/etc/init.d/ccswitch`,
`src/components/settings/BackupListSection.tsx`). Backend-only worker
implementations now exist for daemon DB/data backup and outbound proxy testing;
visible LuCI affordances should wait for design.

### Phase 3 - design-gated expansion

Write backend designs for OpenCode/OpenClaw/Hermes, MCP/prompts/skills,
managed OAuth, WebDAV sync, and universal providers before any LuCI work. Each
design should specify ownership of files/secrets, schema changes, rollback,
package upgrade behavior, and whether the router is a proxy, a config manager,
or a runtime host (`src-tauri/src/app_config.rs`,
`src-tauri/src/database/schema.rs`, `proxy-daemon/src/openwrt_admin.rs`).

### Phase 4 - optional low-value parity only if demanded

Consider LuCI-local preferences such as app card visibility or persisted page
filters after the operational features are complete. Do not port desktop-only
window, tray, terminal, OS dialog, deep-link protocol, or workspace/session
features unless the product direction changes.
