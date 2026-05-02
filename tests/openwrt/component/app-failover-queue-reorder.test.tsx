import { type ReactNode } from "react";
import { act, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { AppsGrid } from "@/openwrt-provider-ui/components/AppsGrid";
import {
  createProviderState,
  createProviderView,
} from "../provider-panel-fixtures";
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

describe("AppsGrid failover queue reorder", () => {
  it("persists queue row drag through provider display order", async () => {
    const shell = createBridgeFixture({ selectedApp: "claude" });
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
    const { transport, getFailoverState } = createProviderTransportFixture({
      claude: createProviderState("claude", [
        primaryProvider,
        backupProvider,
        fallbackProvider,
      ]),
      codex: createProviderState("codex", [], null),
      gemini: createProviderState("gemini", [], null),
    });

    await transport.addToFailoverQueue?.("claude", "claude-primary");
    await transport.addToFailoverQueue?.("claude", "claude-fallback");
    await transport.setAutoFailoverEnabled?.("claude", true);

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
