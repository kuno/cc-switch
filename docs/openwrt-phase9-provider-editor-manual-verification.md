# OpenWrt Phase 9 Provider-Editor Manual Verification

Use this checklist on a real router after the Phase 9 package is installed.

## Preconditions

- The LuCI settings page loads the shared provider manager from `/luci-static/resources/ccswitch/provider-ui/ccswitch-provider-ui.js`.
- The stylesheet at `/luci-static/resources/ccswitch/provider-ui/ccswitch-provider-ui.css` is present and the editor panel renders with the grouped preset rail and grouped form sections.
- At least one restart-capable service instance is available so restart-required messaging can be verified.

## Checks

1. Open the provider manager for `claude`, `codex`, and `gemini` and confirm the add/edit panel shows grouped preset browsing plus the `Identity`, `Endpoint & auth`, and `Notes` form sections.
2. In the add flow, switch between at least two presets for an app and confirm the draft updates provider name, base URL, token field, and default model without saving immediately.
3. Switch back to the custom draft option and confirm the current field values stay editable instead of being reset unexpectedly.
4. Save a new provider from a preset and confirm the provider card shows the expected preset-aligned endpoint, stored-secret state, and restart-required notice when the service is running.
5. Edit an existing provider that already has a stored secret, leave the token blank, save, and confirm the existing secret is preserved rather than cleared.
6. Edit a provider without a stored secret and confirm the blank-secret helper copy does not incorrectly claim that a secret will be preserved.
7. Activate a different saved provider and confirm the LuCI shell messaging stays accurate: activation succeeds, restart-required messaging only appears when the running service actually needs it, and no desktop-only controls appear inside the shared surface.
8. Delete a saved provider and confirm the card disappears, the active provider state refreshes correctly, and the shell message identifies the affected provider.
9. Reload the LuCI page and confirm the shared bundle remounts from the fixed bundle path, the stylesheet still applies, and the selected app tab remains stable.
