import { useRef } from "react";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import {
  ProviderSidePanelHost,
  type ProviderSidePanelHandle,
} from "@/openwrt-provider-ui/components/ProviderSidePanelHost";
import { ProviderSidePanelPresetTab } from "@/openwrt-provider-ui/components/ProviderSidePanelPresetTab";
import type { OpenWrtSharedPageShellApi } from "@/openwrt-provider-ui/pageTypes";
import type { OpenWrtProviderTransport } from "@/platform/openwrt/providers";
import type { SharedProviderPreset } from "@/shared/providers/domain";
import { createBridgeFixture } from "./fixtures/bridge";
import { createProviderTransportFixture } from "./fixtures/providerTransport";
import {
  createPresetGroups,
  createProviderState,
} from "../provider-panel-fixtures";

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

function renderPresetTab({
  onCancel = vi.fn(),
  onPresetSelect = vi.fn(),
  selectedPresetId = null,
}: {
  onCancel?: () => void;
  onPresetSelect?: (presetId: string) => void;
  selectedPresetId?: string | null;
} = {}) {
  render(
    <ProviderSidePanelPresetTab
      groups={createPresetGroups("codex")}
      onCancel={onCancel}
      onPresetSelect={onPresetSelect}
      selectedPresetId={selectedPresetId}
    />,
  );

  return { onCancel, onPresetSelect };
}

describe("ProviderSidePanelPresetTab", () => {
  it("stages a preset card click without applying it", async () => {
    const user = userEvent.setup();
    const onPresetSelect = vi.fn();

    renderPresetTab({ onPresetSelect });

    const openAiCard = screen.getByRole("radio", {
      name: /OpenAI Official/i,
    });
    await user.click(openAiCard);

    expect(openAiCard).toHaveAttribute("aria-checked", "true");
    expect(onPresetSelect).not.toHaveBeenCalled();
  });

  it("enables Select preset only when a preset is staged", async () => {
    const user = userEvent.setup();
    renderPresetTab();

    const selectButton = screen.getByRole("button", {
      name: "Select preset",
    });
    expect(selectButton).toBeDisabled();

    await user.click(
      screen.getByRole("radio", {
        name: /OpenAI Official/i,
      }),
    );

    expect(selectButton).toBeEnabled();
  });

  it("applies the staged preset from the footer button", async () => {
    const user = userEvent.setup();
    const onPresetSelect = vi.fn();
    renderPresetTab({ onPresetSelect });

    await user.click(
      screen.getByRole("radio", {
        name: /OpenAI Official/i,
      }),
    );
    await user.click(
      screen.getByRole("button", {
        name: "Select preset",
      }),
    );

    expect(onPresetSelect).toHaveBeenCalledWith("codex-official");
  });

  it("cancels without applying a staged preset", async () => {
    const user = userEvent.setup();
    const onCancel = vi.fn();
    const onPresetSelect = vi.fn();
    renderPresetTab({ onCancel, onPresetSelect });

    await user.click(
      screen.getByRole("radio", {
        name: /OpenAI Official/i,
      }),
    );
    await user.click(screen.getByRole("button", { name: "Cancel" }));

    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onPresetSelect).not.toHaveBeenCalled();
  });

  it("composes category filters and search with AND semantics", async () => {
    const user = userEvent.setup();
    renderPresetTab();

    await user.type(screen.getByRole("searchbox"), "openrouter");
    expect(
      screen.getByRole("radio", { name: /OpenRouter/i }),
    ).toBeInTheDocument();

    const filterGroup = screen.getByRole("radiogroup", {
      name: "Preset category filter",
    });
    await user.click(
      within(filterGroup).getByRole("radio", { name: "Official" }),
    );

    expect(screen.queryByRole("radio", { name: /OpenRouter/i })).toBeNull();
    expect(
      screen.getByText("No presets match “openrouter”."),
    ).toBeInTheDocument();
  });

  it("marks the custom card with the custom variant", () => {
    renderPresetTab();

    expect(
      screen.getByRole("radio", {
        name: /Custom Configuration/i,
      }),
    ).toHaveAttribute("data-variant", "custom");
  });

  it("shows only the selected adornment when a partner preset is selected", () => {
    const groups = createPresetGroups("codex");
    const partnerPreset = {
      ...groups[0].presets[0],
      id: "codex-partner",
      providerName: "Partner Relay",
      label: "Partner Relay",
      isPartner: true,
    } as SharedProviderPreset & { isPartner: true };

    render(
      <ProviderSidePanelPresetTab
        groups={[
          {
            id: "compatible",
            label: "Compatible gateways",
            hint: "Synthetic test group.",
            presets: [partnerPreset],
          },
        ]}
        onPresetSelect={vi.fn()}
        selectedPresetId="codex-partner"
      />,
    );

    const partnerCard = screen.getByRole("radio", {
      name: /Partner Relay/i,
    });
    expect(partnerCard).toHaveAttribute("data-variant", "partner");
    expect(partnerCard).toHaveAttribute("data-selected", "true");
    expect(partnerCard.querySelector(".lucide-check")).not.toBeNull();
    expect(partnerCard.querySelector(".lucide-star")).toBeNull();
  });

  it("hydrates the host draft from a confirmed real preset and saves it through the create path", async () => {
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
      screen.getByRole("radio", {
        name: /OpenAI Official/i,
      }),
    );
    await user.click(screen.getByRole("button", { name: "Select preset" }));

    expect(screen.getByLabelText("Base URL")).toHaveValue(
      "https://api.openai.com/v1",
    );
    expect(screen.getByLabelText("Auth mode")).toHaveValue("codex_oauth");

    await user.click(
      screen.getByRole("button", {
        name: "Save",
      }),
    );

    await waitFor(() =>
      expect(transport.upsertProvider).toHaveBeenCalledWith("codex", {
        authContent: null,
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
