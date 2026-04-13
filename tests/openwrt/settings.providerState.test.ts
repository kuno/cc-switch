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
  mountHandle: (() => void) | null;
  mountRequestId: number;
};

type StatusNodes = {
  appValue: HTMLElement;
  bundleValue: HTMLElement;
  root: HTMLElement;
  serviceValue: HTMLElement;
  summaryValue: HTMLElement;
  providerTitle?: HTMLElement;
  providerValue?: HTMLElement;
  savedCountValue?: HTMLElement;
};

type ShellNodes = {
  sharedChromeRoot?: HTMLElement;
  messageRoot: HTMLElement;
  messageText: HTMLElement;
  mountRoot: HTMLElement;
  restartButton: HTMLButtonElement;
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

type MountOptions = {
  appId: AppId;
  serviceStatus: { isRunning: boolean };
  shell: ShellBridge;
  target: HTMLElement;
  transport: Record<string, (...args: unknown[]) => Promise<unknown>>;
};

type SettingsView = {
  createProviderShell(uiState: UiState, statusNodes: StatusNodes): ShellNodes;
  createProviderTransport(): Record<string, (...args: unknown[]) => Promise<unknown>>;
  createShellBridge(
    uiState: UiState,
    statusNodes: StatusNodes,
    shellNodes: ShellNodes,
  ): ShellBridge;
  createStatusPanel(uiState: UiState): StatusNodes;
  createUiState(isRunning: boolean, selectedApp: AppId): UiState;
  getBundleAssetPath(): string;
  getSelectedApp(): AppId;
  loadSharedProviderBundle(): Promise<{
    mount(options: MountOptions): { unmount(): void } | (() => void) | void;
  }>;
  mountSharedProviderUi(
    uiState: UiState,
    statusNodes: StatusNodes,
    shellNodes: ShellNodes,
  ): Promise<void>;
  saveSelectedApp(appId: AppId): void;
  teardownSharedProviderUi(uiState: UiState): void;
};

type RpcSpec = {
  expect?: Record<string, unknown>;
  method: string;
  object: string;
  params?: string[];
};

const SHARED_PROVIDER_UI_GLOBAL_KEY = "__CCSWITCH_OPENWRT_SHARED_PROVIDER_UI__";
const SHARED_PROVIDER_UI_SCRIPT_ID =
  "ccswitch-openwrt-shared-provider-ui-bundle";

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
  it("keeps selected-app persistence in the LuCI shell and exposes the fixed bundle path", () => {
    const { settings, localStorage } = loadSettingsView("gemini");

    expect(settings.getSelectedApp()).toBe("gemini");
    expect(settings.getBundleAssetPath()).toBe(
      "/luci-static/resources/ccswitch/provider-ui/ccswitch-provider-ui.js",
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
    expect(statusNodes.appValue.textContent).toBe("Gemini");
    expect(shellNodes.messageText.textContent).toBe("Restart required.");
    expect(shellNodes.messageRoot.style.display).toBe("");
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
    expect(statusNodes.bundleValue.textContent).toBe("Unavailable");
    expect(shellNodes.mountRoot.textContent).toContain("Claude Providers");
    expect(shellNodes.mountRoot.textContent).toContain("bundle missing");
    expect(shellNodes.mountRoot.textContent).toContain(
      "Configure Provider",
    );
    expect(statusNodes.summaryValue.textContent).toContain(
      "LuCI fallback provider manager",
    );
  });

  it("keeps the fallback LuCI provider manager active when the cutover gate disables the real bundle", async () => {
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
    expect(uiState.bundleError).toContain(
      "LuCI fallback provider manager until the shared slice is published",
    );
    expect(statusNodes.bundleValue.textContent).toBe("Fallback");
    expect(shellNodes.mountRoot.textContent).toContain("Claude Providers");
    expect(shellNodes.mountRoot.textContent).toContain("Configure Provider");
    expect(shellNodes.mountRoot.textContent).toContain(
      "LuCI fallback provider manager",
    );
  });

  it("keeps the fallback LuCI provider manager active when the real bundle throws during mount", async () => {
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
    expect(statusNodes.bundleValue.textContent).toBe("Unavailable");
    expect(shellNodes.mountRoot.textContent).toContain("Codex Providers");
    expect(shellNodes.mountRoot.textContent).toContain("mount regression");
    expect(statusNodes.summaryValue.textContent).toContain(
      "LuCI fallback provider manager",
    );
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
    expect(statusNodes.bundleValue.textContent).toBe("Ready");
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
