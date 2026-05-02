import { type ReactNode, useRef } from "react";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ProviderSidePanel } from "@/openwrt-provider-ui/components/ProviderSidePanel";
import {
  ProviderSidePanelHost,
  type ProviderSidePanelHandle,
} from "@/openwrt-provider-ui/components/ProviderSidePanelHost";
import type { OpenWrtSharedPageShellApi } from "@/openwrt-provider-ui/pageTypes";
import type { OpenWrtProviderTransport } from "@/platform/openwrt/providers";
import {
  createProviderSidePanelProps,
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

function HostHarness({
  shell,
  transport,
}: {
  shell: OpenWrtSharedPageShellApi;
  transport: OpenWrtProviderTransport;
}) {
  const panelRef = useRef<ProviderSidePanelHandle | null>(null);

  return (
    <>
      <button
        type="button"
        onClick={() => panelRef.current?.openForApp("claude")}
      >
        Open provider panel
      </button>
      <ProviderSidePanelHost
        ref={panelRef}
        selectedApp="claude"
        shell={shell}
        transport={transport}
      />
    </>
  );
}

describe("ProviderSidePanel provider reorder", () => {
  it("emits a full provider-id order from the unfiltered rail drag end", () => {
    const onReorderProviders = vi.fn();
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

    render(
      <ProviderSidePanel
        {...createProviderSidePanelProps({
          providers: [primaryProvider, backupProvider],
          providerReorderAvailable: true,
          callbacks: {
            onReorderProviders,
          },
        })}
      />,
    );

    expect(
      screen.getByRole("button", { name: "Reorder Claude Primary" }),
    ).toBeEnabled();

    act(() => {
      dndHarness.onDragEnd?.({
        active: { id: "claude-primary" },
        over: { id: "claude-backup" },
      });
    });

    expect(onReorderProviders).toHaveBeenCalledWith([
      "claude-backup",
      "claude-primary",
    ]);
  });

  it("persists provider reorder through the host while preserving selected draft edits", async () => {
    const user = userEvent.setup();
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
    const { transport } = createProviderTransportFixture({
      claude: createProviderState("claude", [primaryProvider, backupProvider]),
    });

    render(<HostHarness shell={shell} transport={transport} />);

    await user.click(
      screen.getByRole("button", {
        name: "Open provider panel",
      }),
    );
    const dialog = await screen.findByRole("dialog", {
      name: "Claude providers",
    });

    await user.click(within(dialog).getByRole("button", { name: "Configure" }));
    await user.click(within(dialog).getByRole("button", { name: "Edit" }));
    await user.clear(within(dialog).getByLabelText("Provider name"));
    await user.type(
      within(dialog).getByLabelText("Provider name"),
      "Unsaved primary draft",
    );

    act(() => {
      dndHarness.onDragEnd?.({
        active: { id: "claude-primary" },
        over: { id: "claude-backup" },
      });
    });

    await waitFor(() =>
      expect(transport.reorderProviders).toHaveBeenCalledWith("claude", [
        "claude-backup",
        "claude-primary",
      ]),
    );

    const rows = Array.from(
      dialog.querySelectorAll<HTMLButtonElement>(
        ".owt-provider-panel__provider-row",
      ),
    );

    expect(rows[0]).toHaveTextContent("Claude Backup");
    expect(rows[1]).toHaveTextContent("Claude Primary");
    expect(within(dialog).getByLabelText("Provider name")).toHaveValue(
      "Unsaved primary draft",
    );
  });

  it("re-derives failover priority from the reordered provider rail", async () => {
    const user = userEvent.setup();
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
    const { transport, getFailoverState, getProviderState, setFailoverState } =
      createProviderTransportFixture({
        claude: createProviderState("claude", [
          primaryProvider,
          backupProvider,
          fallbackProvider,
        ]),
      });
    setFailoverState("claude", {
      queue: ["claude-primary", "claude-fallback"],
    });

    render(<HostHarness shell={shell} transport={transport} />);

    await user.click(
      screen.getByRole("button", {
        name: "Open provider panel",
      }),
    );
    const dialog = await screen.findByRole("dialog", {
      name: "Claude providers",
    });

    act(() => {
      dndHarness.onDragEnd?.({
        active: { id: "claude-fallback" },
        over: { id: "claude-primary" },
      });
    });

    await waitFor(() =>
      expect(transport.reorderProviders).toHaveBeenCalledWith("claude", [
        "claude-fallback",
        "claude-primary",
        "claude-backup",
      ]),
    );
    await waitFor(() =>
      expect(getFailoverState("claude").queue).toEqual([
        "claude-fallback",
        "claude-primary",
      ]),
    );

    const primaryFailoverState = await transport.getProviderFailoverState!(
      "claude",
      "claude-primary",
    );

    expect(primaryFailoverState).toMatchObject({
      queuePosition: 1,
      failoverQueueDepth: 2,
    });
    expect(primaryFailoverState.failoverQueue).toMatchObject([
      { providerId: "claude-fallback", sortIndex: 0 },
      { providerId: "claude-primary", sortIndex: 1 },
    ]);

    await transport.setAutoFailoverEnabled!("claude", true);
    expect(getProviderState("claude").activeProviderId).toBe("claude-fallback");
    expect(
      Array.from(
        dialog.querySelectorAll<HTMLButtonElement>(
          ".owt-provider-panel__provider-row",
        ),
      )[0],
    ).toHaveTextContent("Claude Fallback");
  });
});
