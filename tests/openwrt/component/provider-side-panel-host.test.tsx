import { type ReactElement, useRef } from "react";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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
  createCodexAuthSummary,
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

async function openPanel() {
  await userEvent.setup().click(
    screen.getByRole("button", {
      name: "Open provider panel",
    }),
  );

  return screen.findByRole("dialog", {
    name: /providers$/,
  });
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

      closeButton.focus();
      await user.tab({ shift: true });
      expect(closeButton).not.toHaveFocus();
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

  it("opens saved providers on Activities and new drafts on Configure in edit mode", async () => {
    const user = userEvent.setup();
    const savedShell = createBridgeFixture();
    const primaryProvider = createProviderView("claude", {
      active: true,
      name: "Claude Primary",
      providerId: "claude-primary",
    });
    const savedTransport = createProviderTransportFixture({
      claude: createProviderState("claude", [primaryProvider]),
    }).transport;

    render(<HostHarness shell={savedShell} transport={savedTransport} />);

    const savedDialog = await openPanel();
    const detailMeta = savedDialog.querySelector<HTMLElement>(
      ".owt-provider-panel__detail-meta",
    );

    expect(
      within(await savedDialog).getByRole("button", { name: "Activities" }),
    ).toHaveAttribute("data-active", "true");
    expect(screen.getByText("No recent activity")).toBeInTheDocument();
    expect(
      within(await savedDialog).queryByRole("button", { name: "Save" }),
    ).toBeNull();
    expect(detailMeta).not.toBeNull();
    expect(within(detailMeta as HTMLElement).queryByText("Active")).toBeNull();

    await user.click(
      within(savedDialog).getByRole("button", { name: "Configure" }),
    );
    expect(
      within(savedDialog).getByRole("button", { name: "Configure" }),
    ).toHaveAttribute("data-active", "true");

    await user.keyboard("{Escape}");
    await waitFor(() =>
      expect(
        screen.queryByRole("dialog", { name: "Claude providers" }),
      ).not.toBeInTheDocument(),
    );

    const reopenedSavedDialog = await openPanel();
    expect(
      within(reopenedSavedDialog).getByRole("button", { name: "Activities" }),
    ).toHaveAttribute("data-active", "true");

    await user.keyboard("{Escape}");
    await waitFor(() =>
      expect(
        screen.queryByRole("dialog", { name: "Claude providers" }),
      ).not.toBeInTheDocument(),
    );

    const draftShell = createBridgeFixture({ selectedApp: "codex" });
    const draftTransport = createProviderTransportFixture({
      codex: createProviderState("codex", [], null),
    }).transport;

    render(
      <HostHarness
        selectedApp="codex"
        shell={draftShell}
        transport={draftTransport}
      />,
    );

    await user.click(
      screen.getAllByRole("button", {
        name: "Open provider panel",
      })[1],
    );

    const draftDialog = await screen.findByRole("dialog", {
      name: "Codex providers",
    });
    const filterGroup = within(draftDialog).getByRole("radiogroup", {
      name: "Preset category filter",
    });
    await user.click(
      within(filterGroup).getByRole("radio", {
        name: "Custom",
      }),
    );
    await user.click(
      within(draftDialog).getByRole("radio", {
        name: /Custom Configuration/i,
      }),
    );
    await user.click(
      within(draftDialog).getByRole("button", {
        name: "Select preset",
      }),
    );

    expect(
      within(draftDialog).getByRole("button", { name: "Configure" }),
    ).toHaveAttribute("data-active", "true");
    expect(within(draftDialog).getByRole("button", { name: "Cancel" })).toBeInTheDocument();
    expect(within(draftDialog).getByRole("button", { name: "Save" })).toBeInTheDocument();
    expect(
      within(draftDialog).queryByRole("button", { name: "Edit" }),
    ).toBeNull();
  });

  it("reverts unsaved field edits and auth textarea contents on Cancel", async () => {
    const user = userEvent.setup();
    const shell = createBridgeFixture({ selectedApp: "codex" });
    const codexProvider = createProviderView("codex", {
      active: true,
      authMode: "codex_oauth",
      codexAuth: createCodexAuthSummary(),
      model: "gpt-5.4",
      name: "OpenAI Official",
      providerId: "codex-primary",
    });
    const { transport } = createProviderTransportFixture({
      codex: createProviderState("codex", [codexProvider]),
    });

    render(
      <HostHarness
        selectedApp="codex"
        shell={shell}
        transport={transport}
      />,
    );

    const dialog = await openPanel();
    await user.click(within(await dialog).getByRole("button", { name: "Configure" }));
    await user.click(within(await dialog).getByRole("button", { name: "Edit" }));

    const nameInput = within(await dialog).getByLabelText("Provider name");
    const authTextarea = within(await dialog).getByLabelText("auth.json");

    await user.clear(nameInput);
    await user.type(nameInput, "Temporary Name");
    fireEvent.change(authTextarea, {
      target: {
        value: '{"token":"temp"}',
      },
    });
    await user.click(within(await dialog).getByRole("button", { name: "Cancel" }));
    await user.click(within(await dialog).getByRole("button", { name: "Edit" }));

    expect(within(await dialog).getByLabelText("Provider name")).toHaveValue(
      "OpenAI Official",
    );
    expect(within(await dialog).getByLabelText("auth.json")).toHaveValue("");
  });

  it("keeps Save disabled for unchanged saved providers until a real edit is made", async () => {
    const user = userEvent.setup();
    const shell = createBridgeFixture({ selectedApp: "codex" });
    const codexProvider = createProviderView("codex", {
      active: true,
      authMode: "codex_oauth",
      codexAuth: createCodexAuthSummary(),
      name: "OpenAI Official",
      providerId: "codex-primary",
    });
    const { transport } = createProviderTransportFixture({
      codex: createProviderState("codex", [codexProvider]),
    });

    render(
      <HostHarness
        selectedApp="codex"
        shell={shell}
        transport={transport}
      />,
    );

    const dialog = await openPanel();
    await user.click(within(await dialog).getByRole("button", { name: "Configure" }));
    await user.click(within(await dialog).getByRole("button", { name: "Edit" }));

    const saveButton = within(await dialog).getByRole("button", { name: "Save" });
    const notesInput = within(await dialog).getByLabelText("Notes");

    expect(saveButton).toBeDisabled();

    await user.type(notesInput, " updated");
    expect(saveButton).toBeEnabled();

    await user.clear(notesInput);
    expect(saveButton).toBeDisabled();
    expect(transport.upsertProviderByProviderId).not.toHaveBeenCalled();
  });

  it("sends authContent null for untouched saved auth textareas and empty-string when cleared", async () => {
    const user = userEvent.setup();
    const shell = createBridgeFixture({ selectedApp: "codex" });
    const codexProvider = createProviderView("codex", {
      active: true,
      authMode: "codex_oauth",
      codexAuth: createCodexAuthSummary(),
      name: "OpenAI Official",
      providerId: "codex-primary",
    });
    const { transport } = createProviderTransportFixture({
      codex: createProviderState("codex", [codexProvider]),
    });

    render(
      <HostHarness
        selectedApp="codex"
        shell={shell}
        transport={transport}
      />,
    );

    const dialog = await openPanel();
    await user.click(within(await dialog).getByRole("button", { name: "Configure" }));
    await user.click(within(await dialog).getByRole("button", { name: "Edit" }));
    await user.type(within(await dialog).getByLabelText("Notes"), " updated");
    await user.click(within(await dialog).getByRole("button", { name: "Save" }));

    await waitFor(() =>
      expect(transport.upsertProviderByProviderId).toHaveBeenCalledTimes(1),
    );
    expect(transport.upsertProviderByProviderId).toHaveBeenLastCalledWith(
      "codex",
      "codex-primary",
      expect.objectContaining({
        authContent: null,
      }),
    );

    await user.click(within(await dialog).getByRole("button", { name: "Configure" }));
    await user.click(within(await dialog).getByRole("button", { name: "Edit" }));
    await user.click(within(await dialog).getByRole("button", { name: "Clear auth" }));
    await user.click(within(await dialog).getByRole("button", { name: "Save" }));

    await waitFor(() =>
      expect(transport.upsertProviderByProviderId).toHaveBeenCalledTimes(2),
    );
    expect(transport.upsertProviderByProviderId).toHaveBeenLastCalledWith(
      "codex",
      "codex-primary",
      expect.objectContaining({
        authContent: "",
      }),
    );
  });

  it("includes pasted authContent when saving a new oauth draft", async () => {
    const user = userEvent.setup();
    const shell = createBridgeFixture({ selectedApp: "codex" });
    const { transport } = createProviderTransportFixture({
      codex: createProviderState("codex", [], null),
    });

    render(
      <HostHarness
        selectedApp="codex"
        shell={shell}
        transport={transport}
      />,
    );

    const dialog = await openPanel();
    await user.click(
      within(await dialog).getByRole("radio", { name: /OpenAI Official/i }),
    );
    await user.click(
      within(await dialog).getByRole("button", { name: "Select preset" }),
    );
    fireEvent.change(within(await dialog).getByLabelText("auth.json"), {
      target: {
        value: '{"refresh_token":"new-token"}',
      },
    });
    await user.click(within(await dialog).getByRole("button", { name: "Save" }));

    await waitFor(() => expect(transport.upsertProvider).toHaveBeenCalledTimes(1));
    expect(transport.upsertProvider).toHaveBeenLastCalledWith(
      "codex",
      expect.objectContaining({
        authContent: expect.stringContaining('"refresh_token":"new-token"'),
      }),
    );
  });

  it("requests activities with the selected provider id", async () => {
    const user = userEvent.setup();
    const shell = createBridgeFixture({
      requestLogs: {
        claude: {
          data: [],
          total: 0,
          page: 0,
          pageSize: 20,
        },
      },
      selectedApp: "claude",
    });
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

    render(
      <HostHarness shell={shell} transport={transport} />,
    );

    const dialog = await openPanel();

    await waitFor(() =>
      expect(shell.getRequestLogs).toHaveBeenCalledWith(
        "claude",
        0,
        20,
        "claude-primary",
      ),
    );

    await user.click(
      within(await dialog).getByRole("button", { name: /Claude Backup/ }),
    );

    await waitFor(() =>
      expect(shell.getRequestLogs).toHaveBeenLastCalledWith(
        "claude",
        0,
        20,
        "claude-backup",
      ),
    );
  });

  it("sets the selected saved provider active from the header action", async () => {
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

    render(
      <HostHarness
        providerId="claude-backup"
        shell={shell}
        transport={transport}
      />,
    );

    const dialog = await openPanel();

    await user.click(
      within(dialog).getByRole("button", { name: "Set active" }),
    );

    await waitFor(() =>
      expect(transport.activateProviderByProviderId).toHaveBeenCalledWith(
        "claude",
        "claude-backup",
      ),
    );
    await waitFor(() =>
      expect(
        within(dialog).queryByRole("button", { name: "Set active" }),
      ).toBeNull(),
    );

    const rows = Array.from(
      dialog.querySelectorAll<HTMLButtonElement>(
        ".owt-provider-panel__provider-row",
      ),
    );

    expect(rows[0]).toHaveTextContent("Claude Backup");
    expect(within(rows[0]).getByText("Active")).toBeInTheDocument();
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
