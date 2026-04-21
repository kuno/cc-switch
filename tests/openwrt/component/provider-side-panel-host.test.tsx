import { type ReactElement, useRef } from "react";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import {
  ProviderSidePanelHost,
  type ProviderSidePanelHandle,
} from "@/openwrt-provider-ui/components/ProviderSidePanelHost";
import type { OpenWrtSharedPageShellApi } from "@/openwrt-provider-ui/pageTypes";
import type { OpenWrtProviderTransport } from "@/platform/openwrt/providers";
import { createBridgeFixture } from "./fixtures/bridge";
import { createProviderTransportFixture } from "./fixtures/providerTransport";
import {
  createProviderState,
  createProviderView,
} from "../provider-panel-fixtures";

function HostHarness({
  providerId,
  selectedApp = "claude",
  shell,
  transport,
}: {
  providerId?: string;
  selectedApp?: "claude" | "codex" | "gemini";
  shell: OpenWrtSharedPageShellApi;
  transport: OpenWrtProviderTransport;
}) {
  const panelRef = useRef<ProviderSidePanelHandle | null>(null);

  return (
    <>
      <button
        type="button"
        onClick={() => panelRef.current?.openForApp(selectedApp, providerId)}
      >
        Open provider panel
      </button>
      <ProviderSidePanelHost
        ref={panelRef}
        selectedApp={selectedApp}
        shell={shell}
        transport={transport}
      />
    </>
  );
}

function renderInShadowRoot(ui: ReactElement) {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const shadowRoot = host.attachShadow({ mode: "open" });
  const container = document.createElement("div");
  shadowRoot.appendChild(container);
  const view = render(ui, {
    baseElement: container,
    container,
  });

  return {
    ...view,
    shadowRoot,
    cleanup() {
      view.unmount();
      host.remove();
    },
  };
}

function mockScrollbarWidth(width: number) {
  const innerWidthDescriptor = Object.getOwnPropertyDescriptor(
    window,
    "innerWidth",
  );
  const clientWidthDescriptor = Object.getOwnPropertyDescriptor(
    document.documentElement,
    "clientWidth",
  );

  Object.defineProperty(window, "innerWidth", {
    configurable: true,
    value: 1200,
  });
  Object.defineProperty(document.documentElement, "clientWidth", {
    configurable: true,
    value: 1200 - width,
  });

  return () => {
    if (innerWidthDescriptor) {
      Object.defineProperty(window, "innerWidth", innerWidthDescriptor);
    } else {
      Reflect.deleteProperty(window, "innerWidth");
    }

    if (clientWidthDescriptor) {
      Object.defineProperty(
        document.documentElement,
        "clientWidth",
        clientWidthDescriptor,
      );
    } else {
      Reflect.deleteProperty(document.documentElement, "clientWidth");
    }
  };
}

describe("ProviderSidePanelHost", () => {
  it("opens as a modal, traps focus, closes on Escape, and restores focus", async () => {
    const user = userEvent.setup();
    const restoreScrollbarWidth = mockScrollbarWidth(15);
    const shell = createBridgeFixture({
      serviceStatus: {
        isRunning: true,
      },
    });
    const primaryProvider = createProviderView("claude", {
      active: true,
      name: "Claude Primary",
      notes: "Pinned for router traffic",
      providerId: "claude-primary",
    });
    const backupProvider = createProviderView("claude", {
      active: false,
      baseUrl: "https://api.deepseek.com/anthropic",
      name: "Claude Backup",
      providerId: "claude-backup",
      tokenConfigured: false,
      tokenField: "ANTHROPIC_API_KEY",
    });
    const { transport } = createProviderTransportFixture({
      claude: createProviderState("claude", [primaryProvider, backupProvider]),
    });

    document.body.style.overflow = "clip";
    document.body.style.paddingRight = "4px";

    try {
      render(<HostHarness shell={shell} transport={transport} />);

      const trigger = screen.getByRole("button", {
        name: "Open provider panel",
      });
      await user.click(trigger);

      const dialog = await screen.findByRole("dialog", {
        name: "Claude providers",
      });
      const closeButton = within(dialog).getByRole("button", {
        name: "Close provider panel",
      });

      await waitFor(() => expect(closeButton).toHaveFocus());
      expect(dialog).toHaveAttribute("aria-modal", "true");
      expect(document.body.style.overflow).toBe("hidden");
      expect(document.body.style.paddingRight).toBe("15px");

      const saveButton = within(dialog).getByRole("button", {
        name: "Save",
      });

      saveButton.focus();
      await user.tab();
      expect(closeButton).toHaveFocus();
      await user.tab({ shift: true });
      expect(saveButton).toHaveFocus();

      await user.keyboard("{Escape}");

      await waitFor(() =>
        expect(
          screen.queryByRole("dialog", { name: "Claude providers" }),
        ).not.toBeInTheDocument(),
      );
      expect(trigger).toHaveFocus();
      expect(document.body.style.overflow).toBe("clip");
      expect(document.body.style.paddingRight).toBe("4px");
    } finally {
      restoreScrollbarWidth();
      document.body.style.overflow = "";
      document.body.style.paddingRight = "";
    }
  });

  it("opens into a new-provider preset workflow when no providers exist", async () => {
    const user = userEvent.setup();
    const shell = createBridgeFixture({
      selectedApp: "gemini",
    });
    const { transport } = createProviderTransportFixture({
      gemini: createProviderState("gemini", [], null),
    });

    render(
      <HostHarness selectedApp="gemini" shell={shell} transport={transport} />,
    );

    await user.click(
      screen.getByRole("button", {
        name: "Open provider panel",
      }),
    );

    const dialog = await screen.findByRole("dialog", {
      name: "Gemini providers",
    });

    expect(
      within(dialog).getByText(
        "No providers yet. Create one from a preset or a custom draft.",
      ),
    ).toBeInTheDocument();
    expect(dialog).toHaveAttribute("data-panel-mode", "preset-picker");
    expect(within(dialog).queryByRole("tablist")).toBeNull();
    expect(within(dialog).getByText("Preset browser")).toBeInTheDocument();
    expect(
      within(dialog).getByRole("button", {
        name: /Custom draft/i,
      }),
    ).toBeInTheDocument();
    expect(
      within(dialog).getByRole("button", {
        name: "Cancel",
      }),
    ).toBeEnabled();
    expect(
      within(dialog).queryByRole("button", {
        name: "Save",
      }),
    ).toBeNull();
    expect(dialog).toHaveTextContent(
      "Presets speed up setup but never save automatically.",
    );
  });

  it("keeps forward tab navigation inside the panel when mounted in a shadow root", async () => {
    const user = userEvent.setup();
    const shell = createBridgeFixture({
      serviceStatus: {
        isRunning: true,
      },
    });
    const primaryProvider = createProviderView("claude", {
      active: true,
      name: "Claude Primary",
      providerId: "claude-primary",
    });
    const { transport } = createProviderTransportFixture({
      claude: createProviderState("claude", [primaryProvider]),
    });
    const view = renderInShadowRoot(
      <HostHarness shell={shell} transport={transport} />,
    );

    try {
      await user.click(
        view.getByRole("button", {
          name: "Open provider panel",
        }),
      );

      const dialog = await view.findByRole("dialog", {
        name: "Claude providers",
      });
      const closeButton = within(dialog).getByRole("button", {
        name: "Close provider panel",
      });

      await waitFor(() =>
        expect(view.shadowRoot.activeElement).toBe(closeButton),
      );

      const tabEvent = new KeyboardEvent("keydown", {
        bubbles: true,
        cancelable: true,
        key: "Tab",
      });
      closeButton.dispatchEvent(tabEvent);

      expect(tabEvent.defaultPrevented).toBe(false);
    } finally {
      view.cleanup();
    }
  });
});
