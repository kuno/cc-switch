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
  "failover",
  "openclaw",
  "hermes",
  "autofailover",
  "maxretries",
  "queue",
  "configure routes and provider details",
  "sharedprovidermanager",
] as const;

const FORBIDDEN_ATTR_FRAGMENTS = ["failover", "queue"] as const;

function renderTab(tab: "preset" | "general" | "credentials") {
  const appId = tab === "credentials" ? "codex" : "claude";
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
        selectedProvider,
        selectedProviderId: selectedProvider.providerId,
        tab,
      })}
    />,
  );
}

describe("ProviderSidePanel hard rules", () => {
  it.each(["preset", "general", "credentials"] as const)(
    "%s tab does not leak forbidden failover or legacy surfaces",
    (tab) => {
      const { container } = renderTab(tab);
      const text = (container.textContent ?? "").toLowerCase();

      for (const fragment of FORBIDDEN_TEXT) {
        expect(text).not.toContain(fragment);
      }

      expect(container.querySelector(".owt-legacy-preserved")).toBeNull();

      for (const element of Array.from(container.querySelectorAll<HTMLElement>("*"))) {
        const idValue = element.id.toLowerCase();
        const testIdValue = (element.dataset.testid ?? "").toLowerCase();
        const classValue = element.className.toString().toLowerCase();

        for (const fragment of FORBIDDEN_ATTR_FRAGMENTS) {
          expect(idValue).not.toContain(fragment);
          expect(testIdValue).not.toContain(fragment);
          expect(classValue).not.toContain(fragment);
        }
      }

      const tablist = screen.getByRole("tablist");
      const labels = within(tablist)
        .getAllByRole("button")
        .map((button) => button.textContent?.trim());

      expect(labels).toEqual(["Preset", "General", "Credentials"]);
      expect(labels).toHaveLength(3);
    },
  );
});
