import type {
  ProviderPlatformAdapter,
  SharedProviderAppId,
  SharedProviderCapabilities,
  SharedProviderEditorPayload,
  SharedProviderFailoverState,
  SharedProviderState,
  SharedProviderView,
} from "@/shared/providers/domain";
import {
  emptySharedProviderView,
  normalizeSharedProviderView,
  parseSharedProviderFailoverState,
  parseSharedProviderState,
} from "@/shared/providers/domain";
import type {
  OpenWrtProviderMutationEvent,
  OpenWrtProviderMutationKind,
  OpenWrtProviderRuntimeHooks,
  OpenWrtProviderTransport,
  OpenWrtRpcResult,
} from "./types";

type RpcCandidate = {
  compatibilityFallback: boolean;
  call(): Promise<OpenWrtRpcResult | null | undefined>;
};

const BASE_CAPABILITIES = {
  supportsPresets: true,
  supportsBlankSecretPreserve: true,
  requiresServiceRestart: true,
} satisfies Pick<
  SharedProviderCapabilities,
  "supportsPresets" | "supportsBlankSecretPreserve" | "requiresServiceRestart"
>;

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

function hasRpcFailureDetails(
  result: OpenWrtRpcResult | null | undefined,
): boolean {
  return Boolean(
    result &&
      (typeof result.error === "string" ||
        (result.ok === false && typeof result.message === "string")),
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

  if (!parsed && response?.provider) {
    parsed = response.provider;
  }

  if (
    !parsed &&
    response &&
    typeof response === "object" &&
    (response.providerId != null ||
      response.provider_id != null ||
      response.configured != null ||
      response.baseUrl != null ||
      response.base_url != null ||
      response.tokenField != null ||
      response.token_field != null)
  ) {
    parsed = response as Record<string, unknown>;
  }

  if (!parsed) {
    return emptySharedProviderView(appId);
  }

  return normalizeSharedProviderView(parsed, null, null, appId);
}

function parseStatusPayload(
  response: OpenWrtRpcResult | null | undefined,
): Record<string, unknown> | null {
  if (!response) {
    return null;
  }

  if (
    response.service != null ||
    response.runtime != null ||
    response.apps != null ||
    response.app != null ||
    response.providerId != null ||
    response.provider_id != null ||
    response.failoverQueue != null ||
    response.failover_queue != null
  ) {
    return response as Record<string, unknown>;
  }

  return null;
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

function buildCapabilities(
  state: SharedProviderState,
): SharedProviderCapabilities {
  const legacyConfigured = state.activeProvider.configured;

  return {
    canAdd: state.phase2Available || !legacyConfigured,
    canEdit: state.phase2Available || legacyConfigured,
    canDelete: state.phase2Available,
    canActivate: state.phase2Available,
    ...BASE_CAPABILITIES,
  };
}

async function resolveProviderStateResponse(
  call: () => Promise<OpenWrtRpcResult | null | undefined>,
  fallback: OpenWrtRpcResult | null,
  options: {
    compatibilityFallback: boolean;
    missingMessage: string;
  },
): Promise<OpenWrtRpcResult | null> {
  try {
    const result = await call();

    if (hasRpcFailureDetails(result)) {
      if (
        options.compatibilityFallback &&
        isCompatibilityRpcFailure(result)
      ) {
        return fallback;
      }

      throw new Error(rpcFailureMessage(result) ?? options.missingMessage);
    }

    return result ?? fallback;
  } catch (error) {
    if (
      options.compatibilityFallback &&
      isCompatibilityRpcFailure(error as Error)
    ) {
      return fallback;
    }

    throw new Error(
      rpcFailureMessage(error as Error) ?? options.missingMessage,
    );
  }
}

async function loadProviderState(
  transport: OpenWrtProviderTransport,
  appId: SharedProviderAppId,
): Promise<SharedProviderState> {
  const [listResponse, savedResponse, activeResponse] = await Promise.all([
    resolveProviderStateResponse(() => transport.listProviders(appId), null, {
      compatibilityFallback: true,
      missingMessage: "Failed to load Phase 2 providers.",
    }),
    resolveProviderStateResponse(
      () => transport.listSavedProviders(appId),
      null,
      {
        compatibilityFallback: true,
        missingMessage: "Failed to load saved providers.",
      },
    ),
    resolveProviderStateResponse(
      () => transport.getActiveProvider(appId),
      { ok: false },
      {
        compatibilityFallback: false,
        missingMessage: "Failed to load active provider.",
      },
    ),
  ]);
  const activeProvider = parseActiveProviderResponse(activeResponse, appId);

  const phase2State =
    parseSharedProviderState(
      (listResponse as Record<string, unknown> | null) ?? null,
      activeProvider,
      appId,
    ) ??
    parseSharedProviderState(
      (savedResponse as Record<string, unknown> | null) ?? null,
      activeProvider,
      appId,
    );

  return phase2State ?? buildLegacyProviderState(activeProvider, appId);
}

async function invokePhase2Upsert(
  transport: OpenWrtProviderTransport,
  appId: SharedProviderAppId,
  provider: SharedProviderEditorPayload,
  providerId?: string,
): Promise<void> {
  const missingMessage = "The Phase 2 provider save RPC is not available in this build.";

  async function invokePhase1Upsert(): Promise<void> {
    if (!transport.upsertActiveProvider) {
      throw new Error(missingMessage);
    }

    const result = await transport.upsertActiveProvider(appId, provider);
    if (!isRpcSuccess(result)) {
      throw new Error(
        rpcFailureMessage(result) ??
          "Failed to save provider via Phase 1 fallback.",
      );
    }
  }

  if (providerId) {
    const candidates: RpcCandidate[] = [];

    if (transport.upsertProviderByProviderId) {
      candidates.push({
        compatibilityFallback: true,
        call: () =>
          transport.upsertProviderByProviderId!(appId, providerId, provider),
      });
    }

    if (transport.upsertProviderById) {
      candidates.push({
        compatibilityFallback: true,
        call: () => transport.upsertProviderById!(appId, providerId, provider),
      });
    }

    await invokeRpcCandidates(
      candidates,
      missingMessage,
    );
    return;
  }

  const createCandidates: RpcCandidate[] = [];

  if (transport.upsertProvider) {
    createCandidates.push({
      compatibilityFallback: true,
      call: () => transport.upsertProvider!(appId, provider),
    });
  }

  if (transport.saveProvider) {
    createCandidates.push({
      compatibilityFallback: true,
      call: () => transport.saveProvider!(appId, provider),
    });
  }

  if (createCandidates.length === 0) {
    await invokePhase1Upsert();
    return;
  }

  try {
    await invokeRpcCandidates(createCandidates, missingMessage);
  } catch (error) {
    if (!isCompatibilityRpcFailure(error as Error)) {
      throw error;
    }

    await invokePhase1Upsert();
  }
}

async function invokePhase2Delete(
  transport: OpenWrtProviderTransport,
  appId: SharedProviderAppId,
  providerId: string,
): Promise<void> {
  const candidates: RpcCandidate[] = [];

  if (transport.deleteProviderByProviderId) {
    candidates.push({
      compatibilityFallback: true,
      call: () => transport.deleteProviderByProviderId!(appId, providerId),
    });
  }

  if (transport.deleteProviderById) {
    candidates.push({
      compatibilityFallback: true,
      call: () => transport.deleteProviderById!(appId, providerId),
    });
  }

  await invokeRpcCandidates(
    candidates,
    "The Phase 2 provider delete RPC is not available in this build.",
  );
}

async function invokePhase2Activate(
  transport: OpenWrtProviderTransport,
  appId: SharedProviderAppId,
  providerId: string,
): Promise<void> {
  const candidates: RpcCandidate[] = [];

  if (transport.activateProviderByProviderId) {
    candidates.push({
      compatibilityFallback: true,
      call: () => transport.activateProviderByProviderId!(appId, providerId),
    });
  }

  if (transport.activateProviderById) {
    candidates.push({
      compatibilityFallback: true,
      call: () => transport.activateProviderById!(appId, providerId),
    });
  }

  if (transport.switchProviderByProviderId) {
    candidates.push({
      compatibilityFallback: true,
      call: () => transport.switchProviderByProviderId!(appId, providerId),
    });
  }

  if (transport.switchProviderById) {
    candidates.push({
      compatibilityFallback: true,
      call: () => transport.switchProviderById!(appId, providerId),
    });
  }

  await invokeRpcCandidates(
    candidates,
    "The Phase 2 provider activate RPC is not available in this build.",
  );
}

async function loadProviderFailoverState(
  transport: OpenWrtProviderTransport &
    Required<Pick<OpenWrtProviderTransport, "getProviderFailoverState">>,
  appId: SharedProviderAppId,
  providerId: string,
): Promise<SharedProviderFailoverState> {
  const response = await transport.getProviderFailoverState(appId, providerId);

  if (!isRpcSuccess(response)) {
    throw new Error(
      rpcFailureMessage(response) ??
        `Failed to load ${appId} provider failover state.`,
    );
  }

  return parseSharedProviderFailoverState(parseStatusPayload(response), providerId);
}

async function runFailoverMutation(
  action: () => Promise<OpenWrtRpcResult | null | undefined>,
  failureMessage: string,
): Promise<void> {
  const response = await action();

  if (!isRpcSuccess(response)) {
    throw new Error(rpcFailureMessage(response) ?? failureMessage);
  }
}

async function resolveServiceRunning(
  runtimeHooks?: OpenWrtProviderRuntimeHooks,
): Promise<boolean> {
  if (!runtimeHooks?.getServiceRunning) {
    return false;
  }

  return Boolean(await runtimeHooks.getServiceRunning());
}

function shouldRequireRestartAfterSave(
  previousState: SharedProviderState,
  nextState: SharedProviderState,
  providerId?: string,
): boolean {
  if (!nextState.phase2Available) {
    return true;
  }

  return Boolean(
    previousState.activeProviderId !== nextState.activeProviderId ||
      (providerId && providerId === previousState.activeProviderId) ||
      (!previousState.activeProviderId && nextState.activeProviderId),
  );
}

function shouldRequireRestartAfterActivate(
  previousState: SharedProviderState,
  nextState: SharedProviderState,
): boolean {
  return previousState.activeProviderId !== nextState.activeProviderId;
}

function shouldRequireRestartAfterDelete(
  previousState: SharedProviderState,
  nextState: SharedProviderState,
  providerId: string,
): boolean {
  return Boolean(
    providerId === previousState.activeProviderId ||
      previousState.activeProviderId !== nextState.activeProviderId,
  );
}

function shouldRequireRestart(
  mutation: OpenWrtProviderMutationKind,
  previousState: SharedProviderState,
  nextState: SharedProviderState,
  providerId?: string,
): boolean {
  switch (mutation) {
    case "save":
      return shouldRequireRestartAfterSave(previousState, nextState, providerId);
    case "activate":
      return shouldRequireRestartAfterActivate(previousState, nextState);
    case "delete":
      return shouldRequireRestartAfterDelete(
        previousState,
        nextState,
        providerId ?? "",
      );
  }
}

async function notifyProviderMutation(
  transport: OpenWrtProviderTransport,
  runtimeHooks: OpenWrtProviderRuntimeHooks | undefined,
  appId: SharedProviderAppId,
  mutation: OpenWrtProviderMutationKind,
  previousState: SharedProviderState,
  providerId?: string,
): Promise<void> {
  if (!runtimeHooks?.onProviderMutation) {
    return;
  }

  const [providerState, serviceRunning] = await Promise.all([
    loadProviderState(transport, appId),
    resolveServiceRunning(runtimeHooks),
  ]);
  const event: OpenWrtProviderMutationEvent = {
    appId,
    mutation,
    providerId: providerId ?? null,
    serviceRunning,
    restartRequired:
      serviceRunning &&
      shouldRequireRestart(mutation, previousState, providerState, providerId),
    providerState,
    capabilities: buildCapabilities(providerState),
  };

  try {
    await runtimeHooks.onProviderMutation(event);
  } catch (error) {
    console.warn("[openwrt/providers] Failed to notify runtime hook", error);
  }
}

export function createOpenWrtProviderAdapter(
  transport: OpenWrtProviderTransport,
  runtimeHooks?: OpenWrtProviderRuntimeHooks,
): ProviderPlatformAdapter {
  const adapter: ProviderPlatformAdapter = {
    async listProviderState(appId) {
      return loadProviderState(transport, appId);
    },
    async getProviderFailoverState(appId, providerId) {
      const getProviderFailoverState = transport.getProviderFailoverState;

      if (typeof getProviderFailoverState !== "function") {
        throw new Error(
          "The OpenWrt provider failover detail RPC is not available in this build.",
        );
      }

      return loadProviderFailoverState(
        {
          ...transport,
          getProviderFailoverState,
        },
        appId,
        providerId,
      );
    },
    async saveProvider(appId, draft, providerId) {
      const previousState = runtimeHooks
        ? await loadProviderState(transport, appId)
        : null;

      await invokePhase2Upsert(transport, appId, draft, providerId);

      if (previousState) {
        await notifyProviderMutation(
          transport,
          runtimeHooks,
          appId,
          "save",
          previousState,
          providerId,
        );
      }
    },
    async activateProvider(appId, providerId) {
      const previousState = runtimeHooks
        ? await loadProviderState(transport, appId)
        : null;

      await invokePhase2Activate(transport, appId, providerId);

      if (previousState) {
        await notifyProviderMutation(
          transport,
          runtimeHooks,
          appId,
          "activate",
          previousState,
          providerId,
        );
      }
    },
    async deleteProvider(appId, providerId) {
      const previousState = runtimeHooks
        ? await loadProviderState(transport, appId)
        : null;

      await invokePhase2Delete(transport, appId, providerId);

      if (previousState) {
        await notifyProviderMutation(
          transport,
          runtimeHooks,
          appId,
          "delete",
          previousState,
          providerId,
        );
      }
    },
    async restartServiceIfNeeded() {
      const result = await transport.restartService();
      if (!isRpcSuccess(result)) {
        throw new Error(
          rpcFailureMessage(result) ?? "Failed to restart service.",
        );
      }
    },
    async getCapabilities(appId) {
      const state = await loadProviderState(transport, appId);
      return buildCapabilities(state);
    },
  };

  if (
    typeof transport.addToFailoverQueue === "function" &&
    typeof transport.removeFromFailoverQueue === "function" &&
    typeof transport.setAutoFailoverEnabled === "function" &&
    typeof transport.reorderFailoverQueue === "function" &&
    typeof transport.setMaxRetries === "function"
  ) {
    adapter.addToFailoverQueue = async (appId, providerId) =>
      runFailoverMutation(
        () => transport.addToFailoverQueue!(appId, providerId),
        `Failed to add ${providerId} to the ${appId} failover queue.`,
      );
    adapter.removeFromFailoverQueue = async (appId, providerId) =>
      runFailoverMutation(
        () => transport.removeFromFailoverQueue!(appId, providerId),
        `Failed to remove ${providerId} from the ${appId} failover queue.`,
      );
    adapter.setAutoFailoverEnabled = async (appId, enabled) =>
      runFailoverMutation(
        () => transport.setAutoFailoverEnabled!(appId, enabled),
        `Failed to update ${appId} auto-failover.`,
      );
    adapter.reorderFailoverQueue = async (appId, providerIds) =>
      runFailoverMutation(
        () => transport.reorderFailoverQueue!(appId, providerIds),
        `Failed to reorder the ${appId} failover queue.`,
      );
    adapter.setMaxRetries = async (appId, value) =>
      runFailoverMutation(
        () => transport.setMaxRetries!(appId, value),
        `Failed to update ${appId} max retries.`,
      );
  }

  if (
    typeof transport.uploadCodexAuth === "function" &&
    typeof transport.removeCodexAuth === "function"
  ) {
    adapter.uploadCodexAuth = async (appId, providerId, authJsonText) =>
      runFailoverMutation(
        () => transport.uploadCodexAuth!(appId, providerId, authJsonText),
        `Failed to upload auth.json for ${providerId}.`,
      );
    adapter.removeCodexAuth = async (appId, providerId) =>
      runFailoverMutation(
        () => transport.removeCodexAuth!(appId, providerId),
        `Failed to remove auth.json for ${providerId}.`,
      );
  }

  return adapter;
}

export const __private__ = {
  buildCapabilities,
  invokeRpcCandidates,
  isCompatibilityRpcFailure,
  isRpcSuccess,
  loadProviderFailoverState,
  loadProviderState,
  parseActiveProviderResponse,
  parseStatusPayload,
  rpcFailureMessage,
  runFailoverMutation,
  shouldRequireRestart,
};
