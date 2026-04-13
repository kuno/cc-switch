import { act, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import {
  emptySharedProviderView,
  mountSharedProviderManager,
  type ProviderPlatformAdapter,
  type SharedProviderAppId,
  type SharedProviderCapabilities,
  type SharedProviderState,
  type SharedProviderView,
} from "@/shared/providers";

function createProvider(
  appId: SharedProviderAppId,
  partial: Partial<SharedProviderView> & {
    providerId: string;
    name: string;
    baseUrl: string;
  },
): SharedProviderView {
  const defaultTokenFieldByApp = {
    claude: "ANTHROPIC_AUTH_TOKEN",
    codex: "OPENAI_API_KEY",
    gemini: "GEMINI_API_KEY",
  } as const;

  return {
    configured: true,
    providerId: partial.providerId,
    name: partial.name,
    baseUrl: partial.baseUrl,
    tokenField: partial.tokenField ?? defaultTokenFieldByApp[appId],
    tokenConfigured: partial.tokenConfigured ?? true,
    tokenMasked: partial.tokenMasked ?? "********",
    model: partial.model ?? "",
    notes: partial.notes ?? "",
    active: partial.active ?? false,
  };
}

function buildState(
  appId: SharedProviderAppId,
  providers: SharedProviderView[] = [],
  activeProviderId: string | null = providers.find((provider) => provider.active)
    ?.providerId ?? null,
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

function createAdapter(): ProviderPlatformAdapter {
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
    listProviderState: vi.fn(async (appId: SharedProviderAppId) =>
      buildState(appId),
    ),
    saveProvider: vi.fn().mockResolvedValue(undefined),
    activateProvider: vi.fn().mockResolvedValue(undefined),
    deleteProvider: vi.fn().mockResolvedValue(undefined),
    restartServiceIfNeeded: vi.fn().mockResolvedValue(undefined),
    getCapabilities: vi.fn().mockResolvedValue(capabilities),
  };
}

function createAdapterWithState(
  states: Record<SharedProviderAppId, SharedProviderState>,
): ProviderPlatformAdapter {
  const adapter = createAdapter();

  return {
    ...adapter,
    listProviderState: vi.fn(async (appId: SharedProviderAppId) => states[appId]),
  };
}

describe("mountSharedProviderManager", () => {
  it("mounts the shared provider surface, updates controlled app selection, and unmounts", async () => {
    const adapter = createAdapterWithState({
      claude: buildState(
        "claude",
        [
          createProvider("claude", {
            active: true,
            baseUrl: "https://claude-primary.example.com",
            model: "claude-sonnet-4-5",
            name: "Claude Primary",
            providerId: "claude-primary",
          }),
        ],
        "claude-primary",
      ),
      codex: buildState("codex"),
      gemini: buildState(
        "gemini",
        [
          createProvider("gemini", {
            active: true,
            baseUrl: "https://gemini-primary.example.com",
            model: "gemini-3.1-pro",
            name: "Gemini Primary",
            notes: "Router fallback",
            providerId: "gemini-primary",
          }),
        ],
        "gemini-primary",
      ),
    });
    const container = document.createElement("div");
    document.body.appendChild(container);

    let mounted!: ReturnType<typeof mountSharedProviderManager>;

    await act(async () => {
      mounted = mountSharedProviderManager(container, {
        adapter,
        selectedApp: "claude",
      });
    });

    await waitFor(() =>
      expect(
        within(container).getByRole("button", { name: "Edit Claude Primary" }),
      ).toBeInTheDocument(),
    );
    const claudeCard = within(container)
      .getByText("Claude Primary")
      .closest("article");

    expect(claudeCard).not.toBeNull();
    expect(claudeCard).toHaveTextContent(
      "Base URL: https://claude-primary.example.com",
    );
    expect(claudeCard).toHaveTextContent("Provider ID: claude-primary");

    await act(async () => {
      mounted.update({
        adapter,
        selectedApp: "gemini",
      });
    });

    await waitFor(() =>
      expect(
        within(container).getByRole("button", { name: "Edit Gemini Primary" }),
      ).toBeInTheDocument(),
    );
    const geminiCard = within(container)
      .getByText("Gemini Primary")
      .closest("article");

    expect(geminiCard).not.toBeNull();
    expect(geminiCard).toHaveTextContent(
      "Base URL: https://gemini-primary.example.com",
    );
    expect(geminiCard).toHaveTextContent("Model: gemini-3.1-pro");
    expect(geminiCard).toHaveTextContent("Router fallback");

    await act(async () => {
      mounted.unmount();
    });

    expect(container.innerHTML).toBe("");
    container.remove();
  });
});
