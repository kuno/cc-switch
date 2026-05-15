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
  createProviderTransport(): Record<
    string,
    (...args: unknown[]) => Promise<unknown>
  >;
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

type UcodeMethodRequest = {
  args: Record<string, unknown>;
};

type UcodeMethod = {
  call(request: UcodeMethodRequest): unknown;
};

type UcodeApi = {
  ccswitch: Record<string, UcodeMethod>;
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
    set: vi.fn(
      (config: string, section: string, option: string, value: unknown) => {
        uciState.set(
          `${config}.${section}.${option}`,
          value == null ? "" : String(value),
        );
      },
    ),
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

          if (spec.object === "ccswitch" && spec.method === "get_host_config") {
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

          if (spec.object === "ccswitch" && spec.method === "set_host_config") {
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

function loadOpenWrtRpcHandler(overrides?: {
  popenOutput?: string;
  uci?: Record<string, string>;
}) {
  const commands: string[] = [];
  const uciState = new Map<string, string>([
    ["ccswitch.main.enabled", "1"],
    ["ccswitch.main.listen_addr", "0.0.0.0"],
    ["ccswitch.main.listen_port", "15721"],
    ["ccswitch.main.http_proxy", ""],
    ["ccswitch.main.https_proxy", ""],
    ["ccswitch.main.log_level", "info"],
    ...Object.entries(overrides?.uci ?? {}),
  ]);
  const source = readFileSync(
    path.resolve(
      process.cwd(),
      "openwrt/luci-app-ccswitch/root/usr/share/rpcd/ucode/ccswitch",
    ),
    "utf8",
  ).replace(/^import\s+\{[^}]+\}\s+from\s+'[^']+';\n/gm, "");
  const cursor = vi.fn(() => ({
    commit: vi.fn(() => true),
    get: vi.fn((config: string, section: string, option: string) => {
      return uciState.get(`${config}.${section}.${option}`) ?? null;
    }),
    load: vi.fn(() => true),
    set: vi.fn(
      (config: string, section: string, option: string, value: unknown) => {
        uciState.set(
          `${config}.${section}.${option}`,
          value == null ? "" : String(value),
        );

        return true;
      },
    ),
  }));
  const popen = vi.fn((command: string) => {
    commands.push(command);

    return {
      close: vi.fn(() => 0),
      read: vi.fn(() => overrides?.popenOutput ?? '{"ok":true}'),
    };
  });
  const api = new Function(
    "popen",
    "cursor",
    "replace",
    "trim",
    "json",
    "sprintf",
    "length",
    "index",
    "substr",
    "ord",
    "chr",
    "hexenc",
    "uc",
    "push",
    "join",
    source,
  )(
    popen,
    cursor,
    (
      value: unknown,
      pattern: string | RegExp,
      replacement: string | ((substring: string) => string),
    ) => String(value ?? "").replace(pattern, replacement as never),
    (value: unknown) => String(value ?? "").trim(),
    (value: string) => {
      try {
        return JSON.parse(value);
      } catch {
        return null;
      }
    },
    (format: string, value: unknown) =>
      format === "%J" ? JSON.stringify(value) : String(value ?? ""),
    (value: { length?: number } | null | undefined) => value?.length ?? 0,
    (value: unknown, search: string) => String(value ?? "").indexOf(search),
    (value: unknown, start: number, count?: number) =>
      String(value ?? "").substr(start, count),
    (value: unknown, offset: number) => String(value ?? "").charCodeAt(offset),
    (code: number) => String.fromCharCode(code),
    (value: unknown) =>
      Buffer.from(String(value ?? ""), "utf8").toString("hex"),
    (value: unknown) => String(value ?? "").toUpperCase(),
    (target: unknown[], value: unknown) => {
      target.push(value);
      return target.length;
    },
    (separator: string, values: unknown[]) => values.join(separator),
  ) as UcodeApi;

  return {
    api,
    commands,
    cursor,
    popen,
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
      "/luci-static/resources/ccswitch/provider-ui/openwrt-luci-host.css",
    );

    settings.saveSelectedApp("codex");

    expect(localStorage.setItem).toHaveBeenCalledWith(
      "ccswitch-openwrt-selected-app",
      "codex",
    );
  });

  it("declares the app usage-summary contract for the native page shell", () => {
    const { rpcDeclares } = loadSettingsView();
    const source = readFileSync(
      path.resolve(
        process.cwd(),
        "openwrt/luci-app-ccswitch/htdocs/luci-static/resources/view/ccswitch/settings.js",
      ),
      "utf8",
    );

    expect(
      rpcDeclares.some(
        (spec) =>
          spec.object === "ccswitch" && spec.method === "get_usage_summary",
      ),
    ).toBe(true);
    expect(source).toContain("/usage-summary");
    expect(source).toContain("getUsageSummary: async function (appId)");
  });

  it("declares the app provider-stats contract for the native page shell", () => {
    const { rpcDeclares } = loadSettingsView();
    const source = readFileSync(
      path.resolve(
        process.cwd(),
        "openwrt/luci-app-ccswitch/htdocs/luci-static/resources/view/ccswitch/settings.js",
      ),
      "utf8",
    );

    expect(
      rpcDeclares.some(
        (spec) =>
          spec.object === "ccswitch" && spec.method === "get_provider_stats",
      ),
    ).toBe(true);
    expect(source).toContain("/provider-stats");
    expect(source).toContain("getProviderStats: async function (appId)");
  });

  it("declares the app recent-activity contract for the native page shell", () => {
    const { rpcDeclares } = loadSettingsView();
    const source = readFileSync(
      path.resolve(
        process.cwd(),
        "openwrt/luci-app-ccswitch/htdocs/luci-static/resources/view/ccswitch/settings.js",
      ),
      "utf8",
    );

    expect(
      rpcDeclares.some(
        (spec) =>
          spec.object === "ccswitch" && spec.method === "get_recent_activity",
      ),
    ).toBe(true);
    expect(source).toContain("/recent-activity");
    expect(source).toContain("getRecentActivity: async function (appId)");
  });

  it("declares the quota passthrough contract for the native page shell", () => {
    const { rpcDeclares } = loadSettingsView();
    const source = readFileSync(
      path.resolve(
        process.cwd(),
        "openwrt/luci-app-ccswitch/htdocs/luci-static/resources/view/ccswitch/settings.js",
      ),
      "utf8",
    );

    expect(
      rpcDeclares.some(
        (spec) => spec.object === "ccswitch" && spec.method === "get_quota",
      ),
    ).toBe(true);
    expect(source).toContain("callOpenWrtQuota");
    expect(source).toContain("getQuota: async function ()");
  });

  it("declares the app request-log contracts for the native page shell", () => {
    const { rpcDeclares } = loadSettingsView();
    const source = readFileSync(
      path.resolve(
        process.cwd(),
        "openwrt/luci-app-ccswitch/htdocs/luci-static/resources/view/ccswitch/settings.js",
      ),
      "utf8",
    );

    expect(
      rpcDeclares.some(
        (spec) =>
          spec.object === "ccswitch" && spec.method === "get_request_logs",
      ),
    ).toBe(true);
    expect(
      rpcDeclares.some(
        (spec) =>
          spec.object === "ccswitch" && spec.method === "get_request_detail",
      ),
    ).toBe(true);
    expect(
      rpcDeclares.some(
        (spec) =>
          spec.object === "ccswitch" &&
          spec.method === "get_request_logs" &&
          JSON.stringify(spec.params) ===
            JSON.stringify(["app", "page", "page_size", "provider_id"]),
      ),
    ).toBe(true);
    expect(source).toContain("/request-logs");
    expect(source).toContain(
      "getRequestLogs: async function (appId, page, pageSize, providerId)",
    );
    expect(source).toContain(
      "getRequestDetail: async function (appId, requestId)",
    );
  });

  it("grants LuCI read access to the app usage-summary ubus method", () => {
    const acl = JSON.parse(
      readFileSync(
        path.resolve(
          process.cwd(),
          "openwrt/luci-app-ccswitch/root/usr/share/rpcd/acl.d/luci-app-ccswitch.json",
        ),
        "utf8",
      ),
    ) as {
      "luci-app-ccswitch"?: {
        read?: { ubus?: { ccswitch?: string[] } };
        write?: { ubus?: { ccswitch?: string[] } };
      };
    };

    expect(acl["luci-app-ccswitch"]?.read?.ubus?.ccswitch ?? []).toContain(
      "get_usage_summary",
    );
    expect(acl["luci-app-ccswitch"]?.read?.ubus?.ccswitch ?? []).toContain(
      "get_provider_stats",
    );
    expect(acl["luci-app-ccswitch"]?.read?.ubus?.ccswitch ?? []).toContain(
      "get_recent_activity",
    );
    expect(acl["luci-app-ccswitch"]?.read?.ubus?.ccswitch ?? []).toContain(
      "get_request_logs",
    );
    expect(acl["luci-app-ccswitch"]?.read?.ubus?.ccswitch ?? []).toContain(
      "get_request_detail",
    );
    expect(acl["luci-app-ccswitch"]?.read?.ubus?.ccswitch ?? []).toContain(
      "get_provider_stream_check",
    );
    expect(acl["luci-app-ccswitch"]?.write?.ubus?.ccswitch ?? []).toContain(
      "run_provider_stream_check",
    );
  });

  it("suppresses raw bare rpc failure sentinels so feature-specific fallbacks can render", () => {
    const { settings } = loadSettingsView();

    expect(
      (
        settings as unknown as {
          rpcFailureMessage(input: unknown): string | null;
        }
      ).rpcFailureMessage({
        ok: false,
      }),
    ).toBeNull();
  });

  it("normalizes recent-activity string fallbacks from ubus compatibility payloads", () => {
    const { settings } = loadSettingsView();
    const normalized = (
      settings as unknown as {
        normalizeRecentActivity(input: unknown): Array<{
          providerName: string;
          model: string;
          totalTokens: number;
          totalCost: string;
          statusCode: number;
          latencyMs: number;
          createdAt: number;
        }>;
      }
    ).normalizeRecentActivity({
      ok: true,
      recentActivityJson:
        '[2026-04-15T01:51:01Z WARN] noisy log prefix\n{"entries":[{"providerName":"OpenAI Official","model":"gpt-5.4","totalTokens":321,"totalCost":"0.12","statusCode":200,"latencyMs":412,"createdAt":1712345678}]}',
    });

    expect(normalized).toEqual([
      {
        requestId: "",
        providerId: "",
        providerName: "OpenAI Official",
        model: "gpt-5.4",
        totalTokens: 321,
        totalCost: "0.12",
        statusCode: 200,
        latencyMs: 412,
        createdAt: 1712345678,
      },
    ]);
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
      "/luci-static/resources/ccswitch/provider-ui/openwrt-luci-host.css",
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
    const reorderResult = await transport.reorderProviders("claude", [
      "provider-b",
      "provider-a",
    ]);
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
    expect(reorderResult).toMatchObject({
      args: ["claude", ["provider-b", "provider-a"]],
      spec: {
        method: "reorder_providers",
        object: "ccswitch",
        params: ["app", "provider_ids"],
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

  it("routes provider mutations through the daemon-admin HTTP contract when an override base URL is configured", async () => {
    const { settings, rpcCalls } = loadSettingsView("codex");
    const transport = settings.createProviderTransport();
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({ ok: true }),
    });
    const providerPayload = {
      name: "OpenAI Official",
      baseUrl: "https://api.openai.com/v1",
      tokenField: "OPENAI_API_KEY",
      token: "sk-live-123",
      model: "gpt-5.4",
      notes: "Pinned live route",
    };
    const activeProviderPayload = {
      name: "Claude Direct",
      baseUrl: "https://api.anthropic.com",
      tokenField: "ANTHROPIC_AUTH_TOKEN",
      token: "sk-ant-123",
      model: "claude-sonnet-4-20250514",
      notes: "Primary Anthropic route",
    };

    vi.stubGlobal("fetch", fetchMock);
    (window as unknown as Record<string, unknown>)[
      DAEMON_ADMIN_BASE_URL_OVERRIDE_KEY
    ] = "http://router.example:15721/openwrt/admin";

    await transport.upsertProvider("codex", providerPayload);
    await transport.upsertProviderByProviderId(
      "codex",
      "codex-primary",
      providerPayload,
    );
    await transport.upsertActiveProvider("claude", activeProviderPayload);
    await transport.deleteProviderByProviderId("codex", "codex-primary");
    await transport.activateProviderByProviderId("codex", "codex-primary");
    await transport.uploadCodexAuth(
      "codex",
      "codex-primary",
      '{"access_token":"codex-token"}',
    );
    await transport.uploadClaudeAuth(
      "claude",
      "claude-primary",
      '{"access_token":"claude-token"}',
    );
    await transport.removeCodexAuth("codex", "codex-primary");
    await transport.removeClaudeAuth("claude", "claude-primary");
    await transport.addToFailoverQueue("codex", "codex-primary");
    await transport.removeFromFailoverQueue("codex", "codex-primary");
    await transport.reorderFailoverQueue("codex", [
      "codex-primary",
      "codex-backup",
    ]);
    await transport.reorderProviders("codex", [
      "codex-backup",
      "codex-primary",
    ]);
    await transport.setAutoFailoverEnabled("codex", true);
    await transport.setMaxRetries("codex", 4);

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      "http://router.example:15721/openwrt/admin/apps/codex/providers",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify(providerPayload),
      }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "http://router.example:15721/openwrt/admin/apps/codex/providers/codex-primary",
      expect.objectContaining({
        method: "PUT",
        body: JSON.stringify(providerPayload),
      }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      3,
      "http://router.example:15721/openwrt/admin/apps/claude/providers/active",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify(activeProviderPayload),
      }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      4,
      "http://router.example:15721/openwrt/admin/apps/codex/providers/codex-primary",
      expect.objectContaining({
        method: "DELETE",
      }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      5,
      "http://router.example:15721/openwrt/admin/apps/codex/providers/codex-primary/activate",
      expect.objectContaining({
        method: "POST",
      }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      6,
      "http://router.example:15721/openwrt/admin/apps/codex/providers/codex-primary/codex-auth",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          authJsonText: '{"access_token":"codex-token"}',
        }),
      }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      7,
      "http://router.example:15721/openwrt/admin/apps/claude/providers/claude-primary/claude-auth",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          authJsonText: '{"access_token":"claude-token"}',
        }),
      }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      8,
      "http://router.example:15721/openwrt/admin/apps/codex/providers/codex-primary/codex-auth",
      expect.objectContaining({
        method: "DELETE",
      }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      9,
      "http://router.example:15721/openwrt/admin/apps/claude/providers/claude-primary/claude-auth",
      expect.objectContaining({
        method: "DELETE",
      }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      10,
      "http://router.example:15721/openwrt/admin/apps/codex/failover/providers/codex-primary",
      expect.objectContaining({
        method: "POST",
      }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      11,
      "http://router.example:15721/openwrt/admin/apps/codex/failover/providers/codex-primary",
      expect.objectContaining({
        method: "DELETE",
      }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      12,
      "http://router.example:15721/openwrt/admin/apps/codex/failover/queue",
      expect.objectContaining({
        method: "PUT",
        body: JSON.stringify({
          providerIds: ["codex-primary", "codex-backup"],
        }),
      }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      13,
      "http://router.example:15721/openwrt/admin/apps/codex/providers/order",
      expect.objectContaining({
        method: "PUT",
        body: JSON.stringify({
          providerIds: ["codex-backup", "codex-primary"],
        }),
      }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      14,
      "http://router.example:15721/openwrt/admin/apps/codex/failover/auto-enabled",
      expect.objectContaining({
        method: "PUT",
        body: JSON.stringify({
          enabled: true,
        }),
      }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      15,
      "http://router.example:15721/openwrt/admin/apps/codex/failover/max-retries",
      expect.objectContaining({
        method: "PUT",
        body: JSON.stringify({
          value: 4,
        }),
      }),
    );
    expect(fetchMock).toHaveBeenCalledTimes(15);
    expect(
      rpcCalls.some(
        (call) =>
          call.spec.object === "ccswitch" &&
          [
            "upsert_provider",
            "upsert_active_provider",
            "delete_provider",
            "activate_provider",
            "upload_codex_auth",
            "upload_claude_auth",
            "remove_codex_auth",
            "remove_claude_auth",
            "add_to_failover_queue",
            "remove_from_failover_queue",
            "reorder_failover_queue",
            "reorder_providers",
            "set_auto_failover_enabled",
            "set_max_retries",
          ].includes(call.spec.method),
      ),
    ).toBe(false);
  });

  it("uses the configured listen_addr for rpcd daemon-admin mutations when the daemon is not bound to loopback", () => {
    const { api, commands } = loadOpenWrtRpcHandler({
      uci: {
        "ccswitch.main.listen_addr": "10.1.2.3",
        "ccswitch.main.listen_port": "28443",
      },
    });

    const result = api.ccswitch.activate_provider.call({
      args: {
        app: "codex",
        provider_id: "provider-a",
      },
    });

    expect(result).toMatchObject({ ok: true });
    expect(commands).toHaveLength(1);
    expect(commands[0]).toContain(
      "'http://10.1.2.3:28443/openwrt/admin/apps/codex/providers/provider-a/activate'",
    );
    expect(commands[0]).not.toContain("127.0.0.1");
  });

  it("percent-encodes provider IDs in rpcd daemon-admin mutation paths", () => {
    const { api, commands } = loadOpenWrtRpcHandler();

    const result = api.ccswitch.remove_from_failover_queue.call({
      args: {
        app: "codex",
        provider_id: "primary route/blue",
      },
    });

    expect(result).toMatchObject({ ok: true });
    expect(commands).toHaveLength(1);
    expect(commands[0]).toContain(
      "'http://127.0.0.1:15721/openwrt/admin/apps/codex/failover/providers/primary%20route%2Fblue'",
    );
    expect(commands[0]).not.toContain("primary route/blue'");
  });

  it("bridges provider stream-check read and run calls to daemon admin endpoints", () => {
    const { api, commands } = loadOpenWrtRpcHandler();

    const read = api.ccswitch.get_provider_stream_check.call({
      args: {
        app: "codex",
        provider_id: "primary route/blue",
      },
    });
    const run = api.ccswitch.run_provider_stream_check.call({
      args: {
        app: "codex",
        provider_id: "primary route/blue",
      },
    });

    expect(read).toMatchObject({ ok: true });
    expect(run).toMatchObject({ ok: true });
    expect(commands).toHaveLength(2);
    expect(commands[0]).toContain(
      "'http://127.0.0.1:15721/openwrt/admin/apps/codex/providers/primary%20route%2Fblue/stream-check'",
    );
    expect(commands[1]).toContain("-X 'POST'");
    expect(commands[1]).toContain(
      "'http://127.0.0.1:15721/openwrt/admin/apps/codex/providers/primary%20route%2Fblue/stream-check'",
    );
  });

  it("parses inlined active-provider objects in the LuCI host bridge", () => {
    const { settings } = loadSettingsView("codex");
    const parsed = (
      settings as SettingsView & {
        parseProviderState(
          providerResponse: unknown,
          appId: AppId,
        ): Record<string, unknown>;
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
    expect(settingsSource).not.toContain(
      "mountSharedProviderUi: async function",
    );
    expect(settingsSource).not.toContain(
      "mountSharedRuntimeSurface: async function",
    );
    expect(settingsSource).not.toContain(
      "ccswitch-openwrt-provider-ui-cutover-mode",
    );
  });
});
