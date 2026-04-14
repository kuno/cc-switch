import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { act, fireEvent, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  OPENWRT_SHARED_PROVIDER_UI_GLOBAL_KEY,
  __private__,
  type OpenWrtSharedProviderBundleApi,
} from "@/openwrt-provider-ui/index";
import type {
  OpenWrtProviderMutationEvent,
  OpenWrtProviderTransport,
} from "@/platform/openwrt/providers";
import type { OpenWrtRuntimeTransport } from "@/platform/openwrt/runtime";
import type {
  SharedProviderAppId,
  SharedProviderState,
} from "@/shared/providers/domain";

function createTransport(
  providerStates: Partial<
    Record<SharedProviderAppId, SharedProviderState>
  > = {},
): OpenWrtProviderTransport {
  function getProviderState(appId: SharedProviderAppId): SharedProviderState {
    return providerStates[appId] ?? createProviderState(appId, [], null);
  }

  function createStateResponse(appId: SharedProviderAppId) {
    const state = getProviderState(appId);

    return {
      ok: true,
      providers_json: JSON.stringify({
        activeProviderId: state.activeProviderId,
        providers: Object.fromEntries(
          state.providers.map((provider) => [
            provider.providerId ?? provider.name,
            {
              active: provider.active,
              baseUrl: provider.baseUrl,
              configured: provider.configured,
              model: provider.model,
              name: provider.name,
              notes: provider.notes,
              providerId: provider.providerId,
              tokenConfigured: provider.tokenConfigured,
              tokenField: provider.tokenField,
              tokenMasked: provider.tokenMasked,
            },
          ]),
        ),
      }),
    };
  }

  function createActiveProviderResponse(appId: SharedProviderAppId) {
    const state = getProviderState(appId);

    if (!state.activeProvider.configured) {
      return { ok: false };
    }

    return {
      ok: true,
      provider_json: JSON.stringify({
        active: state.activeProvider.active,
        baseUrl: state.activeProvider.baseUrl,
        configured: state.activeProvider.configured,
        model: state.activeProvider.model,
        name: state.activeProvider.name,
        notes: state.activeProvider.notes,
        providerId: state.activeProvider.providerId,
        tokenConfigured: state.activeProvider.tokenConfigured,
        tokenField: state.activeProvider.tokenField,
        tokenMasked: state.activeProvider.tokenMasked,
      }),
    };
  }

  return {
    listProviders: vi
      .fn<
        (
          appId: SharedProviderAppId,
        ) => Promise<ReturnType<typeof createStateResponse>>
      >()
      .mockImplementation(async (appId) => createStateResponse(appId)),
    listSavedProviders: vi
      .fn<
        (
          appId: SharedProviderAppId,
        ) => Promise<ReturnType<typeof createStateResponse>>
      >()
      .mockImplementation(async (appId) => createStateResponse(appId)),
    getActiveProvider: vi
      .fn<
        (
          appId: SharedProviderAppId,
        ) => Promise<ReturnType<typeof createActiveProviderResponse>>
      >()
      .mockImplementation(async (appId) => createActiveProviderResponse(appId)),
    upsertProvider: vi.fn().mockImplementation(async (appId, provider) => {
      const state = getProviderState(appId);
      const nextProviderId =
        provider.name.toLowerCase().replace(/\s+/g, "-") || `${appId}-provider`;

      providerStates[appId] = createProviderState(
        appId,
        [
          ...state.providers,
          {
            active: false,
            baseUrl: provider.baseUrl,
            model: provider.model,
            name: provider.name,
            notes: provider.notes,
            providerId: nextProviderId,
            tokenConfigured: Boolean(provider.token),
            tokenField: provider.tokenField,
            tokenMasked: provider.token ? "********" : "",
          },
        ],
        state.activeProviderId,
      );

      return { ok: true };
    }),
    restartService: vi.fn().mockResolvedValue({ ok: true }),
  };
}

function createRuntimeTransport(
  overrides: Partial<OpenWrtRuntimeTransport> = {},
): OpenWrtRuntimeTransport {
  return {
    failoverControlsAvailable: false,
    getRuntimeStatus: vi.fn().mockResolvedValue({
      ok: true,
      status_json: JSON.stringify({
        service: {
          running: false,
          reachable: false,
          listenAddress: "127.0.0.1",
          listenPort: 15721,
          proxyEnabled: true,
          enableLogging: true,
          statusSource: "config-fallback",
          statusError: "dial tcp 127.0.0.1:15721: connect: connection refused",
        },
        runtime: {
          running: false,
          address: "127.0.0.1",
          port: 15721,
          active_connections: 0,
          total_requests: 12,
          success_requests: 10,
          failed_requests: 2,
          success_rate: 83.3,
          uptime_seconds: 90,
          current_provider: "Claude Primary",
          current_provider_id: "claude-primary",
          last_request_at: "2026-04-13T08:00:00Z",
          last_error: "dial tcp timeout",
          failover_count: 1,
          active_targets: [],
        },
        apps: [],
      }),
    }),
    getAppRuntimeStatus: vi.fn().mockImplementation(async (appId) => ({
      ok: true,
      status_json: JSON.stringify({
        app: appId,
        providerCount: appId === "claude" ? 2 : 1,
        proxyEnabled: appId !== "gemini",
        autoFailoverEnabled: appId === "claude",
        maxRetries: appId === "claude" ? 4 : 3,
        activeProviderId: `${appId}-primary`,
        activeProvider: {
          configured: true,
          providerId: `${appId}-primary`,
          name:
            appId === "claude"
              ? "Claude Primary"
              : appId === "codex"
                ? "Codex Primary"
                : "Gemini Primary",
          baseUrl: `https://${appId}.example.com`,
          tokenField:
            appId === "claude"
              ? "ANTHROPIC_AUTH_TOKEN"
              : appId === "codex"
                ? "OPENAI_API_KEY"
                : "GEMINI_API_KEY",
          tokenConfigured: true,
        },
        activeProviderHealth: {
          providerId: `${appId}-primary`,
          observed: appId !== "gemini",
          healthy: appId === "codex",
          consecutiveFailures: appId === "claude" ? 2 : 0,
          lastSuccessAt: appId === "gemini" ? null : "2026-04-13T07:59:00Z",
          lastFailureAt: appId === "claude" ? "2026-04-13T07:58:00Z" : null,
          lastError: appId === "claude" ? "upstream timeout" : null,
          updatedAt: "2026-04-13T08:00:00Z",
        },
        usingLegacyDefault: appId === "gemini",
        failoverQueueDepth: appId === "claude" ? 1 : 0,
        failoverQueue:
          appId === "claude"
            ? [
                {
                  providerId: "claude-backup",
                  providerName: "Claude Backup",
                  sortIndex: 0,
                  active: false,
                  health: {
                    providerId: "claude-backup",
                    observed: false,
                    healthy: true,
                  },
                },
              ]
            : [],
        observedProviderCount: appId === "gemini" ? 0 : 1,
        healthyProviderCount: appId === "codex" ? 1 : 0,
        unhealthyProviderCount: appId === "claude" ? 1 : 0,
      }),
    })),
    getAvailableFailoverProviders: vi
      .fn()
      .mockResolvedValue({ ok: false, error: "method not found" }),
    addToFailoverQueue: vi
      .fn()
      .mockResolvedValue({ ok: false, error: "method not found" }),
    removeFromFailoverQueue: vi
      .fn()
      .mockResolvedValue({ ok: false, error: "method not found" }),
    setAutoFailoverEnabled: vi
      .fn()
      .mockResolvedValue({ ok: false, error: "method not found" }),
    ...overrides,
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

const FORBIDDEN_DESKTOP_SHELL_PHRASES = [
  "title bar",
  "window chrome",
  "system tray",
  "tray icon",
  "desktop shell",
  "menu bar",
  "taskbar",
  "dock",
  "window controls",
  "sidebar navigation",
] as const;

const FORBIDDEN_DESKTOP_SHELL_SELECTORS = [
  "#ccswitch-shared-provider-ui-root nav",
  "#ccswitch-shared-provider-ui-root aside",
  "#ccswitch-shared-runtime-surface-root nav",
  "#ccswitch-shared-runtime-surface-root aside",
  ".titlebar",
  ".window-controls",
  ".window-chrome",
  ".desktop-shell",
  ".taskbar",
  ".dock",
] as const;

function getElementClassName(element: Element): string {
  return typeof element.getAttribute === "function"
    ? (element.getAttribute("class") ?? "")
    : "";
}

describe("OpenWrt provider UI bundle", () => {
  beforeEach(() => {
    document.body.classList.remove("ccswitch-openwrt-provider-ui-theme");
    document.body.innerHTML = "";
  });

  afterEach(() => {
    document.body.classList.remove("ccswitch-openwrt-provider-ui-theme");
    document.body.innerHTML = "";
  });

  it("registers the runtime-surface capability and mounts a read-only runtime panel", async () => {
    const globalScope = globalThis as typeof globalThis & {
      [OPENWRT_SHARED_PROVIDER_UI_GLOBAL_KEY]?: OpenWrtSharedProviderBundleApi;
    };
    const api = globalScope[OPENWRT_SHARED_PROVIDER_UI_GLOBAL_KEY];
    const target = document.createElement("div");
    document.body.appendChild(target);
    const transport = createRuntimeTransport();

    expect(api?.capabilities).toEqual({
      providerManager: true,
      runtimeSurface: true,
    });
    expect(Object.keys(api ?? {}).sort()).toEqual([
      "capabilities",
      "mount",
      "mountRuntimeSurface",
    ]);
    expect(typeof api?.mountRuntimeSurface).toBe("function");
    expect(typeof api?.mount).toBe("function");

    let handle:
      | void
      | (() => void)
      | {
          unmount(): void;
        };

    await act(async () => {
      handle = await api?.mountRuntimeSurface({
        target,
        transport,
      });
      await Promise.resolve();
    });
    await waitFor(() =>
      expect(within(target).getByText("Runtime status")).toBeInTheDocument(),
    );

    expect(target).toHaveTextContent("Service Summary");
    expect(target).toHaveTextContent("Config fallback");
    expect(target).toHaveTextContent(
      "The daemon could not be reached. Showing saved OpenWrt configuration and failover context instead.",
    );
    expect(target).toHaveTextContent(
      "dial tcp 127.0.0.1:15721: connect: connection refused",
    );
    expect(target).toHaveTextContent("Claude");
    expect(target).toHaveTextContent("Codex");
    expect(target).toHaveTextContent("Gemini");
    expect(target).toHaveTextContent("Claude Primary");
    expect(target).toHaveTextContent("Queue depth");
    expect(target).toHaveTextContent(
      "No live health observation reported for this queue entry yet.",
    );
    expect(target).toHaveTextContent("Failover queue preview");
    expect(target).not.toHaveTextContent("Failover controls");
    expect(target).not.toHaveTextContent("Add to queue");
    expect(
      within(target).queryByRole("button", { name: /restart/i }),
    ).not.toBeInTheDocument();
    expect(transport.getRuntimeStatus).toHaveBeenCalledOnce();
    expect(transport.getAppRuntimeStatus).toHaveBeenCalledWith("claude");
    expect(transport.getAppRuntimeStatus).toHaveBeenCalledWith("codex");
    expect(transport.getAppRuntimeStatus).toHaveBeenCalledWith("gemini");
    expect(transport.getAvailableFailoverProviders).not.toHaveBeenCalled();
    expect(transport.addToFailoverQueue).not.toHaveBeenCalled();
    expect(transport.removeFromFailoverQueue).not.toHaveBeenCalled();
    expect(transport.setAutoFailoverEnabled).not.toHaveBeenCalled();

    await act(async () => {
      if (typeof handle === "function") {
        handle();
      } else if (handle && typeof handle.unmount === "function") {
        handle.unmount();
      }
    });

    expect(target.textContent).toBe("");
    target.remove();
  });

  it("mounts interactive runtime controls when the transport advertises phase 8 support", async () => {
    const globalScope = globalThis as typeof globalThis & {
      [OPENWRT_SHARED_PROVIDER_UI_GLOBAL_KEY]?: OpenWrtSharedProviderBundleApi;
    };
    const api = globalScope[OPENWRT_SHARED_PROVIDER_UI_GLOBAL_KEY];
    const target = document.createElement("div");
    document.body.appendChild(target);
    const transport = createRuntimeTransport({
      failoverControlsAvailable: true,
      getAvailableFailoverProviders: vi
        .fn()
        .mockImplementation(async (appId) => ({
          ok: true,
          providers_json: JSON.stringify({
            activeProviderId: `${appId}-primary`,
            providers: {
              [`${appId}-backup`]: {
                active: false,
                configured: true,
                model:
                  appId === "claude"
                    ? "claude-haiku-4-5"
                    : appId === "codex"
                      ? "gpt-5.4-mini"
                      : "gemini-2.5-flash",
                name:
                  appId === "claude"
                    ? "Claude Backup"
                    : appId === "codex"
                      ? "Codex Backup"
                      : "Gemini Backup",
                providerId: `${appId}-backup`,
                tokenConfigured: true,
                tokenField:
                  appId === "claude"
                    ? "ANTHROPIC_AUTH_TOKEN"
                    : appId === "codex"
                      ? "OPENAI_API_KEY"
                      : "GEMINI_API_KEY",
              },
            },
          }),
        })),
      addToFailoverQueue: vi.fn().mockResolvedValue({ ok: true }),
      removeFromFailoverQueue: vi.fn().mockResolvedValue({ ok: true }),
      setAutoFailoverEnabled: vi.fn().mockResolvedValue({ ok: true }),
    });

    let handle:
      | void
      | (() => void)
      | {
          unmount(): void;
        };

    await act(async () => {
      handle = await api?.mountRuntimeSurface({
        target,
        transport,
      });
      await Promise.resolve();
    });

    await waitFor(() =>
      expect(
        within(target).getByRole("switch", { name: "Claude auto-failover" }),
      ).toBeInTheDocument(),
    );

    expect(target).toHaveTextContent("Failover controls");
    expect(
      within(target).getAllByRole("button", { name: "Add to queue" }).length,
    ).toBeGreaterThan(0);

    fireEvent.click(
      within(target).getByRole("switch", { name: "Claude auto-failover" }),
    );

    await waitFor(() =>
      expect(transport.setAutoFailoverEnabled).toHaveBeenCalledWith(
        "claude",
        false,
      ),
    );
    expect(transport.getAvailableFailoverProviders).toHaveBeenCalledWith(
      "claude",
    );

    await act(async () => {
      if (typeof handle === "function") {
        handle();
      } else if (handle && typeof handle.unmount === "function") {
        handle.unmount();
      }
    });

    expect(target.textContent).toBe("");
    target.remove();
  });

  it("mounts the real Phase 6 provider surface and keeps app selection in the shell", async () => {
    const globalScope = globalThis as typeof globalThis & {
      [OPENWRT_SHARED_PROVIDER_UI_GLOBAL_KEY]?: OpenWrtSharedProviderBundleApi;
    };
    const api = globalScope[OPENWRT_SHARED_PROVIDER_UI_GLOBAL_KEY];
    const target = document.createElement("div");
    document.body.appendChild(target);
    const unsubscribe = vi.fn();
    let selectedApp: SharedProviderAppId = "claude";
    const shell = {
      clearMessage: vi.fn(),
      getSelectedApp: vi.fn().mockImplementation(() => selectedApp),
      getServiceStatus: vi.fn().mockReturnValue({ isRunning: false }),
      refreshServiceStatus: vi.fn().mockResolvedValue({ isRunning: false }),
      restartService: vi.fn().mockResolvedValue({ isRunning: false }),
      setSelectedApp: vi
        .fn()
        .mockImplementation((appId: "claude" | "codex" | "gemini") => {
          selectedApp = appId;
          return appId;
        }),
      subscribe: vi.fn().mockReturnValue(unsubscribe),
      showMessage: vi.fn(),
    };
    const transport = createTransport({
      claude: createProviderState("claude", [
        {
          active: true,
          baseUrl: "https://claude-primary.example.com",
          model: "claude-sonnet-4-5",
          name: "Claude Primary",
          notes: "Pinned for router traffic",
          providerId: "claude-primary",
          tokenConfigured: true,
          tokenField: "ANTHROPIC_AUTH_TOKEN",
        },
        {
          active: false,
          baseUrl: "https://claude-backup.example.com",
          model: "claude-haiku-4-5",
          name: "Claude Backup",
          providerId: "claude-backup",
          tokenConfigured: false,
          tokenField: "ANTHROPIC_API_KEY",
        },
      ]),
      codex: createProviderState("codex", [
        {
          active: true,
          baseUrl: "https://codex-primary.example.com/v1",
          model: "gpt-5.4",
          name: "Codex Primary",
          providerId: "codex-primary",
          tokenConfigured: true,
          tokenField: "OPENAI_API_KEY",
        },
      ]),
    });

    expect(api).toBeDefined();
    expect(api?.capabilities).toEqual({
      providerManager: true,
      runtimeSurface: true,
    });

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
      expect(
        within(target).getByRole("button", { name: "Edit Claude Primary" }),
      ).toBeInTheDocument(),
    );
    const providerCards = target.querySelectorAll("article");
    const claudePrimaryCard = Array.from(providerCards).find((card) =>
      card.textContent?.includes("Claude Primary"),
    );
    const claudeBackupCard = Array.from(providerCards).find((card) =>
      card.textContent?.includes("Claude Backup"),
    );
    const claudeDetailPanel = target.querySelector(
      '[data-ccswitch-region="provider-detail-panel"]',
    );

    expect(
      within(target).getByRole("button", { name: "Claude" }),
    ).toHaveAttribute("aria-pressed", "true");
    expect(
      within(target).getByRole("button", { name: "Add provider" }),
    ).toBeInTheDocument();
    expect(claudePrimaryCard).not.toBeNull();
    expect(claudeBackupCard).not.toBeNull();
    expect(claudeDetailPanel).not.toBeNull();
    expect(claudeDetailPanel).toHaveTextContent(
      /Base URL\s*https:\/\/claude-primary\.example\.com/,
    );
    expect(claudeDetailPanel).toHaveTextContent(/Model\s*claude-sonnet-4-5/);
    expect(claudeDetailPanel).toHaveTextContent(
      /Token field\s*ANTHROPIC_AUTH_TOKEN/,
    );
    expect(claudeDetailPanel).toHaveTextContent(/Provider ID\s*claude-primary/);
    expect(claudeDetailPanel).toHaveTextContent("Pinned for router traffic");
    expect(
      within(claudeDetailPanel as HTMLElement).getByText("Active route", {
        selector: "span",
      }),
    ).toBeInTheDocument();
    expect(
      within(claudeDetailPanel as HTMLElement).getByText("Stored secret", {
        selector: "span",
      }),
    ).toBeInTheDocument();
    expect(
      within(claudePrimaryCard as HTMLElement).queryByRole("button", {
        name: "Activate Claude Primary",
      }),
    ).not.toBeInTheDocument();
    expect(
      within(claudeBackupCard as HTMLElement).getByRole("button", {
        name: "Activate Claude Backup",
      }),
    ).toBeEnabled();
    expect(
      within(claudeBackupCard as HTMLElement).queryByText("Stored secret", {
        selector: "span",
      }),
    ).not.toBeInTheDocument();
    expect(
      within(target).queryByRole("button", { name: /duplicate/i }),
    ).not.toBeInTheDocument();
    expect(
      within(target).queryByRole("button", { name: /terminal/i }),
    ).not.toBeInTheDocument();
    expect(
      within(target).queryByRole("button", { name: /usage/i }),
    ).not.toBeInTheDocument();
    expect(
      within(target).queryByRole("button", { name: /failover/i }),
    ).not.toBeInTheDocument();
    expect(
      within(target).queryByRole("button", { name: /restart/i }),
    ).not.toBeInTheDocument();
    expect(target.textContent).not.toContain("Shared provider bundle loaded.");
    expect(target.textContent).not.toContain(
      "Waiting for the shared provider manager implementation.",
    );
    expect(target.textContent).not.toContain("Configure Provider");
    expect(shell.showMessage).not.toHaveBeenCalled();
    expect(shell.subscribe).toHaveBeenCalledTimes(1);
    expect(
      document.body.classList.contains("ccswitch-openwrt-provider-ui-theme"),
    ).toBe(true);
    expect(transport.listProviders).toHaveBeenCalledWith("claude");
    expect(transport.listSavedProviders).toHaveBeenCalledWith("claude");
    expect(transport.getActiveProvider).toHaveBeenCalledWith("claude");

    await act(async () => {
      fireEvent.click(within(target).getByRole("button", { name: "Codex" }));
    });

    expect(shell.setSelectedApp).toHaveBeenCalledWith("codex");
    await waitFor(() =>
      expect(
        within(target).getByRole("button", { name: "Edit Codex Primary" }),
      ).toBeInTheDocument(),
    );
    const codexPrimaryCard = Array.from(target.querySelectorAll("article")).find(
      (card) => card.textContent?.includes("Codex Primary"),
    );
    const codexDetailPanel = target.querySelector(
      '[data-ccswitch-region="provider-detail-panel"]',
    );

    expect(
      within(target).getByRole("button", { name: "Codex" }),
    ).toHaveAttribute("aria-pressed", "true");
    expect(codexPrimaryCard).not.toBeNull();
    expect(codexDetailPanel).not.toBeNull();
    expect(codexDetailPanel).toHaveTextContent(
      /Base URL\s*https:\/\/codex-primary\.example\.com\/v1/,
    );
    expect(codexDetailPanel).toHaveTextContent(/Model\s*gpt-5\.4/);
    expect(codexDetailPanel).toHaveTextContent(/Token field\s*OPENAI_API_KEY/);
    expect(codexDetailPanel).toHaveTextContent(/Provider ID\s*codex-primary/);
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
    expect(unsubscribe).toHaveBeenCalledTimes(1);
    expect(
      document.body.classList.contains("ccswitch-openwrt-provider-ui-theme"),
    ).toBe(false);
    expect(target.textContent).toBe("");
    target.remove();
  });

  it("mounts runtime and provider surfaces into unified OpenWrt roots without a secondary app shell", async () => {
    const globalScope = globalThis as typeof globalThis & {
      [OPENWRT_SHARED_PROVIDER_UI_GLOBAL_KEY]?: OpenWrtSharedProviderBundleApi;
    };
    const api = globalScope[OPENWRT_SHARED_PROVIDER_UI_GLOBAL_KEY];
    const shellRoot = document.createElement("div");
    const runtimeRoot = document.createElement("div");
    const providerRoot = document.createElement("div");
    const transport = createTransport({
      claude: createProviderState("claude", [
        {
          active: true,
          baseUrl: "https://claude-primary.example.com",
          model: "claude-sonnet-4-5",
          name: "Claude Primary",
          providerId: "claude-primary",
          tokenConfigured: true,
          tokenField: "ANTHROPIC_AUTH_TOKEN",
        },
      ]),
    });
    const runtimeTransport = createRuntimeTransport();

    runtimeRoot.id = "ccswitch-shared-runtime-surface-root";
    providerRoot.id = "ccswitch-shared-provider-ui-root";
    shellRoot.append(runtimeRoot, providerRoot);
    document.body.appendChild(shellRoot);

    const shell = {
      clearMessage: vi.fn(),
      getSelectedApp: vi
        .fn()
        .mockReturnValue("claude" satisfies SharedProviderAppId),
      getServiceStatus: vi.fn().mockReturnValue({ isRunning: true }),
      refreshServiceStatus: vi.fn().mockResolvedValue({ isRunning: true }),
      restartService: vi.fn().mockResolvedValue({ isRunning: true }),
      setSelectedApp: vi
        .fn()
        .mockImplementation((appId: SharedProviderAppId) => appId),
      subscribe: vi.fn().mockReturnValue(vi.fn()),
      showMessage: vi.fn(),
    };

    let runtimeHandle:
      | void
      | (() => void)
      | {
          unmount(): void;
        };
    let providerHandle:
      | void
      | (() => void)
      | {
          unmount(): void;
        };

    await act(async () => {
      runtimeHandle = await api?.mountRuntimeSurface({
        target: runtimeRoot,
        transport: runtimeTransport,
      });
      providerHandle = await api?.mount({
        appId: "claude",
        serviceStatus: { isRunning: true },
        shell,
        target: providerRoot,
        transport,
      });
      await Promise.resolve();
    });

    await waitFor(() =>
      expect(
        within(runtimeRoot).getByText("Runtime status"),
      ).toBeInTheDocument(),
    );
    await waitFor(() =>
      expect(
        within(providerRoot).getByRole("button", {
          name: "Edit Claude Primary",
        }),
      ).toBeInTheDocument(),
    );

    expect(
      document.body.classList.contains("ccswitch-openwrt-provider-ui-theme"),
    ).toBe(true);
    expect(runtimeRoot.firstElementChild?.tagName).toBe("SECTION");
    expect(runtimeRoot.querySelectorAll('[role="region"]').length).toBe(3);
    expect(
      runtimeRoot.querySelector("section.ccswitch-openwrt-page-section"),
    ).not.toBeNull();
    expect(
      runtimeRoot.querySelector(".ccswitch-openwrt-page-header"),
    ).not.toBeNull();
    expect(
      runtimeRoot.querySelector(".ccswitch-openwrt-surface-card"),
    ).not.toBeNull();
    expect(runtimeRoot).toHaveTextContent("Queue depth / retries");
    expect(
      Array.from(runtimeRoot.querySelectorAll("*")).some((element) =>
        getElementClassName(element).includes("rounded-3xl"),
      ),
    ).toBe(true);
    expect(
      providerRoot.querySelector(".ccswitch-openwrt-page-section"),
    ).not.toBeNull();
    expect(
      providerRoot.querySelector(".ccswitch-openwrt-page-header"),
    ).not.toBeNull();
    expect(
      providerRoot.querySelector(
        '[data-ccswitch-region="provider-app-picker"][aria-label="Provider apps"]',
      ),
    ).not.toBeNull();
    expect(
      providerRoot.querySelector(".ccswitch-openwrt-provider-card"),
    ).not.toBeNull();
    expect(
      providerRoot.querySelector('[data-ccswitch-region="provider-detail-panel"]'),
    ).not.toBeNull();
    expect(
      within(providerRoot).getByRole("tab", { name: "General" }),
    ).toHaveAttribute("aria-selected", "true");
    expect(
      within(providerRoot).getByRole("tab", { name: "Credentials" }),
    ).toBeInTheDocument();
    expect(
      providerRoot.querySelector(
        '[data-ccswitch-region="provider-summary-grid"][data-ccswitch-layout="stack-to-split"]',
      ),
    ).not.toBeNull();
    expect(
      providerRoot,
    ).toHaveTextContent("General provider settings");
    expect(
      shellRoot.querySelector("main, nav, aside, [role='navigation']"),
    ).toBeNull();
    expect(shellRoot.querySelector("dialog")).toBeNull();
    expect(
      document.body.querySelector(".ccswitch-openwrt-provider-ui-dialog"),
    ).toBeNull();
    expect(
      document.body.querySelector(".ccswitch-openwrt-provider-ui-overlay"),
    ).toBeNull();
    expect(
      within(shellRoot).queryByRole("button", { name: /restart/i }),
    ).not.toBeInTheDocument();

    await act(async () => {
      if (typeof runtimeHandle === "function") {
        runtimeHandle();
      } else if (runtimeHandle && typeof runtimeHandle.unmount === "function") {
        runtimeHandle.unmount();
      }

      if (typeof providerHandle === "function") {
        providerHandle();
      } else if (
        providerHandle &&
        typeof providerHandle.unmount === "function"
      ) {
        providerHandle.unmount();
      }
    });

    expect(runtimeRoot.textContent).toBe("");
    expect(providerRoot.textContent).toBe("");
    expect(
      document.body.classList.contains("ccswitch-openwrt-provider-ui-theme"),
    ).toBe(false);
    shellRoot.remove();
  });

  it("keeps editor and delete dialogs inside the OpenWrt body portal without creating host-owned controls", async () => {
    const globalScope = globalThis as typeof globalThis & {
      [OPENWRT_SHARED_PROVIDER_UI_GLOBAL_KEY]?: OpenWrtSharedProviderBundleApi;
    };
    const api = globalScope[OPENWRT_SHARED_PROVIDER_UI_GLOBAL_KEY];
    const shellRoot = document.createElement("div");
    const providerRoot = document.createElement("div");
    const transport = createTransport({
      claude: createProviderState("claude", [
        {
          active: true,
          baseUrl: "https://claude-primary.example.com",
          model: "claude-sonnet-4-5",
          name: "Claude Primary",
          providerId: "claude-primary",
          tokenConfigured: true,
          tokenField: "ANTHROPIC_AUTH_TOKEN",
        },
        {
          active: false,
          baseUrl: "https://claude-backup.example.com",
          model: "claude-haiku-4-5",
          name: "Claude Backup",
          providerId: "claude-backup",
          tokenConfigured: false,
          tokenField: "ANTHROPIC_API_KEY",
        },
      ]),
    });

    providerRoot.id = "ccswitch-shared-provider-ui-root";
    shellRoot.appendChild(providerRoot);
    document.body.appendChild(shellRoot);

    const shell = {
      clearMessage: vi.fn(),
      getSelectedApp: vi
        .fn()
        .mockReturnValue("claude" satisfies SharedProviderAppId),
      getServiceStatus: vi.fn().mockReturnValue({ isRunning: true }),
      refreshServiceStatus: vi.fn().mockResolvedValue({ isRunning: true }),
      restartService: vi.fn().mockResolvedValue({ isRunning: true }),
      setSelectedApp: vi
        .fn()
        .mockImplementation((appId: SharedProviderAppId) => appId),
      subscribe: vi.fn().mockReturnValue(vi.fn()),
      showMessage: vi.fn(),
    };

    let providerHandle:
      | void
      | (() => void)
      | {
          unmount(): void;
        };

    await act(async () => {
      providerHandle = await api?.mount({
        appId: "claude",
        serviceStatus: { isRunning: true },
        shell,
        target: providerRoot,
        transport,
      });
    });

    await waitFor(() =>
      expect(
        within(providerRoot).getByRole("button", {
          name: "Edit Claude Primary",
        }),
      ).toBeInTheDocument(),
    );

    await act(async () => {
      fireEvent.click(
        within(providerRoot).getByRole("button", {
          name: "Edit Claude Primary",
        }),
      );
    });

    const editDialog = await within(document.body).findByRole("dialog", {
      name: "Update Claude provider",
    });

    expect(editDialog).toHaveClass("ccswitch-openwrt-provider-ui-dialog");
    expect(document.body.contains(editDialog)).toBe(true);
    expect(shellRoot.contains(editDialog)).toBe(false);
    const editForm = editDialog.querySelector("form");
    const overlay = document.body.querySelector(
      ".ccswitch-openwrt-provider-ui-overlay",
    );

    expect(editForm).not.toBeNull();
    expect(overlay).not.toBeNull();
    expect(document.body.contains(overlay)).toBe(true);
    expect(shellRoot.contains(overlay as Node)).toBe(false);
    expect(within(editDialog).queryByRole("button", { name: /restart/i })).toBeNull();

    await act(async () => {
      fireEvent.click(
        within(editDialog).getByRole("button", { name: "Cancel" }),
      );
    });

    await waitFor(() =>
      expect(
        document.body.querySelector(".ccswitch-openwrt-provider-ui-dialog"),
      ).toBeNull(),
    );

    await act(async () => {
      fireEvent.click(
        within(providerRoot).getByRole("button", {
          name: "Delete Claude Backup",
        }),
      );
    });

    const deleteDialog = await within(document.body).findByRole("dialog", {
      name: "Delete provider",
    });

    expect(deleteDialog).toHaveClass("ccswitch-openwrt-provider-ui-dialog");
    expect(document.body.contains(deleteDialog)).toBe(true);
    expect(shellRoot.contains(deleteDialog)).toBe(false);
    expect(
      document.body.querySelectorAll(".ccswitch-openwrt-provider-ui-overlay"),
    ).toHaveLength(1);
    expect(
      within(deleteDialog).queryByRole("button", { name: /restart/i }),
    ).toBeNull();

    await act(async () => {
      if (typeof providerHandle === "function") {
        providerHandle();
      } else if (
        providerHandle &&
        typeof providerHandle.unmount === "function"
      ) {
        providerHandle.unmount();
      }
    });

    expect(providerRoot.textContent).toBe("");
    expect(
      document.body.querySelector(".ccswitch-openwrt-provider-ui-dialog"),
    ).toBeNull();
    expect(
      document.body.querySelector(".ccswitch-openwrt-provider-ui-overlay"),
    ).toBeNull();
    shellRoot.remove();
  });

  it("updates shell messaging and restart state for save, activate, and delete mutations", () => {
    const rerender = vi.fn();
    let restartState = {
      pending: false,
      inFlight: true,
    };
    const shell = {
      clearMessage: vi.fn(),
      getSelectedApp: vi
        .fn<() => SharedProviderAppId>()
        .mockReturnValue("gemini"),
      getRestartState: vi.fn().mockImplementation(() => restartState),
      getServiceStatus: vi.fn().mockReturnValue({ isRunning: false }),
      refreshServiceStatus: vi.fn().mockResolvedValue({ isRunning: false }),
      restartService: vi.fn().mockResolvedValue({ isRunning: false }),
      setSelectedApp: vi.fn(),
      setRestartState: vi.fn().mockImplementation((nextState) => {
        restartState = {
          ...restartState,
          ...nextState,
        };
      }),
      showMessage: vi.fn(),
    };
    const state = {
      disposed: false,
      restartInFlight: true,
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
    expect(state.restartInFlight).toBe(true);
    expect(shell.setRestartState).toHaveBeenLastCalledWith({
      pending: true,
      inFlight: true,
    });
    expect(shell.showMessage).toHaveBeenLastCalledWith(
      "info",
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
    expect(state.restartPending).toBe(true);
    expect(state.restartInFlight).toBe(true);
    expect(shell.setRestartState).toHaveBeenCalledTimes(1);
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
    expect(state.restartInFlight).toBe(true);
    expect(shell.setRestartState).toHaveBeenLastCalledWith({
      pending: true,
      inFlight: true,
    });
    expect(shell.showMessage).toHaveBeenLastCalledWith(
      "info",
      "provider-delete was deleted. Restart the service to apply provider changes.",
    );
    expect(rerender).toHaveBeenCalledTimes(3);
  });

  it("releases the theme lease when initial mount setup throws", () => {
    expect(
      document.body.classList.contains("ccswitch-openwrt-provider-ui-theme"),
    ).toBe(false);

    expect(() =>
      __private__.withThemeLease(() => {
        throw new Error("mount failed");
      }),
    ).toThrow("mount failed");

    expect(
      document.body.classList.contains("ccswitch-openwrt-provider-ui-theme"),
    ).toBe(false);
  });

  it("duplicates a provider through the mounted bundle by seeding add mode and saving on the create path", async () => {
    const globalScope = globalThis as typeof globalThis & {
      [OPENWRT_SHARED_PROVIDER_UI_GLOBAL_KEY]?: OpenWrtSharedProviderBundleApi;
    };
    const api = globalScope[OPENWRT_SHARED_PROVIDER_UI_GLOBAL_KEY];
    const shellRoot = document.createElement("div");
    const providerRoot = document.createElement("div");
    const transport = createTransport({
      codex: createProviderState(
        "codex",
        [
          {
            active: true,
            baseUrl: "https://codex-primary.example.com/v1",
            model: "gpt-5.4",
            name: "Codex Primary",
            notes: "Pinned for router traffic",
            providerId: "codex-primary",
            tokenConfigured: true,
            tokenField: "OPENAI_API_KEY",
            tokenMasked: "********",
          },
        ],
        "codex-primary",
      ),
    });

    providerRoot.id = "ccswitch-shared-provider-ui-root";
    shellRoot.appendChild(providerRoot);
    document.body.appendChild(shellRoot);

    const shell = {
      clearMessage: vi.fn(),
      getSelectedApp: vi
        .fn()
        .mockReturnValue("codex" satisfies SharedProviderAppId),
      getServiceStatus: vi.fn().mockReturnValue({ isRunning: true }),
      refreshServiceStatus: vi.fn().mockResolvedValue({ isRunning: true }),
      restartService: vi.fn().mockResolvedValue({ isRunning: true }),
      setSelectedApp: vi
        .fn()
        .mockImplementation((appId: SharedProviderAppId) => appId),
      subscribe: vi.fn().mockReturnValue(vi.fn()),
      showMessage: vi.fn(),
    };

    let providerHandle:
      | void
      | (() => void)
      | {
          unmount(): void;
        };

    await act(async () => {
      providerHandle = await api?.mount({
        appId: "codex",
        serviceStatus: { isRunning: true },
        shell,
        target: providerRoot,
        transport,
      });
    });

    await waitFor(() =>
      expect(
        within(providerRoot).getByRole("button", {
          name: "Duplicate Codex Primary",
        }),
      ).toBeInTheDocument(),
    );

    await act(async () => {
      fireEvent.click(
        within(providerRoot).getByRole("button", {
          name: "Duplicate Codex Primary",
        }),
      );
    });

    const duplicateDialog = await within(document.body).findByRole("dialog", {
      name: "Save Codex provider",
    });
    const duplicateDialogScope = within(duplicateDialog);

    expect(duplicateDialogScope.getByLabelText("Provider name")).toHaveValue(
      "Codex Primary copy",
    );
    expect(duplicateDialogScope.getByLabelText("Base URL")).toHaveValue(
      "https://codex-primary.example.com/v1",
    );
    expect(duplicateDialogScope.getByLabelText("API token")).toHaveValue("");

    await act(async () => {
      fireEvent.change(duplicateDialogScope.getByLabelText("API token"), {
        target: { value: "copy-secret" },
      });
      fireEvent.click(
        duplicateDialogScope.getByRole("button", { name: "Save provider" }),
      );
    });

    await waitFor(() =>
      expect(transport.upsertProvider).toHaveBeenCalledWith(
        "codex",
        expect.objectContaining({
          name: "Codex Primary copy",
          baseUrl: "https://codex-primary.example.com/v1",
          tokenField: "OPENAI_API_KEY",
          token: "copy-secret",
          model: "gpt-5.4",
          notes: "Pinned for router traffic",
        }),
      ),
    );
    expect(transport.upsertProviderByProviderId).not.toHaveBeenCalled();
    expect(transport.upsertProviderById).not.toHaveBeenCalled();

    await waitFor(() =>
      expect(
        within(providerRoot).getByRole("button", {
          name: "Edit Codex Primary copy",
        }),
      ).toBeInTheDocument(),
    );

    await act(async () => {
      if (typeof providerHandle === "function") {
        providerHandle();
      } else if (
        providerHandle &&
        typeof providerHandle.unmount === "function"
      ) {
        providerHandle.unmount();
      }
    });

    shellRoot.remove();
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
    const stagedStylesheetPath = path.resolve(
      repoRoot,
      "openwrt/provider-ui-dist/ccswitch-provider-ui.css",
    );
    const stagedOutputPath = path.join(outputDir, "ccswitch-provider-ui.js");
    const stagedStylesheetOutputPath = path.join(
      outputDir,
      "ccswitch-provider-ui.css",
    );
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
    execFileSync("sh", [helperPath, "--output-dir", outputDir], {
      cwd: repoRoot,
    });

    expect(existsSync(stagedBundlePath)).toBe(true);
    expect(existsSync(stagedStylesheetPath)).toBe(true);
    expect(existsSync(stagedOutputPath)).toBe(true);
    expect(existsSync(stagedStylesheetOutputPath)).toBe(true);
    const stagedBundleSource = readFileSync(stagedBundlePath, "utf8");
    const stagedStylesheetSource = readFileSync(stagedStylesheetPath, "utf8");
    const bundleSource = readFileSync(stagedOutputPath, "utf8");
    const stylesheetSource = readFileSync(stagedStylesheetOutputPath, "utf8");
    expect(bundleSource).toBe(stagedBundleSource);
    expect(stylesheetSource).toBe(stagedStylesheetSource);
    expect(stagedBundleSource).toContain(
      "__CCSWITCH_OPENWRT_SHARED_PROVIDER_UI__",
    );
    expect(stagedBundleSource).toContain("providerManager");
    expect(stagedBundleSource).toContain("runtimeSurface");
    expect(stagedBundleSource).toContain("mountRuntimeSurface");
    expect(stagedStylesheetSource).toContain(
      "body.ccswitch-openwrt-provider-ui-theme",
    );
    expect(stagedStylesheetSource).toMatch(
      /#ccswitch-shared-provider-ui-root,\s*#ccswitch-shared-runtime-surface-root,\s*body\.ccswitch-openwrt-provider-ui-theme\s+\.ccswitch-openwrt-provider-ui-dialog,\s*body\.ccswitch-openwrt-provider-ui-theme\s+\.ccswitch-openwrt-provider-ui-overlay/,
    );
    expect(stagedStylesheetSource).toMatch(
      /#ccswitch-shared-provider-ui-root,\s*#ccswitch-shared-provider-ui-root \*,\s*#ccswitch-shared-provider-ui-root \*:before,\s*#ccswitch-shared-provider-ui-root \*:after,\s*#ccswitch-shared-runtime-surface-root,\s*#ccswitch-shared-runtime-surface-root \*/,
    );
    expect(stagedStylesheetSource).toMatch(
      /#ccswitch-shared-provider-ui-root\s+:focus-visible,\s*#ccswitch-shared-runtime-surface-root\s+:focus-visible,\s*body\.ccswitch-openwrt-provider-ui-theme\s+\.ccswitch-openwrt-provider-ui-dialog\s+:focus-visible/,
    );
    expect(stagedStylesheetSource).toMatch(
      /body\.ccswitch-openwrt-provider-ui-theme\s+\.ccswitch-openwrt-provider-ui-dialog\{[^}]*max-height:[^;}]+[^}]*overflow:hidden/,
    );
    expect(stagedStylesheetSource).toMatch(
      /body\.ccswitch-openwrt-provider-ui-theme\s+\.ccswitch-openwrt-provider-ui-dialog\{[^}]*display:flex[^}]*width:min\(72rem,100%\)[^}]*max-width:100%[^}]*min-height:0[^}]*max-height:min\(60rem,100%\)[^}]*margin:auto[^}]*overflow:hidden/,
    );
    expect(stagedStylesheetSource).toMatch(
      /body\.ccswitch-openwrt-provider-ui-theme\s+\.ccswitch-openwrt-provider-ui-dialog>form\{[^}]*display:flex[^}]*min-height:0[^}]*flex:1 1 auto[^}]*flex-direction:column[^}]*max-height:inherit/,
    );
    expect(stagedStylesheetSource).toContain(
      "html.dark body.ccswitch-openwrt-provider-ui-theme,body.ccswitch-openwrt-provider-ui-theme.dark",
    );
    expect(stagedStylesheetSource).toMatch(
      /body\.ccswitch-openwrt-provider-ui-theme\s+\.ccswitch-openwrt-provider-ui-overlay\{/,
    );
    expect(stagedStylesheetSource).not.toContain("color-scheme:light");
    expect(stagedStylesheetSource).not.toContain("scrollbar-width:none");
    expect(stagedBundleSource).not.toContain("process.env.NODE_ENV");
    expect(stagedBundleSource).not.toContain("Shared provider bundle loaded.");
    expect(stagedBundleSource).not.toContain(
      "Waiting for the shared provider manager implementation.",
    );
    expect(luciMakefile).toContain("prepare-provider-ui-bundle.sh");
    expect(buildIpkScript).toContain("prepare-provider-ui-bundle.sh");
    expect(viteConfig).toContain("openwrt/provider-ui-dist");
  });

  it("ships required embed-safe host-fit selectors in staged artifacts", () => {
    const repoRoot = process.cwd();
    const stagedBundleSource = readFileSync(
      path.resolve(
        repoRoot,
        "openwrt/provider-ui-dist/ccswitch-provider-ui.js",
      ),
      "utf8",
    );
    const stagedStylesheetSource = readFileSync(
      path.resolve(
        repoRoot,
        "openwrt/provider-ui-dist/ccswitch-provider-ui.css",
      ),
      "utf8",
    );

    for (const hook of [
      "ccswitch-openwrt-page-section",
      "ccswitch-openwrt-page-header",
      "ccswitch-openwrt-app-switch",
      "ccswitch-openwrt-surface-card",
      "ccswitch-openwrt-provider-card",
      "ccswitch-openwrt-state-shell",
      "ccswitch-openwrt-provider-ui-positioner",
    ]) {
      expect(stagedBundleSource).toContain(hook);
      expect(stagedStylesheetSource).toContain(hook);
    }

    expect(stagedStylesheetSource).toMatch(
      /body\.ccswitch-openwrt-provider-ui-theme \.ccswitch-openwrt-provider-ui-dialog/,
    );
    expect(stagedStylesheetSource).toMatch(
      /body\.ccswitch-openwrt-provider-ui-theme \.ccswitch-openwrt-provider-ui-overlay/,
    );
    expect(stagedStylesheetSource).toMatch(
      /body\.ccswitch-openwrt-provider-ui-theme \.ccswitch-openwrt-provider-ui-dialog--compact\{[^}]*width:min\(28rem,100%\)/,
    );
    expect(stagedStylesheetSource).toMatch(
      /#ccswitch-shared-provider-ui-root \[data-ccswitch-layout=stack-to-split\]/,
    );
    expect(stagedStylesheetSource).toMatch(
      /#ccswitch-shared-runtime-surface-root \[data-ccswitch-layout=stack-to-row\]/,
    );
    expect(stagedStylesheetSource).toMatch(
      /#ccswitch-shared-provider-ui-root \[data-ccswitch-layout=responsive-grid\]/,
    );
    expect(stagedStylesheetSource).toMatch(
      /#ccswitch-shared-runtime-surface-root \[data-ccswitch-layout=responsive-grid\]/,
    );
    expect(stagedStylesheetSource).toMatch(
      /@media\(max-width:\d+px\)\{[^}]*body\.ccswitch-openwrt-provider-ui-theme \.cbi-value\{[^}]*grid-template-columns:1fr[^}]*\}/,
    );
    expect(stagedStylesheetSource).toMatch(
      /@media\(max-width:\d+px\)\{[^}]*body\.ccswitch-openwrt-provider-ui-theme \.ccswitch-openwrt-provider-ui-positioner\{[^}]*\}[^}]*body\.ccswitch-openwrt-provider-ui-theme \.ccswitch-openwrt-provider-ui-dialog\{/,
    );
  });

  it("keeps the staged OpenWrt bundle free of split-shell selectors and desktop-shell structure", () => {
    const repoRoot = process.cwd();
    const stagedBundleSource = readFileSync(
      path.resolve(
        repoRoot,
        "openwrt/provider-ui-dist/ccswitch-provider-ui.js",
      ),
      "utf8",
    ).toLowerCase();
    const stagedStylesheetSource = readFileSync(
      path.resolve(
        repoRoot,
        "openwrt/provider-ui-dist/ccswitch-provider-ui.css",
      ),
      "utf8",
    ).toLowerCase();

    for (const phrase of FORBIDDEN_DESKTOP_SHELL_PHRASES) {
      expect(stagedBundleSource).not.toContain(phrase);
      expect(stagedStylesheetSource).not.toContain(phrase);
    }

    for (const selector of FORBIDDEN_DESKTOP_SHELL_SELECTORS) {
      expect(stagedStylesheetSource).not.toContain(selector);
    }
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
    const explicitStylesheetPath = path.join(
      sourceDir,
      "explicit-real-bundle.css",
    );
    const stagedBundlePath = path.resolve(
      repoRoot,
      "openwrt/provider-ui-dist/ccswitch-provider-ui.js",
    );
    const stagedStylesheetPath = path.resolve(
      repoRoot,
      "openwrt/provider-ui-dist/ccswitch-provider-ui.css",
    );
    const stagedOutputPath = path.join(outputDir, "ccswitch-provider-ui.js");
    const stagedStylesheetOutputPath = path.join(
      outputDir,
      "ccswitch-provider-ui.css",
    );
    const stagedBundleExisted = existsSync(stagedBundlePath);
    const stagedStylesheetExisted = existsSync(stagedStylesheetPath);
    const stagedBundleBefore = stagedBundleExisted
      ? readFileSync(stagedBundlePath, "utf8")
      : null;
    const stagedStylesheetBefore = stagedStylesheetExisted
      ? readFileSync(stagedStylesheetPath, "utf8")
      : null;
    const explicitBundleSource = [
      "globalThis.__CCSWITCH_OPENWRT_SHARED_PROVIDER_UI__ = {",
      "  capabilities: { providerManager: true },",
      "  mount() { return { unmount() {} }; },",
      "};",
      "",
    ].join("\n");
    const explicitStylesheetSource =
      ":root { --ccswitch-explicit-bundle: 1; }\n";

    writeFileSync(explicitBundlePath, explicitBundleSource, "utf8");
    writeFileSync(explicitStylesheetPath, explicitStylesheetSource, "utf8");

    execFileSync("sh", [helperPath, "--output-dir", outputDir], {
      cwd: repoRoot,
      env: {
        ...process.env,
        CCSWITCH_OPENWRT_PROVIDER_UI_BUNDLE: explicitBundlePath,
      },
    });

    expect(existsSync(stagedOutputPath)).toBe(true);
    expect(existsSync(stagedStylesheetOutputPath)).toBe(true);
    expect(readFileSync(stagedOutputPath, "utf8")).toBe(explicitBundleSource);
    expect(readFileSync(stagedStylesheetOutputPath, "utf8")).toBe(
      explicitStylesheetSource,
    );
    expect(readFileSync(stagedOutputPath, "utf8")).toContain(
      "providerManager: true",
    );
    if (stagedBundleExisted) {
      expect(readFileSync(stagedBundlePath, "utf8")).toBe(stagedBundleBefore);
    } else {
      expect(existsSync(stagedBundlePath)).toBe(false);
    }
    if (stagedStylesheetExisted) {
      expect(readFileSync(stagedStylesheetPath, "utf8")).toBe(
        stagedStylesheetBefore,
      );
    } else {
      expect(existsSync(stagedStylesheetPath)).toBe(false);
    }
  });
});
