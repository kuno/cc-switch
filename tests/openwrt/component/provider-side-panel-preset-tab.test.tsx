import { useRef } from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ProviderSidePanelHost, type ProviderSidePanelHandle } from "@/openwrt-provider-ui/components/ProviderSidePanelHost";
import { ProviderSidePanelPresetTab } from "@/openwrt-provider-ui/components/ProviderSidePanelPresetTab";
import type { OpenWrtSharedPageShellApi } from "@/openwrt-provider-ui/pageTypes";
import type { OpenWrtProviderTransport } from "@/platform/openwrt/providers";
import { createBridgeFixture } from "./fixtures/bridge";
import { createProviderTransportFixture } from "./fixtures/providerTransport";
import { createPresetGroups, createProviderState } from "../provider-panel-fixtures";

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
        onClick={() => panelRef.current?.openForApp("codex")}
      >
        Open codex provider panel
      </button>
      <ProviderSidePanelHost
        ref={panelRef}
        selectedApp="codex"
        shell={shell}
        transport={transport}
      />
    </>
  );
}

describe("ProviderSidePanelPresetTab", () => {
  it("renders the real preset catalog and reports the selected preset id", async () => {
    const user = userEvent.setup();
    const onPresetSelect = vi.fn();

    render(
      <ProviderSidePanelPresetTab
        groups={createPresetGroups("codex")}
        onPresetSelect={onPresetSelect}
        selectedPresetId="custom"
      />,
    );

    expect(screen.getByText("Preset browser")).toBeInTheDocument();
    expect(screen.getByText("Official")).toBeInTheDocument();
    expect(screen.getByText("Platform templates")).toBeInTheDocument();
    expect(screen.getByText("Compatible gateways")).toBeInTheDocument();
    expect(
      screen.getByRole("button", {
        name: /Custom draft/i,
      }),
    ).toHaveAttribute("data-selected", "true");

    await user.click(
      screen.getByRole("button", {
        name: /OpenAI Official/i,
      }),
    );

    expect(onPresetSelect).toHaveBeenCalledWith("codex-official");
  });

  it("hydrates the host draft from a real preset and saves it through the create path", async () => {
    const user = userEvent.setup();
    const shell = createBridgeFixture({
      selectedApp: "codex",
      serviceStatus: {
        isRunning: true,
      },
    });
    const { transport } = createProviderTransportFixture({
      codex: createProviderState("codex", [], null),
    });

    render(<HostHarness shell={shell} transport={transport} />);

    await user.click(
      screen.getByRole("button", {
        name: "Open codex provider panel",
      }),
    );
    await screen.findByRole("dialog", {
      name: "Codex providers",
    });

    await user.click(
      screen.getByRole("button", {
        name: /OpenAI Official/i,
      }),
    );
    await user.click(
      screen.getByRole("button", {
        name: "Credentials",
      }),
    );

    expect(screen.getByLabelText("Base URL")).toHaveValue(
      "https://api.openai.com/v1",
    );
    expect(
      screen.getByRole("button", {
        name: "auth.json",
      }),
    ).toHaveAttribute("data-active", "true");

    await user.click(
      screen.getByRole("button", {
        name: "Save",
      }),
    );

    await waitFor(() =>
      expect(transport.upsertProvider).toHaveBeenCalledWith("codex", {
        authMode: "codex_oauth",
        baseUrl: "https://api.openai.com/v1",
        model: "gpt-5.4",
        name: "OpenAI Official",
        notes: "",
        token: "",
        tokenField: "OPENAI_API_KEY",
      }),
    );
  });
});
