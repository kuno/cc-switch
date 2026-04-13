import type { SharedProviderAppId, SharedProviderView } from "@/shared/providers/domain";
import type { ProxyStatus } from "@/types/proxy";

export const OPENWRT_RUNTIME_APP_IDS = [
  "claude",
  "codex",
  "gemini",
] as const satisfies readonly SharedProviderAppId[];

export interface SharedRuntimeProviderHealth {
  providerId: string;
  observed: boolean;
  healthy: boolean;
  consecutiveFailures: number;
  lastSuccessAt: string | null;
  lastFailureAt: string | null;
  lastError: string | null;
  updatedAt: string | null;
}

export interface SharedRuntimeQueueEntry {
  providerId: string;
  providerName: string;
  sortIndex: number | null;
  active: boolean;
  health: SharedRuntimeProviderHealth;
}

export interface SharedRuntimeAppStatus {
  appId: SharedProviderAppId;
  providerCount: number;
  proxyEnabled: boolean;
  autoFailoverEnabled: boolean;
  maxRetries: number;
  activeProviderId: string | null;
  activeProvider: SharedProviderView;
  activeProviderHealth: SharedRuntimeProviderHealth | null;
  usingLegacyDefault: boolean;
  failoverQueueDepth: number;
  failoverQueue: SharedRuntimeQueueEntry[];
  observedProviderCount: number;
  healthyProviderCount: number;
  unhealthyProviderCount: number;
}

export interface SharedRuntimeServiceStatus {
  running: boolean;
  reachable: boolean;
  listenAddress: string;
  listenPort: number;
  proxyEnabled: boolean;
  enableLogging: boolean;
  statusSource: string;
  statusError: string | null;
  runtime: ProxyStatus;
}

export interface SharedRuntimeSurfaceState {
  service: SharedRuntimeServiceStatus;
  apps: SharedRuntimeAppStatus[];
}

export interface RuntimePlatformAdapter {
  getRuntimeSurface(): Promise<SharedRuntimeSurfaceState>;
  getAppRuntimeStatus(
    appId: SharedProviderAppId,
  ): Promise<SharedRuntimeAppStatus>;
}
