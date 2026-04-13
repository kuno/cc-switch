import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { act, fireEvent, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import {
  OPENWRT_SHARED_PROVIDER_UI_GLOBAL_KEY,
  __private__,
  type OpenWrtSharedProviderBundleApi,
} from "@/openwrt-provider-ui/index";
import type {
  OpenWrtProviderMutationEvent,
  OpenWrtProviderTransport,
} from "@/platform/openwrt/providers";
import type {
  SharedProviderAppId,
  SharedProviderState,
} from "@/shared/providers/domain";

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

function createProviderState(
  appId: SharedProviderAppId,
  providers: Array<{
    active?: boolean;
    baseUrl?: string;
    configured?: boolean;
    model?: string;
    name: string;
    notes?: string;
    providerId: string;
    tokenConfigured?: boolean;
    tokenField?:
      | "ANTHROPIC_AUTH_TOKEN"
      | "ANTHROPIC_API_KEY"
      | "OPENAI_API_KEY"
      | "GEMINI_API_KEY";
    tokenMasked?: string;
  }>,
  activeProviderId: string | null = providers.find(
    (provider) => provider.active,
  )?.providerId ?? null,
): SharedProviderState {
  const defaultTokenFieldByApp = {
    claude: "ANTHROPIC_AUTH_TOKEN",
    codex: "OPENAI_API_KEY",
    gemini: "GEMINI_API_KEY",
  } as const;

  const normalizedProviders = providers.map((provider) => ({
    active: provider.active ?? provider.providerId === activeProviderId,
    baseUrl: provider.baseUrl ?? `https://${provider.providerId}.example.com`,
    configured: provider.configured ?? true,
    model: provider.model ?? "",
    name: provider.name,
    notes: provider.notes ?? "",
    providerId: provider.providerId,
    tokenConfigured: provider.tokenConfigured ?? true,
    tokenField: provider.tokenField ?? defaultTokenFieldByApp[appId],
    tokenMasked: provider.tokenMasked ?? "********",
  }));
  const activeProvider = normalizedProviders.find(
    (provider) => provider.providerId === activeProviderId,
  ) ?? {
    active: false,
    baseUrl: "",
    configured: false,
    model: "",
    name: "",
    notes: "",
    providerId: null,
    tokenConfigured: false,
    tokenField: defaultTokenFieldByApp[appId],
    tokenMasked: "",
  };

  return {
    phase2Available: true,
    providers: normalizedProviders,
    activeProviderId,
    activeProvider,
  };
}

function createMutationEvent(
  event: Partial<OpenWrtProviderMutationEvent> &
    Pick<OpenWrtProviderMutationEvent, "appId" | "mutation">,
): OpenWrtProviderMutationEvent {
  const appId = event.appId;

  return {
    appId,
    mutation: event.mutation,
    providerId: event.providerId ?? null,
    serviceRunning: event.serviceRunning ?? false,
    restartRequired: event.restartRequired ?? false,
    providerState: event.providerState ?? createProviderState(appId, [], null),
    capabilities: {
      canAdd: true,
      canEdit: true,
      canDelete: true,
      canActivate: true,
      supportsPresets: true,
      supportsBlankSecretPreserve: true,
      requiresServiceRestart: true,
    },
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
    expect(target.textContent).not.toContain("Shared provider bundle loaded.");
    expect(target.textContent).not.toContain(
      "Waiting for the shared provider manager implementation.",
    );
    expect(shell.showMessage).not.toHaveBeenCalled();
    expect(transport.listProviders).toHaveBeenCalledWith("claude");
    expect(transport.listSavedProviders).toHaveBeenCalledWith("claude");
    expect(transport.getActiveProvider).toHaveBeenCalledWith("claude");

    await act(async () => {
      fireEvent.click(within(target).getByRole("button", { name: "Codex" }));
    });

    expect(shell.setSelectedApp).toHaveBeenCalledWith("codex");
    await waitFor(() =>
      expect(
        within(target).getByText("No providers saved for Codex yet."),
      ).toBeInTheDocument(),
    );
    expect(transport.listProviders).toHaveBeenCalledWith("codex");
    expect(transport.listSavedProviders).toHaveBeenCalledWith("codex");
    expect(transport.getActiveProvider).toHaveBeenCalledWith("codex");

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

  it("updates shell messaging and restart state for save, activate, and delete mutations", () => {
    const rerender = vi.fn();
    const shell = {
      clearMessage: vi.fn(),
      getSelectedApp: vi
        .fn<() => SharedProviderAppId>()
        .mockReturnValue("gemini"),
      getServiceStatus: vi.fn().mockReturnValue({ isRunning: false }),
      refreshServiceStatus: vi.fn().mockResolvedValue({ isRunning: false }),
      restartService: vi.fn().mockResolvedValue({ isRunning: false }),
      setSelectedApp: vi.fn(),
      showMessage: vi.fn(),
    };
    const state = {
      disposed: false,
      restartPending: false,
      selectedApp: "claude" as SharedProviderAppId,
      serviceRunning: false,
    };

    __private__.handleProviderMutationEvent(
      state,
      shell,
      rerender,
      createMutationEvent({
        appId: "claude",
        mutation: "save",
        providerId: "provider-save",
        restartRequired: true,
        serviceRunning: true,
        providerState: createProviderState("claude", [
          {
            active: true,
            name: "Saved Provider",
            providerId: "provider-save",
          },
        ]),
      }),
    );

    expect(state.selectedApp).toBe("gemini");
    expect(state.serviceRunning).toBe(true);
    expect(state.restartPending).toBe(true);
    expect(shell.showMessage).toHaveBeenLastCalledWith(
      "success",
      "Saved Provider was saved. Restart the service to apply provider changes.",
    );

    __private__.handleProviderMutationEvent(
      state,
      shell,
      rerender,
      createMutationEvent({
        appId: "codex",
        mutation: "activate",
        providerId: "provider-activate",
        restartRequired: false,
        serviceRunning: false,
        providerState: createProviderState("codex", [
          {
            active: true,
            name: "Active Provider",
            providerId: "provider-activate",
          },
        ]),
      }),
    );

    expect(state.serviceRunning).toBe(false);
    expect(state.restartPending).toBe(false);
    expect(shell.showMessage).toHaveBeenLastCalledWith(
      "success",
      "Active Provider was activated. The service is stopped, so no restart is needed right now.",
    );

    __private__.handleProviderMutationEvent(
      state,
      shell,
      rerender,
      createMutationEvent({
        appId: "gemini",
        mutation: "delete",
        providerId: "provider-delete",
        restartRequired: true,
        serviceRunning: true,
        providerState: createProviderState("gemini", [], null),
      }),
    );

    expect(state.serviceRunning).toBe(true);
    expect(state.restartPending).toBe(true);
    expect(shell.showMessage).toHaveBeenLastCalledWith(
      "success",
      "provider-delete was deleted. Restart the service to apply provider changes.",
    );
    expect(rerender).toHaveBeenCalledTimes(3);
  });

  it("ships the committed staged real bundle and copies it unchanged for package assembly", () => {
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
    const viteConfig = readFileSync(
      path.resolve(repoRoot, "vite.config.ts"),
      "utf8",
    );
    const stagedBundleSource = readFileSync(stagedBundlePath, "utf8");

    execFileSync("sh", [helperPath, "--output-dir", outputDir], {
      cwd: repoRoot,
    });

    expect(existsSync(stagedBundlePath)).toBe(true);
    expect(existsSync(stagedOutputPath)).toBe(true);
    const bundleSource = readFileSync(stagedOutputPath, "utf8");

    expect(bundleSource).toBe(stagedBundleSource);
    expect(stagedBundleSource).toContain("__CCSWITCH_OPENWRT_SHARED_PROVIDER_UI__");
    expect(stagedBundleSource).toContain("providerManager");
    expect(stagedBundleSource).toContain("Provider manager");
    expect(stagedBundleSource).toContain("cc-switch service");
    expect(stagedBundleSource).not.toContain("Shared provider bundle loaded.");
    expect(stagedBundleSource).not.toContain(
      "Waiting for the shared provider manager implementation.",
    );
    expect(stagedBundleSource).not.toContain("StepFun");
    expect(stagedBundleSource).not.toContain("KAT-Coder");
    expect(stagedBundleSource).not.toContain("GitHub Copilot");
    expect(stagedBundleSource).not.toContain("Codex (ChatGPT Plus/Pro)");
    expect(stagedBundleSource).not.toContain("AWS Bedrock (AKSK)");
    expect(stagedBundleSource).not.toContain("AWS Bedrock (API Key)");
    expect(luciMakefile).toContain("prepare-provider-ui-bundle.sh");
    expect(buildIpkScript).toContain("prepare-provider-ui-bundle.sh");
    expect(viteConfig).toContain("openwrt/provider-ui-dist");
  });

  it("copies an explicit real bundle without mutating the canonical staged artifact", () => {
    const repoRoot = process.cwd();
    const sourceDir = mkdtempSync(
      path.join(os.tmpdir(), "ccswitch-openwrt-ui-src-"),
    );
    const outputDir = mkdtempSync(
      path.join(os.tmpdir(), "ccswitch-openwrt-ui-"),
    );
    const helperPath = path.resolve(
      repoRoot,
      "openwrt/prepare-provider-ui-bundle.sh",
    );
    const explicitBundlePath = path.join(sourceDir, "explicit-real-bundle.js");
    const stagedBundlePath = path.resolve(
      repoRoot,
      "openwrt/provider-ui-dist/ccswitch-provider-ui.js",
    );
    const stagedOutputPath = path.join(outputDir, "ccswitch-provider-ui.js");
    const stagedBundleExisted = existsSync(stagedBundlePath);
    const stagedBundleBefore = stagedBundleExisted
      ? readFileSync(stagedBundlePath, "utf8")
      : null;
    const explicitBundleSource = [
      "globalThis.__CCSWITCH_OPENWRT_SHARED_PROVIDER_UI__ = {",
      "  capabilities: { providerManager: true },",
      "  mount() { return { unmount() {} }; },",
      "};",
      "",
    ].join("\n");

    writeFileSync(explicitBundlePath, explicitBundleSource, "utf8");

    execFileSync("sh", [helperPath, "--output-dir", outputDir], {
      cwd: repoRoot,
      env: {
        ...process.env,
        CCSWITCH_OPENWRT_PROVIDER_UI_BUNDLE: explicitBundlePath,
      },
    });

    expect(existsSync(stagedOutputPath)).toBe(true);
    expect(readFileSync(stagedOutputPath, "utf8")).toBe(explicitBundleSource);
    expect(readFileSync(stagedOutputPath, "utf8")).toContain(
      "providerManager: true",
    );
    if (stagedBundleExisted) {
      expect(readFileSync(stagedBundlePath, "utf8")).toBe(stagedBundleBefore);
    } else {
      expect(existsSync(stagedBundlePath)).toBe(false);
    }
  });
});
