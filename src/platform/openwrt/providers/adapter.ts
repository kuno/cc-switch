import type {
  ProviderPlatformAdapter,
  SharedProviderAppId,
  SharedProviderCapabilities,
  SharedProviderEditorPayload,
  SharedProviderState,
  SharedProviderView,
} from "@/shared/providers/domain";
import {
  emptySharedProviderView,
  normalizeSharedProviderView,
  parseSharedProviderState,
} from "@/shared/providers/domain";
import type { OpenWrtProviderTransport, OpenWrtRpcResult } from "./types";

type RpcCandidate = {
  compatibilityFallback: boolean;
  call(): Promise<OpenWrtRpcResult | null | undefined>;
};

const DEFAULT_CAPABILITIES: SharedProviderCapabilities = {
  canAdd: true,
  canEdit: true,
  canDelete: true,
  canActivate: true,
  supportsPresets: true,
  supportsBlankSecretPreserve: true,
  requiresServiceRestart: true,
};

function isRpcSuccess(result: OpenWrtRpcResult | null | undefined): boolean {
  return result?.ok === true;
}

function rpcFailureMessage(
  failure: OpenWrtRpcResult | string | Error | null | undefined,
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

function isCompatibilityRpcFailure(
  failure: OpenWrtRpcResult | string | Error | null | undefined,
): boolean {
  const message = rpcFailureMessage(failure)?.toLowerCase();

  if (!message) {
    return true;
  }

  return (
    message.includes("method not found") ||
    message.includes("no such method") ||
    message.includes("unknown method") ||
    message.includes("invalid argument") ||
    message.includes("invalid arguments") ||
    message.includes("invalid params") ||
    message.includes("invalid parameters") ||
    message.includes("unknown argument") ||
    message.includes("unknown parameter") ||
    message.includes("unexpected argument") ||
    message.includes("unexpected parameter") ||
    message.includes("missing argument") ||
    message.includes("missing parameter") ||
    message.includes("argument mismatch") ||
    message.includes("parameter mismatch")
  );
}

async function invokeRpcCandidates(
  candidates: RpcCandidate[],
  missingMessage: string,
): Promise<OpenWrtRpcResult> {
  let lastCompatibilityFailure:
    | OpenWrtRpcResult
    | string
    | Error
    | null
    | undefined = null;

  for (const candidate of candidates) {
    try {
      const result = await candidate.call();

      if (isRpcSuccess(result)) {
        return result as OpenWrtRpcResult;
      }

      if (
        candidate.compatibilityFallback &&
        isCompatibilityRpcFailure(result)
      ) {
        lastCompatibilityFailure = result;
        continue;
      }

      throw new Error(rpcFailureMessage(result) ?? missingMessage);
    } catch (error) {
      if (
        candidate.compatibilityFallback &&
        isCompatibilityRpcFailure(error as Error)
      ) {
        lastCompatibilityFailure = error as Error;
        continue;
      }

      throw new Error(rpcFailureMessage(error as Error) ?? missingMessage);
    }
  }

  throw new Error(
    rpcFailureMessage(lastCompatibilityFailure) ?? missingMessage,
  );
}

function parseActiveProviderResponse(
  response: OpenWrtRpcResult | null,
  appId: SharedProviderAppId,
): SharedProviderView {
  let parsed: Record<string, unknown> | null = null;

  if (response?.ok === true && response.provider_json) {
    try {
      parsed = JSON.parse(response.provider_json) as Record<string, unknown>;
    } catch {
      parsed = null;
    }
  }

  if (!parsed && response?.provider) {
    parsed = response.provider;
  }

  if (!parsed) {
    return emptySharedProviderView(appId);
  }

  return normalizeSharedProviderView(parsed, null, null, appId);
}

function buildLegacyProviderState(
  provider: SharedProviderView,
  appId: SharedProviderAppId,
): SharedProviderState {
  const providers = provider.configured
    ? [
        {
          ...provider,
          active: true,
        },
      ]
    : [];
  const activeProvider = providers[0] ?? emptySharedProviderView(appId);

  return {
    phase2Available: false,
    providers,
    activeProviderId: activeProvider.providerId,
    activeProvider,
  };
}

async function loadProviderState(
  transport: OpenWrtProviderTransport,
  appId: SharedProviderAppId,
): Promise<SharedProviderState> {
  const [listResponse, savedResponse, activeResponse] = await Promise.all([
    transport.listProviders(appId),
    transport.listSavedProviders(appId),
    transport.getActiveProvider(appId),
  ]);
  const activeProvider = parseActiveProviderResponse(activeResponse, appId);

  const phase2State =
    parseSharedProviderState(listResponse, activeProvider, appId) ??
    parseSharedProviderState(savedResponse, activeProvider, appId);

  return phase2State ?? buildLegacyProviderState(activeProvider, appId);
}

async function invokePhase2Upsert(
  transport: OpenWrtProviderTransport,
  appId: SharedProviderAppId,
  provider: SharedProviderEditorPayload,
  providerId?: string,
): Promise<void> {
  if (providerId) {
    await invokeRpcCandidates(
      [
        {
          compatibilityFallback: true,
          call: () =>
            Promise.resolve(
              transport.upsertProviderByProviderId?.(
                appId,
                providerId,
                provider,
              ),
            ),
        },
        {
          compatibilityFallback: true,
          call: () =>
            Promise.resolve(
              transport.upsertProviderById?.(appId, providerId, provider),
            ),
        },
      ],
      "The Phase 2 provider save RPC is not available in this build.",
    );
    return;
  }

  try {
    await invokeRpcCandidates(
      [
        {
          compatibilityFallback: true,
          call: () =>
            Promise.resolve(transport.upsertProvider?.(appId, provider)),
        },
        {
          compatibilityFallback: true,
          call: () =>
            Promise.resolve(transport.saveProvider?.(appId, provider)),
        },
      ],
      "The Phase 2 provider save RPC is not available in this build.",
    );
  } catch (error) {
    if (
      !transport.upsertActiveProvider ||
      !isCompatibilityRpcFailure(error as Error)
    ) {
      throw error;
    }

    const result = await transport.upsertActiveProvider(appId, provider);
    if (!isRpcSuccess(result)) {
      throw new Error(
        rpcFailureMessage(result) ??
          "Failed to save provider via Phase 1 fallback.",
      );
    }
  }
}

async function invokePhase2Delete(
  transport: OpenWrtProviderTransport,
  appId: SharedProviderAppId,
  providerId: string,
): Promise<void> {
  await invokeRpcCandidates(
    [
      {
        compatibilityFallback: true,
        call: () =>
          Promise.resolve(
            transport.deleteProviderByProviderId?.(appId, providerId),
          ),
      },
      {
        compatibilityFallback: true,
        call: () =>
          Promise.resolve(transport.deleteProviderById?.(appId, providerId)),
      },
    ],
    "The Phase 2 provider delete RPC is not available in this build.",
  );
}

async function invokePhase2Activate(
  transport: OpenWrtProviderTransport,
  appId: SharedProviderAppId,
  providerId: string,
): Promise<void> {
  await invokeRpcCandidates(
    [
      {
        compatibilityFallback: true,
        call: () =>
          Promise.resolve(
            transport.activateProviderByProviderId?.(appId, providerId),
          ),
      },
      {
        compatibilityFallback: true,
        call: () =>
          Promise.resolve(transport.activateProviderById?.(appId, providerId)),
      },
      {
        compatibilityFallback: true,
        call: () =>
          Promise.resolve(
            transport.switchProviderByProviderId?.(appId, providerId),
          ),
      },
      {
        compatibilityFallback: true,
        call: () =>
          Promise.resolve(transport.switchProviderById?.(appId, providerId)),
      },
    ],
    "The Phase 2 provider activate RPC is not available in this build.",
  );
}

export function createOpenWrtProviderAdapter(
  transport: OpenWrtProviderTransport,
): ProviderPlatformAdapter {
  return {
    async listProviderState(appId) {
      return loadProviderState(transport, appId);
    },
    async saveProvider(appId, draft, providerId) {
      await invokePhase2Upsert(transport, appId, draft, providerId);
    },
    async activateProvider(appId, providerId) {
      await invokePhase2Activate(transport, appId, providerId);
    },
    async deleteProvider(appId, providerId) {
      await invokePhase2Delete(transport, appId, providerId);
    },
    async restartServiceIfNeeded() {
      const result = await transport.restartService();
      if (!isRpcSuccess(result)) {
        throw new Error(
          rpcFailureMessage(result) ?? "Failed to restart service.",
        );
      }
    },
    async getCapabilities() {
      return DEFAULT_CAPABILITIES;
    },
  };
}

export const __private__ = {
  invokeRpcCandidates,
  isCompatibilityRpcFailure,
  isRpcSuccess,
  loadProviderState,
  parseActiveProviderResponse,
  rpcFailureMessage,
};
