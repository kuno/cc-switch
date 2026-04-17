# OpenWrt Option 2 Daemon Decoupling Log

## Purpose

This document records each component intentionally removed from the `proxy-daemon`
build while moving toward Option 2:

- keep the router daemon focused on backend control-plane concerns
- keep desktop-only MCP/Skill/config migration code out of the daemon path
- preserve a clear route to restore removed pieces later if product direction changes

This is a living log and should be updated whenever another desktop-facing
component is removed from the daemon build.

## Design Rule

The daemon is treated as a long-lived backend surface for LuCI and future router
APIs. That means:

- pure shared types/logic may live in `cc-switch-shared`
- daemon runtime/API behavior should live in `proxy-daemon`
- desktop-only wiring should remain in `src-tauri`

Legacy compatibility should be preserved at adapter boundaries, not by keeping
desktop internals compiled into the daemon forever.

## Removed Components

### 1. `src-tauri/src/services/mcp.rs` removed from daemon build

- Status: removed earlier in this Option 2 stream
- Previous daemon path: `proxy-daemon/src/services/mod.rs`
- Reason:
  - the file is a desktop integration surface for MCP import/sync flows
  - it depends on desktop MCP wiring and legacy config expectations
  - it is not part of the router daemon’s stable HTTP control plane
- Router impact:
  - none for current OpenWrt runtime/API behavior
  - daemon no longer compiles or links the desktop MCP service layer
- How to restore:
  - re-add the path import in `proxy-daemon/src/services/mod.rs`
  - restore any daemon call sites that expect `McpService`
  - ensure daemon `app_config` exposes the MCP config structures the service needs
- Estimated effort to restore: low

### 2. Desktop `SkillService` implementation removed from daemon build

- Status: removed earlier in this Option 2 stream
- Previous daemon path: `proxy-daemon/src/services/mod.rs`
- Replacement:
  - `proxy-daemon/src/services/skill.rs` local compatibility shim
- Reason:
  - the desktop skill service manages filesystem/app sync behavior that does not
    belong in the router daemon build
  - the daemon only needed type compatibility for config/database surfaces
- Router impact:
  - daemon keeps lightweight skill metadata compatibility
  - desktop skill install/sync implementation is no longer compiled into the router build
- How to restore:
  - replace the local shim with the old path import
  - restore any desktop file-sync behavior intentionally omitted from the daemon
  - validate router storage/layout expectations before doing so
- Estimated effort to restore: low to medium

### 3. Provider MCP/Skill sync side effects disabled in non-desktop builds

- Status: removed earlier in this Option 2 stream
- Files:
  - `src-tauri/src/services/provider/live.rs`
  - `src-tauri/src/services/provider/mod.rs`
- Reason:
  - provider switching/sync is shared logic
  - MCP/Skill propagation is desktop-only side effect
  - keeping these side effects in daemon builds would continue desktop coupling
- Router impact:
  - provider flows still work
  - daemon builds take no-op MCP/Skill sync paths
- How to restore:
  - remove the `#[cfg(feature = "tauri-desktop")]` no-op split
  - ensure daemon intentionally wants to own MCP/Skill propagation logic
  - reintroduce the required service modules and config surfaces
- Estimated effort to restore: low

### 4. Full `src-tauri/src/app_config.rs` removed from daemon build

- Status: removed in this slice
- Previous daemon path:
  - `proxy-daemon/src/app_config.rs` path-imported the whole desktop module
- Replacement:
  - `proxy-daemon/src/app_config.rs` now re-exports shared config types only
- Removed daemon-build responsibilities:
  - `MultiAppConfig`
  - config file load/save logic
  - prompt auto-import logic
  - legacy `skills.json` import fallback
  - unified MCP migration logic inside the config loader
  - desktop compatibility migration of `claude_common_config_snippet`
- Reason:
  - the daemon only needs shared config types like `AppType`, `McpServer`,
    `InstalledSkill`, and `SkillApps`
  - full legacy config loading is desktop compatibility logic, not daemon runtime logic
  - keeping the full module in daemon builds would keep the daemon coupled to
    desktop config format evolution
- Router impact:
  - no change to current HTTP/runtime behavior
  - daemon build no longer compiles legacy desktop config loader logic
- How to restore:
  - revert `proxy-daemon/src/app_config.rs` back to a path import of
    `src-tauri/src/app_config.rs`
  - re-enable any downstream modules that require `MultiAppConfig`
  - accept renewed coupling to desktop config migration behavior
- Estimated effort to restore: low

### 5. `src-tauri/src/database/migration.rs` removed from daemon build

- Status: removed in this slice
- Change:
  - `src-tauri/src/database/mod.rs` now compiles `migration.rs` only with
    `feature = "tauri-desktop"`
- Reason:
  - the module migrates legacy `config.json` (`MultiAppConfig`) into SQLite
  - that is a desktop startup/data migration concern
  - the router daemon uses SQLite runtime state, not legacy JSON bootstrap migration
- Router impact:
  - none for normal daemon startup
  - daemon build is no longer forced to compile `MultiAppConfig` migration paths
- How to restore:
  - remove the feature gate around `mod migration;`
  - restore a daemon `app_config` module that includes `MultiAppConfig`
  - validate whether router startup should really run legacy JSON migration
- Estimated effort to restore: low

### 6. `src-tauri/src/database/tests.rs` removed from daemon test build

- Status: removed in this slice
- Change:
  - `src-tauri/src/database/mod.rs` now compiles those tests only with
    `all(test, feature = "tauri-desktop")`
- Reason:
  - these tests validate desktop-side schema/config migration behavior including
    `MultiAppConfig`-driven flows
  - they are useful for desktop maintenance, but not required for the OpenWrt package build
- Router impact:
  - no runtime impact
  - daemon test builds no longer compile desktop migration fixtures
- How to restore:
  - remove the feature gate around `mod tests;`
  - restore daemon-side `MultiAppConfig` compatibility as needed
- Estimated effort to restore: low

### 7. Unused MCP modules removed from daemon bridge

- Status: removed in this slice
- Removed from `proxy-daemon/src/shared_core.rs`:
  - `src-tauri/src/mcp/mod.rs`
  - `src-tauri/src/claude_mcp.rs`
  - `src-tauri/src/gemini_mcp.rs`
- Reason:
  - after removing `services/mcp.rs` from the daemon build, these modules had no
    remaining daemon references
  - continuing to compile them would keep dead desktop MCP coupling in the router build
- Router impact:
  - none
- How to restore:
  - re-add the path imports to `proxy-daemon/src/shared_core.rs`
  - restore the daemon-side call chain that actually needs them
  - re-check `crate::app_config::MultiAppConfig` availability if MCP import flows are needed
- Estimated effort to restore: low

## What Was Not Removed

These remain because they still serve daemon/runtime needs:

- `src-tauri/src/database/`
  - core SQLite runtime storage still matters to the daemon
- `src-tauri/src/services/provider/`
  - shared provider business logic is still valuable
- `src-tauri/src/services/proxy.rs`
  - the daemon still owns runtime proxy control behavior
- `src-tauri/src/settings.rs`
  - shared settings/runtime toggles are still used by daemon code

## Reintroduction Policy

A removed desktop component should only be restored to the daemon build if all of
the following are true:

1. The daemon needs that behavior at runtime, not just type compatibility.
2. The behavior belongs to a router/backend control plane, not a desktop app workflow.
3. Reintroducing it is cheaper and cleaner than extracting the needed subset into
   `cc-switch-shared` or daemon-owned code.

If only part of a removed component is needed again, prefer extracting the small
shared subset instead of restoring the full desktop module.
