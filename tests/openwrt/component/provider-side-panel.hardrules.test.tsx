import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ProviderSidePanel } from "@/openwrt-provider-ui/components/ProviderSidePanel";
import {
  createCodexAuthSummary,
  createProviderDraft,
  createProviderSidePanelProps,
  createProviderView,
} from "../provider-panel-fixtures";

const FORBIDDEN_TEXT = [
  "openclaw",
  "hermes",
  "configure routes and provider details",
  "sharedprovidermanager",
] as const;

function renderTab(tab: "preset-picker" | "activities" | "configure") {
  const appId = tab === "configure" ? "codex" : "claude";
  const selectedProvider = createProviderView(appId, {
    active: true,
    authMode: appId === "codex" ? "codex_oauth" : undefined,
    codexAuth:
      appId === "codex"
        ? createCodexAuthSummary()
        : undefined,
    name: appId === "codex" ? "OpenAI Official" : "Claude Primary",
    providerId: `${appId}-primary`,
  });

  return render(
    <ProviderSidePanel
      {...createProviderSidePanelProps({
        appId,
        draft: createProviderDraft(appId, {
          authMode: selectedProvider.authMode,
          baseUrl: selectedProvider.baseUrl,
          model: selectedProvider.model,
          name: selectedProvider.name,
        }),
        panelMode: tab === "preset-picker" ? "preset-picker" : "detail",
        selectedProvider,
        selectedProviderId: selectedProvider.providerId,
        tab: tab === "configure" ? "configure" : "activities",
      })}
    />,
  );
}

describe("ProviderSidePanel hard rules", () => {
  it.each(["preset-picker", "activities", "configure"] as const)(
    "%s state does not leak forbidden legacy surfaces",
    async (tab) => {
      const { container } = renderTab(tab);
      const text = (container.textContent ?? "").toLowerCase();

      for (const fragment of FORBIDDEN_TEXT) {
        expect(text).not.toContain(fragment);
      }

      expect(container.querySelector(".owt-legacy-preserved")).toBeNull();

      if (tab === "preset-picker") {
        expect(screen.queryByRole("tablist")).toBeNull();
        expect(screen.queryByText("Preset browser")).not.toBeInTheDocument();
        expect(screen.getByText("Custom")).toBeInTheDocument();
      } else {
        if (tab === "activities") {
          expect(await screen.findByText("No recent activity")).toBeInTheDocument();
        }

        const tablist = screen.getByRole("tablist");
        const labels = within(tablist)
          .getAllByRole("button", { hidden: false })
          .map((button) => button.textContent?.trim());

        expect(labels).toEqual(["Activities", "Configure"]);
        expect(labels).toHaveLength(2);
        expect(
          container.querySelector('[data-placeholder-tab="failover"]'),
        ).not.toBeNull();
        expect(
          container.querySelector('[data-placeholder-panel="failover"]'),
        ).not.toBeNull();
      }
    },
  );
});
