import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import {
  OPENWRT_SHARED_PROVIDER_UI_GLOBAL_KEY,
  openWrtSharedProviderBundleApi,
  type OpenWrtSharedProviderBundleApi,
} from "@/openwrt-provider-ui/index";
import type { OpenWrtProviderTransport } from "@/platform/openwrt/providers";

function createTransport(): OpenWrtProviderTransport {
  return {
    listProviders: vi.fn().mockResolvedValue(null),
    listSavedProviders: vi.fn().mockResolvedValue(null),
    getActiveProvider: vi.fn().mockResolvedValue({ ok: false }),
    restartService: vi.fn().mockResolvedValue({ ok: true }),
  };
}

describe("OpenWrt provider UI bundle contract", () => {
  it("registers a global mount API and supports the documented mount contract", async () => {
    const globalScope = globalThis as typeof globalThis & {
      [OPENWRT_SHARED_PROVIDER_UI_GLOBAL_KEY]?: OpenWrtSharedProviderBundleApi;
    };
    const api = globalScope[OPENWRT_SHARED_PROVIDER_UI_GLOBAL_KEY];
    const target = document.createElement("div");
    target.appendChild(document.createTextNode("stale bundle content"));
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
    expect(api).toBe(openWrtSharedProviderBundleApi);
    expect(typeof api?.capabilities?.providerManager).toBe("boolean");

    const handle = await Promise.resolve(
      api!.mount({
        appId: "claude",
        serviceStatus: { isRunning: false },
        shell,
        target,
        transport: createTransport(),
      }),
    );

    await waitFor(() =>
      expect(target.childNodes.length).toBeGreaterThan(0),
    );
    expect(target.textContent).not.toContain("stale bundle content");
    expect(
      handle == null ||
        typeof handle === "function" ||
        (typeof handle === "object" && typeof handle.unmount === "function"),
    ).toBe(true);

    if (typeof handle === "function") {
      handle();
      await waitFor(() => expect(target.textContent).toBe(""));
    } else if (handle && typeof handle.unmount === "function") {
      handle.unmount();
      await waitFor(() => expect(target.textContent).toBe(""));
    }
  });

  it("stages the same bundle asset for standalone and feed builds", () => {
    const repoRoot = process.cwd();
    const outputDir = mkdtempSync(path.join(os.tmpdir(), "ccswitch-openwrt-ui-"));
    const helperPath = path.resolve(
      repoRoot,
      "openwrt/prepare-provider-ui-bundle.sh",
    );
    const emittedBundlePath = path.resolve(
      repoRoot,
      "openwrt/luci-app-ccswitch/htdocs/luci-static/resources/ccswitch/provider-ui/ccswitch-provider-ui.js",
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
    const viteConfig = readFileSync(path.resolve(repoRoot, "vite.config.ts"), "utf8");

    execFileSync("sh", [helperPath, "--output-dir", outputDir], {
      cwd: repoRoot,
    });

    expect(existsSync(stagedOutputPath)).toBe(true);
    expect(readFileSync(stagedOutputPath, "utf8")).toContain(
      "__CCSWITCH_OPENWRT_SHARED_PROVIDER_UI__",
    );
    expect(readFileSync(stagedOutputPath, "utf8")).toContain(
      "providerManager",
    );
    if (existsSync(emittedBundlePath)) {
      expect(readFileSync(stagedOutputPath, "utf8")).toBe(
        readFileSync(emittedBundlePath, "utf8"),
      );
    } else if (existsSync(stagedBundlePath)) {
      expect(readFileSync(stagedOutputPath, "utf8")).toBe(
        readFileSync(stagedBundlePath, "utf8"),
      );
    }
    expect(luciMakefile).toContain("prepare-provider-ui-bundle.sh");
    expect(buildIpkScript).toContain("prepare-provider-ui-bundle.sh");
    expect(buildIpkScript).toContain("OPENWRT_PROVIDER_UI_ASSET");
    expect(buildIpkScript).toContain(
      "/htdocs/luci-static/resources/ccswitch/provider-ui/ccswitch-provider-ui.js",
    );
    expect(viteConfig).toContain('"src/openwrt-provider-ui/index.ts"');
    expect(viteConfig).toContain(
      '"openwrt/luci-app-ccswitch/htdocs/luci-static/resources/ccswitch/provider-ui"',
    );
  });

  it("prefers an explicit bundle override when staging package assets", () => {
    const repoRoot = process.cwd();
    const helperPath = path.resolve(
      repoRoot,
      "openwrt/prepare-provider-ui-bundle.sh",
    );
    const outputDir = mkdtempSync(path.join(os.tmpdir(), "ccswitch-openwrt-ui-"));
    const explicitBundleDir = mkdtempSync(
      path.join(os.tmpdir(), "ccswitch-openwrt-ui-explicit-"),
    );
    const explicitBundlePath = path.join(
      explicitBundleDir,
      "custom-provider-ui.js",
    );
    const explicitMarker = "window.__explicitProviderBundle = true;";

    writeFileSync(explicitBundlePath, explicitMarker);

    execFileSync("sh", [helperPath, "--output-dir", outputDir], {
      cwd: repoRoot,
      env: {
        ...process.env,
        CCSWITCH_OPENWRT_PROVIDER_UI_BUNDLE: explicitBundlePath,
      },
    });

    expect(
      readFileSync(path.join(outputDir, "ccswitch-provider-ui.js"), "utf8"),
    ).toBe(explicitMarker);
  });
});
