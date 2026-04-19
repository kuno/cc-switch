import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { OPENWRT_PAGE_FIXED_NOW } from "./fixtures/pageShell";
import { renderOpenWrtPageShell } from "./fixtures/renderPageShell";

describe("OpenWrtPageShell", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(Date, "now").mockReturnValue(OPENWRT_PAGE_FIXED_NOW);
  });

  it("renders the header and applies the stored initial theme on mount", async () => {
    renderOpenWrtPageShell({
      initialTheme: "dark",
    });

    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Open Claude providers" }),
      ).toBeInTheDocument(),
    );

    expect(screen.getByText("OpenWrt / Services")).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { level: 1, name: "CC Switch" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Switch to light theme" }),
    ).toBeInTheDocument();
    expect(document.body.dataset.ccswitchTheme).toBe("dark");
    expect(document.body).toHaveClass(
      "ccswitch-openwrt-provider-ui-theme-dark",
    );
  });

  it("toggles the theme through click, Enter, and Space", async () => {
    const user = userEvent.setup();
    renderOpenWrtPageShell();

    const themeToggle = await screen.findByRole("button", {
      name: "Switch to dark theme",
    });

    expect(document.body.dataset.ccswitchTheme).toBe("light");

    await user.click(themeToggle);
    expect(document.body.dataset.ccswitchTheme).toBe("dark");

    const lightToggle = screen.getByRole("button", {
      name: "Switch to light theme",
    });
    lightToggle.focus();
    await user.keyboard("{Enter}");
    expect(document.body.dataset.ccswitchTheme).toBe("light");

    const darkToggle = screen.getByRole("button", {
      name: "Switch to dark theme",
    });
    darkToggle.focus();
    await user.keyboard("[Space]");
    expect(document.body.dataset.ccswitchTheme).toBe("dark");
  });

  it("wires app-card selection through the shell bridge and opens the provider panel", async () => {
    const user = userEvent.setup();
    const { bridge } = renderOpenWrtPageShell();

    const codexOpenProvidersButton = await screen.findByRole("button", {
      name: "Open Codex providers",
    });

    await user.click(codexOpenProvidersButton);

    await waitFor(() =>
      expect(
        screen.getByRole("dialog", { name: "Codex providers" }),
      ).toBeInTheDocument(),
    );
    expect(bridge.setSelectedApp).toHaveBeenCalledWith("codex");
  });

  it("restores focus after opening and closing the provider panel from the shell", async () => {
    const user = userEvent.setup();
    renderOpenWrtPageShell();

    const openProvidersButton = await screen.findByRole("button", {
      name: "Open Claude providers",
    });

    openProvidersButton.focus();
    await user.click(openProvidersButton);

    const closeButton = await screen.findByRole("button", {
      name: "Close provider panel",
    });

    await waitFor(() => {
      expect(closeButton).toHaveFocus();
    });

    await user.click(closeButton);

    await waitFor(() => {
      expect(openProvidersButton).toHaveFocus();
    });
  });

  it("restores focus after opening and closing the activity drawer from the shell", async () => {
    const user = userEvent.setup();
    const { bridge } = renderOpenWrtPageShell();

    const claudeCard = (
      await screen.findByRole("button", {
        name: "Open Claude providers",
      })
    ).closest("article");

    expect(claudeCard).not.toBeNull();

    const openActivityButton = within(claudeCard as HTMLElement).getByRole(
      "button",
      {
        name: "Open",
      },
    );

    openActivityButton.focus();
    await user.click(openActivityButton);

    const closeButton = await screen.findByRole("button", {
      name: "Close recent activity",
    });

    await waitFor(() => {
      expect(closeButton).toHaveFocus();
    });

    expect(bridge.setSelectedApp).toHaveBeenCalledWith("claude");

    await user.click(closeButton);

    await waitFor(() => {
      expect(openActivityButton).toHaveFocus();
    });
  });
});
