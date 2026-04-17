import { type ReactElement } from "react";
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
  type SharedProviderState,
  type SharedProviderView,
} from "@/shared/providers";
import { createTestQueryClient } from "../../utils/testQueryClient";

function buildState(
  appId: SharedProviderAppId,
  providers: SharedProviderView[],
  activeProviderId: string | null,
): SharedProviderState {
  const activeProvider =
    providers.find((provider) => provider.providerId === activeProviderId) ??
    emptySharedProviderView(appId);

  return {
    phase2Available: true,
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

function cloneState(state: SharedProviderState): SharedProviderState {
  return {
    phase2Available: state.phase2Available,
    activeProviderId: state.activeProviderId,
    activeProvider: { ...state.activeProvider },
    providers: state.providers.map((provider) => ({ ...provider })),
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
    tokenField: partial.tokenField ?? "OPENAI_API_KEY",
    tokenConfigured: partial.tokenConfigured ?? true,
    tokenMasked: partial.tokenMasked ?? "********",
    model: partial.model ?? "gpt-5.4",
    notes: partial.notes ?? "",
    active: partial.active ?? false,
    authMode: partial.authMode,
    codexAuth: partial.codexAuth,
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

describe("SharedProviderManager editor provider refresh", () => {
  it("keeps the editor wired to the live provider while editing an existing provider", async () => {
    let state = buildState(
      "codex",
      [
        createProvider({
          providerId: "codex-openai",
          name: "OpenAI Official",
          baseUrl: "https://api.openai.com/v1",
          tokenField: "OPENAI_API_KEY",
          authMode: "codex_oauth",
        }),
      ],
      "codex-openai",
    );

    const capabilities: SharedProviderCapabilities = {
      canAdd: true,
      canEdit: true,
      canDelete: true,
      canActivate: true,
      supportsPresets: true,
      supportsBlankSecretPreserve: true,
      requiresServiceRestart: true,
    };

    const adapter: ProviderPlatformAdapter = {
      listProviderState: vi.fn(async () => cloneState(state)),
      saveProvider: vi.fn().mockResolvedValue(undefined),
      activateProvider: vi.fn().mockResolvedValue(undefined),
      deleteProvider: vi.fn().mockResolvedValue(undefined),
      restartServiceIfNeeded: vi.fn().mockResolvedValue(undefined),
      getCapabilities: vi.fn().mockResolvedValue(capabilities),
    };

    const { queryClient, user } = renderManager(
      <SharedProviderManager adapter={adapter} defaultApp="codex" />,
    );

    await screen.findByRole("button", { name: "Edit OpenAI Official" });

    await user.click(
      screen.getByRole("button", { name: "Edit OpenAI Official" }),
    );

    const dialog = await screen.findByRole("dialog", {
      name: "Update Codex provider",
    });
    const dialogScope = within(dialog);

    expect(dialogScope.queryByText("Stored auth.json")).not.toBeInTheDocument();

    state = buildState(
      "codex",
      [
        createProvider({
          providerId: "codex-openai",
          name: "OpenAI Official",
          baseUrl: "https://api.openai.com/v1",
          tokenField: "OPENAI_API_KEY",
          authMode: "codex_oauth",
          codexAuth: {
            accountId: "acct-live-refresh",
            expiresAt: 1735689600,
            refreshTokenPresent: true,
          },
        }),
      ],
      "codex-openai",
    );

    await queryClient.invalidateQueries({
      queryKey: ["shared-provider-manager", "state", "codex"],
    });

    await waitFor(() =>
      expect(dialogScope.getByText("Stored auth.json")).toBeInTheDocument(),
    );
    expect(
      dialogScope.getByText("Account ID: acct-live-refresh"),
    ).toBeInTheDocument();
    expect(
      dialogScope.getByText("Refresh token present: yes"),
    ).toBeInTheDocument();
    expect(
      dialogScope.getByText("Expires at: 1735689600"),
    ).toBeInTheDocument();
  });
});
