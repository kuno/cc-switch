import type { SharedProviderAppId } from "@/shared/providers/domain";
import {
  emptySharedProviderView,
  normalizeSharedProviderView,
} from "@/shared/providers/domain";
import {
  type SharedRuntimeAppStatus,
  type SharedRuntimeFailoverQueueEntry,
  type SharedRuntimeProviderHealth,
  type SharedRuntimeProxyStatus,
  type SharedRuntimeServiceStatus,
  type SharedRuntimeStatusView,
} from "@/shared/runtime/domain";
import {
  OPENWRT_RUNTIME_APP_IDS,
  type RuntimePlatformAdapter,
} from "@/shared/runtime/types";
import type { OpenWrtRuntimeRpcResult, OpenWrtRuntimeTransport } from "./types";

type RuntimeLike = Record<string, unknown>;

const EMPTY_PROXY_STATUS: SharedRuntimeProxyStatus = {
  running: false,
  address: "",
  port: 0,
  activeConnections: 0,
  totalRequests: 0,
  successRequests: 0,
  failedRequests: 0,
  successRate: 0,
  uptimeSeconds: 0,
  currentProvider: null,
  currentProviderId: null,
  lastRequestAt: null,
  lastError: null,
  failoverCount: 0,
  activeTargets: [],
};

function isRpcSuccess(result: OpenWrtRuntimeRpcResult | null | undefined): boolean {
  return result?.ok === true;
}

function rpcFailureMessage(
  failure: OpenWrtRuntimeRpcResult | string | Error | null | undefined,
): string | null {
  if (failure == null) {
    return null;
  }

  if (typeof failure === "string") {
    return failure;
  }

  if (failure instanceof Error) {
    return failure.message;
  }

  if (failure.message) {
    return failure.message;
  }

  if (failure.error) {
    return failure.error;
  }

  try {
    return JSON.stringify(failure);
  } catch {
    return String(failure);
  }
}

function parsePayload(
  response: OpenWrtRuntimeRpcResult | null | undefined,
): RuntimeLike | null {
  if (!response) {
    return null;
  }

  if (typeof response.status_json === "string") {
    try {
      return JSON.parse(response.status_json) as RuntimeLike;
    } catch {
      return null;
    }
  }

  if (
    response.service != null ||
    response.runtime != null ||
    response.apps != null ||
    response.app != null
  ) {
    return response as RuntimeLike;
  }

  return null;
}

function getString(value: RuntimeLike, keys: string[]): string {
  for (const key of keys) {
    const candidate = value[key];
    if (typeof candidate === "string") {
      return candidate;
    }
  }

  return "";
}

function getNumber(value: RuntimeLike, keys: string[]): number {
  for (const key of keys) {
    const candidate = value[key];
    if (typeof candidate === "number" && Number.isFinite(candidate)) {
      return candidate;
    }
  }

  return 0;
}

function getOptionalNumber(value: RuntimeLike, keys: string[]): number | null {
  for (const key of keys) {
    const candidate = value[key];
    if (typeof candidate === "number" && Number.isFinite(candidate)) {
      return candidate;
    }
  }

  return null;
}

function getBoolean(value: RuntimeLike, keys: string[]): boolean {
  return keys.some((key) => Boolean(value[key]));
}

function getOptionalString(value: RuntimeLike, keys: string[]): string | null {
  for (const key of keys) {
    const candidate = value[key];
    if (typeof candidate === "string") {
      return candidate;
    }
  }

  return null;
}

function normalizeHealth(
  value: unknown,
  fallbackProviderId: string | null,
): SharedRuntimeProviderHealth | null {
  if (!value || typeof value !== "object") {
    return fallbackProviderId
      ? {
          providerId: fallbackProviderId,
          observed: false,
          healthy: false,
          consecutiveFailures: 0,
          lastSuccessAt: null,
          lastFailureAt: null,
          lastError: null,
          updatedAt: null,
        }
      : null;
  }

  const typedValue = value as RuntimeLike;

  return {
    providerId:
      getString(typedValue, ["providerId", "provider_id"]) || fallbackProviderId || "",
    observed: getBoolean(typedValue, ["observed"]),
    healthy: getBoolean(typedValue, ["healthy"]),
    consecutiveFailures: getNumber(typedValue, [
      "consecutiveFailures",
      "consecutive_failures",
    ]),
    lastSuccessAt: getOptionalString(typedValue, [
      "lastSuccessAt",
      "last_success_at",
    ]),
    lastFailureAt: getOptionalString(typedValue, [
      "lastFailureAt",
      "last_failure_at",
    ]),
    lastError: getOptionalString(typedValue, ["lastError", "last_error"]),
    updatedAt: getOptionalString(typedValue, ["updatedAt", "updated_at"]),
  };
}

function normalizeQueueEntry(value: unknown): SharedRuntimeFailoverQueueEntry | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const typedValue = value as RuntimeLike;
  const providerId = getString(typedValue, ["providerId", "provider_id"]);

  if (!providerId) {
    return null;
  }

  return {
    providerId,
    providerName: getString(typedValue, ["providerName", "provider_name"]),
    sortIndex: getOptionalNumber(typedValue, ["sortIndex", "sort_index"]),
    active: getBoolean(typedValue, ["active"]),
    health:
      normalizeHealth(typedValue.health, providerId) ?? {
        providerId,
        observed: false,
        healthy: false,
        consecutiveFailures: 0,
        lastSuccessAt: null,
        lastFailureAt: null,
        lastError: null,
        updatedAt: null,
      },
  };
}

function normalizeProxyStatus(value: unknown): SharedRuntimeProxyStatus {
  if (!value || typeof value !== "object") {
    return EMPTY_PROXY_STATUS;
  }

  const typedValue = value as RuntimeLike;

  return {
    running: getBoolean(typedValue, ["running"]),
    address: getString(typedValue, ["address"]),
    port: getNumber(typedValue, ["port"]),
    activeConnections: getNumber(typedValue, ["active_connections"]),
    totalRequests: getNumber(typedValue, ["total_requests"]),
    successRequests: getNumber(typedValue, ["success_requests"]),
    failedRequests: getNumber(typedValue, ["failed_requests"]),
    successRate: getNumber(typedValue, ["success_rate"]),
    uptimeSeconds: getNumber(typedValue, ["uptime_seconds"]),
    currentProvider: getOptionalString(typedValue, ["current_provider"]),
    currentProviderId: getOptionalString(typedValue, ["current_provider_id"]),
    lastRequestAt: getOptionalString(typedValue, ["last_request_at"]),
    lastError: getOptionalString(typedValue, ["last_error"]),
    failoverCount: getNumber(typedValue, ["failover_count"]),
    activeTargets: Array.isArray(typedValue.active_targets)
      ? typedValue.active_targets.map((entry) => ({
          appType: getString(entry as RuntimeLike, ["app_type"]) as SharedProviderAppId,
          providerName: getString(entry as RuntimeLike, ["provider_name"]),
          providerId: getString(entry as RuntimeLike, ["provider_id"]),
        }))
      : [],
  };
}

function emptyAppStatus(appId: SharedProviderAppId): SharedRuntimeAppStatus {
  return {
    app: appId,
    providerCount: 0,
    proxyEnabled: false,
    autoFailoverEnabled: false,
    maxRetries: 0,
    activeProviderId: null,
    activeProvider: emptySharedProviderView(appId),
    activeProviderHealth: null,
    usingLegacyDefault: false,
    failoverQueueDepth: 0,
    failoverQueue: [],
    observedProviderCount: 0,
    healthyProviderCount: 0,
    unhealthyProviderCount: 0,
  };
}

function normalizeAppStatus(
  appId: SharedProviderAppId,
  value: unknown,
): SharedRuntimeAppStatus {
  if (!value || typeof value !== "object") {
    return emptyAppStatus(appId);
  }

  const typedValue = value as RuntimeLike;
  const activeProviderId =
    getOptionalString(typedValue, ["activeProviderId", "active_provider_id"]) ??
    null;
  const queue = Array.isArray(typedValue.failoverQueue)
    ? typedValue.failoverQueue
        .map((entry) => normalizeQueueEntry(entry))
        .filter(function (
          entry,
        ): entry is SharedRuntimeFailoverQueueEntry {
          return entry != null;
        })
    : [];

  return {
    app: appId,
    providerCount: getNumber(typedValue, ["providerCount", "provider_count"]),
    proxyEnabled: getBoolean(typedValue, ["proxyEnabled", "proxy_enabled"]),
    autoFailoverEnabled: getBoolean(typedValue, [
      "autoFailoverEnabled",
      "auto_failover_enabled",
    ]),
    maxRetries: getNumber(typedValue, ["maxRetries", "max_retries"]),
    activeProviderId,
    activeProvider: normalizeSharedProviderView(
      (typedValue.activeProvider as RuntimeLike | undefined) ?? null,
      activeProviderId,
      activeProviderId,
      appId,
    ),
    activeProviderHealth: normalizeHealth(
      typedValue.activeProviderHealth,
      activeProviderId,
    ),
    usingLegacyDefault: getBoolean(typedValue, [
      "usingLegacyDefault",
      "using_legacy_default",
    ]),
    failoverQueueDepth:
      getNumber(typedValue, ["failoverQueueDepth", "failover_queue_depth"]) ||
      queue.length,
    failoverQueue: queue,
    observedProviderCount: getNumber(typedValue, [
      "observedProviderCount",
      "observed_provider_count",
    ]),
    healthyProviderCount: getNumber(typedValue, [
      "healthyProviderCount",
      "healthy_provider_count",
    ]),
    unhealthyProviderCount: getNumber(typedValue, [
      "unhealthyProviderCount",
      "unhealthy_provider_count",
    ]),
  };
}

function normalizeServiceStatus(value: unknown): SharedRuntimeServiceStatus {
  if (!value || typeof value !== "object") {
    return {
      running: false,
      reachable: false,
      listenAddress: "",
      listenPort: 0,
      proxyEnabled: false,
      enableLogging: false,
      statusSource: "config-fallback",
      statusError: null,
    };
  }

  const typedValue = value as RuntimeLike;

  return {
    running: getBoolean(typedValue, ["running"]),
    reachable: getBoolean(typedValue, ["reachable"]),
    listenAddress: getString(typedValue, ["listenAddress", "listen_address"]),
    listenPort: getNumber(typedValue, ["listenPort", "listen_port"]),
    proxyEnabled: getBoolean(typedValue, ["proxyEnabled", "proxy_enabled"]),
    enableLogging: getBoolean(typedValue, ["enableLogging", "enable_logging"]),
    statusSource:
      getString(typedValue, ["statusSource", "status_source"]) ||
      "config-fallback",
    statusError: getOptionalString(typedValue, ["statusError", "status_error"]),
  };
}

async function loadAppRuntimeStatus(
  transport: OpenWrtRuntimeTransport,
  appId: SharedProviderAppId,
): Promise<SharedRuntimeAppStatus> {
  const response = await transport.getAppRuntimeStatus(appId);

  if (!isRpcSuccess(response)) {
    throw new Error(
      rpcFailureMessage(response) ?? `Failed to load ${appId} runtime status.`,
    );
  }

  const payload = parsePayload(response);
  return normalizeAppStatus(appId, payload);
}

export function createOpenWrtRuntimeAdapter(
  transport: OpenWrtRuntimeTransport,
): RuntimePlatformAdapter {
  return {
    async getAppRuntimeStatus(appId) {
      return loadAppRuntimeStatus(transport, appId);
    },
    async getRuntimeSurface() {
      const response = await transport.getRuntimeStatus();

      if (!isRpcSuccess(response)) {
        throw new Error(
          rpcFailureMessage(response) ?? "Failed to load OpenWrt runtime status.",
        );
      }

      const payload = parsePayload(response);
      if (!payload) {
        throw new Error("OpenWrt runtime status payload was empty.");
      }

      const service = normalizeServiceStatus(payload.service);
      const runtime = normalizeProxyStatus(payload.runtime);

      const baseApps = new Map<SharedProviderAppId, SharedRuntimeAppStatus>();
      if (Array.isArray(payload.apps)) {
        for (const entry of payload.apps) {
          if (!entry || typeof entry !== "object") {
            continue;
          }

          const typedEntry = entry as RuntimeLike;
          const appId = getString(typedEntry, ["app"]) as SharedProviderAppId;

          if (
            appId === "claude" ||
            appId === "codex" ||
            appId === "gemini"
          ) {
            baseApps.set(appId, normalizeAppStatus(appId, typedEntry));
          }
        }
      }

      const appResponses = await Promise.allSettled(
        OPENWRT_RUNTIME_APP_IDS.map((appId) => transport.getAppRuntimeStatus(appId)),
      );
      const apps = OPENWRT_RUNTIME_APP_IDS.map((appId, index) => {
        const result = appResponses[index];

        if (result?.status === "fulfilled" && isRpcSuccess(result.value)) {
          const payload = parsePayload(result.value);
          return normalizeAppStatus(appId, payload);
        }

        return baseApps.get(appId) ?? emptyAppStatus(appId);
      });

      return {
        service,
        runtime,
        apps,
      } satisfies SharedRuntimeStatusView;
    },
  };
}

export const __private__ = {
  isRpcSuccess,
  normalizeAppStatus,
  normalizeHealth,
  normalizeProxyStatus,
  normalizeQueueEntry,
  normalizeServiceStatus,
  parsePayload,
  rpcFailureMessage,
};
