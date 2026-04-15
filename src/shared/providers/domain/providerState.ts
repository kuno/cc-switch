import type {
  SharedProviderAppId,
  SharedProviderEditorPayload,
  SharedProviderState,
  SharedProviderTokenField,
  SharedProviderView,
} from "./types";

type ProviderLike = Record<string, unknown>;

const DEFAULT_TOKEN_FIELD_BY_APP: Record<
  SharedProviderAppId,
  SharedProviderTokenField
> = {
  claude: "ANTHROPIC_AUTH_TOKEN",
  codex: "OPENAI_API_KEY",
  gemini: "GEMINI_API_KEY",
};

function getBoolean(provider: ProviderLike, keys: string[]): boolean {
  return keys.some((key) => Boolean(provider[key]));
}

function getString(provider: ProviderLike, keys: string[]): string {
  for (const key of keys) {
    const value = provider[key];
    if (typeof value === "string") {
      return value;
    }
  }

  return "";
}

export function emptySharedProviderView(
  appId: SharedProviderAppId,
): SharedProviderView {
  return {
    configured: false,
    providerId: null,
    name: "",
    baseUrl: "",
    tokenField: DEFAULT_TOKEN_FIELD_BY_APP[appId],
    tokenConfigured: false,
    tokenMasked: "",
    model: "",
    notes: "",
    active: false,
  };
}

export function emptySharedProviderEditorPayload(
  appId: SharedProviderAppId,
): SharedProviderEditorPayload {
  return {
    name: "",
    baseUrl: "",
    tokenField: DEFAULT_TOKEN_FIELD_BY_APP[appId],
    token: "",
    model: "",
    notes: "",
  };
}

export function normalizeSharedProviderView(
  provider: ProviderLike | null | undefined,
  fallbackId: string | null,
  activeProviderId: string | null,
  appId: SharedProviderAppId,
): SharedProviderView {
  const normalized = emptySharedProviderView(appId);

  if (!provider || typeof provider !== "object") {
    return normalized;
  }

  const providerId =
    getString(provider, ["providerId", "provider_id", "id"]) || fallbackId;
  const isActive = Boolean(
    provider.active ||
      provider.isActive ||
      provider.is_current ||
      (activeProviderId && providerId && activeProviderId === providerId),
  );

  return {
    configured:
      provider.configured !== false &&
      Boolean(
        providerId ||
          provider.name ||
          provider.baseUrl ||
          provider.base_url ||
          provider.tokenConfigured ||
          provider.token_configured ||
          provider.tokenMasked ||
          provider.token_masked,
      ),
    providerId,
    name: getString(provider, ["name"]),
    baseUrl: getString(provider, ["baseUrl", "base_url"]),
    tokenField:
      (getString(provider, [
        "tokenField",
        "token_field",
      ]) as SharedProviderTokenField) || DEFAULT_TOKEN_FIELD_BY_APP[appId],
    tokenConfigured: getBoolean(provider, [
      "tokenConfigured",
      "token_configured",
    ]),
    tokenMasked: getString(provider, ["tokenMasked", "token_masked"]),
    model: getString(provider, ["model"]),
    notes: getString(provider, ["notes"]),
    active: isActive,
    authMode: getString(provider, ["authMode", "auth_mode"]) || undefined,
  };
}

export function normalizeSharedProviderList(
  rawProviders: unknown,
  activeProviderId: string | null,
  appId: SharedProviderAppId,
): SharedProviderView[] {
  const list: SharedProviderView[] = [];

  if (Array.isArray(rawProviders)) {
    rawProviders.forEach((provider, index) => {
      list.push(
        normalizeSharedProviderView(
          provider as ProviderLike,
          `provider-${index}`,
          activeProviderId,
          appId,
        ),
      );
    });
  } else if (rawProviders && typeof rawProviders === "object") {
    Object.entries(rawProviders as Record<string, unknown>).forEach(
      ([id, provider]) => {
        list.push(
          normalizeSharedProviderView(
            provider as ProviderLike,
            id,
            activeProviderId,
            appId,
          ),
        );
      },
    );
  }

  return list.filter((provider) => provider.configured);
}

function extractPhase2ListPayload(response: ProviderLike | null): unknown {
  const directKeys = ["providers", "items", "savedProviders", "providerMap"];

  if (!response) {
    return null;
  }

  if (Array.isArray(response)) {
    return response;
  }

  for (const key of directKeys) {
    if (response[key] != null) {
      return response;
    }
  }

  return null;
}

function extractRawProviders(payload: unknown): unknown {
  const metaKeys = new Set([
    "activeProviderId",
    "active_provider_id",
    "currentProviderId",
    "current_provider_id",
  ]);

  if (Array.isArray(payload)) {
    return payload;
  }

  if (!payload || typeof payload !== "object") {
    return {};
  }

  const typedPayload = payload as Record<string, unknown>;

  if (typedPayload.providers != null) return typedPayload.providers;
  if (typedPayload.items != null) return typedPayload.items;
  if (typedPayload.savedProviders != null) return typedPayload.savedProviders;
  if (typedPayload.providerMap != null) return typedPayload.providerMap;

  const directMap: Record<string, unknown> = {};

  Object.keys(typedPayload).forEach((key) => {
    if (
      !metaKeys.has(key) &&
      typedPayload[key] &&
      typeof typedPayload[key] === "object"
    ) {
      directMap[key] = typedPayload[key];
    }
  });

  return directMap;
}

function findActiveProviderId(providers: SharedProviderView[]): string | null {
  return (
    providers.find((provider) => provider.active && provider.providerId)
      ?.providerId ?? null
  );
}

function matchProviderHint(
  providers: SharedProviderView[],
  providerHint: SharedProviderView,
): string | null {
  if (!providerHint.configured) {
    return null;
  }

  const byId = providers.find(
    (provider) =>
      providerHint.providerId &&
      provider.providerId === providerHint.providerId,
  );
  if (byId?.providerId) {
    return byId.providerId;
  }

  const byPayload = providers.find(
    (provider) =>
      provider.name === providerHint.name &&
      provider.baseUrl === providerHint.baseUrl,
  );

  return byPayload?.providerId ?? null;
}

function buildProviderState(
  providers: SharedProviderView[],
  activeProviderId: string | null,
  phase2Available: boolean,
  appId: SharedProviderAppId,
): SharedProviderState {
  let activeProvider = emptySharedProviderView(appId);

  const normalizedProviders = providers.map((provider) => {
    const isActive = Boolean(
      activeProviderId &&
        provider.providerId &&
        provider.providerId === activeProviderId,
    );
    const normalized = {
      ...provider,
      active: isActive,
    };
    if (normalized.active) {
      activeProvider = normalized;
    }
    return normalized;
  });

  return {
    phase2Available,
    providers: normalizedProviders,
    activeProviderId,
    activeProvider,
  };
}

export function parseSharedProviderState(
  listResponse: ProviderLike | null,
  activeHint: SharedProviderView,
  appId: SharedProviderAppId,
): SharedProviderState | null {
  const payload = extractPhase2ListPayload(listResponse);

  if (!payload) {
    return null;
  }

  const typedPayload = payload as Record<string, unknown>;
  let activeProviderId =
    getString(typedPayload, [
      "activeProviderId",
      "active_provider_id",
      "currentProviderId",
      "current_provider_id",
    ]) ||
    getString(listResponse ?? {}, ["activeProviderId", "active_provider_id"]) ||
    null;

  const providers = normalizeSharedProviderList(
    extractRawProviders(payload),
    activeProviderId,
    appId,
  );

  if (!activeProviderId) {
    activeProviderId = findActiveProviderId(providers);
  }

  if (!activeProviderId) {
    activeProviderId = matchProviderHint(providers, activeHint);
  }

  return buildProviderState(providers, activeProviderId, true, appId);
}
