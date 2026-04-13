import type { ReactElement } from "react";
import { QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import {
  SharedProviderManager,
  emptySharedProviderView,
  type ProviderPlatformAdapter,
  type SharedProviderAppId,
  type SharedProviderCapabilities,
  type SharedProviderEditorPayload,
  type SharedProviderState,
  type SharedProviderView,
} from "@/shared/providers";
import { createTestQueryClient } from "../../utils/testQueryClient";

function buildState(
  appId: SharedProviderAppId,
  providers: SharedProviderView[],
  activeProviderId: string | null,
  phase2Available = true,
): SharedProviderState {
  const activeProvider =
    providers.find((provider) => provider.providerId === activeProviderId) ??
    emptySharedProviderView(appId);

  return {
    phase2Available,
    providers: providers.map((provider) => ({
      ...provider,
      active: provider.providerId === activeProviderId,
    })),
    activeProviderId,
    activeProvider:
      activeProvider.providerId === activeProviderId
        ? {
            ...activeProvider,
            active: true,
          }
        : activeProvider,
  };
}

function createProvider(
  partial: Partial<SharedProviderView> & {
    providerId: string;
    name: string;
    baseUrl: string;
  },
): SharedProviderView {
  return {
    configured: true,
    providerId: partial.providerId,
    name: partial.name,
    baseUrl: partial.baseUrl,
    tokenField: partial.tokenField ?? "ANTHROPIC_AUTH_TOKEN",
    tokenConfigured: partial.tokenConfigured ?? true,
    tokenMasked: partial.tokenMasked ?? "********",
    model: partial.model ?? "",
    notes: partial.notes ?? "",
    active: partial.active ?? false,
  };
}

function createAdapter(
  overrides: Partial<ProviderPlatformAdapter> = {},
): ProviderPlatformAdapter {
  const capabilities: SharedProviderCapabilities = {
    canAdd: true,
    canEdit: true,
    canDelete: true,
    canActivate: true,
    supportsPresets: true,
    supportsBlankSecretPreserve: true,
    requiresServiceRestart: true,
  };

  return {
    listProviderState: vi.fn().mockResolvedValue(buildState("claude", [], null)),
    saveProvider: vi.fn().mockResolvedValue(undefined),
    activateProvider: vi.fn().mockResolvedValue(undefined),
    deleteProvider: vi.fn().mockResolvedValue(undefined),
    restartServiceIfNeeded: vi.fn().mockResolvedValue(undefined),
    getCapabilities: vi.fn().mockResolvedValue(capabilities),
    ...overrides,
  };
}

function renderManager(ui: ReactElement) {
  const queryClient = createTestQueryClient();
  const user = userEvent.setup();

  return {
    user,
    queryClient,
    ...render(
      <QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>,
    ),
  };
}

function createMutableAdapter(initialState: {
  claude?: SharedProviderState;
  codex?: SharedProviderState;
  gemini?: SharedProviderState;
}) {
  const states: Record<SharedProviderAppId, SharedProviderState> = {
    claude: initialState.claude ?? buildState("claude", [], null),
    codex: initialState.codex ?? buildState("codex", [], null),
    gemini: initialState.gemini ?? buildState("gemini", [], null),
  };
  let nextProviderId = 1;

  function cloneState(appId: SharedProviderAppId): SharedProviderState {
    const state = states[appId];

    return {
      phase2Available: state.phase2Available,
      activeProviderId: state.activeProviderId,
      activeProvider: { ...state.activeProvider },
      providers: state.providers.map((provider) => ({ ...provider })),
    };
  }

  function rewriteState(
    appId: SharedProviderAppId,
    providers: SharedProviderView[],
    activeProviderId: string | null,
  ) {
    states[appId] = buildState(appId, providers, activeProviderId);
  }

  const adapter = createAdapter({
    listProviderState: vi.fn(async (appId: SharedProviderAppId) =>
      cloneState(appId),
    ),
    saveProvider: vi.fn(
      async (
        appId: SharedProviderAppId,
        draft: SharedProviderEditorPayload,
        providerId?: string,
      ) => {
        const state = states[appId];
        const providers = state.providers.map((provider) => ({ ...provider }));

        if (providerId) {
          rewriteState(
            appId,
            providers.map((provider) =>
              provider.providerId === providerId
                ? {
                    ...provider,
                    name: draft.name,
                    baseUrl: draft.baseUrl,
                    tokenField: draft.tokenField,
                    model: draft.model,
                    notes: draft.notes,
                    tokenConfigured: draft.token
                      ? true
                      : provider.tokenConfigured,
                    tokenMasked: draft.token
                      ? "********updated"
                      : provider.tokenMasked,
                  }
                : provider,
            ),
            state.activeProviderId,
          );
          return;
        }

        const newProviderId = `provider-${nextProviderId++}`;
        rewriteState(
          appId,
          [
            ...providers,
            {
              configured: true,
              providerId: newProviderId,
              name: draft.name,
              baseUrl: draft.baseUrl,
              tokenField: draft.tokenField,
              tokenConfigured: Boolean(draft.token),
              tokenMasked: draft.token ? "********new" : "",
              model: draft.model,
              notes: draft.notes,
              active: false,
            },
          ],
          state.activeProviderId,
        );
      },
    ),
    activateProvider: vi.fn(
      async (appId: SharedProviderAppId, providerId: string) => {
        rewriteState(
          appId,
          states[appId].providers.map((provider) => ({ ...provider })),
          providerId,
        );
      },
    ),
    deleteProvider: vi.fn(
      async (appId: SharedProviderAppId, providerId: string) => {
        const providers = states[appId].providers.filter(
          (provider) => provider.providerId !== providerId,
        );
        const activeProviderId =
          states[appId].activeProviderId === providerId
            ? providers[0]?.providerId ?? null
            : states[appId].activeProviderId;

        rewriteState(appId, providers, activeProviderId);
      },
    ),
  });

  return adapter;
}

describe("SharedProviderManager", () => {
  it("shows loading, empty state, and app switching", async () => {
    let resolveProviders!: (value: SharedProviderState) => void;
    const providerPromise = new Promise<SharedProviderState>((resolve) => {
      resolveProviders = resolve;
    });
    const adapter = createAdapter({
      listProviderState: vi
        .fn()
        .mockImplementationOnce(async () => providerPromise)
        .mockResolvedValueOnce(buildState("codex", [], null)),
    });
    const onSelectedAppChange = vi.fn();
    const { user } = renderManager(
      <SharedProviderManager
        adapter={adapter}
        onSelectedAppChange={onSelectedAppChange}
      />,
    );

    expect(screen.getByText("Loading providers...")).toBeInTheDocument();

    resolveProviders(buildState("claude", [], null));

    expect(
      await screen.findByText("No providers saved for Claude yet."),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Codex" }));

    expect(onSelectedAppChange).toHaveBeenCalledWith("codex");
    expect(
      await screen.findByText("No providers saved for Codex yet."),
    ).toBeInTheDocument();
  });

  it("shows an error state and retries loading", async () => {
    const listProviderState = vi
      .fn()
      .mockRejectedValueOnce(new Error("rpc unavailable"))
      .mockResolvedValueOnce(buildState("claude", [], null));
    const adapter = createAdapter({
      listProviderState,
    });
    const { user } = renderManager(
      <SharedProviderManager adapter={adapter} />,
    );

    expect(
      await screen.findByText("Unable to load providers."),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Retry" }));

    expect(
      await screen.findByText("No providers saved for Claude yet."),
    ).toBeInTheDocument();
    expect(listProviderState).toHaveBeenCalledTimes(2);
  });

  it("adds and edits a provider from shared presets and notifies restart state", async () => {
    const adapter = createMutableAdapter({
      claude: buildState("claude", [], null),
    });
    const onRestartRequired = vi.fn();
    const { user } = renderManager(
      <SharedProviderManager
        adapter={adapter}
        onRestartRequired={onRestartRequired}
        shellState={{
          serviceName: "ccswitch",
          serviceStatusLabel: "running",
        }}
      />,
    );

    await screen.findByText("No providers saved for Claude yet.");

    const nameInput = screen.getByLabelText("Provider name");
    const baseUrlInput = screen.getByLabelText("Base URL");
    const tokenInput = screen.getByLabelText("API token");

    expect(nameInput).toHaveValue("Claude Official");
    expect(baseUrlInput).toHaveValue("https://api.anthropic.com");

    await user.type(tokenInput, "secret-token");
    await user.click(screen.getByRole("button", { name: "Save provider" }));

    expect(
      await screen.findByRole("button", { name: "Edit Claude Official" }),
    ).toBeInTheDocument();
    expect(adapter.saveProvider).toHaveBeenCalledWith(
      "claude",
      expect.objectContaining({
        name: "Claude Official",
        baseUrl: "https://api.anthropic.com",
        tokenField: "ANTHROPIC_AUTH_TOKEN",
        token: "secret-token",
      }),
      undefined,
    );
    expect(onRestartRequired).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "saved",
        appId: "claude",
        providerName: "Claude Official",
        requiresServiceRestart: true,
      }),
    );
    expect(
      screen.getByText(/Restart the ccswitch to apply provider changes./i),
    ).toBeInTheDocument();

    await user.click(
      screen.getByRole("button", { name: "Edit Claude Official" }),
    );
    await user.clear(screen.getByLabelText("Notes"));
    await user.type(screen.getByLabelText("Notes"), "Router preset");
    await user.clear(screen.getByLabelText("Model"));
    await user.type(screen.getByLabelText("Model"), "claude-sonnet-4");
    await user.click(screen.getByRole("button", { name: "Update provider" }));

    await waitFor(() =>
      expect(adapter.saveProvider).toHaveBeenLastCalledWith(
        "claude",
        expect.objectContaining({
          name: "Claude Official",
          token: "",
          model: "claude-sonnet-4",
          notes: "Router preset",
        }),
        "provider-1",
      ),
    );
    expect(onRestartRequired).toHaveBeenCalledTimes(2);
    expect(screen.getByText("Router preset")).toBeInTheDocument();
  });

  it("activates and deletes saved providers", async () => {
    const adapter = createMutableAdapter({
      codex: buildState(
        "codex",
        [
          createProvider({
            providerId: "alpha",
            name: "Alpha",
            baseUrl: "https://alpha.example.com/v1",
            tokenField: "OPENAI_API_KEY",
            model: "gpt-5.4",
            active: true,
          }),
          createProvider({
            providerId: "beta",
            name: "Beta",
            baseUrl: "https://beta.example.com/v1",
            tokenField: "OPENAI_API_KEY",
            model: "gpt-5.4-mini",
            active: false,
          }),
        ],
        "alpha",
      ),
    });
    const { user } = renderManager(
      <SharedProviderManager adapter={adapter} defaultApp="codex" />,
    );

    expect(await screen.findByText("Alpha")).toBeInTheDocument();
    expect(screen.getByText("Beta")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Activate Beta" }));

    await waitFor(() =>
      expect(adapter.activateProvider).toHaveBeenCalledWith("codex", "beta"),
    );

    const betaCard = screen.getByText("Beta").closest("article");
    expect(
      within(betaCard as HTMLElement).getByText("Active", {
        selector: "span",
      }),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Delete Alpha" }));
    await user.click(screen.getByRole("button", { name: "Confirm delete" }));

    await waitFor(() =>
      expect(adapter.deleteProvider).toHaveBeenCalledWith("codex", "alpha"),
    );
    expect(screen.queryByText("Alpha")).not.toBeInTheDocument();
  });
});
