import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  OPENWRT_SHARED_PROVIDER_UI_GLOBAL_KEY,
  type OpenWrtSharedProviderBundleApi,
} from "@/openwrt-provider-ui/index";

describe("OpenWrt provider UI bundle placeholder", () => {
  it("registers a global mount API and renders a resilient placeholder", async () => {
    const globalScope = globalThis as typeof globalThis & {
      [OPENWRT_SHARED_PROVIDER_UI_GLOBAL_KEY]?: OpenWrtSharedProviderBundleApi;
    };
    const api = globalScope[OPENWRT_SHARED_PROVIDER_UI_GLOBAL_KEY];
    const target = document.createElement("div");
    const shell = {
      clearMessage: vi.fn(),
      getSelectedApp: vi.fn().mockReturnValue("claude"),
      getServiceStatus: vi.fn().mockReturnValue({ isRunning: false }),
      refreshServiceStatus: vi.fn().mockResolvedValue({ isRunning: false }),
      restartService: vi.fn().mockResolvedValue({ isRunning: false }),
      setSelectedApp: vi.fn().mockReturnValue("claude"),
      showMessage: vi.fn(),
    };

    expect(api).toBeDefined();
    expect(api?.capabilities).toEqual({ providerManager: false });

    const handle = await Promise.resolve(
      api!.mount({
        appId: "claude",
        serviceStatus: { isRunning: false },
        shell,
        target,
        transport: {} as never,
      }),
    );

    expect(target.textContent).toContain("Shared provider bundle loaded.");
    expect(target.textContent).toContain(
      "LuCI shell and browser-bundle contract",
    );
    expect(shell.showMessage).toHaveBeenCalledWith(
      "info",
      "Shared provider bundle loaded. Waiting for the shared provider manager implementation.",
    );

    if (typeof handle === "function") {
      handle();
    } else if (handle && typeof handle.unmount === "function") {
      handle.unmount();
    }

    expect(shell.clearMessage).toHaveBeenCalledTimes(1);
    expect(target.textContent).toBe("");
  });

  it("stages the same bundle asset for standalone and feed builds", () => {
    const repoRoot = process.cwd();
    const outputDir = mkdtempSync(path.join(os.tmpdir(), "ccswitch-openwrt-ui-"));
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
    expect(readFileSync(stagedOutputPath, "utf8")).toContain(
      "providerManager",
    );
    expect(luciMakefile).toContain("prepare-provider-ui-bundle.sh");
    expect(buildIpkScript).toContain("prepare-provider-ui-bundle.sh");
  });
});
