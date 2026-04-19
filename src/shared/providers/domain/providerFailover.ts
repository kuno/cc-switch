import type {
  SharedProviderFailoverQueueEntry,
  SharedProviderFailoverState,
  SharedProviderHealth,
} from "./types";

type ValueMap = Record<string, unknown>;

function getString(value: ValueMap, keys: string[]): string {
  for (const key of keys) {
    const candidate = value[key];
    if (typeof candidate === "string") {
      return candidate;
    }
  }

  return "";
}

function getOptionalString(value: ValueMap, keys: string[]): string | null {
  for (const key of keys) {
    const candidate = value[key];
    if (typeof candidate === "string") {
      return candidate;
    }
  }

  return null;
}

function getNumber(value: ValueMap, keys: string[]): number {
  for (const key of keys) {
    const candidate = value[key];
    if (typeof candidate === "number" && Number.isFinite(candidate)) {
      return candidate;
    }
  }

  return 0;
}

function getOptionalNumber(value: ValueMap, keys: string[]): number | null {
  for (const key of keys) {
    const candidate = value[key];
    if (typeof candidate === "number" && Number.isFinite(candidate)) {
      return candidate;
    }
  }

  return null;
}

function getBoolean(value: ValueMap, keys: string[]): boolean {
  return keys.some((key) => Boolean(value[key]));
}

function parseHealth(
  value: unknown,
  fallbackProviderId: string,
): SharedProviderHealth {
  if (!value || typeof value !== "object") {
    return {
      providerId: fallbackProviderId,
      observed: false,
      healthy: true,
      consecutiveFailures: 0,
      lastSuccessAt: null,
      lastFailureAt: null,
      lastError: null,
      updatedAt: null,
    };
  }

  const typedValue = value as ValueMap;

  return {
    providerId:
      getString(typedValue, ["providerId", "provider_id"]) ||
      fallbackProviderId,
    observed: getBoolean(typedValue, ["observed"]),
    healthy: !typedValue.hasOwnProperty("healthy")
      ? true
      : getBoolean(typedValue, ["healthy"]),
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

function parseQueueEntry(value: unknown): SharedProviderFailoverQueueEntry | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const typedValue = value as ValueMap;
  const providerId = getString(typedValue, ["providerId", "provider_id"]);

  if (!providerId) {
    return null;
  }

  return {
    providerId,
    providerName: getString(typedValue, ["providerName", "provider_name"]),
    sortIndex: getOptionalNumber(typedValue, ["sortIndex", "sort_index"]),
    active: getBoolean(typedValue, ["active"]),
    health: parseHealth(typedValue.health, providerId),
  };
}

export function emptySharedProviderFailoverState(
  providerId: string,
): SharedProviderFailoverState {
  return {
    providerId,
    proxyEnabled: false,
    autoFailoverEnabled: false,
    maxRetries: 0,
    activeProviderId: null,
    inFailoverQueue: false,
    queuePosition: null,
    sortIndex: null,
    providerHealth: parseHealth(null, providerId),
    failoverQueueDepth: 0,
    failoverQueue: [],
  };
}

export function parseSharedProviderFailoverState(
  payload: unknown,
  fallbackProviderId: string,
): SharedProviderFailoverState {
  if (!payload || typeof payload !== "object") {
    return emptySharedProviderFailoverState(fallbackProviderId);
  }

  const typedValue = payload as ValueMap;
  const queue = Array.isArray(typedValue.failoverQueue)
    ? typedValue.failoverQueue
        .map((entry) => parseQueueEntry(entry))
        .filter(
          (entry): entry is SharedProviderFailoverQueueEntry => entry != null,
        )
    : [];
  const providerId =
    getString(typedValue, ["providerId", "provider_id"]) || fallbackProviderId;

  return {
    providerId,
    proxyEnabled: getBoolean(typedValue, ["proxyEnabled", "proxy_enabled"]),
    autoFailoverEnabled: getBoolean(typedValue, [
      "autoFailoverEnabled",
      "auto_failover_enabled",
    ]),
    maxRetries: getNumber(typedValue, ["maxRetries", "max_retries"]),
    activeProviderId:
      getOptionalString(typedValue, ["activeProviderId", "active_provider_id"]) ??
      null,
    inFailoverQueue: getBoolean(typedValue, [
      "inFailoverQueue",
      "in_failover_queue",
    ]),
    queuePosition: getOptionalNumber(typedValue, [
      "queuePosition",
      "queue_position",
    ]),
    sortIndex: getOptionalNumber(typedValue, ["sortIndex", "sort_index"]),
    providerHealth: parseHealth(typedValue.providerHealth, providerId),
    failoverQueueDepth:
      getNumber(typedValue, ["failoverQueueDepth", "failover_queue_depth"]) ||
      queue.length,
    failoverQueue: queue,
  };
}
