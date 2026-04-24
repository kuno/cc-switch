import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { OPENWRT_APP_IDS } from "../fixtures/openwrtProviderUi";
import { OPENWRT_PAGE_FIXED_NOW } from "./fixtures/pageShell";
import { renderOpenWrtPageShell } from "./fixtures/renderPageShell";

describe("OpenWrtPageShell", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(Date, "now").mockReturnValue(OPENWRT_PAGE_FIXED_NOW);
  });

  it("renders the header and applies the stored initial theme on mount", async () => {
    const { target } = renderOpenWrtPageShell({
      initialTheme: "dark",
    });

    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Open Claude providers" }),
      ).toBeInTheDocument(),
    );

    expect(
      screen.getByRole("heading", { level: 2, name: /^Apps\b/ }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { level: 2, name: /^Daemon\b/ }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Switch to light theme" }),
    ).toBeInTheDocument();
    expect(target.dataset.ccswitchTheme).toBe("dark");
    expect(target).toHaveClass("dark");
  });

  it("toggles the theme through click, Enter, and Space", async () => {
    const user = userEvent.setup();
    const { target } = renderOpenWrtPageShell();

    const themeToggle = await screen.findByRole("button", {
      name: "Switch to dark theme",
    });

    expect(target.dataset.ccswitchTheme).toBe("light");
    expect(target).not.toHaveClass("dark");

    await user.click(themeToggle);
    expect(target.dataset.ccswitchTheme).toBe("dark");
    expect(target).toHaveClass("dark");

    const lightToggle = screen.getByRole("button", {
      name: "Switch to light theme",
    });
    lightToggle.focus();
    await user.keyboard("{Enter}");
    expect(target.dataset.ccswitchTheme).toBe("light");
    expect(target).not.toHaveClass("dark");

    const darkToggle = screen.getByRole("button", {
      name: "Switch to dark theme",
    });
    darkToggle.focus();
    await user.keyboard("[Space]");
    expect(target.dataset.ccswitchTheme).toBe("dark");
    expect(target).toHaveClass("dark");
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
    ).closest(".owt-app-card");

    expect(claudeCard).not.toBeNull();

    const openActivityButton = within(claudeCard as HTMLElement).getByTitle(
      "Show recent requests",
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

  it("refetches the apps grid after a successful provider mutation", async () => {
    const user = userEvent.setup();
    const { transport } = renderOpenWrtPageShell();
    const listProviders = transport.listProviders as unknown as Mock;
    const openProvidersButton = await screen.findByRole("button", {
      name: "Open Claude providers",
    });

    await waitFor(() => {
      expect(listProviders).toHaveBeenCalledTimes(OPENWRT_APP_IDS.length);
    });
    listProviders.mockClear();

    await user.click(openProvidersButton);
    const dialog = await screen.findByRole("dialog", {
      name: "Claude providers",
    });

    await waitFor(() => {
      expect(listProviders).toHaveBeenCalledTimes(1);
    });
    listProviders.mockClear();

    await user.click(within(dialog).getByRole("button", { name: "Configure" }));
    await user.click(within(dialog).getByRole("button", { name: "Edit" }));
    await user.click(within(dialog).getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(
        Array.from(
          new Set(
            listProviders.mock.calls.map(([appId]) => appId as string),
          ),
        ).sort(),
      ).toEqual([...OPENWRT_APP_IDS]);
    });
  });

  it("does not refetch the apps grid when opening the activity drawer", async () => {
    const user = userEvent.setup();
    const { transport } = renderOpenWrtPageShell();
    const listProviders = transport.listProviders as unknown as Mock;
    const claudeCard = (
      await screen.findByRole("button", {
        name: "Open Claude providers",
      })
    ).closest(".owt-app-card");

    expect(claudeCard).not.toBeNull();

    await waitFor(() => {
      expect(listProviders).toHaveBeenCalledTimes(OPENWRT_APP_IDS.length);
    });
    listProviders.mockClear();

    await user.click(
      within(claudeCard as HTMLElement).getByTitle("Show recent requests"),
    );

    await screen.findByRole("dialog", { name: "Recent activity" });

    expect(listProviders).not.toHaveBeenCalled();
  });
});
