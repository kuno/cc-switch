import type { SharedProviderAppId } from "@/shared/providers/domain";

export type SharedRuntimeAppId = SharedProviderAppId;

export const SHARED_RUNTIME_APP_IDS: SharedRuntimeAppId[] = [
  "claude",
  "codex",
  "gemini",
];

export interface SharedRuntimeProviderSummary {
  configured: boolean;
  providerId: string | null;
  name: string;
  model: string;
  active: boolean;
}

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

export interface SharedRuntimeAppView {
  appId: SharedRuntimeAppId;
  providerCount: number;
  proxyEnabled: boolean;
  autoFailoverEnabled: boolean;
  maxRetries: number;
  activeProviderId: string | null;
  activeProvider: SharedRuntimeProviderSummary;
  activeProviderHealth: SharedRuntimeProviderHealth | null;
  usingLegacyDefault: boolean;
  failoverQueueDepth: number;
  failoverQueue: SharedRuntimeQueueEntry[];
  observedProviderCount: number;
  healthyProviderCount: number;
  unhealthyProviderCount: number;
}

export interface SharedRuntimeServiceView {
  running: boolean;
  reachable: boolean;
  listenAddress: string;
  listenPort: number | null;
  proxyEnabled: boolean;
  enableLogging: boolean;
  statusSource: string;
  statusError: string | null;
  activeConnections: number | null;
  totalRequests: number | null;
  successRequests: number | null;
  failedRequests: number | null;
  successRate: number | null;
  uptimeSeconds: number | null;
  failoverCount: number | null;
  currentProviderName: string | null;
  currentProviderId: string | null;
}

export interface SharedRuntimeState {
  service: SharedRuntimeServiceView;
  apps: SharedRuntimeAppView[];
}

export function emptySharedRuntimeProvider(): SharedRuntimeProviderSummary {
  return {
    configured: false,
    providerId: null,
    name: "",
    model: "",
    active: false,
  };
}

export function emptySharedRuntimeHealth(
  providerId = "",
): SharedRuntimeProviderHealth {
  return {
    providerId,
    observed: false,
    healthy: false,
    consecutiveFailures: 0,
    lastSuccessAt: null,
    lastFailureAt: null,
    lastError: null,
    updatedAt: null,
  };
}

export function emptySharedRuntimeAppView(
  appId: SharedRuntimeAppId,
): SharedRuntimeAppView {
  return {
    appId,
    providerCount: 0,
    proxyEnabled: false,
    autoFailoverEnabled: false,
    maxRetries: 0,
    activeProviderId: null,
    activeProvider: emptySharedRuntimeProvider(),
    activeProviderHealth: null,
    usingLegacyDefault: false,
    failoverQueueDepth: 0,
    failoverQueue: [],
    observedProviderCount: 0,
    healthyProviderCount: 0,
    unhealthyProviderCount: 0,
  };
}

export function emptySharedRuntimeServiceView(): SharedRuntimeServiceView {
  return {
    running: false,
    reachable: false,
    listenAddress: "",
    listenPort: null,
    proxyEnabled: false,
    enableLogging: false,
    statusSource: "config-fallback",
    statusError: null,
    activeConnections: null,
    totalRequests: null,
    successRequests: null,
    failedRequests: null,
    successRate: null,
    uptimeSeconds: null,
    failoverCount: null,
    currentProviderName: null,
    currentProviderId: null,
  };
}

export function normalizeSharedRuntimeState(
  state: SharedRuntimeState,
): SharedRuntimeState {
  const appMap = new Map(
    state.apps.map((app) => [app.appId, app] satisfies [SharedRuntimeAppId, SharedRuntimeAppView]),
  );

  return {
    service: state.service,
    apps: SHARED_RUNTIME_APP_IDS.map(
      (appId) => appMap.get(appId) ?? emptySharedRuntimeAppView(appId),
    ),
  };
}
