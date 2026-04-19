import type { SharedProviderAppId } from "@/shared/providers/domain";
import type { SharedRuntimeAppStatus, SharedRuntimeStatusView } from "./domain";
import type { RuntimeSurfacePlatformAdapter } from "./SharedRuntimeSurface";

export const OPENWRT_RUNTIME_APP_IDS = [
  "claude",
  "codex",
  "gemini",
] as const satisfies readonly SharedProviderAppId[];

export interface RuntimePlatformAdapter extends RuntimeSurfacePlatformAdapter {
  getAppRuntimeStatus(
    appId: SharedProviderAppId,
  ): Promise<SharedRuntimeAppStatus>;
  getRuntimeSurface(): Promise<SharedRuntimeStatusView>;
}
