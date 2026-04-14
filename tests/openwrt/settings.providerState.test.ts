import { readFileSync } from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

type AppId = "claude" | "codex" | "gemini";

type UiState = {
  isRunning: boolean;
  selectedApp: AppId;
  busy: boolean;
  message: { kind: "success" | "error" | "info"; text: string } | null;
  bundleStatus: "idle" | "loading" | "ready" | "fallback" | "error";
  bundleError: string | null;
  fallbackReason: string | null;
  restartPending: boolean;
  mountHandle: (() => void) | null;
  mountRequestId: number;
  runtimeMountHandle: (() => void) | null;
  runtimeMountRequestId: number;
};

type StatusNodes = {
  messageRoot: HTMLElement;
  messageText: HTMLElement;
  restartButton: HTMLButtonElement;
  root: HTMLElement;
  serviceValue: HTMLElement;
  summaryValue: HTMLElement;
};

type ShellNodes = {
  runtimeMountRoot: HTMLElement;
  mountRoot: HTMLElement;
  root: HTMLElement;
};

type ShellBridge = {
  clearMessage(): void;
  getSelectedApp(): AppId;
  getServiceStatus(): { isRunning: boolean };
  refreshServiceStatus(): Promise<{ isRunning: boolean }>;
  restartService(): Promise<{ isRunning: boolean }>;
  setSelectedApp(appId: AppId): AppId;
  showMessage(kind: "success" | "error" | "info", text: string): void;
};

type ProviderMountOptions = {
  appId: AppId;
  serviceStatus: { isRunning: boolean };
  shell: ShellBridge;
  target: HTMLElement;
  transport: Record<string, (...args: unknown[]) => Promise<unknown>>;
};

type RuntimeMountOptions = {
  target: HTMLElement;
  transport: {
    failoverControlsAvailable?: boolean;
    getRuntimeStatus(): Promise<unknown>;
    getAppRuntimeStatus(appId: AppId): Promise<unknown>;
    getAvailableFailoverProviders(appId: AppId): Promise<unknown>;
    addToFailoverQueue(appId: AppId, providerId: string): Promise<unknown>;
    removeFromFailoverQueue(appId: AppId, providerId: string): Promise<unknown>;
    setAutoFailoverEnabled(appId: AppId, enabled: boolean): Promise<unknown>;
  };
};

type SettingsView = {
  createProviderShell(uiState: UiState, statusNodes: StatusNodes): ShellNodes;
  createProviderTransport(): Record<string, (...args: unknown[]) => Promise<unknown>>;
  createRuntimeTransport(): RuntimeMountOptions["transport"];
  createShellBridge(
    uiState: UiState,
    statusNodes: StatusNodes,
    shellNodes: ShellNodes,
  ): ShellBridge;
  createStatusPanel(uiState: UiState): StatusNodes;
  createUiState(isRunning: boolean, selectedApp: AppId): UiState;
  getBundleAssetPath(): string;
  getBundleStylePath(): string;
  getSelectedApp(): AppId;
  loadSharedProviderBundle(): Promise<{
    capabilities?: { providerManager?: boolean; runtimeSurface?: boolean };
    mount(
      options: ProviderMountOptions,
    ): { unmount(): void } | (() => void) | void;
    mountRuntimeSurface?(
      options: RuntimeMountOptions,
    ): { unmount(): void } | (() => void) | void;
  }>;
  mountSharedRuntimeSurface(
    uiState: UiState,
    shellNodes: ShellNodes,
  ): Promise<void>;
  mountSharedProviderUi(
    uiState: UiState,
    statusNodes: StatusNodes,
    shellNodes: ShellNodes,
  ): Promise<void>;
  saveSelectedApp(appId: AppId): void;
  teardownSharedRuntimeSurface(uiState: UiState): void;
  teardownSharedProviderUi(uiState: UiState): void;
};

type RpcSpec = {
  expect?: Record<string, unknown>;
  method: string;
  object: string;
  params?: string[];
};

type StaticPrototypeSettings = SettingsView & {
  buildStaticPrototypeQuery(bindings: {
    app: AppId;
    health: string;
    httpProxy: string;
    httpsProxy: string;
    listenAddr: string;
    listenPort: string;
    logLevel: string;
    proxyEnabled: string;
    serviceLabel: string;
    status: string;
  }): string;
  buildStaticPrototypeWorkspaceData(data: unknown[]): {
    apps: Record<
      AppId,
      {
        activeProviderId: string | null;
        providers: Array<Record<string, unknown>>;
      }
    >;
  };
  getHostConfigSnapshot(): {
    enabled: boolean;
    httpProxy: string;
    httpsProxy: string;
    listenAddr: string;
    listenPort: string;
    logLevel: string;
  };
  getStaticPrototypeBindings(data: unknown[]): {
    app: AppId;
    health: string;
    httpProxy: string;
    httpsProxy: string;
    listenAddr: string;
    listenPort: string;
    logLevel: string;
    proxyEnabled: string;
    serviceLabel: string;
    status: string;
  };
  parseServiceState(serviceStatus: unknown): boolean;
  parseStaticPrototypeFailoverState(
    response: unknown,
    fallbackProviderId: string,
  ): Record<string, unknown>;
};

const SHARED_PROVIDER_UI_GLOBAL_KEY = "__CCSWITCH_OPENWRT_SHARED_PROVIDER_UI__";
const SHARED_PROVIDER_UI_SCRIPT_ID =
  "ccswitch-openwrt-shared-provider-ui-bundle";
const SHARED_PROVIDER_UI_CUTOVER_MODE_STORAGE_KEY =
  "ccswitch-openwrt-provider-ui-cutover-mode";
const SHARED_PROVIDER_UI_DISABLE_GLOBAL_KEY =
  "__CCSWITCH_OPENWRT_DISABLE_REAL_PROVIDER_UI__";
const SHARED_PROVIDER_UI_FALLBACK_REASON_GATE_DISABLED = "gate-disabled";
const SHARED_PROVIDER_UI_FALLBACK_REASON_BUNDLE_FAILURE = "bundle-failure";
const SHARED_PROVIDER_UI_FALLBACK_REASON_BUNDLE_REGRESSION =
  "bundle-regression";
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

function createElement(
  tag: string,
  attrs?: Record<string, unknown> | unknown[] | string,
  children?: unknown[] | string,
): HTMLElement {
  const element = document.createElement(tag);
  let resolvedAttrs = attrs;
  let resolvedChildren = children;

  if (
    Array.isArray(attrs) ||
    typeof attrs === "string" ||
    attrs instanceof Node
  ) {
    resolvedAttrs = undefined;
    resolvedChildren = attrs as unknown[] | string;
  }

  if (resolvedAttrs && typeof resolvedAttrs === "object") {
    Object.entries(resolvedAttrs).forEach(([key, value]) => {
      if (value == null) {
        return;
      }

      if (key === "class") {
        element.className = String(value);
        return;
      }

      if (key === "style") {
        element.setAttribute("style", String(value));
        return;
      }

      if (key === "click" && typeof value === "function") {
        element.addEventListener("click", value as EventListener);
        return;
      }

      element.setAttribute(key, String(value));
    });
  }

  const appendChild = (child: unknown) => {
    if (child == null) {
      return;
    }

    if (Array.isArray(child)) {
      child.forEach(appendChild);
      return;
    }

    if (child instanceof Node) {
      element.appendChild(child);
      return;
    }

    element.appendChild(document.createTextNode(String(child)));
  };

  appendChild(resolvedChildren);

  return element;
}

function loadSettingsView(selectedApp?: AppId) {
  const rpcDeclares: RpcSpec[] = [];
  const storage = new Map<string, string>();

  if (selectedApp) {
    storage.set("ccswitch-openwrt-selected-app", selectedApp);
  }

  const source = readFileSync(
    path.resolve(
      process.cwd(),
      "openwrt/luci-app-ccswitch/htdocs/luci-static/resources/view/ccswitch/settings.js",
    ),
    "utf8",
  );
  const factory = new Function(
    "view",
    "form",
    "uci",
    "rpc",
    "ui",
    "_",
    "localStorage",
    source,
  );
  const localStorage = {
    getItem: vi.fn((key: string) => storage.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => {
      storage.set(key, value);
    }),
  };

  const settings = factory(
    {
      extend(definition: SettingsView) {
        return definition;
      },
    },
    {},
    {
      load: vi.fn().mockResolvedValue(null),
    },
    {
      declare(spec: RpcSpec) {
        rpcDeclares.push(spec);

        return (...args: unknown[]) =>
          Promise.resolve({
            args,
            ok: true,
            spec,
          });
      },
    },
    {
      createHandlerFn(_ctx: unknown, handler: (...args: unknown[]) => unknown) {
        return handler;
      },
    },
    (value: string) => value,
    localStorage,
  ) as SettingsView;

  return {
    localStorage,
    rpcDeclares,
    settings,
    storage,
  };
}

beforeEach(() => {
  document.head.innerHTML = "";
  delete (window as unknown as Record<string, unknown>)[
    SHARED_PROVIDER_UI_GLOBAL_KEY
  ];
  delete (window as unknown as Record<string, unknown>)[
    SHARED_PROVIDER_UI_DISABLE_GLOBAL_KEY
  ];
  (globalThis as Record<string, unknown>).E = createElement;
  (globalThis as Record<string, unknown>).L = {
    bind<T extends (...args: never[]) => unknown>(fn: T, ctx: unknown) {
      return fn.bind(ctx);
    },
    resolveDefault<T>(promise: Promise<T>, fallback: T) {
      return Promise.resolve(promise).catch(() => fallback);
    },
  };
});

describe("OpenWrt settings shared-provider shell", () => {
  it("keeps the host shell explicitly split between sparse LuCI controls and the provider workspace", () => {
    const source = readFileSync(
      path.resolve(
        process.cwd(),
        "openwrt/luci-app-ccswitch/htdocs/luci-static/resources/view/ccswitch/settings.js",
      ),
      "utf8",
    );

    expect(source).toContain("ccswitch-host-top-block");
    expect(source).toContain("ccswitch-host-bottom-block");
    expect(source).toContain("_('Router Service')");
    expect(source).toContain("_('Restart Framing')");
    expect(source).toContain("_('Workspace Surface')");
    expect(source).toContain(
      "_('Keep truthful router-backed service settings, service status, and restart actions in LuCI. The provider workspace is isolated below as the main product surface.')",
    );

    expect(source).not.toContain("_('Router Overview')");
    expect(source).not.toContain("_('Selected Application')");
    expect(source).not.toContain("_('Saved Providers')");
    expect(source).not.toContain("_('Routing Summary')");
  });

  it("keeps selected-app persistence in the LuCI shell and exposes the fixed bundle and stylesheet paths", () => {
    const { settings, localStorage } = loadSettingsView("gemini");

    expect(settings.getSelectedApp()).toBe("gemini");
    expect(settings.getBundleAssetPath()).toBe(
      "/luci-static/resources/ccswitch/provider-ui/ccswitch-provider-ui.js",
    );
    expect(settings.getBundleStylePath()).toBe(
      "/luci-static/resources/ccswitch/provider-ui/ccswitch-provider-ui.css",
    );

    settings.saveSelectedApp("codex");

    expect(localStorage.setItem).toHaveBeenCalledWith(
      "ccswitch-openwrt-selected-app",
      "codex",
    );
  });

  it("reuses a pre-registered bundle API without injecting another script", async () => {
    const { settings } = loadSettingsView();
    const api = {
      mount: vi.fn(),
    };
    const appendChildSpy = vi.spyOn(document.head, "appendChild");

    (window as unknown as Record<string, unknown>)[
      SHARED_PROVIDER_UI_GLOBAL_KEY
    ] = api;

    await expect(settings.loadSharedProviderBundle()).resolves.toBe(api);
    expect(document.getElementById(SHARED_PROVIDER_UI_SCRIPT_ID)).toBeNull();
    expect(appendChildSpy).not.toHaveBeenCalled();

    appendChildSpy.mockRestore();
  });

  it("injects the shared bundle stylesheet once while loading the mount script", async () => {
    const { settings } = loadSettingsView();
    const api = {
      mount: vi.fn(),
    };

    const loadPromise = settings.loadSharedProviderBundle();
    const stylesheet = document.head.querySelector(
      'link[rel="stylesheet"]',
    ) as HTMLLinkElement | null;
    const script = document.getElementById(
      SHARED_PROVIDER_UI_SCRIPT_ID,
    ) as HTMLScriptElement | null;

    expect(stylesheet).not.toBeNull();
    expect(stylesheet?.getAttribute("href")).toBe(
      "/luci-static/resources/ccswitch/provider-ui/ccswitch-provider-ui.css",
    );
    expect(script).not.toBeNull();
    expect(script?.getAttribute("src")).toBe(
      "/luci-static/resources/ccswitch/provider-ui/ccswitch-provider-ui.js",
    );

    (window as unknown as Record<string, unknown>)[
      SHARED_PROVIDER_UI_GLOBAL_KEY
    ] = api;
    script?.dispatchEvent(new Event("load"));

    await expect(loadPromise).resolves.toBe(api);
    await expect(settings.loadSharedProviderBundle()).resolves.toBe(api);
    expect(
      document.head.querySelectorAll('link[rel="stylesheet"]').length,
    ).toBe(1);
    expect(
      document.querySelectorAll(`#${SHARED_PROVIDER_UI_SCRIPT_ID}`).length,
    ).toBe(1);
  });

  it("wires raw rpc transport methods for the shared provider bundle", async () => {
    const { settings } = loadSettingsView();
    const transport = settings.createProviderTransport();

    const listResult = await transport.listProviders("codex");
    const activateResult = await transport.activateProviderByProviderId(
      "gemini",
      "provider-a",
    );
    const restartResult = await transport.restartService();

    expect(listResult).toMatchObject({
      args: ["codex"],
      spec: {
        method: "list_providers",
        object: "ccswitch",
        params: ["app"],
      },
    });
    expect(activateResult).toMatchObject({
      args: ["gemini", "provider-a"],
      spec: {
        method: "activate_provider",
        object: "ccswitch",
        params: ["app", "provider_id"],
      },
    });
    expect(restartResult).toMatchObject({
      args: [],
      spec: {
        method: "restart_service",
        object: "ccswitch",
      },
    });
  });

  it("keeps restart shell-owned when building shared provider mount options", () => {
    const { settings } = loadSettingsView("codex");
    const uiState = settings.createUiState(true, "codex");
    const statusNodes = settings.createStatusPanel(uiState);
    const shellNodes = settings.createProviderShell(uiState, statusNodes);
    const mountOptions = settings.createSharedProviderMountOptions(
      uiState,
      statusNodes,
      shellNodes,
    );

    expect(mountOptions.shell.restartService).toEqual(expect.any(Function));
    expect("restartService" in mountOptions.transport).toBe(false);
  });

  it("wires raw rpc transport methods for the shared runtime surface", async () => {
    const { settings } = loadSettingsView();
    const transport = settings.createRuntimeTransport();

    const statusResult = await transport.getRuntimeStatus();
    const appStatusResult = await transport.getAppRuntimeStatus("codex");
    const availableProvidersResult =
      await transport.getAvailableFailoverProviders("codex");
    const addResult = await transport.addToFailoverQueue("codex", "provider-a");
    const removeResult = await transport.removeFromFailoverQueue(
      "codex",
      "provider-a",
    );
    const toggleResult = await transport.setAutoFailoverEnabled("codex", true);

    expect(transport.failoverControlsAvailable).toBe(true);

    expect(statusResult).toMatchObject({
      args: [],
      spec: {
        method: "get_runtime_status",
        object: "ccswitch",
      },
    });
    expect(appStatusResult).toMatchObject({
      args: ["codex"],
      spec: {
        method: "get_app_runtime_status",
        object: "ccswitch",
        params: ["app"],
      },
    });
    expect(availableProvidersResult).toMatchObject({
      args: ["codex"],
      spec: {
        method: "get_available_failover_providers",
        object: "ccswitch",
        params: ["app"],
      },
    });
    expect(addResult).toMatchObject({
      args: ["codex", "provider-a"],
      spec: {
        method: "add_to_failover_queue",
        object: "ccswitch",
        params: ["app", "provider_id"],
      },
    });
    expect(removeResult).toMatchObject({
      args: ["codex", "provider-a"],
      spec: {
        method: "remove_from_failover_queue",
        object: "ccswitch",
        params: ["app", "provider_id"],
      },
    });
    expect(toggleResult).toMatchObject({
      args: ["codex", true],
      spec: {
        method: "set_auto_failover_enabled",
        object: "ccswitch",
        params: ["app", "enabled"],
      },
    });
  });

  it("builds contract-checked host bindings and nested provider.failover payload for the static prototype bridge", () => {
    const { settings } = loadSettingsView("codex");
    const staticPrototypeSettings =
      settings as unknown as StaticPrototypeSettings;

    staticPrototypeSettings.getSelectedApp = () => "codex";
    staticPrototypeSettings.getHostConfigSnapshot = () => ({
      enabled: true,
      httpProxy: "http://router-http.internal:7890",
      httpsProxy: "http://router-https.internal:7890",
      listenAddr: "0.0.0.0",
      listenPort: "15721",
      logLevel: "debug",
    });
    staticPrototypeSettings.parseServiceState = () => true;

    const bindings = staticPrototypeSettings.getStaticPrototypeBindings([
      null,
      { ccswitch: { instances: { main: {} } } },
      {
        ok: true,
        status_json: JSON.stringify({
          service: {
            running: true,
            reachable: false,
            listenAddress: "10.0.0.5",
            listenPort: 18443,
            proxyEnabled: false,
            enableLogging: true,
            statusSource: "runtime",
          },
        }),
      },
    ]);

    expect(bindings).toStrictEqual({
      app: "codex",
      health: "degraded",
      httpProxy: "http://router-http.internal:7890",
      httpsProxy: "http://router-https.internal:7890",
      listenAddr: "10.0.0.5",
      listenPort: "18443",
      logLevel: "debug",
      proxyEnabled: "0",
      serviceLabel: "Router daemon",
      status: "running",
    });
    expect(
      Object.fromEntries(
        new URLSearchParams(
          staticPrototypeSettings.buildStaticPrototypeQuery(bindings),
        ),
      ),
    ).toStrictEqual({
      app: "codex",
      health: "degraded",
      http_proxy: "http://router-http.internal:7890",
      https_proxy: "http://router-https.internal:7890",
      listen_addr: "10.0.0.5",
      listen_port: "18443",
      log_level: "debug",
      proxy_enabled: "0",
      service_label: "Router daemon",
      status: "running",
    });

    const failover = staticPrototypeSettings.parseStaticPrototypeFailoverState(
      {
        ok: true,
        status_json: JSON.stringify({
          providerId: "codex-primary",
          proxyEnabled: false,
          autoFailoverEnabled: true,
          maxRetries: 4,
          activeProviderId: "codex-primary",
          inFailoverQueue: true,
          queuePosition: 0,
          sortIndex: 0,
          providerHealth: {
            providerId: "codex-primary",
            observed: true,
            healthy: false,
            consecutiveFailures: 2,
            lastSuccessAt: "2026-04-13T07:59:00Z",
            lastFailureAt: "2026-04-13T08:00:00Z",
            lastError: "upstream timeout",
            updatedAt: "2026-04-13T08:01:00Z",
          },
          failoverQueueDepth: 2,
          failoverQueue: [
            {
              providerId: "codex-backup",
              providerName: "Codex Backup",
              sortIndex: 1,
              active: false,
              health: {
                providerId: "codex-backup",
                observed: false,
                healthy: true,
              },
            },
          ],
        }),
      },
      "ignored-provider-id",
    );

    expect(failover).toStrictEqual({
      providerId: "codex-primary",
      proxyEnabled: false,
      autoFailoverEnabled: true,
      maxRetries: 4,
      activeProviderId: "codex-primary",
      inFailoverQueue: true,
      queuePosition: 0,
      sortIndex: 0,
      providerHealth: {
        providerId: "codex-primary",
        observed: true,
        healthy: false,
        consecutiveFailures: 2,
        lastSuccessAt: "2026-04-13T07:59:00Z",
        lastFailureAt: "2026-04-13T08:00:00Z",
        lastError: "upstream timeout",
        updatedAt: "2026-04-13T08:01:00Z",
      },
      failoverQueueDepth: 2,
      failoverQueue: [
        {
          providerId: "codex-backup",
          providerName: "Codex Backup",
          sortIndex: 1,
          active: false,
          health: {
            providerId: "codex-backup",
            observed: false,
            healthy: true,
            consecutiveFailures: 0,
            lastSuccessAt: null,
            lastFailureAt: null,
            lastError: null,
            updatedAt: null,
          },
        },
      ],
    });

    const payload = staticPrototypeSettings.buildStaticPrototypeWorkspaceData([
      null,
      null,
      null,
      {
        claude: { activeProviderId: null, providers: [] },
        codex: {
          activeProviderId: "codex-primary",
          providers: [
            {
              active: true,
              baseUrl: "https://api.openai.com/v1",
              failover,
              model: "gpt-5.4",
              name: "OpenAI Official",
              notes: "Pinned live route",
              providerId: "codex-primary",
              tokenConfigured: true,
              tokenField: "OPENAI_API_KEY",
              tokenMasked: "sk-live-...789",
            },
          ],
        },
        gemini: { activeProviderId: null, providers: [] },
      },
    ]);

    expect(payload.apps.codex).toStrictEqual({
      activeProviderId: "codex-primary",
      providers: [
        {
          providerId: "codex-primary",
          name: "OpenAI Official",
          baseUrl: "https://api.openai.com/v1",
          tokenField: "OPENAI_API_KEY",
          tokenConfigured: true,
          tokenMasked: "sk-live-...789",
          model: "gpt-5.4",
          notes: "Pinned live route",
          active: true,
          failover: {
            providerId: "codex-primary",
            proxyEnabled: false,
            autoFailoverEnabled: true,
            maxRetries: 4,
            activeProviderId: "codex-primary",
            inFailoverQueue: true,
            queuePosition: 0,
            sortIndex: 0,
            providerHealth: {
              providerId: "codex-primary",
              observed: true,
              healthy: false,
              consecutiveFailures: 2,
              lastSuccessAt: "2026-04-13T07:59:00Z",
              lastFailureAt: "2026-04-13T08:00:00Z",
              lastError: "upstream timeout",
              updatedAt: "2026-04-13T08:01:00Z",
            },
            failoverQueueDepth: 2,
            failoverQueue: [
              {
                providerId: "codex-backup",
                providerName: "Codex Backup",
                sortIndex: 1,
                active: false,
                health: {
                  providerId: "codex-backup",
                  observed: false,
                  healthy: true,
                  consecutiveFailures: 0,
                  lastSuccessAt: null,
                  lastFailureAt: null,
                  lastError: null,
                  updatedAt: null,
                },
              },
            ],
          },
        },
      ],
    });
  });

  it("lets the shared bundle update the shell-owned selected app and banner state", () => {
    const { settings, localStorage } = loadSettingsView("claude");
    const uiState = settings.createUiState(true, "claude");
    const statusNodes = settings.createStatusPanel(uiState);
    const shellNodes = settings.createProviderShell(uiState, statusNodes);
    const shell = settings.createShellBridge(uiState, statusNodes, shellNodes);

    expect(shell.getSelectedApp()).toBe("claude");
    expect(shell.getServiceStatus()).toEqual({ isRunning: true });

    shell.setSelectedApp("gemini");
    shell.showMessage("success", "Restart required.");

    expect(uiState.selectedApp).toBe("gemini");
    expect(localStorage.setItem).toHaveBeenCalledWith(
      "ccswitch-openwrt-selected-app",
      "gemini",
    );
    expect(statusNodes.messageText.textContent).toBe("Restart required.");
    expect(statusNodes.messageRoot.style.display).toBe("");
  });

  it("builds one LuCI host shell with shared runtime and provider mount sections plus a single restart owner", () => {
    const { settings } = loadSettingsView("claude");
    const uiState = settings.createUiState(true, "claude");

    uiState.bundleStatus = "ready";
    uiState.restartPending = true;

    const statusNodes = settings.createStatusPanel(uiState);
    const shellNodes = settings.createProviderShell(uiState, statusNodes);
    const shellText = shellNodes.root.textContent ?? "";
    const combinedText = `${statusNodes.root.textContent ?? ""} ${shellText}`.toLowerCase();
    const shellChildren = Array.from(shellNodes.root.children);
    const workspaceButtons = Array.from(
      shellNodes.root.querySelectorAll("button"),
    ).map((button) => button.textContent?.trim());
    const runtimeShell = shellNodes.runtimeMountRoot.closest("section");
    const providerShell = shellNodes.mountRoot.closest("section");

    expect(statusNodes.summaryValue.textContent).toBe(
      "Provider changes are saved. Restart in LuCI when you want them applied.",
    );
    expect(shellNodes.root.className).toBe("ccswitch-host-workspace-stack");
    expect(shellChildren).toHaveLength(2);
    expect(shellChildren[0]).toHaveTextContent("Workspace Surface");
    expect(shellChildren[1].className).toBe("ccswitch-host-shell-grid");
    expect(shellText).toContain("Runtime Status");
    expect(shellText).toContain("Provider Manager");
    expect(shellText).toContain(
      "The shared OpenWrt bundle mounts the read-only runtime and failover panel here. Service settings, outbound proxy controls, and restart actions stay in LuCI.",
    );
    expect(shellText).toContain(
      "Service settings, outbound proxy controls, status, and restart actions stay in the LuCI shell.",
    );
    expect(statusNodes.root.querySelectorAll(".ccswitch-host-actions")).toHaveLength(
      1,
    );
    expect(statusNodes.root.contains(statusNodes.restartButton)).toBe(true);
    expect(workspaceButtons).toEqual([]);
    expect(shellNodes.runtimeMountRoot.id).toBe("ccswitch-shared-runtime-surface-root");
    expect(shellNodes.mountRoot.id).toBe("ccswitch-shared-provider-ui-root");
    expect(shellNodes.runtimeMountRoot.className).toBe(
      "ccswitch-host-shared-mount ccswitch-host-runtime-mount",
    );
    expect(shellNodes.mountRoot.className).toBe(
      "ccswitch-host-shared-mount ccswitch-host-provider-mount",
    );
    expect(runtimeShell?.className).toBe(
      "ccswitch-host-surface ccswitch-host-runtime-shell ccswitch-host-nonlive-shell",
    );
    expect(providerShell?.className).toBe(
      "ccswitch-host-surface ccswitch-host-provider-shell ccswitch-host-nonlive-shell",
    );
    expect(runtimeShell?.contains(shellNodes.runtimeMountRoot)).toBe(true);
    expect(providerShell?.contains(shellNodes.mountRoot)).toBe(true);
    expect(shellNodes.root.querySelector("main, nav, aside, [role='navigation']")).toBeNull();

    for (const phrase of FORBIDDEN_DESKTOP_SHELL_PHRASES) {
      expect(combinedText).not.toContain(phrase);
    }
  });

  it("keeps the b24 prototype provider search local and non-live shell controls visibly inert", () => {
    const source = readFileSync(
      path.resolve(
        process.cwd(),
        "openwrt/luci-app-ccswitch/htdocs/luci-static/resources/ccswitch/prototype-b24/index.html",
      ),
      "utf8",
    );

    expect(source).toContain('id="providerSearch"');
    expect(source).toContain("function filteredProviders(app)");
    expect(source).toContain("function resetProviderFilter()");
    expect(source).toContain("resetProviderFilter();");
    expect(source).toContain("providerFilter: \"\"");
    expect(source).toContain("Stop stays unsupported in this prototype shell");
    expect(source).toContain('class="chip non-live"');
    expect(source).toContain('class="inline-input mono non-live"');
    expect(source).toContain('class="chip-select non-live"');
  });

  it("injects explicit host-shell layout fallbacks for narrow widths", () => {
    const { settings } = loadSettingsView("claude");
    const uiState = settings.createUiState(true, "claude");

    settings.createStatusPanel(uiState);

    const styleNode = document.getElementById(
      "ccswitch-openwrt-host-page-shell-styles",
    );
    const styleText = styleNode?.textContent ?? "";

    expect(styleNode).not.toBeNull();
    expect(styleText).toContain(
      "#ccswitch-host-page-shell{--ccswitch-host-foreground:hsl(222 47% 11%)",
    );
    expect(styleText).toContain(
      "html.dark #ccswitch-host-page-shell,body.dark #ccswitch-host-page-shell{--ccswitch-host-foreground:hsl(210 40% 96%)",
    );
    expect(styleText).toContain(
      "#ccswitch-host-page-shell .ccswitch-host-surface{position:relative;margin:0;border:1px solid var(--ccswitch-host-border-strong);border-radius:18px;background:linear-gradient(180deg,var(--ccswitch-host-surface-top) 0%,var(--ccswitch-host-surface-bottom) 100%);box-shadow:var(--ccswitch-host-shadow);padding:1.05rem 1.1rem}",
    );
    expect(styleText).toContain(
      "#ccswitch-host-page-shell .ccswitch-host-shell-grid{display:grid;gap:.9rem;align-items:start;grid-template-columns:minmax(0,1fr) minmax(0,1.12fr)}",
    );
    expect(styleText).toContain(
      "#ccswitch-host-page-shell .ccswitch-host-shell-grid>.ccswitch-host-surface,#ccswitch-host-page-shell .ccswitch-host-settings-grid>.ccswitch-host-surface{min-width:0}",
    );
    expect(styleText).toContain(
      "#ccswitch-host-page-shell .ccswitch-host-map .cbi-value{display:grid;grid-template-columns:minmax(0,10.5rem) minmax(0,1fr);column-gap:.9rem;row-gap:.35rem;align-items:flex-start;margin:0;padding:.8rem 0;border-top:1px solid var(--ccswitch-host-divider)}",
    );
    expect(styleText).toContain(
      "#ccswitch-host-page-shell .ccswitch-host-map input[type=\"text\"],#ccswitch-host-page-shell .ccswitch-host-map input[type=\"password\"],#ccswitch-host-page-shell .ccswitch-host-map input[type=\"number\"],#ccswitch-host-page-shell .ccswitch-host-map select,#ccswitch-host-page-shell .ccswitch-host-map textarea{width:100%;min-height:2.65rem;padding:.6rem .8rem;border:1px solid var(--ccswitch-host-border-strong);border-radius:14px;background:linear-gradient(180deg,var(--ccswitch-host-input-top) 0%,var(--ccswitch-host-input-bottom) 100%);box-shadow:inset 0 1px 0 hsl(0 0% 100% / .24),0 10px 18px -18px hsl(220 38% 12% / .35);color:var(--ccswitch-host-foreground)}",
    );
    expect(styleText).toContain(
      "@media (max-width:1120px){#ccswitch-host-page-shell .ccswitch-host-shell-grid,#ccswitch-host-page-shell .ccswitch-host-settings-grid{grid-template-columns:minmax(0,1fr)}#ccswitch-host-page-shell .ccswitch-host-section-title{font-size:1.18rem}}",
    );
    expect(styleText).toContain(
      "@media (max-width:820px){#ccswitch-host-page-shell .ccswitch-host-status-grid{grid-template-columns:repeat(2,minmax(0,1fr))}#ccswitch-host-page-shell .ccswitch-host-map .cbi-value{grid-template-columns:minmax(0,1fr);row-gap:.4rem}#ccswitch-host-page-shell .ccswitch-host-surface{padding:.95rem}#ccswitch-host-page-shell .ccswitch-host-service-row{grid-template-columns:minmax(0,1fr)}#ccswitch-host-page-shell .ccswitch-host-shared-mount,#ccswitch-host-page-shell #ccswitch-shared-provider-ui-root,#ccswitch-host-page-shell #ccswitch-shared-runtime-surface-root{margin-top:.75rem}}",
    );
    expect(styleText).toContain(
      "@media (max-width:640px){#ccswitch-host-page-shell .ccswitch-host-status-grid{grid-template-columns:minmax(0,1fr)}#ccswitch-host-page-shell .ccswitch-host-actions,#ccswitch-host-page-shell .ccswitch-host-map .cbi-page-actions,#ccswitch-host-page-shell .ccswitch-host-fallback-card-header,#ccswitch-host-page-shell .ccswitch-host-fallback-card-actions{flex-direction:column;align-items:stretch}#ccswitch-host-page-shell .ccswitch-host-actions .cbi-button,#ccswitch-host-page-shell .ccswitch-host-map .cbi-page-actions .cbi-button{width:100%}}",
    );
  });

  it("mounts the runtime surface above the provider manager through a separate bundle contract", async () => {
    const { settings } = loadSettingsView("claude");
    const uiState = settings.createUiState(true, "claude");
    const statusNodes = settings.createStatusPanel(uiState);
    const shellNodes = settings.createProviderShell(uiState, statusNodes);
    const runtimeUnmount = vi.fn();
    const providerUnmount = vi.fn();
    const mountRuntimeSurface = vi
      .fn()
      .mockReturnValue({ unmount: runtimeUnmount });
    const mount = vi.fn().mockReturnValue({ unmount: providerUnmount });

    settings.loadSharedProviderBundle = vi.fn().mockResolvedValue({
      capabilities: { providerManager: true, runtimeSurface: true },
      mount,
      mountRuntimeSurface,
    });

    await settings.mountSharedRuntimeSurface(uiState, shellNodes);
    await settings.mountSharedProviderUi(uiState, statusNodes, shellNodes);

    expect(mountRuntimeSurface).toHaveBeenCalledTimes(1);
    expect(mountRuntimeSurface).toHaveBeenCalledWith(
      expect.objectContaining({
        target: shellNodes.runtimeMountRoot,
        transport: expect.objectContaining({
          failoverControlsAvailable: true,
          getRuntimeStatus: expect.any(Function),
          getAppRuntimeStatus: expect.any(Function),
        }),
      }),
    );
    expect(mount).toHaveBeenCalledTimes(1);
    expect(mount).toHaveBeenCalledWith(
      expect.objectContaining({
        target: shellNodes.mountRoot,
      }),
    );

    settings.teardownSharedRuntimeSurface(uiState);
    settings.teardownSharedProviderUi(uiState);

    expect(runtimeUnmount).toHaveBeenCalledTimes(1);
    expect(providerUnmount).toHaveBeenCalledTimes(1);
  });

  it("shows runtime-only fallback text when the bundle lacks runtime-surface support", async () => {
    const { settings } = loadSettingsView();
    const uiState = settings.createUiState(false, "claude");
    const statusNodes = settings.createStatusPanel(uiState);
    const shellNodes = settings.createProviderShell(uiState, statusNodes);
    const mount = vi.fn().mockReturnValue({ unmount: vi.fn() });

    settings.loadSharedProviderBundle = vi.fn().mockResolvedValue({
      capabilities: { providerManager: true, runtimeSurface: false },
      mount,
    });

    await settings.mountSharedRuntimeSurface(uiState, shellNodes);
    await settings.mountSharedProviderUi(uiState, statusNodes, shellNodes);

    expect(shellNodes.runtimeMountRoot.textContent).toContain(
      "missing runtime-panel support",
    );
    expect(shellNodes.mountRoot.textContent).not.toContain(
      "missing runtime-panel support",
    );
    expect(mount).toHaveBeenCalledTimes(1);
    expect(uiState.bundleStatus).toBe("ready");
  });

  it("shows runtime-only fallback text when the runtime surface throws during mount", async () => {
    const { settings } = loadSettingsView();
    const uiState = settings.createUiState(true, "claude");
    const statusNodes = settings.createStatusPanel(uiState);
    const shellNodes = settings.createProviderShell(uiState, statusNodes);
    const mountRuntimeSurface = vi.fn().mockImplementation(() => {
      throw new Error("runtime mount regression");
    });
    const mount = vi.fn().mockReturnValue({ unmount: vi.fn() });

    settings.loadSharedProviderBundle = vi.fn().mockResolvedValue({
      capabilities: { providerManager: true, runtimeSurface: true },
      mount,
      mountRuntimeSurface,
    });

    await settings.mountSharedRuntimeSurface(uiState, shellNodes);
    await settings.mountSharedProviderUi(uiState, statusNodes, shellNodes);

    expect(shellNodes.runtimeMountRoot.textContent).toContain(
      "runtime mount regression",
    );
    expect(mount).toHaveBeenCalledTimes(1);
    expect(uiState.bundleStatus).toBe("ready");
  });

  it("keeps the LuCI shell functional when the shared bundle fails to load", async () => {
    const { settings } = loadSettingsView();
    const uiState = settings.createUiState(false, "claude");
    const statusNodes = settings.createStatusPanel(uiState);
    const shellNodes = settings.createProviderShell(uiState, statusNodes);

    settings.loadSharedProviderBundle = vi
      .fn()
      .mockRejectedValue(new Error("bundle missing"));

    await settings.mountSharedProviderUi(uiState, statusNodes, shellNodes);

    expect(uiState.bundleStatus).toBe("error");
    expect(uiState.bundleError).toBe("bundle missing");
    expect(uiState.fallbackReason).toBe(
      SHARED_PROVIDER_UI_FALLBACK_REASON_BUNDLE_FAILURE,
    );
    expect(shellNodes.mountRoot.textContent).toContain("Claude Providers");
    expect(shellNodes.mountRoot.textContent).toContain("bundle missing");
    expect(shellNodes.mountRoot.textContent).toContain("Configure Provider");
    expect(statusNodes.messageText.textContent).toContain("bundle missing");
  });

  it("keeps the guarded LuCI fallback active when the cutover gate disables the real bundle", async () => {
    const { settings, storage } = loadSettingsView();
    const uiState = settings.createUiState(false, "claude");
    const statusNodes = settings.createStatusPanel(uiState);
    const shellNodes = settings.createProviderShell(uiState, statusNodes);
    const loadSharedProviderBundle = vi.fn();

    storage.set(SHARED_PROVIDER_UI_CUTOVER_MODE_STORAGE_KEY, "fallback");
    settings.loadSharedProviderBundle = loadSharedProviderBundle;

    await settings.mountSharedProviderUi(uiState, statusNodes, shellNodes);

    expect(loadSharedProviderBundle).not.toHaveBeenCalled();
    expect(uiState.bundleStatus).toBe("fallback");
    expect(uiState.fallbackReason).toBe(
      SHARED_PROVIDER_UI_FALLBACK_REASON_GATE_DISABLED,
    );
    expect(uiState.bundleError).toContain("disabled for this browser by the local cutover setting");
    expect(shellNodes.mountRoot.textContent).toContain("Claude Providers");
    expect(shellNodes.mountRoot.textContent).toContain("Configure Provider");
    expect(shellNodes.mountRoot.textContent).toContain(
      "disabled for this browser by the local cutover setting",
    );
    expect(statusNodes.messageText.textContent).toContain(
      "shared provider panel is disabled for this browser",
    );
  });

  it("keeps the guarded LuCI fallback active when the bundle regresses below the real provider-manager contract", async () => {
    const { settings } = loadSettingsView();
    const uiState = settings.createUiState(false, "claude");
    const statusNodes = settings.createStatusPanel(uiState);
    const shellNodes = settings.createProviderShell(uiState, statusNodes);
    const mount = vi.fn();

    settings.loadSharedProviderBundle = vi.fn().mockResolvedValue({
      capabilities: { providerManager: false },
      mount,
    });

    await settings.mountSharedProviderUi(uiState, statusNodes, shellNodes);

    expect(mount).not.toHaveBeenCalled();
    expect(uiState.bundleStatus).toBe("fallback");
    expect(uiState.fallbackReason).toBe(
      SHARED_PROVIDER_UI_FALLBACK_REASON_BUNDLE_REGRESSION,
    );
    expect(uiState.bundleError).toContain("without provider-panel support");
    expect(shellNodes.mountRoot.textContent).toContain("Claude Providers");
    expect(shellNodes.mountRoot.textContent).toContain("Configure Provider");
    expect(shellNodes.mountRoot.textContent).toContain(
      "without provider-panel support",
    );
    expect(statusNodes.messageText.textContent).toContain(
      "without provider-panel support",
    );
  });

  it("keeps the guarded LuCI fallback active when the real bundle throws during mount", async () => {
    const { settings } = loadSettingsView();
    const uiState = settings.createUiState(true, "codex");
    const statusNodes = settings.createStatusPanel(uiState);
    const shellNodes = settings.createProviderShell(uiState, statusNodes);
    const mount = vi.fn().mockImplementation(() => {
      throw new Error("mount regression");
    });

    settings.loadSharedProviderBundle = vi.fn().mockResolvedValue({
      capabilities: { providerManager: true },
      mount,
    });

    await settings.mountSharedProviderUi(uiState, statusNodes, shellNodes);

    expect(mount).toHaveBeenCalledTimes(1);
    expect(uiState.bundleStatus).toBe("error");
    expect(uiState.bundleError).toBe("mount regression");
    expect(uiState.fallbackReason).toBe(
      SHARED_PROVIDER_UI_FALLBACK_REASON_BUNDLE_FAILURE,
    );
    expect(shellNodes.mountRoot.textContent).toContain("Codex Providers");
    expect(shellNodes.mountRoot.textContent).toContain("mount regression");
    expect(statusNodes.messageText.textContent).toContain("mount regression");
  });

  it("treats an omitted providerManager capability as the real-bundle path", async () => {
    const { settings } = loadSettingsView("gemini");
    const uiState = settings.createUiState(true, "gemini");
    const statusNodes = settings.createStatusPanel(uiState);
    const shellNodes = settings.createProviderShell(uiState, statusNodes);
    const unmount = vi.fn();
    const mount = vi.fn().mockReturnValue({ unmount });

    settings.loadSharedProviderBundle = vi.fn().mockResolvedValue({
      mount,
    });

    await settings.mountSharedProviderUi(uiState, statusNodes, shellNodes);

    expect(uiState.bundleStatus).toBe("ready");
    expect(uiState.fallbackReason).toBeNull();
    expect(mount).toHaveBeenCalledTimes(1);
    expect(shellNodes.mountRoot.textContent).not.toContain(
      "LuCI fallback provider manager",
    );
  });

  it("hands a stable mount contract to the bundle and tears it down cleanly", async () => {
    const { settings } = loadSettingsView("claude");
    const uiState = settings.createUiState(true, "claude");
    const statusNodes = settings.createStatusPanel(uiState);
    const shellNodes = settings.createProviderShell(uiState, statusNodes);
    const unmount = vi.fn();
    const mount = vi.fn().mockReturnValue({ unmount });

    settings.loadSharedProviderBundle = vi.fn().mockResolvedValue({
      capabilities: { providerManager: true },
      mount,
    });

    await settings.mountSharedProviderUi(uiState, statusNodes, shellNodes);

    expect(uiState.bundleStatus).toBe("ready");
    expect(uiState.fallbackReason).toBeNull();
    expect(mount).toHaveBeenCalledTimes(1);
    expect(mount).toHaveBeenCalledWith(
      expect.objectContaining({
        appId: "claude",
        serviceStatus: { isRunning: true },
        shell: expect.objectContaining({
          restartService: expect.any(Function),
          setSelectedApp: expect.any(Function),
          showMessage: expect.any(Function),
        }),
        target: shellNodes.mountRoot,
        transport: expect.objectContaining({
          listProviders: expect.any(Function),
          restartService: expect.any(Function),
        }),
      }),
    );

    settings.teardownSharedProviderUi(uiState);

    expect(unmount).toHaveBeenCalledTimes(1);
  });
});
