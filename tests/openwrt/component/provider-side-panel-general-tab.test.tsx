import { useRef } from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ProviderSidePanelHost, type ProviderSidePanelHandle } from "@/openwrt-provider-ui/components/ProviderSidePanelHost";
import { ProviderSidePanelGeneralTab } from "@/openwrt-provider-ui/components/ProviderSidePanelGeneralTab";
import type { OpenWrtSharedPageShellApi } from "@/openwrt-provider-ui/pageTypes";
import type { OpenWrtProviderTransport } from "@/platform/openwrt/providers";
import { createBridgeFixture } from "./fixtures/bridge";
import { createProviderTransportFixture } from "./fixtures/providerTransport";
import { createProviderDraft, createProviderState, createProviderView } from "../provider-panel-fixtures";

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
        Open claude provider panel
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

describe("ProviderSidePanelGeneralTab", () => {
  it("updates provider and website draft fields through the tab callbacks", () => {
    const draft = createProviderDraft("claude", {
      name: "Claude Primary",
      notes: "Pinned route",
    });
    const onDraftChange = vi.fn();
    const onWebsiteChange = vi.fn();

    render(
      <ProviderSidePanelGeneralTab
        draft={draft}
        onDraftChange={onDraftChange}
        onWebsiteChange={onWebsiteChange}
        website="https://claude.example.com"
      />,
    );

    fireEvent.change(screen.getByLabelText("Provider name"), {
      target: {
        value: "Claude Backup",
      },
    });
    expect(onDraftChange).toHaveBeenLastCalledWith({
      ...draft,
      name: "Claude Backup",
    });

    fireEvent.change(screen.getByLabelText("Model"), {
      target: {
        value: "claude-haiku-4-5",
      },
    });
    expect(onDraftChange).toHaveBeenLastCalledWith({
      ...draft,
      model: "claude-haiku-4-5",
    });

    fireEvent.change(screen.getByLabelText(/Website URL/i), {
      target: {
        value: "https://backup.example.com",
      },
    });
    expect(onWebsiteChange).toHaveBeenLastCalledWith(
      "https://backup.example.com",
    );

    fireEvent.change(screen.getByLabelText("Notes"), {
      target: {
        value: "Updated fallback note",
      },
    });
    expect(onDraftChange).toHaveBeenLastCalledWith({
      ...draft,
      notes: "Updated fallback note",
    });
  });

  it("preserves general-tab edits across tab switches and saves through the provider transport", async () => {
    const user = userEvent.setup();
    const shell = createBridgeFixture();
    const primaryProvider = createProviderView("claude", {
      active: true,
      baseUrl: "https://api.anthropic.com",
      model: "claude-sonnet-4-5",
      name: "Claude Primary",
      notes: "Pinned for router traffic",
      providerId: "claude-primary",
      tokenConfigured: true,
      tokenField: "ANTHROPIC_AUTH_TOKEN",
    });
    const { transport } = createProviderTransportFixture({
      claude: createProviderState("claude", [primaryProvider]),
    });

    render(<HostHarness shell={shell} transport={transport} />);

    await user.click(
      screen.getByRole("button", {
        name: "Open claude provider panel",
      }),
    );
    await screen.findByRole("dialog", {
      name: "Claude providers",
    });

    await user.clear(screen.getByLabelText("Provider name"));
    await user.type(screen.getByLabelText("Provider name"), "Claude Renamed");
    await user.clear(screen.getByLabelText("Model"));
    await user.type(screen.getByLabelText("Model"), "claude-haiku-4-5");
    await user.clear(screen.getByLabelText(/Website URL/i));
    await user.type(
      screen.getByLabelText(/Website URL/i),
      "https://docs.anthropic.com",
    );
    await user.clear(screen.getByLabelText("Notes"));
    await user.type(screen.getByLabelText("Notes"), "Updated notes");

    await user.click(
      screen.getByRole("button", {
        name: "Credentials",
      }),
    );
    await user.click(
      screen.getByRole("button", {
        name: "General",
      }),
    );

    expect(screen.getByLabelText("Provider name")).toHaveValue("Claude Renamed");
    expect(screen.getByLabelText("Model")).toHaveValue("claude-haiku-4-5");
    expect(screen.getByLabelText(/Website URL/i)).toHaveValue(
      "https://docs.anthropic.com",
    );
    expect(screen.getByLabelText("Notes")).toHaveValue("Updated notes");

    await user.click(
      screen.getByRole("button", {
        name: "Save",
      }),
    );

    await waitFor(() =>
      expect(transport.upsertProviderByProviderId).toHaveBeenCalled(),
    );

    const payload = transport.upsertProviderByProviderId.mock.calls[0]?.[2];
    expect(payload).toMatchObject({
      baseUrl: "https://api.anthropic.com",
      model: "claude-haiku-4-5",
      name: "Claude Renamed",
      notes: "Updated notes",
      token: "",
      tokenField: "ANTHROPIC_AUTH_TOKEN",
    });
    expect(payload).not.toHaveProperty("website");
  });
});
