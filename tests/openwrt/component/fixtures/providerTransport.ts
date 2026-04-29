import { vi } from "vitest";
import type { OpenWrtProviderTransport } from "@/platform/openwrt/providers";
import type {
  SharedProviderAppId,
  SharedProviderEditorPayload,
  SharedProviderState,
  SharedProviderView,
} from "@/shared/providers/domain";
import {
  createClaudeAuthSummary,
  createCodexAuthSummary,
  createProviderState,
  createProviderView,
} from "../../provider-panel-fixtures";

type ProviderStateMap = Partial<
  Record<SharedProviderAppId, SharedProviderState>
>;
type FailoverFixtureState = {
  autoFailoverEnabled: boolean;
  maxRetries: number;
  queue: string[];
};
type FailoverStateMap = Partial<
  Record<SharedProviderAppId, FailoverFixtureState>
>;

function toResponseProvider(provider: SharedProviderView) {
  return {
    active: provider.active,
    authMode: provider.authMode,
    baseUrl: provider.baseUrl,
    claudeAuth: provider.claudeAuth,
    codexAuth: provider.codexAuth,
    configured: provider.configured,
    icon: provider.icon,
    iconColor: provider.iconColor,
    model: provider.model,
    name: provider.name,
    notes: provider.notes,
    providerId: provider.providerId,
    tokenConfigured: provider.tokenConfigured,
    tokenField: provider.tokenField,
    tokenMasked: provider.tokenMasked,
  };
}

function slugifyProviderId(appId: SharedProviderAppId, name: string): string {
  const slug = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return slug || `${appId}-provider`;
}

export function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });

  return {
    promise,
    resolve,
    reject,
  };
}

export function createProviderTransportFixture(
  initialProviderStates: ProviderStateMap = {},
) {
  const providerStates: ProviderStateMap = {
    ...initialProviderStates,
  };
  const failoverStates: FailoverStateMap = {};

  function getProviderState(appId: SharedProviderAppId): SharedProviderState {
    return providerStates[appId] ?? createProviderState(appId, [], null);
  }

  function setProviderState(
    appId: SharedProviderAppId,
    state: SharedProviderState,
  ) {
    providerStates[appId] = state;
  }

  function getFailoverState(appId: SharedProviderAppId): FailoverFixtureState {
    failoverStates[appId] ??= {
      autoFailoverEnabled: false,
      maxRetries: 3,
      queue: [],
    };

    return failoverStates[appId]!;
  }

  function setFailoverState(
    appId: SharedProviderAppId,
    nextState: Partial<FailoverFixtureState>,
  ) {
    const currentState = getFailoverState(appId);

    failoverStates[appId] = {
      ...currentState,
      ...nextState,
      queue: nextState.queue ? [...nextState.queue] : [...currentState.queue],
    };
  }

  function createStateResponse(appId: SharedProviderAppId) {
    const state = getProviderState(appId);

    return {
      ok: true,
      activeProviderId: state.activeProviderId,
      providers: Object.fromEntries(
        state.providers.map((provider) => [
          provider.providerId ?? provider.name,
          toResponseProvider(provider),
        ]),
      ),
    };
  }

  function createActiveProviderResponse(appId: SharedProviderAppId) {
    const state = getProviderState(appId);

    if (!state.activeProvider.configured) {
      return {
        ok: false,
      };
    }

    return {
      ok: true,
      ...toResponseProvider(state.activeProvider),
    };
  }

  function buildNextProvider(
    appId: SharedProviderAppId,
    draft: SharedProviderEditorPayload,
    providerId: string,
    currentProvider: SharedProviderView | null,
  ): SharedProviderView {
    const nextCodexAuth =
      appId !== "codex"
        ? currentProvider?.codexAuth
        : draft.authContent === ""
          ? undefined
          : typeof draft.authContent === "string"
            ? createCodexAuthSummary()
            : currentProvider?.codexAuth;
    const nextClaudeAuth =
      appId !== "claude"
        ? currentProvider?.claudeAuth
        : draft.authContent === ""
          ? undefined
          : typeof draft.authContent === "string"
            ? createClaudeAuthSummary()
            : currentProvider?.claudeAuth;
    const nextTokenConfigured =
      Boolean(draft.token.trim()) ||
      Boolean(nextCodexAuth) ||
      Boolean(nextClaudeAuth) ||
      Boolean(
        currentProvider?.tokenConfigured &&
          !currentProvider.codexAuth &&
          !currentProvider.claudeAuth,
      );

    return createProviderView(appId, {
      ...currentProvider,
      providerId,
      name: draft.name,
      baseUrl: draft.baseUrl,
      tokenField: draft.tokenField,
      tokenConfigured: nextTokenConfigured,
      tokenMasked: nextTokenConfigured ? "********" : "",
      model: draft.model,
      notes: draft.notes,
      active: currentProvider?.active ?? false,
      authMode: draft.authMode ?? currentProvider?.authMode,
      claudeAuth: nextClaudeAuth,
      codexAuth: nextCodexAuth,
    });
  }

  function upsertProvider(
    appId: SharedProviderAppId,
    draft: SharedProviderEditorPayload,
    providerId?: string,
  ) {
    const currentState = getProviderState(appId);
    const nextProviderId = providerId ?? slugifyProviderId(appId, draft.name);
    const currentProvider =
      currentState.providers.find(
        (provider) => provider.providerId === nextProviderId,
      ) ?? null;
    const nextProvider = buildNextProvider(
      appId,
      draft,
      nextProviderId,
      currentProvider,
    );
    const nextProviders = currentProvider
      ? currentState.providers.map((provider) =>
          provider.providerId === nextProviderId ? nextProvider : provider,
        )
      : [...currentState.providers, nextProvider];

    setProviderState(
      appId,
      createProviderState(appId, nextProviders, currentState.activeProviderId),
    );
  }

  function updateProvider(
    appId: SharedProviderAppId,
    providerId: string,
    update: (provider: SharedProviderView) => SharedProviderView,
  ) {
    const currentState = getProviderState(appId);
    const nextProviders = currentState.providers.map((provider) =>
      provider.providerId === providerId ? update(provider) : provider,
    );

    setProviderState(
      appId,
      createProviderState(appId, nextProviders, currentState.activeProviderId),
    );
  }

  function createProviderFailoverResponse(
    appId: SharedProviderAppId,
    providerId: string,
  ) {
    const providerState = getProviderState(appId);
    const failoverState = getFailoverState(appId);
    const queuePosition = failoverState.queue.indexOf(providerId);

    return {
      ok: true,
      providerId,
      proxyEnabled: true,
      autoFailoverEnabled: failoverState.autoFailoverEnabled,
      maxRetries: failoverState.maxRetries,
      activeProviderId: providerState.activeProviderId,
      inFailoverQueue: queuePosition >= 0,
      queuePosition: queuePosition >= 0 ? queuePosition : null,
      sortIndex: queuePosition >= 0 ? queuePosition : null,
      providerHealth: {
        providerId,
        observed: false,
        healthy: true,
        consecutiveFailures: 0,
        lastSuccessAt: null,
        lastFailureAt: null,
        lastError: null,
        updatedAt: null,
      },
      failoverQueueDepth: failoverState.queue.length,
      failoverQueue: failoverState.queue.map((queuedProviderId, index) => {
        const queuedProvider =
          providerState.providers.find(
            (provider) => provider.providerId === queuedProviderId,
          ) ?? null;

        return {
          providerId: queuedProviderId,
          providerName: queuedProvider?.name ?? queuedProviderId,
          sortIndex: index,
          active: queuedProviderId === providerState.activeProviderId,
          health: {
            providerId: queuedProviderId,
            observed: false,
            healthy: true,
            consecutiveFailures: 0,
            lastSuccessAt: null,
            lastFailureAt: null,
            lastError: null,
            updatedAt: null,
          },
        };
      }),
    };
  }

  const transport = {
    listProviders: vi.fn(async (appId) => createStateResponse(appId)),
    listSavedProviders: vi.fn(async (appId) => createStateResponse(appId)),
    getActiveProvider: vi.fn(async (appId) =>
      createActiveProviderResponse(appId),
    ),
    upsertProvider: vi.fn(async (appId, provider) => {
      upsertProvider(appId, provider);

      return {
        ok: true,
      };
    }),
    upsertProviderByProviderId: vi.fn(async (appId, providerId, provider) => {
      upsertProvider(appId, provider, providerId);

      return {
        ok: true,
      };
    }),
    activateProviderByProviderId: vi.fn(async (appId, providerId) => {
      const currentState = getProviderState(appId);

      setProviderState(
        appId,
        createProviderState(appId, currentState.providers, providerId),
      );

      return {
        ok: true,
      };
    }),
    deleteProviderByProviderId: vi.fn(async (appId, providerId) => {
      const currentState = getProviderState(appId);
      const nextProviders = currentState.providers.filter(
        (provider) => provider.providerId !== providerId,
      );
      const nextActiveProviderId =
        currentState.activeProviderId === providerId
          ? (nextProviders[0]?.providerId ?? null)
          : currentState.activeProviderId;

      setProviderState(
        appId,
        createProviderState(appId, nextProviders, nextActiveProviderId),
      );

      return {
        ok: true,
      };
    }),
    getProviderFailoverState: vi.fn(async (appId, providerId) =>
      createProviderFailoverResponse(appId, providerId),
    ),
    addToFailoverQueue: vi.fn(async (appId, providerId) => {
      const currentFailoverState = getFailoverState(appId);

      if (!currentFailoverState.queue.includes(providerId)) {
        setFailoverState(appId, {
          queue: [...currentFailoverState.queue, providerId],
        });
      }

      return {
        ok: true,
      };
    }),
    removeFromFailoverQueue: vi.fn(async (appId, providerId) => {
      const currentFailoverState = getFailoverState(appId);

      setFailoverState(appId, {
        queue: currentFailoverState.queue.filter(
          (queuedProviderId) => queuedProviderId !== providerId,
        ),
      });

      return {
        ok: true,
      };
    }),
    setAutoFailoverEnabled: vi.fn(async (appId, enabled) => {
      const currentFailoverState = getFailoverState(appId);

      setFailoverState(appId, {
        autoFailoverEnabled: enabled,
      });

      if (enabled && currentFailoverState.queue[0]) {
        const currentState = getProviderState(appId);

        setProviderState(
          appId,
          createProviderState(
            appId,
            currentState.providers,
            currentFailoverState.queue[0],
          ),
        );
      }

      return {
        ok: true,
      };
    }),
    reorderFailoverQueue: vi.fn(async (appId, providerIds) => {
      setFailoverState(appId, {
        queue: [...providerIds],
      });

      return {
        ok: true,
      };
    }),
    setMaxRetries: vi.fn(async (appId, value) => {
      setFailoverState(appId, {
        maxRetries: value,
      });

      return {
        ok: true,
      };
    }),
    uploadCodexAuth: vi.fn(async (appId, providerId) => {
      updateProvider(appId, providerId, (provider) => ({
        ...provider,
        authMode: "codex_oauth",
        codexAuth: createCodexAuthSummary(),
      }));

      return {
        ok: true,
      };
    }),
    removeCodexAuth: vi.fn(async (appId, providerId) => {
      updateProvider(appId, providerId, (provider) => ({
        ...provider,
        codexAuth: undefined,
      }));

      return {
        ok: true,
      };
    }),
    uploadClaudeAuth: vi.fn(async (appId, providerId) => {
      updateProvider(appId, providerId, (provider) => ({
        ...provider,
        authMode: "claude_oauth",
        claudeAuth: createClaudeAuthSummary(),
      }));

      return {
        ok: true,
      };
    }),
    removeClaudeAuth: vi.fn(async (appId, providerId) => {
      updateProvider(appId, providerId, (provider) => ({
        ...provider,
        claudeAuth: undefined,
      }));

      return {
        ok: true,
      };
    }),
    restartService: vi.fn(async () => ({
      ok: true,
    })),
  } satisfies OpenWrtProviderTransport;

  return {
    transport,
    getProviderState,
    setProviderState,
    getFailoverState,
    setFailoverState,
  };
}
