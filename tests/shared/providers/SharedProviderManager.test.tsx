import { type ReactElement } from "react";
import { QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { flushSync } from "react-dom";
import { describe, expect, it, vi } from "vitest";
import {
  SharedProviderManager,
  emptySharedProviderView,
  mountSharedProviderManager,
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
    listProviderState: vi
      .fn()
      .mockResolvedValue(buildState("claude", [], null)),
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

function cloneState(state: SharedProviderState): SharedProviderState {
  return {
    phase2Available: state.phase2Available,
    activeProviderId: state.activeProviderId,
    activeProvider: { ...state.activeProvider },
    providers: state.providers.map((provider) => ({ ...provider })),
  };
}

function createDeferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((resolver) => {
    resolve = resolver;
  });

  return {
    promise,
    resolve,
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

  function cloneAppState(appId: SharedProviderAppId): SharedProviderState {
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
      cloneAppState(appId),
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
            ? (providers[0]?.providerId ?? null)
            : states[appId].activeProviderId;

        rewriteState(appId, providers, activeProviderId);
      },
    ),
  });

  return adapter;
}

function createSaveRaceAdapter() {
  const states: Record<SharedProviderAppId, SharedProviderState> = {
    claude: buildState("claude", [], null),
    codex: buildState("codex", [], null),
    gemini: buildState("gemini", [], null),
  };
  const saveDeferred = createDeferred();

  const adapter = createAdapter({
    listProviderState: vi.fn(async (appId: SharedProviderAppId) =>
      cloneState(states[appId]),
    ),
    saveProvider: vi.fn(
      async (
        appId: SharedProviderAppId,
        draft: SharedProviderEditorPayload,
      ) => {
        await saveDeferred.promise;
        states[appId] = buildState(
          appId,
          [
            createProvider({
              providerId: "provider-1",
              name: draft.name,
              baseUrl: draft.baseUrl,
              tokenField: draft.tokenField,
              tokenConfigured: Boolean(draft.token),
              tokenMasked: draft.token ? "********new" : "",
              model: draft.model,
              notes: draft.notes,
              active: false,
            }),
          ],
          null,
        );
      },
    ),
  });

  return {
    adapter,
    resolveSave: saveDeferred.resolve,
  };
}

describe("SharedProviderManager", () => {
  it("shows loading, empty state, and keyboard app switching", async () => {
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

    expect(screen.getByText("Loading provider settings...")).toBeInTheDocument();

    resolveProviders(buildState("claude", [], null));

    expect(
      await screen.findByText("No Claude providers saved."),
    ).toBeInTheDocument();

    const claudeTab = screen.getByRole("button", { name: "Claude" });

    claudeTab.focus();
    await user.keyboard("{ArrowRight}");

    expect(onSelectedAppChange).toHaveBeenCalledWith("codex");
    expect(screen.getByRole("button", { name: "Codex" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(
      await screen.findByText("No Codex providers saved."),
    ).toBeInTheDocument();
  });

  it("restores focus for keyboard-opened editor and delete dialogs", async () => {
    const adapter = createMutableAdapter({
      claude: buildState(
        "claude",
        [
          createProvider({
            providerId: "alpha",
            name: "Alpha",
            baseUrl: "https://alpha.example.com",
          }),
        ],
        "alpha",
      ),
    });
    const { user } = renderManager(
      <SharedProviderManager adapter={adapter} defaultApp="claude" />,
    );

    await screen.findByRole("button", { name: "Edit Alpha" });

    const addButton = screen.getAllByRole("button", {
      name: "Add provider",
    })[0]!;
    addButton.focus();
    await user.keyboard("{Enter}");

    const addDialog = await screen.findByRole("dialog", {
      name: "Save Claude provider",
    });
    expect(within(addDialog).getByLabelText("Provider name")).toHaveFocus();

    await user.keyboard("{Escape}");

    await waitFor(() =>
      expect(
        screen.queryByRole("dialog", { name: "Save Claude provider" }),
      ).not.toBeInTheDocument(),
    );
    expect(addButton).toHaveFocus();

    const deleteButton = screen.getByRole("button", { name: "Delete Alpha" });
    deleteButton.focus();
    await user.keyboard("{Enter}");

    const deleteDialog = await screen.findByRole("dialog", {
      name: "Delete provider",
    });
    expect(
      within(deleteDialog).getByRole("button", { name: "Cancel" }),
    ).toHaveFocus();

    await user.keyboard("{Escape}");

    await waitFor(() =>
      expect(
        screen.queryByRole("dialog", { name: "Delete provider" }),
      ).not.toBeInTheDocument(),
    );
    expect(deleteButton).toHaveFocus();
  });

  it("exposes stable layout hooks for the embedded provider surface", async () => {
    const adapter = createAdapter({
      listProviderState: vi.fn().mockResolvedValue(
        buildState(
          "claude",
          [
            createProvider({
              providerId: "claude-primary",
              name: "Claude Primary",
              baseUrl: "https://api.anthropic.com",
              model: "claude-sonnet-4-5",
            }),
            createProvider({
              providerId: "claude-backup",
              name: "Claude Backup",
              baseUrl: "https://gateway.example.com",
              model: "claude-haiku-4-5",
            }),
          ],
          "claude-primary",
        ),
      ),
    });

    const { user, container } = renderManager(
      <SharedProviderManager adapter={adapter} defaultApp="claude" />,
    );

    await screen.findByRole("button", { name: "Edit Claude Primary" });

    const providerSurface = container.querySelector(
      '[data-ccswitch-region="provider-surface"]',
    );

    expect(providerSurface).toHaveAttribute(
      "data-ccswitch-layout",
      "embedded-stack",
    );

    const providerHeader = providerSurface?.querySelector(
      '[data-ccswitch-region="provider-header"]',
    );
    const appSwitch = providerSurface?.querySelector(
      '[data-ccswitch-region="provider-app-switch"]',
    );
    const summaryGrid = providerSurface?.querySelector(
      '[data-ccswitch-region="provider-summary-grid"]',
    );
    const providerBody = providerSurface?.querySelector(
      '[data-ccswitch-region="provider-body"]',
    );
    const toolbar = providerSurface?.querySelector(
      '[data-ccswitch-region="provider-toolbar"]',
    );
    const providerCardGrid = providerSurface?.querySelector(
      '[data-ccswitch-region="provider-card-grid"]',
    );
    const providerDetailPanel = providerSurface?.querySelector(
      '[data-ccswitch-region="provider-detail-panel"]',
    );

    expect(providerHeader).toHaveAttribute(
      "data-ccswitch-layout",
      "embedded-stack",
    );
    expect(appSwitch).toHaveAttribute("data-ccswitch-layout", "wrap-row");
    expect(summaryGrid).toHaveAttribute(
      "data-ccswitch-layout",
      "stack-to-split",
    );
    expect(summaryGrid).toHaveClass("grid");
    expect(providerBody).toHaveAttribute(
      "data-ccswitch-layout",
      "embedded-stack",
    );
    expect(toolbar).toContainElement(
      screen.getAllByRole("button", { name: "Add provider" })[0]!,
    );
    expect(providerCardGrid).toHaveAttribute(
      "data-ccswitch-layout",
      "responsive-grid",
    );
    expect(providerCardGrid).toHaveClass("grid");
    expect(providerDetailPanel).not.toBeNull();
    expect(providerCardGrid).toContainElement(
      screen.getByRole("button", { name: "Edit Claude Primary" }).closest(
        "article",
      ),
    );
    expect(
      summaryGrid?.querySelector('[data-ccswitch-region="provider-summary"]'),
    ).toBeTruthy();
    expect(
      summaryGrid?.querySelector(
        '[data-ccswitch-region="provider-active-route"]',
      ),
    ).toBeTruthy();

    await user.click(
      screen.getByRole("button", { name: "Delete Claude Backup" }),
    );

    const deleteDialog = await screen.findByRole("dialog", {
      name: "Delete provider",
    });

    expect(deleteDialog).toHaveClass("ccswitch-openwrt-dialog-shell");
  });

  it("shows an error state and retries loading", async () => {
    const listProviderState = vi
      .fn()
      .mockRejectedValueOnce(new Error("rpc unavailable"))
      .mockResolvedValueOnce(buildState("claude", [], null));
    const adapter = createAdapter({
      listProviderState,
    });
    const { user } = renderManager(<SharedProviderManager adapter={adapter} />);

    expect(
      await screen.findByText("Could not load provider settings."),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "Retry after the OpenWrt service or RPC bridge is available again.",
      ),
    ).toBeInTheDocument();
    expect(
      screen
        .getByText("Could not load provider settings.")
        .closest(".ccswitch-openwrt-state-shell--warning"),
    ).not.toBeNull();

    await user.click(screen.getByRole("button", { name: "Retry" }));

    expect(
      await screen.findByText("No Claude providers saved."),
    ).toBeInTheDocument();
    expect(listProviderState).toHaveBeenCalledTimes(2);
  });

  it("adds and edits a provider from shared presets in the dedicated panel and notifies restart state", async () => {
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

    await screen.findByText("No Claude providers saved.");

    const addProviderButton = screen.getAllByRole("button", {
      name: "Add provider",
    })[0]!;
    addProviderButton.focus();
    await user.keyboard("{Enter}");

    const addDialog = await screen.findByRole("dialog", {
      name: "Save Claude provider",
    });
    const addDialogScope = within(addDialog);

    expect(addDialogScope.getByText("Official")).toBeInTheDocument();
    expect(addDialogScope.getByText("Compatible gateways")).toBeInTheDocument();
    expect(addDialogScope.getByLabelText("Provider name")).toHaveValue(
      "Claude Official",
    );
    expect(addDialogScope.getByLabelText("Base URL")).toHaveValue(
      "https://api.anthropic.com",
    );

    await user.type(addDialogScope.getByLabelText("API token"), "secret-token");
    const saveProviderButton = addDialogScope.getByRole("button", {
      name: "Save provider",
    });
    saveProviderButton.focus();
    await user.keyboard("{Enter}");

    expect(
      await screen.findByRole("button", { name: "Edit Claude Official" }),
    ).toBeInTheDocument();
    await waitFor(() =>
      expect(
        screen.queryByRole("dialog", { name: "Save Claude provider" }),
      ).not.toBeInTheDocument(),
    );
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
    const restartRequiredNotice = screen.getByRole("alert");
    expect(restartRequiredNotice).toHaveTextContent(/provider saved/i);
    expect(
      screen.getByText(/Restart the service to apply provider changes\./i),
    ).toBeInTheDocument();
    expect(restartRequiredNotice).toHaveTextContent("Claude Official");
    expect(restartRequiredNotice).toHaveTextContent(/restart/i);
    expect(restartRequiredNotice).toHaveTextContent(/apply provider changes/i);
    expect(restartRequiredNotice).toHaveTextContent(/luci restart control/i);
    expect(restartRequiredNotice).toHaveTextContent(/service: ccswitch/i);
    expect(restartRequiredNotice).toHaveTextContent(/current service status: running/i);
    expect(restartRequiredNotice).not.toHaveTextContent(
      "Changes are available immediately.",
    );
    expect(restartRequiredNotice).toHaveClass("bg-amber-500/10");

    const editProviderButton = screen.getByRole("button", {
      name: "Edit Claude Official",
    });
    editProviderButton.focus();
    await user.keyboard("{Enter}");

    const editDialog = await screen.findByRole("dialog", {
      name: "Update Claude provider",
    });
    const editDialogScope = within(editDialog);

    await user.clear(editDialogScope.getByLabelText("Notes"));
    await user.type(editDialogScope.getByLabelText("Notes"), "Router preset");
    await user.clear(editDialogScope.getByLabelText("Model"));
    await user.type(editDialogScope.getByLabelText("Model"), "claude-sonnet-4");
    const updateProviderButton = editDialogScope.getByRole("button", {
      name: "Update provider",
    });
    updateProviderButton.focus();
    await user.keyboard("{Enter}");

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
    await waitFor(() =>
      expect(
        screen.queryByRole("dialog", { name: "Update Claude provider" }),
      ).not.toBeInTheDocument(),
    );
    expect(onRestartRequired).toHaveBeenCalledTimes(2);
    expect(screen.getByText("Router preset")).toBeInTheDocument();
  });

  it(
    "treats restart-required mutation notices as warning-level instead of success-only",
    async () => {
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

      await screen.findByText("No Claude providers saved.");

      await user.click(
        screen.getAllByRole("button", {
          name: "Add provider",
        })[0]!,
      );

      const addDialog = await screen.findByRole("dialog", {
        name: "Save Claude provider",
      });
      const addDialogScope = within(addDialog);

      await user.type(addDialogScope.getByLabelText("API token"), "secret-token");
      await user.click(
        addDialogScope.getByRole("button", {
          name: "Save provider",
        }),
      );

      expect(
        await screen.findByRole("button", { name: "Edit Claude Official" }),
      ).toBeInTheDocument();
      expect(onRestartRequired).toHaveBeenCalledWith(
        expect.objectContaining({
          action: "saved",
          appId: "claude",
          providerName: "Claude Official",
          requiresServiceRestart: true,
        }),
      );

      const restartRequiredNotice = screen.getByRole("alert");
      expect(restartRequiredNotice).toHaveTextContent("Claude Official");
      expect(restartRequiredNotice).toHaveTextContent(/restart/i);
      expect(restartRequiredNotice).not.toHaveTextContent(/immediately/i);
      expect(restartRequiredNotice.className).not.toContain("border-emerald-500/30");
    },
  );

  it("shows grouped presets and form sections, and keeps custom drafts editable after preset selection", async () => {
    const adapter = createMutableAdapter({
      codex: buildState("codex", [], null),
    });
    const { user } = renderManager(
      <SharedProviderManager adapter={adapter} defaultApp="codex" />,
    );

    await screen.findByText("No Codex providers saved.");
    await user.click(
      screen.getAllByRole("button", { name: "Add provider" })[0]!,
    );

    const dialog = await screen.findByRole("dialog", {
      name: "Save Codex provider",
    });
    const dialogScope = within(dialog);

    expect(dialogScope.getByText("Preset browser")).toBeInTheDocument();
    expect(dialogScope.getByText("Official")).toBeInTheDocument();
    expect(dialogScope.getByText("Platform templates")).toBeInTheDocument();
    expect(dialogScope.getByText("Compatible gateways")).toBeInTheDocument();
    expect(
      dialogScope.getByRole("heading", { name: "General" }),
    ).toBeInTheDocument();
    expect(
      dialogScope.getByRole("heading", { name: "Credentials" }),
    ).toBeInTheDocument();
    expect(dialogScope.getByLabelText("Notes")).toBeInTheDocument();
    expect(dialogScope.getByLabelText("Provider name")).toHaveValue(
      "OpenAI Official",
    );
    expect(dialogScope.getByLabelText("Base URL")).toHaveValue(
      "https://api.openai.com/v1",
    );

    await user.click(dialogScope.getByRole("button", { name: /OpenRouter/ }));

    expect(dialogScope.getByLabelText("Provider name")).toHaveValue(
      "OpenRouter",
    );
    expect(dialogScope.getByLabelText("Base URL")).toHaveValue(
      "https://openrouter.ai/api/v1",
    );
    expect(dialogScope.getByLabelText("Model")).toHaveValue("gpt-5.4");
    expect(
      dialogScope.getAllByText(
        "OpenRouter Responses-compatible endpoint for Codex.",
      ).length,
    ).toBeGreaterThan(0);

    await user.clear(dialogScope.getByLabelText("Provider name"));
    await user.type(dialogScope.getByLabelText("Provider name"), "Router edge");
    await user.click(dialogScope.getByRole("button", { name: /Custom draft/ }));

    expect(dialogScope.getByLabelText("Provider name")).toHaveValue(
      "Router edge",
    );
    expect(dialogScope.getByLabelText("Base URL")).toHaveValue(
      "https://openrouter.ai/api/v1",
    );
    expect(dialogScope.getByLabelText("Model")).toHaveValue("gpt-5.4");
    expect(
      dialogScope.getByText(
        "Keep the current fields editable without applying a preset.",
      ),
    ).toBeInTheDocument();
  });

  it("shows blank-secret preserve guidance only when editing a provider with a stored secret", async () => {
    const adapter = createAdapter({
      listProviderState: vi.fn().mockResolvedValue(
        buildState(
          "claude",
          [
            createProvider({
              providerId: "with-secret",
              name: "Claude Secret",
              baseUrl: "https://api.anthropic.com",
              tokenConfigured: true,
            }),
            createProvider({
              providerId: "without-secret",
              name: "Claude Empty",
              baseUrl: "https://gateway.example.com",
              tokenConfigured: false,
              tokenMasked: "",
            }),
          ],
          "with-secret",
        ),
      ),
    });
    const { user } = renderManager(
      <SharedProviderManager adapter={adapter} defaultApp="claude" />,
    );

    await screen.findByText("Claude Secret");

    await user.click(
      screen.getByRole("button", { name: "Edit Claude Secret" }),
    );

    const storedSecretDialog = await screen.findByRole("dialog", {
      name: "Update Claude provider",
    });
    const storedSecretScope = within(storedSecretDialog);

    expect(
      storedSecretScope.getByPlaceholderText(
        "Leave blank to keep the stored secret",
      ),
    ).toBeInTheDocument();
    expect(
      storedSecretScope.getByText("Stored secret detected"),
    ).toBeInTheDocument();
    expect(
      storedSecretScope.getByText(
        "Leave the token blank to preserve the stored secret.",
      ),
    ).toBeInTheDocument();

    await user.click(storedSecretScope.getByRole("button", { name: "Cancel" }));

    await waitFor(() =>
      expect(
        screen.queryByRole("dialog", { name: "Update Claude provider" }),
      ).not.toBeInTheDocument(),
    );

    await user.click(screen.getByRole("button", { name: "Edit Claude Empty" }));

    const emptySecretDialog = await screen.findByRole("dialog", {
      name: "Update Claude provider",
    });
    const emptySecretScope = within(emptySecretDialog);

    expect(
      emptySecretScope.getByPlaceholderText(
        "Enter the secret for this provider",
      ),
    ).toBeInTheDocument();
    expect(
      emptySecretScope.queryByText(
        "Leave the token blank to preserve the stored secret.",
      ),
    ).not.toBeInTheDocument();
  });

  it("keeps selected-provider General and Credentials panes aligned to the chosen card", async () => {
    const adapter = createMutableAdapter({
      claude: buildState(
        "claude",
        [
          createProvider({
            providerId: "claude-primary",
            name: "Claude Primary",
            baseUrl: "https://api.anthropic.com",
            tokenField: "ANTHROPIC_AUTH_TOKEN",
            tokenConfigured: true,
            tokenMasked: "sk-ant-****",
            model: "claude-sonnet-4-5",
            notes: "Primary route",
            active: true,
          }),
          createProvider({
            providerId: "claude-backup",
            name: "Claude Backup",
            baseUrl: "https://gateway.example.com",
            tokenField: "ANTHROPIC_API_KEY",
            tokenConfigured: false,
            tokenMasked: "",
            model: "",
            notes: "",
          }),
        ],
        "claude-primary",
      ),
    });
    const { user } = renderManager(
      <SharedProviderManager adapter={adapter} defaultApp="claude" />,
    );

    await screen.findByText("Claude Primary");

    const detailPanel = document.querySelector(
      '[data-ccswitch-region="provider-detail-panel"]',
    ) as HTMLElement | null;

    expect(detailPanel).not.toBeNull();
    expect(detailPanel).toHaveTextContent("Claude Primary");
    expect(detailPanel).toHaveTextContent("General provider settings");
    expect(detailPanel).toHaveTextContent("Primary route");
    expect(detailPanel).toHaveTextContent("Stored secret");

    await user.click(screen.getByRole("tab", { name: "Credentials" }));

    expect(screen.getByRole("tab", { name: "Credentials" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(detailPanel).toHaveTextContent("Secret-safe reads only");
    expect(detailPanel).toHaveTextContent(
      "Blank preserves the stored secret during edits.",
    );
    expect(detailPanel).toHaveTextContent("sk-ant-****");
    expect(detailPanel).not.toHaveTextContent("No stored secret");

    await user.click(screen.getByText("Claude Backup"));

    expect(detailPanel).toHaveTextContent("Claude Backup");
    expect(detailPanel).toHaveTextContent("No stored secret");
    expect(detailPanel).toHaveTextContent(
      "Add a token in the editor to store credentials for this provider.",
    );
    expect(detailPanel).not.toHaveTextContent("Stored secret detected");
  });

  it("lets focused provider action buttons handle Enter without reselecting the card", async () => {
    const adapter = createMutableAdapter({
      claude: buildState(
        "claude",
        [
          createProvider({
            providerId: "claude-primary",
            name: "Claude Primary",
            baseUrl: "https://api.anthropic.com",
            tokenField: "ANTHROPIC_AUTH_TOKEN",
            active: true,
          }),
          createProvider({
            providerId: "claude-backup",
            name: "Claude Backup",
            baseUrl: "https://gateway.example.com",
            tokenField: "ANTHROPIC_API_KEY",
          }),
        ],
        "claude-primary",
      ),
    });
    const { user } = renderManager(
      <SharedProviderManager adapter={adapter} defaultApp="claude" />,
    );

    await screen.findByText("Claude Backup");
    await user.click(screen.getByText("Claude Backup"));

    const detailPanel = document.querySelector(
      '[data-ccswitch-region="provider-detail-panel"]',
    ) as HTMLElement | null;
    const deleteButton = screen.getByRole("button", {
      name: "Delete Claude Primary",
    });

    expect(detailPanel).toHaveTextContent("Claude Backup");

    deleteButton.focus();
    await user.keyboard("{Enter}");

    const deleteDialog = await screen.findByRole("dialog", {
      name: "Delete provider",
    });

    expect(deleteDialog).toBeInTheDocument();
    expect(detailPanel).toHaveTextContent("Claude Backup");
    expect(detailPanel).not.toHaveTextContent("Claude Primary");
  });

  it("filters providers locally by provider fields and matched preset labels", async () => {
    const adapter = createAdapter({
      listProviderState: vi.fn().mockResolvedValue(
        buildState(
          "codex",
          [
            createProvider({
              providerId: "alpha",
              name: "Alpha",
              baseUrl: "https://alpha.example.com/v1",
              tokenField: "OPENAI_API_KEY",
              notes: "LAN route",
            }),
            createProvider({
              providerId: "packy",
              name: "Gateway edge",
              baseUrl: "https://www.packyapi.com/v1",
              tokenField: "OPENAI_API_KEY",
            }),
          ],
          "alpha",
        ),
      ),
    });
    const { user } = renderManager(
      <SharedProviderManager adapter={adapter} defaultApp="codex" />,
    );

    expect(await screen.findByText("Alpha")).toBeInTheDocument();
    expect(screen.getByText("Gateway edge")).toBeInTheDocument();

    const searchInput = screen.getByLabelText("Search providers");

    await user.type(searchInput, "PackyCode");

    expect(
      await screen.findByText('Showing 1 result for "PackyCode" out of 2.'),
    ).toBeInTheDocument();
    expect(screen.getByText("Gateway edge")).toBeInTheDocument();
    expect(screen.queryByText("Alpha")).not.toBeInTheDocument();

    await user.clear(searchInput);
    await user.type(searchInput, "LAN route");

    expect(
      await screen.findByText('Showing 1 result for "LAN route" out of 2.'),
    ).toBeInTheDocument();
    expect(screen.getByText("Alpha")).toBeInTheDocument();
    expect(screen.queryByText("Gateway edge")).not.toBeInTheDocument();

    const clearSearchButton = screen.getByRole("button", {
      name: "Clear search",
    });
    clearSearchButton.focus();
    await user.keyboard("{Enter}");

    await waitFor(() =>
      expect(screen.queryByText(/Showing 1 result/)).not.toBeInTheDocument(),
    );
    expect(screen.getByText("Alpha")).toBeInTheDocument();
    expect(screen.getByText("Gateway edge")).toBeInTheDocument();
    expect(adapter.saveProvider).not.toHaveBeenCalled();
  });

  it("keeps keyboard app switching, dialog close, and search clearing on explicit roles and labels", async () => {
    const adapter = createMutableAdapter({
      claude: buildState(
        "claude",
        [
          createProvider({
            providerId: "claude-primary",
            name: "Claude Primary",
            baseUrl: "https://api.anthropic.com",
            tokenField: "ANTHROPIC_AUTH_TOKEN",
            active: true,
          }),
        ],
        "claude-primary",
      ),
      codex: buildState(
        "codex",
        [
          createProvider({
            providerId: "alpha",
            name: "Alpha",
            baseUrl: "https://alpha.example.com/v1",
            tokenField: "OPENAI_API_KEY",
            notes: "LAN route",
            active: true,
          }),
          createProvider({
            providerId: "beta",
            name: "Beta",
            baseUrl: "https://beta.example.com/v1",
            tokenField: "OPENAI_API_KEY",
          }),
        ],
        "alpha",
      ),
    });
    const { user } = renderManager(
      <SharedProviderManager adapter={adapter} defaultApp="claude" />,
    );

    expect(await screen.findByText("Claude Primary")).toBeInTheDocument();

    const codexButton = screen.getByRole("button", { name: "Codex" });
    codexButton.focus();
    expect(codexButton).toHaveFocus();

    await user.keyboard("[Space]");

    expect(await screen.findByText("Alpha")).toBeInTheDocument();
    expect(codexButton).toHaveAttribute("aria-pressed", "true");

    const searchInput = screen.getByLabelText("Search providers");
    await user.type(searchInput, "LAN route");

    expect(
      await screen.findByText('Showing 1 result for "LAN route" out of 2.'),
    ).toBeInTheDocument();

    const clearSearchButton = screen.getByRole("button", {
      name: "Clear search",
    });
    clearSearchButton.focus();
    expect(clearSearchButton).toHaveFocus();

    await user.keyboard("{Enter}");

    await waitFor(() => expect(searchInput).toHaveValue(""));
    await waitFor(() =>
      expect(screen.queryByText(/Showing 1 result/)).not.toBeInTheDocument(),
    );

    const deleteButton = screen.getByRole("button", { name: "Delete Alpha" });
    deleteButton.focus();
    expect(deleteButton).toHaveFocus();

    await user.keyboard("{Enter}");

    const deleteDialog = await screen.findByRole("dialog", {
      name: "Delete provider",
    });
    expect(deleteDialog).toHaveAccessibleDescription(
      "Delete Alpha from the saved Codex providers on this router.",
    );
    expect(
      within(deleteDialog).getByRole("button", { name: "Cancel" }),
    ).toHaveFocus();

    await user.keyboard("{Escape}");

    await waitFor(() =>
      expect(
        screen.queryByRole("dialog", { name: "Delete provider" }),
      ).not.toBeInTheDocument(),
    );

    const addProviderButton = screen.getByRole("button", {
      name: "Add provider",
    });
    addProviderButton.focus();
    expect(addProviderButton).toHaveFocus();

    await user.keyboard("{Enter}");

    const addDialog = await screen.findByRole("dialog", {
      name: "Save Codex provider",
    });
    expect(addDialog).toHaveAccessibleDescription(
      "Save a new Codex provider from a preset or a custom draft.",
    );
    expect(
      within(addDialog).getByLabelText("Provider name"),
    ).toBeInTheDocument();

    await user.keyboard("{Escape}");

    await waitFor(() =>
      expect(
        screen.queryByRole("dialog", { name: "Save Codex provider" }),
      ).not.toBeInTheDocument(),
    );
  });

  it("closes draft state on app switch and resets the add panel to the next app", async () => {
    const adapter = createMutableAdapter({
      claude: buildState("claude", [], null),
      codex: buildState("codex", [], null),
    });
    const { user, rerender, queryClient } = renderManager(
      <SharedProviderManager adapter={adapter} selectedApp="claude" />,
    );

    await screen.findByText("No Claude providers saved.");

    await user.click(
      screen.getAllByRole("button", { name: "Add provider" })[0]!,
    );

    const claudeDialog = await screen.findByRole("dialog", {
      name: "Save Claude provider",
    });
    await user.clear(within(claudeDialog).getByLabelText("Provider name"));
    await user.type(
      within(claudeDialog).getByLabelText("Provider name"),
      "Unsaved Claude",
    );

    rerender(
      <QueryClientProvider client={queryClient}>
        <SharedProviderManager adapter={adapter} selectedApp="codex" />
      </QueryClientProvider>,
    );

    expect(
      await screen.findByText("No Codex providers saved."),
    ).toBeInTheDocument();
    await waitFor(() =>
      expect(
        screen.queryByRole("dialog", { name: "Save Claude provider" }),
      ).not.toBeInTheDocument(),
    );

    await user.click(
      screen.getAllByRole("button", { name: "Add provider" })[0]!,
    );

    const codexDialog = await screen.findByRole("dialog", {
      name: "Save Codex provider",
    });
    const codexDialogScope = within(codexDialog);

    expect(codexDialogScope.getByLabelText("Provider name")).toHaveValue(
      "OpenAI Official",
    );
    expect(codexDialogScope.getByLabelText("Base URL")).toHaveValue(
      "https://api.openai.com/v1",
    );
  });

  it("does not synchronously paint the previous app draft during a controlled app switch", async () => {
    const adapter = createMutableAdapter({
      claude: buildState("claude", [], null),
      codex: buildState("codex", [], null),
    });
    const user = userEvent.setup();
    const container = document.createElement("div");
    document.body.appendChild(container);
    let mounted!: ReturnType<typeof mountSharedProviderManager>;

    act(() => {
      mounted = mountSharedProviderManager(container, {
        adapter,
        selectedApp: "claude",
      });
    });

    await waitFor(() =>
      expect(
        within(container).getByText("No Claude providers saved."),
      ).toBeInTheDocument(),
    );

    await user.click(
      within(container).getAllByRole("button", { name: "Add provider" })[0]!,
    );

    const addDialog = await screen.findByRole("dialog", {
      name: "Save Claude provider",
    });
    await user.clear(within(addDialog).getByLabelText("Provider name"));
    await user.type(
      within(addDialog).getByLabelText("Provider name"),
      "Unsaved Claude",
    );

    act(() => {
      flushSync(() => {
        mounted.update({
          adapter,
          selectedApp: "codex",
        });
      });

      expect(
        within(container).getByRole("button", { name: "Codex" }),
      ).toHaveAttribute("aria-pressed", "true");
      expect(
        screen.queryByRole("dialog", { name: "Save Claude provider" }),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByDisplayValue("Unsaved Claude"),
      ).not.toBeInTheDocument();
    });

    act(() => {
      mounted.unmount();
    });
    container.remove();
  });

  it("ignores stale save completions after the selected app changes", async () => {
    const { adapter, resolveSave } = createSaveRaceAdapter();
    const { user, rerender, queryClient, container } = renderManager(
      <SharedProviderManager adapter={adapter} selectedApp="claude" />,
    );

    await screen.findByText("No Claude providers saved.");

    await user.click(
      within(container).getAllByRole("button", { name: "Add provider" })[0]!,
    );

    const addDialog = await screen.findByRole("dialog", {
      name: "Save Claude provider",
    });
    const addDialogScope = within(addDialog);

    expect(addDialogScope.getByLabelText("Provider name")).toHaveValue(
      "Claude Official",
    );

    await user.type(addDialogScope.getByLabelText("API token"), "secret-token");
    await user.click(
      addDialogScope.getByRole("button", { name: "Save provider" }),
    );

    rerender(
      <QueryClientProvider client={queryClient}>
        <SharedProviderManager adapter={adapter} selectedApp="codex" />
      </QueryClientProvider>,
    );

    expect(
      await screen.findByText("No Codex providers saved."),
    ).toBeInTheDocument();
    await waitFor(() =>
      expect(
        screen.queryByRole("dialog", { name: "Save Claude provider" }),
      ).not.toBeInTheDocument(),
    );

    resolveSave();

    await waitFor(() =>
      expect(
        within(container).getAllByRole("button", { name: "Add provider" })[0],
      ).toBeEnabled(),
    );
    expect(screen.queryByText("Provider saved.")).not.toBeInTheDocument();

    await user.click(
      within(container).getAllByRole("button", { name: "Add provider" })[0]!,
    );

    const codexDialog = await screen.findByRole("dialog", {
      name: "Save Codex provider",
    });
    const codexDialogScope = within(codexDialog);

    expect(codexDialogScope.getByLabelText("Provider name")).toHaveValue(
      "OpenAI Official",
    );
    expect(codexDialogScope.getByLabelText("Base URL")).toHaveValue(
      "https://api.openai.com/v1",
    );
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

    const activateBetaButton = screen.getByRole("button", {
      name: "Activate Beta",
    });
    activateBetaButton.focus();
    await user.keyboard("{Enter}");

    await waitFor(() =>
      expect(adapter.activateProvider).toHaveBeenCalledWith("codex", "beta"),
    );

    const betaCard = screen.getByText("Beta").closest("article");
    expect(
      within(betaCard as HTMLElement).getByText("Active provider", {
        selector: "span",
      }),
    ).toBeInTheDocument();

    const deleteAlphaButton = screen.getByRole("button", { name: "Delete Alpha" });
    deleteAlphaButton.focus();
    await user.keyboard("{Enter}");
    const confirmDeleteButton = screen.getByRole("button", {
      name: "Delete provider",
    });
    confirmDeleteButton.focus();
    await user.keyboard("{Enter}");

    await waitFor(() =>
      expect(adapter.deleteProvider).toHaveBeenCalledWith("codex", "alpha"),
    );
    expect(screen.queryByText("Alpha")).not.toBeInTheDocument();
  });

  it("duplicates a provider into a seeded add draft and saves it through the create path", async () => {
    const adapter = createMutableAdapter({
      codex: buildState(
        "codex",
        [
          createProvider({
            providerId: "alpha",
            name: "Alpha",
            baseUrl: "https://alpha.example.com/v1",
            tokenField: "OPENAI_API_KEY",
            tokenConfigured: true,
            model: "gpt-5.4",
            notes: "Primary route",
            active: true,
          }),
          createProvider({
            providerId: "alpha-copy",
            name: "Alpha copy",
            baseUrl: "https://alpha-copy.example.com/v1",
            tokenField: "OPENAI_API_KEY",
            tokenConfigured: false,
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

    await screen.findByRole("button", { name: "Edit Alpha" });

    const alphaCard = document.querySelector("article");
    expect(alphaCard).not.toBeNull();
    expect(
      within(alphaCard as HTMLElement).queryByRole("button", {
        name: "Duplicate Alpha",
      }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Duplicate selected Alpha" }),
    ).toBeInTheDocument();

    await user.click(
      screen.getByRole("button", { name: "Duplicate selected Alpha" }),
    );

    const duplicateDialog = await screen.findByRole("dialog", {
      name: "Save Codex provider",
    });
    const duplicateDialogScope = within(duplicateDialog);

    expect(duplicateDialogScope.getByLabelText("Provider name")).toHaveValue(
      "Alpha copy 2",
    );
    expect(duplicateDialogScope.getByLabelText("Base URL")).toHaveValue(
      "https://alpha.example.com/v1",
    );
    expect(duplicateDialogScope.getByLabelText("Model")).toHaveValue("gpt-5.4");
    expect(duplicateDialogScope.getByLabelText("Notes")).toHaveValue(
      "Primary route",
    );
    expect(duplicateDialogScope.getByLabelText("API token")).toHaveValue("");
    expect(
      duplicateDialogScope.queryByText(
        "Leave the token blank to preserve the stored secret.",
      ),
    ).not.toBeInTheDocument();

    await user.type(
      duplicateDialogScope.getByLabelText("API token"),
      "duplicate-secret",
    );
    await user.click(
      duplicateDialogScope.getByRole("button", { name: "Save provider" }),
    );

    await waitFor(() =>
      expect(adapter.saveProvider).toHaveBeenLastCalledWith(
        "codex",
        expect.objectContaining({
          name: "Alpha copy 2",
          baseUrl: "https://alpha.example.com/v1",
          tokenField: "OPENAI_API_KEY",
          token: "duplicate-secret",
          model: "gpt-5.4",
          notes: "Primary route",
        }),
        undefined,
      ),
    );
    expect(await screen.findByText("Alpha copy 2")).toBeInTheDocument();
  });

  it("hides unsupported add and edit entry points when the adapter disables them", async () => {
    const adapter = createAdapter({
      listProviderState: vi.fn().mockResolvedValue(
        buildState(
          "claude",
          [
            createProvider({
              providerId: "alpha",
              name: "Alpha",
              baseUrl: "https://alpha.example.com",
            }),
          ],
          "alpha",
        ),
      ),
      getCapabilities: vi.fn().mockResolvedValue({
        canAdd: false,
        canEdit: false,
        canDelete: true,
        canActivate: true,
        supportsPresets: true,
        supportsBlankSecretPreserve: true,
        requiresServiceRestart: true,
      } satisfies SharedProviderCapabilities),
    });

    const { container } = renderManager(
      <SharedProviderManager adapter={adapter} />,
    );

    expect(await screen.findByText("Alpha")).toBeInTheDocument();
    await waitFor(() =>
      expect(
        within(container).queryByRole("button", { name: "Add provider" }),
      ).not.toBeInTheDocument(),
    );
    await waitFor(() =>
      expect(
        within(container).queryByRole("button", { name: "Edit Alpha" }),
      ).not.toBeInTheDocument(),
    );
    expect(screen.queryByText("Save provider")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Provider name")).not.toBeInTheDocument();
    expect(
      screen.getByText(
        "Claude providers stay visible here, but this surface is read-only for provider changes on this router.",
      ),
    ).toBeInTheDocument();
  });
});
