import type {
  SharedProviderAppId,
  SharedProviderView,
} from "@/shared/providers/domain";

export type SharedRuntimeAppId = SharedProviderAppId;

export interface SharedRuntimeServiceStatus {
  running: boolean;
  reachable: boolean;
  listenAddress: string;
  listenPort: number;
  proxyEnabled: boolean;
  enableLogging: boolean;
  statusSource: string;
  statusError: string | null;
}

export interface SharedRuntimeActiveTarget {
  appType: SharedRuntimeAppId;
  providerName: string;
  providerId: string;
}

export interface SharedRuntimeProxyStatus {
  running: boolean;
  address: string;
  port: number;
  activeConnections: number;
  totalRequests: number;
  successRequests: number;
  failedRequests: number;
  successRate: number;
  uptimeSeconds: number;
  currentProvider: string | null;
  currentProviderId: string | null;
  lastRequestAt: string | null;
  lastError: string | null;
  failoverCount: number;
  activeTargets: SharedRuntimeActiveTarget[];
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

export interface SharedRuntimeFailoverQueueEntry {
  providerId: string;
  providerName: string;
  sortIndex: number | null;
  active: boolean;
  health: SharedRuntimeProviderHealth;
}

export interface SharedRuntimeAppStatus {
  app: SharedRuntimeAppId;
  providerCount: number;
  proxyEnabled: boolean;
  autoFailoverEnabled: boolean;
  maxRetries: number;
  activeProviderId: string | null;
  activeProvider: SharedProviderView;
  activeProviderHealth: SharedRuntimeProviderHealth | null;
  usingLegacyDefault: boolean;
  failoverQueueDepth: number;
  failoverQueue: SharedRuntimeFailoverQueueEntry[];
  observedProviderCount: number;
  healthyProviderCount: number;
  unhealthyProviderCount: number;
}

export interface SharedRuntimeStatusView {
  service: SharedRuntimeServiceStatus;
  runtime: SharedRuntimeProxyStatus;
  apps: SharedRuntimeAppStatus[];
}
