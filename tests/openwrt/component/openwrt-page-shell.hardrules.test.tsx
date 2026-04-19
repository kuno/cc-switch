import { screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { OPENWRT_PAGE_FIXED_NOW } from "./fixtures/pageShell";
import { renderOpenWrtPageShell } from "./fixtures/renderPageShell";

const FORBIDDEN_TEXT = [
  "Configure routes and provider details",
  "Failover",
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
      container.querySelectorAll<HTMLElement>("article[data-app]"),
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
    expect(renderedAppCards).toEqual(["claude", "codex", "gemini"]);
  });
});
