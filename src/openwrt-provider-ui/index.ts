import type { OpenWrtProviderTransport } from "@/platform/openwrt/providers";
import type { SharedProviderAppId } from "@/shared/providers/domain";

export const OPENWRT_SHARED_PROVIDER_UI_GLOBAL_KEY =
  "__CCSWITCH_OPENWRT_SHARED_PROVIDER_UI__";

export type OpenWrtShellMessageKind = "success" | "error" | "info";

export interface OpenWrtSharedProviderShellApi {
  getSelectedApp(): SharedProviderAppId;
  setSelectedApp(appId: SharedProviderAppId): SharedProviderAppId;
  getServiceStatus(): {
    isRunning: boolean;
  };
  refreshServiceStatus(): Promise<{
    isRunning: boolean;
  }>;
  showMessage(kind: OpenWrtShellMessageKind, text: string): void;
  clearMessage(): void;
  restartService(): Promise<{
    isRunning: boolean;
  }>;
}

export interface OpenWrtSharedProviderMountOptions {
  target: HTMLElement;
  appId: SharedProviderAppId;
  serviceStatus: {
    isRunning: boolean;
  };
  transport: OpenWrtProviderTransport;
  shell: OpenWrtSharedProviderShellApi;
}

export interface OpenWrtSharedProviderBundleApi {
  mount(
    options: OpenWrtSharedProviderMountOptions,
  ):
    | void
    | (() => void)
    | { unmount(): void }
    | Promise<void | (() => void) | { unmount(): void }>;
}

type OpenWrtSharedProviderGlobal = typeof globalThis & {
  [OPENWRT_SHARED_PROVIDER_UI_GLOBAL_KEY]?: OpenWrtSharedProviderBundleApi;
};

function clearTarget(target: HTMLElement) {
  while (target.firstChild) {
    target.removeChild(target.firstChild);
  }
}

function appendTextBlock(
  target: HTMLElement,
  text: string,
  styles?: Partial<CSSStyleDeclaration>,
) {
  const node = document.createElement("div");
  node.textContent = text;

  if (styles) {
    Object.assign(node.style, styles);
  }

  target.appendChild(node);
}

function renderPlaceholder(
  options: OpenWrtSharedProviderMountOptions,
): () => void {
  const { target, appId, serviceStatus } = options;
  const shell = options.shell;
  const container = document.createElement("section");

  clearTarget(target);
  Object.assign(container.style, {
    border: "1px solid #dbe1ea",
    borderRadius: "4px",
    padding: "1rem",
    background: "#ffffff",
  });

  appendTextBlock(container, "Shared provider bundle loaded.", {
    color: "#111827",
    fontWeight: "600",
  });
  appendTextBlock(
    container,
    "This worktree only owns the LuCI shell and browser-bundle contract.",
    {
      marginTop: "0.5rem",
      color: "#4b5563",
    },
  );
  appendTextBlock(
    container,
    `Selected application: ${appId}. Service running: ${
      serviceStatus.isRunning ? "yes" : "no"
    }.`,
    {
      marginTop: "0.5rem",
      color: "#4b5563",
    },
  );
  appendTextBlock(
    container,
    "The shared React provider manager can replace this placeholder by overriding the registered mount implementation.",
    {
      marginTop: "0.5rem",
      color: "#4b5563",
    },
  );

  target.appendChild(container);
  shell.showMessage(
    "info",
    "Shared provider bundle loaded. Waiting for the shared provider manager implementation.",
  );

  return () => {
    shell.clearMessage();
    clearTarget(target);
  };
}

const api: OpenWrtSharedProviderBundleApi = {
  mount(options) {
    return renderPlaceholder(options);
  },
};

export const openWrtSharedProviderBundleApi = api;

(globalThis as OpenWrtSharedProviderGlobal)[
  OPENWRT_SHARED_PROVIDER_UI_GLOBAL_KEY
] = api;
