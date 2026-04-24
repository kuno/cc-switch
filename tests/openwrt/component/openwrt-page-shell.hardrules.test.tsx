import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { OPENWRT_PAGE_FIXED_NOW } from "./fixtures/pageShell";
import { renderOpenWrtPageShell } from "./fixtures/renderPageShell";

const FORBIDDEN_TEXT = [
  "Configure routes and provider details",
  "OpenClaw",
  "Hermes",
  "autoFailover",
  "maxRetries",
  "SharedProviderManager",
] as const;

describe("OpenWrtPageShell hard rules", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(Date, "now").mockReturnValue(OPENWRT_PAGE_FIXED_NOW);
  });

  it("keeps the rendered shell free of legacy provider-manager artifacts", async () => {
    const { container } = renderOpenWrtPageShell();

    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Open Claude providers" }),
      ).toBeInTheDocument(),
    );

    const renderedText = document.body.textContent ?? "";
    const renderedAppCards = Array.from(
      container.querySelectorAll<HTMLElement>(
        ".owt-apps-grid .owt-app-card[data-app]",
      ),
    ).map((card) => card.dataset.app);

    expect(document.body.querySelector(".owt-legacy-preserved")).toBeNull();

    for (const forbiddenText of FORBIDDEN_TEXT) {
      expect(renderedText).not.toContain(forbiddenText);
    }

    expect(
      container.querySelector(
        [
          ".SharedProviderManager",
          ".shared-provider-manager",
          '[data-testid=\"shared-provider-manager\"]',
          '[data-testid=\"SharedProviderManager\"]',
        ].join(", "),
      ),
    ).toBeNull();
    expect(screen.queryByRole("button", { name: "Failover" })).toBeNull();
    expect(
      container.querySelector('[data-placeholder-tab="failover"]'),
    ).toHaveAttribute("hidden");
    expect(
      container.querySelector('[data-placeholder-panel="failover"]'),
    ).toHaveAttribute("hidden");
    expect(renderedAppCards).toEqual(["claude", "codex", "gemini"]);
  });

  it("uses one shared scrim and keeps the shell drawers mutually exclusive", async () => {
    const user = userEvent.setup();
    const { container } = renderOpenWrtPageShell();

    const claudeCard = await screen.findByRole("button", {
      name: "Open Claude providers",
    });

    await user.click(claudeCard);
    await screen.findByRole("dialog", {
      name: "Claude providers",
    });

    expect(
      container.querySelector('.owt-overlay-scrim[data-open="true"]'),
    ).not.toBeNull();
    expect(container.querySelector(".owt-provider-panel__scrim")).toBeNull();
    expect(container.querySelector(".owt-activity-drawer__scrim")).toBeNull();

    await user.click(within(claudeCard).getByTitle("Show recent requests"));

    await screen.findByRole("dialog", {
      name: "Recent activity",
    });
    await waitFor(() =>
      expect(
        screen.queryByRole("dialog", { name: "Claude providers" }),
      ).not.toBeInTheDocument(),
    );

    const sharedScrim = container.querySelector<HTMLButtonElement>(
      '.owt-overlay-scrim[data-open="true"]',
    );

    expect(sharedScrim).not.toBeNull();
    fireEvent.click(sharedScrim!);

    await waitFor(() =>
      expect(
        screen.queryByRole("dialog", { name: "Recent activity" }),
      ).not.toBeInTheDocument(),
    );
    expect(
      container.querySelector('.owt-overlay-scrim[data-open="true"]'),
    ).toBeNull();
  });
});
