# OpenWrt Phase 8 Runtime-Control Manual Verification

Use this on a real router after the Phase 8 build is installed.

## Preconditions

- At least two saved providers exist for one app (`claude`, `codex`, or `gemini`).
- The LuCI settings page loads the shared runtime surface above the provider manager.

## Checks

1. Confirm the runtime card now shows the Phase 8 failover controls on the real router path.
2. Add a saved provider to the queue and confirm the card refreshes with the provider listed in both the controls section and queue preview.
3. Remove a queued provider and confirm it disappears from the queue but remains saved in the provider manager.
4. Enable auto-failover and confirm the card refreshes to the enabled state without changing the active provider directly.
5. Disable auto-failover and confirm the queue membership remains intact after refresh.
6. Force a failing mutation and confirm the card keeps the last good snapshot visible while showing an inline error.
7. Restart the service from the LuCI shell and confirm the runtime controls still reflect the persisted router state after the next refresh.
