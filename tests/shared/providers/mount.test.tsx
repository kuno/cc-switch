import { act, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import {
  emptySharedProviderView,
  mountSharedProviderManager,
  type ProviderPlatformAdapter,
  type SharedProviderAppId,
  type SharedProviderCapabilities,
  type SharedProviderState,
} from "@/shared/providers";

function buildState(appId: SharedProviderAppId): SharedProviderState {
  return {
    phase2Available: true,
    providers: [],
    activeProviderId: null,
    activeProvider: emptySharedProviderView(appId),
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

describe("mountSharedProviderManager", () => {
  it("mounts, updates controlled app selection, and unmounts", async () => {
    const adapter = createAdapter();
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
        within(container).getByText("No providers saved for Claude yet."),
      ).toBeInTheDocument(),
    );

    await act(async () => {
      mounted.update({
        adapter,
        selectedApp: "gemini",
      });
    });

    await waitFor(() =>
      expect(
        within(container).getByText("No providers saved for Gemini yet."),
      ).toBeInTheDocument(),
    );

    await act(async () => {
      mounted.unmount();
    });

    expect(container.innerHTML).toBe("");
    container.remove();
  });
});
