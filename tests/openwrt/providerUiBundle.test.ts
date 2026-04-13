import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { act, fireEvent, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import {
  OPENWRT_SHARED_PROVIDER_UI_GLOBAL_KEY,
  type OpenWrtSharedProviderBundleApi,
} from "@/openwrt-provider-ui/index";
import type { OpenWrtProviderTransport } from "@/platform/openwrt/providers";

function createTransport(): OpenWrtProviderTransport {
  const emptyStatePayload = {
    activeProviderId: null,
    providers: {},
  };

  return {
    listProviders: vi.fn().mockResolvedValue({
      ok: true,
      providers_json: JSON.stringify(emptyStatePayload),
    }),
    listSavedProviders: vi.fn().mockResolvedValue({
      ok: true,
      providers_json: JSON.stringify(emptyStatePayload),
    }),
    getActiveProvider: vi.fn().mockResolvedValue({ ok: false }),
    restartService: vi.fn().mockResolvedValue({ ok: true }),
  };
}

describe("OpenWrt provider UI bundle", () => {
  it("registers the real shared provider manager bundle and keeps app selection in the shell", async () => {
    const globalScope = globalThis as typeof globalThis & {
      [OPENWRT_SHARED_PROVIDER_UI_GLOBAL_KEY]?: OpenWrtSharedProviderBundleApi;
    };
    const api = globalScope[OPENWRT_SHARED_PROVIDER_UI_GLOBAL_KEY];
    const target = document.createElement("div");
    document.body.appendChild(target);
    const shell = {
      clearMessage: vi.fn(),
      getSelectedApp: vi.fn().mockReturnValue("claude"),
      getServiceStatus: vi.fn().mockReturnValue({ isRunning: false }),
      refreshServiceStatus: vi.fn().mockResolvedValue({ isRunning: false }),
      restartService: vi.fn().mockResolvedValue({ isRunning: false }),
      setSelectedApp: vi
        .fn()
        .mockImplementation((appId: "claude" | "codex" | "gemini") => appId),
      showMessage: vi.fn(),
    };
    const transport = createTransport();

    expect(api).toBeDefined();
    expect(api?.capabilities).toEqual({ providerManager: true });

    let handle:
      | void
      | (() => void)
      | {
          unmount(): void;
        };

    await act(async () => {
      handle = await Promise.resolve(
        api!.mount({
          appId: "claude",
          serviceStatus: { isRunning: false },
          shell,
          target,
          transport,
        }),
      );
    });

    await waitFor(() =>
      expect(within(target).getByText("Provider manager")).toBeInTheDocument(),
    );
    expect(
      within(target).getByText("No providers saved for Claude yet."),
    ).toBeInTheDocument();
    expect(shell.showMessage).not.toHaveBeenCalled();

    await act(async () => {
      fireEvent.click(within(target).getByRole("button", { name: "Codex" }));
    });

    expect(shell.setSelectedApp).toHaveBeenCalledWith("codex");
    await waitFor(() =>
      expect(
        within(target).getByText("No providers saved for Codex yet."),
      ).toBeInTheDocument(),
    );

    await act(async () => {
      if (typeof handle === "function") {
        handle();
      } else if (handle && typeof handle.unmount === "function") {
        handle.unmount();
      }
    });

    expect(shell.clearMessage).toHaveBeenCalledTimes(1);
    expect(target.textContent).toBe("");
    target.remove();
  });

  it("stages the same bundle asset for standalone and feed builds", () => {
    const repoRoot = process.cwd();
    const outputDir = mkdtempSync(
      path.join(os.tmpdir(), "ccswitch-openwrt-ui-"),
    );
    const helperPath = path.resolve(
      repoRoot,
      "openwrt/prepare-provider-ui-bundle.sh",
    );
    const stagedBundlePath = path.resolve(
      repoRoot,
      "openwrt/provider-ui-dist/ccswitch-provider-ui.js",
    );
    const stagedOutputPath = path.join(outputDir, "ccswitch-provider-ui.js");
    const luciMakefile = readFileSync(
      path.resolve(repoRoot, "openwrt/luci-app-ccswitch/Makefile"),
      "utf8",
    );
    const buildIpkScript = readFileSync(
      path.resolve(repoRoot, "openwrt/build-ipk.sh"),
      "utf8",
    );

    execFileSync("sh", [helperPath, "--output-dir", outputDir], {
      cwd: repoRoot,
    });

    expect(existsSync(stagedBundlePath)).toBe(true);
    expect(existsSync(stagedOutputPath)).toBe(true);
    expect(readFileSync(stagedOutputPath, "utf8")).toContain(
      "__CCSWITCH_OPENWRT_SHARED_PROVIDER_UI__",
    );
    expect(readFileSync(stagedOutputPath, "utf8")).toContain("providerManager");
    expect(luciMakefile).toContain("prepare-provider-ui-bundle.sh");
    expect(buildIpkScript).toContain("prepare-provider-ui-bundle.sh");
  });
});
