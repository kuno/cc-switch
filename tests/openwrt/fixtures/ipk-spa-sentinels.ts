/**
 * Update these sentinels whenever ProviderPlatformAdapter grows a new
 * bundle-critical identifier or the OpenWrt SPA picks up a selector that must
 * survive end-to-end IPK packaging. The list stays intentionally small so a
 * stale bundle is obvious.
 */
export const OPENWRT_IPK_SPA_JS_SENTINELS = [
  "__CCSWITCH_OPENWRT_SHARED_PROVIDER_UI__",
  "mountPage",
  "mountRuntimeSurface",
  "uploadClaudeAuth",
  "removeClaudeAuth",
] as const;

export const OPENWRT_IPK_SPA_CSS_SENTINELS = [
  "body.ccswitch-openwrt-provider-ui-theme",
  ".ccswitch-openwrt-provider-ui-positioner",
  ".ccswitch-openwrt-provider-ui-dialog--compact",
  "#ccswitch-openwrt-native-page-root.ccswitch-openwrt-native-page-host",
] as const;
