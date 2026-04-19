import { useRef } from "react";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { ProviderSidePanelHost, type ProviderSidePanelHandle } from "@/openwrt-provider-ui/components/ProviderSidePanelHost";
import type { OpenWrtSharedPageShellApi } from "@/openwrt-provider-ui/pageTypes";
import type { OpenWrtProviderTransport } from "@/platform/openwrt/providers";
import { createBridgeFixture } from "./fixtures/bridge";
import { createProviderTransportFixture } from "./fixtures/providerTransport";
import { createProviderState, createProviderView } from "../provider-panel-fixtures";

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

describe("ProviderSidePanelHost", () => {
  it("opens as a modal, traps focus, closes on Escape, and restores focus", async () => {
    const user = userEvent.setup();
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
    expect(document.body.style.overflow).toBe("");
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
      <HostHarness
        selectedApp="gemini"
        shell={shell}
        transport={transport}
      />,
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
    expect(
      within(dialog).getByRole("button", {
        name: "Preset",
      }),
    ).toHaveAttribute("data-active", "true");
    expect(
      within(dialog).getByRole("button", {
        name: "Save",
      }),
    ).toBeDisabled();
    expect(dialog).toHaveTextContent("Create a new Gemini route from this draft.");
  });
});
