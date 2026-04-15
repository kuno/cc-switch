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
  createSharedProviderMountOptions(
    uiState: UiState,
    statusNodes: StatusNodes,
    shellNodes: ShellNodes,
  ): ProviderMountOptions;
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

type RpcCall = {
  args: unknown[];
  spec: RpcSpec;
};

type StaticPrototypeSettings = SettingsView & {
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
  loadStaticPrototypeHostBindings(): Promise<{
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
  }>;
  normalizeStaticPrototypeHostPayload(payload: Record<string, unknown>): {
    httpProxy: string;
    httpsProxy: string;
    listenAddr: string;
    listenPort: string;
    logLevel: string;
  };
  parseServiceState(serviceStatus: unknown): boolean;
  parseStaticPrototypeFailoverState(
    response: unknown,
    fallbackProviderId: string,
  ): Record<string, unknown>;
  saveStaticPrototypeHostConfig(payload: Record<string, unknown>): Promise<{
    httpProxy: string;
    httpsProxy: string;
    listenAddr: string;
    listenPort: string;
    logLevel: string;
  }>;
  loadStaticPrototypeHostBindingsAfterRestart(): Promise<{
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
  }>;
};

const SHARED_PROVIDER_UI_GLOBAL_KEY = "__CCSWITCH_OPENWRT_SHARED_PROVIDER_UI__";
const SHARED_PROVIDER_UI_SCRIPT_ID =
  "ccswitch-openwrt-shared-provider-ui-bundle";
const DAEMON_ADMIN_BASE_URL_OVERRIDE_KEY =
  "__CCSWITCH_OPENWRT_DAEMON_ADMIN_BASE_URL__";

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
  const rpcCalls: RpcCall[] = [];
  const storage = new Map<string, string>();
  const uciState = new Map<string, string>([
    ["ccswitch.main.enabled", "1"],
    ["ccswitch.main.listen_addr", "0.0.0.0"],
    ["ccswitch.main.listen_port", "15721"],
    ["ccswitch.main.http_proxy", ""],
    ["ccswitch.main.https_proxy", ""],
    ["ccswitch.main.log_level", "info"],
  ]);

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
  const uci = {
    get: vi.fn((config: string, section: string, option: string) => {
      return uciState.get(`${config}.${section}.${option}`) ?? null;
    }),
    load: vi.fn().mockResolvedValue(null),
    save: vi.fn().mockResolvedValue(null),
    set: vi.fn((config: string, section: string, option: string, value: unknown) => {
      uciState.set(`${config}.${section}.${option}`, value == null ? "" : String(value));
    }),
  };

  const settings = factory(
    {
      extend(definition: SettingsView) {
        return definition;
      },
    },
    {},
    uci,
    {
      declare(spec: RpcSpec) {
        rpcDeclares.push(spec);

        return (...args: unknown[]) => {
          rpcCalls.push({ args, spec });

          if (
            spec.object === "ccswitch" &&
            spec.method === "get_host_config"
          ) {
            return Promise.resolve({
              ok: true,
              enabled: uciState.get("ccswitch.main.enabled") === "1",
              listenAddr: uciState.get("ccswitch.main.listen_addr") ?? "",
              listenPort: uciState.get("ccswitch.main.listen_port") ?? "",
              httpProxy: uciState.get("ccswitch.main.http_proxy") ?? "",
              httpsProxy: uciState.get("ccswitch.main.https_proxy") ?? "",
              logLevel: uciState.get("ccswitch.main.log_level") ?? "info",
            });
          }

          if (
            spec.object === "ccswitch" &&
            spec.method === "set_host_config"
          ) {
            const host =
              args[0] && typeof args[0] === "object"
                ? (args[0] as Record<string, unknown>)
                : {};

            uciState.set(
              "ccswitch.main.enabled",
              host.enabled === true ? "1" : "0",
            );
            uciState.set(
              "ccswitch.main.listen_addr",
              host.listenAddr == null ? "" : String(host.listenAddr),
            );
            uciState.set(
              "ccswitch.main.listen_port",
              host.listenPort == null ? "" : String(host.listenPort),
            );
            uciState.set(
              "ccswitch.main.http_proxy",
              host.httpProxy == null ? "" : String(host.httpProxy),
            );
            uciState.set(
              "ccswitch.main.https_proxy",
              host.httpsProxy == null ? "" : String(host.httpsProxy),
            );
            uciState.set(
              "ccswitch.main.log_level",
              host.logLevel == null ? "info" : String(host.logLevel),
            );

            return Promise.resolve({
              ok: true,
              enabled: uciState.get("ccswitch.main.enabled") === "1",
              listenAddr: uciState.get("ccswitch.main.listen_addr") ?? "",
              listenPort: uciState.get("ccswitch.main.listen_port") ?? "",
              httpProxy: uciState.get("ccswitch.main.http_proxy") ?? "",
              httpsProxy: uciState.get("ccswitch.main.https_proxy") ?? "",
              logLevel: uciState.get("ccswitch.main.log_level") ?? "info",
            });
          }

          return Promise.resolve({
            args,
            ok: true,
            spec,
          });
        };
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
    rpcCalls,
    rpcDeclares,
    settings,
    storage,
    uci,
    uciState,
  };
}

beforeEach(() => {
  document.head.innerHTML = "";
  delete (window as unknown as Record<string, unknown>)[
    SHARED_PROVIDER_UI_GLOBAL_KEY
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

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  delete (window as unknown as Record<string, unknown>)[
    DAEMON_ADMIN_BASE_URL_OVERRIDE_KEY
  ];
});

describe("OpenWrt settings shared-provider shell", () => {
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

  it("prefers the daemon-admin runtime fast path when an override base URL is configured", async () => {
    const { settings, rpcCalls } = loadSettingsView("codex");
    const staticPrototypeSettings =
      settings as unknown as StaticPrototypeSettings;
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({
        ok: true,
        service: {
          running: true,
          reachable: true,
          listenAddress: "10.0.0.5",
          listenPort: 18443,
          proxyEnabled: false,
          enableLogging: true,
          statusSource: "live-status",
        },
        runtime: {
          running: true,
        },
      }),
    });

    vi.stubGlobal("fetch", fetchMock);
    (window as unknown as Record<string, unknown>)[
      DAEMON_ADMIN_BASE_URL_OVERRIDE_KEY
    ] = "http://router.example:15721/openwrt/admin";
    staticPrototypeSettings.parseServiceState = () => true;

    const bindings = await staticPrototypeSettings.loadStaticPrototypeHostBindings();

    expect(bindings).toMatchObject({
      health: "healthy",
      listenAddr: "0.0.0.0",
      listenPort: "15721",
      proxyEnabled: "0",
      status: "running",
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "http://router.example:15721/openwrt/admin/runtime",
      expect.objectContaining({
        method: "GET",
        headers: expect.objectContaining({
          Accept: "application/json",
        }),
      }),
    );
    expect(
      rpcCalls.some(
        (call) =>
          call.spec.object === "ccswitch" &&
          call.spec.method === "get_host_config",
      ),
    ).toBe(true);
    expect(
      rpcCalls.some(
        (call) =>
          call.spec.object === "ccswitch" &&
          call.spec.method === "get_runtime_status",
      ),
    ).toBe(false);
  });

  it("prefers the daemon-admin provider fast path when an override base URL is configured", async () => {
    const { settings, rpcCalls } = loadSettingsView("codex");
    const transport = settings.createProviderTransport();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: vi.fn().mockResolvedValue({
          ok: true,
          activeProviderId: "codex-primary",
          providers: [
            {
              active: true,
              baseUrl: "https://api.openai.com/v1",
              configured: true,
              model: "gpt-5.4",
              name: "OpenAI Official",
              notes: "Pinned live route",
              providerId: "codex-primary",
              tokenConfigured: true,
              tokenField: "OPENAI_API_KEY",
              tokenMasked: "sk-live-...789",
            },
          ],
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: vi.fn().mockResolvedValue({
          ok: true,
          active: true,
          baseUrl: "https://api.openai.com/v1",
          configured: true,
          model: "gpt-5.4",
          name: "OpenAI Official",
          notes: "Pinned live route",
          providerId: "codex-primary",
          tokenConfigured: true,
          tokenField: "OPENAI_API_KEY",
          tokenMasked: "sk-live-...789",
        }),
      });

    vi.stubGlobal("fetch", fetchMock);
    (window as unknown as Record<string, unknown>)[
      DAEMON_ADMIN_BASE_URL_OVERRIDE_KEY
    ] = "http://router.example:15721/openwrt/admin";

    const [providersResult, activeProviderResult] = await Promise.all([
      transport.listProviders("codex"),
      transport.getActiveProvider("codex"),
    ]);

    expect(providersResult).toMatchObject({
      activeProviderId: "codex-primary",
      providers: [
        expect.objectContaining({
          providerId: "codex-primary",
          name: "OpenAI Official",
        }),
      ],
    });
    expect(activeProviderResult).toMatchObject({
      providerId: "codex-primary",
      name: "OpenAI Official",
      active: true,
    });
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      "http://router.example:15721/openwrt/admin/apps/codex/providers",
      expect.objectContaining({
        method: "GET",
      }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "http://router.example:15721/openwrt/admin/apps/codex/providers/active",
      expect.objectContaining({
        method: "GET",
      }),
    );
    expect(
      rpcCalls.some(
        (call) =>
          call.spec.object === "ccswitch" &&
          (call.spec.method === "list_providers" ||
            call.spec.method === "get_active_provider"),
      ),
    ).toBe(false);
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
        service: {
          running: true,
          reachable: false,
          listenAddress: "10.0.0.5",
          listenPort: 18443,
          proxyEnabled: false,
          enableLogging: true,
          statusSource: "runtime",
        },
      },
    ]);

    expect(bindings).toStrictEqual({
      app: "codex",
      health: "degraded",
      httpProxy: "http://router-http.internal:7890",
      httpsProxy: "http://router-https.internal:7890",
      listenAddr: "0.0.0.0",
      listenPort: "15721",
      logLevel: "debug",
      proxyEnabled: "0",
      serviceLabel: "Router daemon",
      status: "running",
    });

    const failover = staticPrototypeSettings.parseStaticPrototypeFailoverState(
      {
        ok: true,
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

  it("parses inlined active-provider objects in the LuCI host bridge", () => {
    const { settings } = loadSettingsView("codex");
    const parsed = (
      settings as SettingsView & {
        parseProviderState(providerResponse: unknown, appId: AppId): Record<string, unknown>;
      }
    ).parseProviderState(
      {
        ok: true,
        active: true,
        baseUrl: "https://api.openai.com/v1",
        configured: true,
        model: "gpt-5.4",
        name: "OpenAI Official",
        notes: "Pinned live route",
        providerId: "codex-primary",
        tokenConfigured: true,
        tokenField: "OPENAI_API_KEY",
        tokenMasked: "sk-live-...789",
      },
      "codex",
    );

    expect(parsed).toMatchObject({
      active: true,
      baseUrl: "https://api.openai.com/v1",
      configured: true,
      model: "gpt-5.4",
      name: "OpenAI Official",
      notes: "Pinned live route",
      providerId: "codex-primary",
      tokenConfigured: true,
      tokenField: "OPENAI_API_KEY",
      tokenMasked: "sk-live-...789",
    });
  });

  it("writes only the host-config ubus fields for static prototype saves", async () => {
    const { settings, uci, uciState, rpcCalls } = loadSettingsView("codex");
    const staticPrototypeSettings =
      settings as unknown as StaticPrototypeSettings;

    const saved = await staticPrototypeSettings.saveStaticPrototypeHostConfig({
      listenAddr: "10.0.0.7",
      listenPort: "28443",
      httpProxy: "http://router-http.internal:7890",
      httpsProxy: "http://router-https.internal:7891",
      logLevel: "trace",
      inventedField: "ignored",
    });

    expect(saved).toStrictEqual({
      listenAddr: "10.0.0.7",
      listenPort: "28443",
      httpProxy: "http://router-http.internal:7890",
      httpsProxy: "http://router-https.internal:7891",
      logLevel: "trace",
    });
    expect(uci.set).not.toHaveBeenCalled();
    expect(uci.save).not.toHaveBeenCalled();
    expect(
      rpcCalls.some(
        (call) =>
          call.spec.object === "ccswitch" &&
          call.spec.method === "set_host_config" &&
          call.args[0] &&
          typeof call.args[0] === "object" &&
          (call.args[0] as Record<string, unknown>).listenAddr === "10.0.0.7" &&
          (call.args[0] as Record<string, unknown>).listenPort === "28443" &&
          (call.args[0] as Record<string, unknown>).httpProxy ===
            "http://router-http.internal:7890" &&
          (call.args[0] as Record<string, unknown>).httpsProxy ===
            "http://router-https.internal:7891" &&
          (call.args[0] as Record<string, unknown>).logLevel === "trace",
      ),
    ).toBe(true);
    expect(uciState.get("ccswitch.main.enabled")).toBe("1");
    expect(uciState.get("ccswitch.main.listen_addr")).toBe("10.0.0.7");
    expect(uciState.get("ccswitch.main.listen_port")).toBe("28443");
    expect(uciState.get("ccswitch.main.http_proxy")).toBe(
      "http://router-http.internal:7890",
    );
    expect(uciState.get("ccswitch.main.https_proxy")).toBe(
      "http://router-https.internal:7891",
    );
    expect(uciState.get("ccswitch.main.log_level")).toBe("trace");
    expect(uciState.get("ccswitch.main.inventedField")).toBeUndefined();
  });

  it("falls back to the current snapshot when static prototype listen fields are invalid", async () => {
    const { settings, uci, uciState, rpcCalls } = loadSettingsView("codex");
    const staticPrototypeSettings =
      settings as unknown as StaticPrototypeSettings;

    const saved = await staticPrototypeSettings.saveStaticPrototypeHostConfig({
      listenAddr: "router.internal",
      listenPort: "70000",
      httpProxy: "http://router-http.internal:7890",
      httpsProxy: "http://router-https.internal:7891",
      logLevel: "debug",
    });

    expect(saved).toStrictEqual({
      listenAddr: "0.0.0.0",
      listenPort: "15721",
      httpProxy: "http://router-http.internal:7890",
      httpsProxy: "http://router-https.internal:7891",
      logLevel: "debug",
    });
    expect(uci.set).not.toHaveBeenCalled();
    expect(uci.save).not.toHaveBeenCalled();
    expect(uciState.get("ccswitch.main.listen_addr")).toBe("0.0.0.0");
    expect(uciState.get("ccswitch.main.listen_port")).toBe("15721");
    expect(uciState.get("ccswitch.main.http_proxy")).toBe(
      "http://router-http.internal:7890",
    );
    expect(uciState.get("ccswitch.main.https_proxy")).toBe(
      "http://router-https.internal:7891",
    );
    expect(uciState.get("ccswitch.main.log_level")).toBe("debug");
    expect(
      rpcCalls.some(
        (call) =>
          call.spec.object === "ccswitch" &&
          call.spec.method === "set_host_config" &&
          call.args[0] &&
          typeof call.args[0] === "object" &&
          (call.args[0] as Record<string, unknown>).listenAddr === "0.0.0.0" &&
          (call.args[0] as Record<string, unknown>).listenPort === "15721",
      ),
    ).toBe(true);
  });

  it("accepts valid IP-form listen addresses and valid ports in static prototype saves", async () => {
    const { settings } = loadSettingsView("codex");
    const staticPrototypeSettings =
      settings as unknown as StaticPrototypeSettings;

    expect(
      staticPrototypeSettings.normalizeStaticPrototypeHostPayload({
        listenAddr: "2001:db8::1",
        listenPort: "443",
      }),
    ).toMatchObject({
      listenAddr: "2001:db8::1",
      listenPort: "443",
    });
    expect(
      staticPrototypeSettings.normalizeStaticPrototypeHostPayload({
        listenAddr: "10.0.0.7",
        listenPort: "28443",
      }),
    ).toMatchObject({
      listenAddr: "10.0.0.7",
      listenPort: "28443",
    });
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
    expect(source).toContain('id="providerFilterReset"');
    expect(source).toContain("function filteredProviders(app)");
    expect(source).toContain("function resetProviderFilter()");
    expect(source).toContain("resetProviderFilter();");
    expect(source).toContain('els.providerFilterReset.addEventListener("click"');
    expect(source).toContain("providerFilter: \"\"");
    expect(source).toContain("Stop stays unsupported in this prototype shell");
    expect(source).toContain('class="chip non-live"');
    expect(source).toContain('id="hostSaveButton"');
    expect(source).toContain('function requestHostSave()');
    expect(source).toContain('type: "ccswitch-prototype-host-save"');
    expect(source).toContain('type: "ccswitch-prototype-restart-service"');
  });

  it("ships a native-only LuCI render path without prototype iframe fallback", () => {
    const settingsSource = readFileSync(
      path.resolve(
        process.cwd(),
        "openwrt/luci-app-ccswitch/htdocs/luci-static/resources/view/ccswitch/settings.js",
      ),
      "utf8",
    );

    expect(settingsSource).toContain("renderNativePage: function");
    expect(settingsSource).toContain("api.mountPage");
    expect(settingsSource).not.toContain("renderStaticPrototype: function");
    expect(settingsSource).not.toContain("handleStaticPrototypeFrameMessage");
    expect(settingsSource).not.toContain("OPENWRT_STATIC_PROTOTYPE_MODE");
    expect(settingsSource).not.toContain("new form.Map(");
    expect(settingsSource).not.toContain("ccswitch-prototype-restart-result");
    expect(settingsSource).not.toContain("createProviderShell: function");
    expect(settingsSource).not.toContain("mountSharedProviderUi: async function");
    expect(settingsSource).not.toContain("mountSharedRuntimeSurface: async function");
    expect(settingsSource).not.toContain(
      "ccswitch-openwrt-provider-ui-cutover-mode",
    );
  });
});
