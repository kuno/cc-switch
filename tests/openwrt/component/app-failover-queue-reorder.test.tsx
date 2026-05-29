import { type ReactNode } from "react";
import { act, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { AppsGrid } from "@/openwrt-provider-ui/components/AppsGrid";
import type { OpenWrtStatusResponse } from "@/openwrt-provider-ui/pageTypes";
import {
  createProviderState,
  createProviderView,
} from "../provider-panel-fixtures";
import type { SharedProviderState } from "@/shared/providers/domain";
import { createBridgeFixture } from "./fixtures/bridge";
import { createProviderTransportFixture } from "./fixtures/providerTransport";

const dndHarness = vi.hoisted(() => ({
  onDragEnd: null as
    | ((event: { active: { id: string }; over: { id: string } | null }) => void)
    | null,
}));

vi.mock("@dnd-kit/core", () => ({
  closestCenter: vi.fn(),
  DndContext: ({
    children,
    onDragEnd,
  }: {
    children: ReactNode;
    onDragEnd: typeof dndHarness.onDragEnd;
  }) => {
    dndHarness.onDragEnd = onDragEnd;
    return <div data-testid="mock-dnd-context">{children}</div>;
  },
  KeyboardSensor: vi.fn(),
  PointerSensor: vi.fn(),
  useSensor: vi.fn((sensor, options) => ({ sensor, options })),
  useSensors: vi.fn((...sensors) => sensors),
}));

vi.mock("@dnd-kit/sortable", () => ({
  arrayMove: <T,>(items: T[], from: number, to: number) => {
    const nextItems = [...items];
    const [item] = nextItems.splice(from, 1);
    nextItems.splice(to, 0, item);
    return nextItems;
  },
  SortableContext: ({ children }: { children: ReactNode }) => children,
  sortableKeyboardCoordinates: vi.fn(),
  useSortable: ({ id }: { id: string }) => ({
    attributes: {
      "data-dnd-id": id,
    },
    isDragging: false,
    listeners: {},
    setNodeRef: vi.fn(),
    transform: null,
    transition: undefined,
  }),
  verticalListSortingStrategy: {},
}));

vi.mock("@dnd-kit/utilities", () => ({
  CSS: {
    Transform: {
      toString: vi.fn(() => undefined),
    },
  },
}));

function createStatusFromProviderState(
  providerState: SharedProviderState,
  failoverQueue: string[],
): OpenWrtStatusResponse {
  const activeProviderId = providerState.activeProviderId;
  const providers = Object.fromEntries(
    providerState.providers.map((provider) => [
      provider.providerId ?? provider.name,
      {
        ...provider,
        providerId: provider.providerId,
        configured: provider.configured,
        active: provider.providerId === activeProviderId,
        baseUrl: provider.baseUrl,
        tokenField: provider.tokenField,
        tokenConfigured: provider.tokenConfigured,
        tokenMasked: provider.tokenMasked,
        stats: null,
        quota: null,
      },
    ]),
  );
  const providersById = new Map(
    providerState.providers.map((provider) => [provider.providerId, provider]),
  );

  return {
    daemon: {
      health: true,
      running: true,
      uptimeSeconds: 3600,
      lastError: null,
      checkedAt: "2026-04-22T00:00:00.000Z",
    },
    apps: {
      claude: {
        mode: "failover",
        proxyEnabled: true,
        health: true,
        healthReason: null,
        maxRetries: 3,
        usage: null,
        activeProvider: activeProviderId
          ? {
              providerId: activeProviderId,
              name: providerState.activeProvider.name,
            }
          : null,
        providers,
        failoverQueue: failoverQueue.map((providerId, index) => ({
          providerId,
          providerName: providersById.get(providerId)?.name ?? providerId,
          sortIndex: index,
          active: providerId === activeProviderId,
          health: {
            providerId,
            observed: false,
            healthy: true,
            consecutiveFailures: 0,
            lastSuccessAt: null,
            lastFailureAt: null,
            lastError: null,
            updatedAt: null,
          },
        })),
        failoverStatus: Object.fromEntries(
          failoverQueue.map((providerId, index) => [
            providerId,
            {
              inFailoverQueue: true,
              queuePosition: index,
              currentRole:
                providerId === activeProviderId ? "active" : "standby",
              health: {
                providerId,
                observed: false,
                healthy: true,
                consecutiveFailures: 0,
                lastSuccessAt: null,
                lastFailureAt: null,
                lastError: null,
                updatedAt: null,
              },
            },
          ]),
        ),
      },
      codex: { mode: "normal", maxRetries: 3, providers: {} },
      gemini: { mode: "normal", maxRetries: 3, providers: {} },
    },
  };
}

describe("AppsGrid failover queue reorder", () => {
  it("persists queue row drag through provider display order", async () => {
    const primaryProvider = createProviderView("claude", {
      active: true,
      name: "Claude Primary",
      providerId: "claude-primary",
    });
    const backupProvider = createProviderView("claude", {
      active: false,
      name: "Claude Backup",
      providerId: "claude-backup",
    });
    const fallbackProvider = createProviderView("claude", {
      active: false,
      name: "Claude Fallback",
      providerId: "claude-fallback",
    });
    const providerState = createProviderState("claude", [
      primaryProvider,
      backupProvider,
      fallbackProvider,
    ]);
    const { transport, getFailoverState } = createProviderTransportFixture({
      claude: providerState,
      codex: createProviderState("codex", [], null),
      gemini: createProviderState("gemini", [], null),
    });

    await transport.addToFailoverQueue?.("claude", "claude-primary");
    await transport.addToFailoverQueue?.("claude", "claude-fallback");
    await transport.setAutoFailoverEnabled?.("claude", true);
    const shell = createBridgeFixture({
      selectedApp: "claude",
      status: createStatusFromProviderState(
        providerState,
        getFailoverState("claude").queue,
      ),
    });

    render(
      <AppsGrid
        options={{
          target: document.body,
          shell,
          transport,
        }}
        onOpenActivity={vi.fn()}
        onOpenProviderPanel={vi.fn()}
      />,
    );

    await screen.findByText("Claude Fallback");
    expect(
      screen.getByRole("button", { name: "Reorder Claude Primary" }),
    ).toBeEnabled();

    act(() => {
      dndHarness.onDragEnd?.({
        active: { id: "claude-fallback" },
        over: { id: "claude-primary" },
      });
    });

    await waitFor(() =>
      expect(transport.reorderProviders).toHaveBeenCalledWith("claude", [
        "claude-fallback",
        "claude-backup",
        "claude-primary",
      ]),
    );
    await waitFor(() =>
      expect(getFailoverState("claude").queue).toEqual([
        "claude-fallback",
        "claude-primary",
      ]),
    );
  });
});
