import type { SharedRuntimeAppId, SharedRuntimeAppStatus, SharedRuntimeStatusView } from "./domain";

export const OPENWRT_RUNTIME_APP_IDS = [
  "claude",
  "codex",
  "gemini",
] as const satisfies readonly SharedRuntimeAppId[];

export interface SharedRuntimeFailoverProviderOption {
  providerId: string;
  providerName: string;
  model: string;
}

export interface RuntimeSurfacePlatformAdapter {
  getRuntimeSurface(): Promise<SharedRuntimeStatusView>;
  getAvailableFailoverProviders?(
    appId: SharedRuntimeAppId,
  ): Promise<SharedRuntimeFailoverProviderOption[]>;
  addToFailoverQueue?(
    appId: SharedRuntimeAppId,
    providerId: string,
  ): Promise<void>;
  removeFromFailoverQueue?(
    appId: SharedRuntimeAppId,
    providerId: string,
  ): Promise<void>;
  setAutoFailoverEnabled?(
    appId: SharedRuntimeAppId,
    enabled: boolean,
  ): Promise<void>;
}

export type RuntimeSurfaceFailoverControlAdapter = Required<
  Pick<
    RuntimeSurfacePlatformAdapter,
    | "getAvailableFailoverProviders"
    | "addToFailoverQueue"
    | "removeFromFailoverQueue"
    | "setAutoFailoverEnabled"
  >
>;

export function supportsRuntimeFailoverControls(
  adapter: RuntimeSurfacePlatformAdapter,
): adapter is RuntimeSurfacePlatformAdapter &
  RuntimeSurfaceFailoverControlAdapter {
  return (
    typeof adapter.getAvailableFailoverProviders === "function" &&
    typeof adapter.addToFailoverQueue === "function" &&
    typeof adapter.removeFromFailoverQueue === "function" &&
    typeof adapter.setAutoFailoverEnabled === "function"
  );
}

export interface RuntimePlatformAdapter extends RuntimeSurfacePlatformAdapter {
  getAppRuntimeStatus(
    appId: SharedRuntimeAppId,
  ): Promise<SharedRuntimeAppStatus>;
}
