import {
  createEvent,
  fireEvent,
  render,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AppsGrid } from "@/openwrt-provider-ui/components/AppsGrid";
import { createProviderTransportFixture } from "../fixtures/openwrtProviderUi";
import { createBridgeFixture } from "./fixtures/bridge";

const APP_CARD_ORDER_STORAGE_KEY = "ccswitch-openwrt-app-card-order";

function appOrder(container: HTMLElement): string[] {
  return Array.from(
    container.querySelectorAll<HTMLElement>(".owt-app-card[data-app]"),
  ).map((card) => card.dataset.app ?? "");
}

function dataTransfer() {
  return {
    dropEffect: "none",
    effectAllowed: "all",
    setData: vi.fn(),
  };
}

function mockCardRect(card: Element) {
  vi.spyOn(card, "getBoundingClientRect").mockReturnValue({
    bottom: 100,
    height: 80,
    left: 0,
    right: 200,
    top: 20,
    width: 200,
    x: 0,
    y: 20,
    toJSON: () => ({}),
  });
}

function dragOverAt(
  card: Element,
  clientX: number,
  transfer: ReturnType<typeof dataTransfer>,
) {
  const event = createEvent.dragOver(card, { dataTransfer: transfer });
  Object.defineProperty(event, "clientX", { value: clientX });
  fireEvent(card, event);
}

function dropAt(
  card: Element,
  clientX: number,
  transfer: ReturnType<typeof dataTransfer>,
) {
  const event = createEvent.drop(card, { dataTransfer: transfer });
  Object.defineProperty(event, "clientX", { value: clientX });
  fireEvent(card, event);
}

afterEach(() => {
  window.localStorage.removeItem(APP_CARD_ORDER_STORAGE_KEY);
});

describe("AppsGrid app-card reorder", () => {
  it("reorders configured cards and keeps the order across refreshes", async () => {
    const bridge = createBridgeFixture();
    const transport = createProviderTransportFixture();
    const props = {
      options: {
        target: document.body,
        shell: bridge,
        transport,
      },
      onOpenActivity: vi.fn(),
      onOpenProviderPanel: vi.fn(),
    };
    const { container, rerender } = render(
      <AppsGrid {...props} providerMutationVersion={0} />,
    );

    await waitFor(() => {
      expect(
        container.querySelector('.owt-app-card[data-app="claude"]'),
      ).toBeInTheDocument();
    });

    expect(appOrder(container)).toEqual([
      "claude",
      "codex",
      "gemini",
      "opencode",
      "openclaw",
    ]);
    expect(
      container.querySelector('.owt-app-card[data-app="claude"]'),
    ).toHaveAttribute("data-reorderable", "true");
    expect(
      container.querySelector('.owt-app-card[data-app="opencode"]'),
    ).not.toHaveAttribute("data-reorderable", "true");

    const transfer = dataTransfer();
    fireEvent.dragStart(
      container.querySelector(
        '.owt-app-card[data-app="gemini"] .owt-app-card__drag-handle',
      )!,
      {
        dataTransfer: transfer,
      },
    );
    fireEvent.dragOver(
      container.querySelector('.owt-app-card[data-app="claude"]')!,
      { dataTransfer: transfer },
    );
    fireEvent.drop(
      container.querySelector('.owt-app-card[data-app="claude"]')!,
      {
        dataTransfer: transfer,
      },
    );

    await waitFor(() => {
      expect(appOrder(container)).toEqual([
        "gemini",
        "claude",
        "codex",
        "opencode",
        "openclaw",
      ]);
    });
    expect(
      JSON.parse(window.localStorage.getItem(APP_CARD_ORDER_STORAGE_KEY)!),
    ).toEqual(["gemini", "claude", "codex", "opencode", "openclaw"]);

    rerender(<AppsGrid {...props} providerMutationVersion={1} />);

    await waitFor(() => {
      expect(appOrder(container)).toEqual([
        "gemini",
        "claude",
        "codex",
        "opencode",
        "openclaw",
      ]);
    });
  });

  it("shows a drop edge on the configured app currently under drag", async () => {
    const { container } = render(
      <AppsGrid
        options={{
          target: document.body,
          shell: createBridgeFixture(),
          transport: createProviderTransportFixture(),
        }}
        onOpenActivity={vi.fn()}
        onOpenProviderPanel={vi.fn()}
      />,
    );

    await waitFor(() => {
      expect(
        container.querySelector('.owt-app-card[data-app="claude"]'),
      ).toBeInTheDocument();
    });

    const transfer = dataTransfer();
    fireEvent.dragStart(
      container.querySelector(
        '.owt-app-card[data-app="claude"] .owt-app-card__drag-handle',
      )!,
      {
        dataTransfer: transfer,
      },
    );
    const targetCard = container.querySelector(
      '.owt-app-card[data-app="codex"]',
    )!;
    mockCardRect(targetCard);
    dragOverAt(targetCard, 160, transfer);

    expect(targetCard).toHaveAttribute("data-drop-position", "after");

    fireEvent.dragEnd(
      container.querySelector(
        '.owt-app-card[data-app="claude"] .owt-app-card__drag-handle',
      )!,
      {
        dataTransfer: transfer,
      },
    );

    expect(
      container.querySelector('.owt-app-card[data-app="codex"]'),
    ).not.toHaveAttribute("data-drop-position");
  });

  it("uses the hovered half of the target card for before or after placement", async () => {
    const { container } = render(
      <AppsGrid
        options={{
          target: document.body,
          shell: createBridgeFixture(),
          transport: createProviderTransportFixture(),
        }}
        onOpenActivity={vi.fn()}
        onOpenProviderPanel={vi.fn()}
      />,
    );

    await waitFor(() => {
      expect(
        container.querySelector('.owt-app-card[data-app="claude"]'),
      ).toBeInTheDocument();
    });

    const targetCard = container.querySelector(
      '.owt-app-card[data-app="claude"]',
    )!;
    mockCardRect(targetCard);

    const transfer = dataTransfer();
    fireEvent.dragStart(
      container.querySelector(
        '.owt-app-card[data-app="gemini"] .owt-app-card__drag-handle',
      )!,
      {
        dataTransfer: transfer,
      },
    );
    dragOverAt(targetCard, 160, transfer);

    expect(targetCard).toHaveAttribute("data-drop-position", "after");

    dropAt(targetCard, 160, transfer);

    await waitFor(() => {
      expect(appOrder(container)).toEqual([
        "claude",
        "gemini",
        "codex",
        "opencode",
        "openclaw",
      ]);
    });
  });
});
