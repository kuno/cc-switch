# OpenWrt Phase 10 Page-Style Manual Verification

Use this checklist on a real router after the Phase 10 package is installed.

## Preconditions

- The LuCI settings page loads from `openwrt/luci-app-ccswitch/htdocs/luci-static/resources/view/ccswitch/settings.js`.
- The shared OpenWrt bundle and stylesheet load from `/luci-static/resources/ccswitch/provider-ui/ccswitch-provider-ui.js` and `/luci-static/resources/ccswitch/provider-ui/ccswitch-provider-ui.css`.
- Verify at a normal desktop browser width where the whole page can be reviewed top-to-bottom in one pass.

## Checks

1. Load the page fresh and confirm the service controls, outbound proxy controls, logging, runtime surface, and provider manager read as one CC Switch page instead of a LuCI-looking top section with a desktop-looking lower section.
2. Compare the top LuCI-owned sections against the runtime and provider surfaces and confirm spacing, headings, borders, and section rhythm feel aligned rather than split into two card languages.
3. Confirm no desktop-only shell metaphors appear anywhere on the page: no fake title bar, fake window chrome, fake sidebar navigation, fake dock, fake taskbar, or fake tray affordances.
4. Confirm the LuCI shell still owns service status and restart behavior: the restart action remains in the LuCI page chrome, shared surfaces do not add their own restart button, and restart-required messaging still points back to LuCI.
5. Exercise at least one provider save or activation flow while the service is running and confirm the page keeps the unified layout while the LuCI shell continues to own restart/status messaging.
6. Reload the page and confirm the same unified full-page presentation returns without transient mixed-language styling or a lower “embedded app” look.
