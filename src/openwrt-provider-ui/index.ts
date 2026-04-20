import "./openwrt-luci-host.css";
import providerUiCss from "./openwrt-provider-ui.css?inline";
import { createElement } from "react";
import { createRoot } from "react-dom/client";
import {
  createOpenWrtProviderAdapter,
  type OpenWrtProviderMutationEvent,
  type OpenWrtProviderTransport,
} from "@/platform/openwrt/providers";
import {
  createOpenWrtRuntimeAdapter,
  type OpenWrtRuntimeTransport,
} from "@/platform/openwrt/runtime";
import {
  mountSharedProviderManager,
  type MountedSharedProviderManager,
  type SharedProviderManagerProps,
  type SharedProviderShellState,
} from "@/shared/providers";
import {
  mountSharedRuntimeSurface,
  type MountedSharedRuntimeSurface,
} from "@/shared/runtime";
import type {
  SharedProviderAppId,
  SharedProviderView,
} from "@/shared/providers/domain";
import { OpenWrtPageShell } from "./OpenWrtPageShell";
import type {
  OpenWrtSharedProviderShellApi,
  OpenWrtShellMessageKind,
  OpenWrtSharedPageMountOptions,
} from "./pageTypes";

export const OPENWRT_SHARED_PROVIDER_UI_GLOBAL_KEY =
  "__CCSWITCH_OPENWRT_SHARED_PROVIDER_UI__";

export interface OpenWrtSharedProviderMountOptions {
  target: HTMLElement;
  appId: SharedProviderAppId;
  serviceStatus: {
    isRunning: boolean;
  };
  transport: OpenWrtProviderTransport;
  shell: OpenWrtSharedProviderShellApi;
}

export interface OpenWrtSharedRuntimeMountOptions {
  target: HTMLElement;
  transport: OpenWrtRuntimeTransport;
}

export interface OpenWrtSharedProviderBundleCapabilities {
  pageShell: boolean;
  providerManager: boolean;
  runtimeSurface: boolean;
}

export interface OpenWrtSharedProviderBundleApi {
  capabilities?: OpenWrtSharedProviderBundleCapabilities;
  mount(
    options: OpenWrtSharedProviderMountOptions,
  ):
    | void
    | (() => void)
    | { unmount(): void }
    | Promise<void | (() => void) | { unmount(): void }>;
  mountRuntimeSurface(
    options: OpenWrtSharedRuntimeMountOptions,
  ):
    | void
    | (() => void)
    | { unmount(): void }
    | Promise<void | (() => void) | { unmount(): void }>;
  mountPage(
    options: OpenWrtSharedPageMountOptions,
  ):
    | void
    | (() => void)
    | { unmount(): void }
    | Promise<void | (() => void) | { unmount(): void }>;
}

type OpenWrtSharedProviderGlobal = typeof globalThis & {
  [OPENWRT_SHARED_PROVIDER_UI_GLOBAL_KEY]?: OpenWrtSharedProviderBundleApi;
};
type OpenWrtShellRestartState = Required<
  ReturnType<NonNullable<OpenWrtSharedProviderShellApi["getRestartState"]>>
>;

type OpenWrtProviderManagerMountState = {
  mounted: MountedSharedProviderManager | null;
  selectedApp: SharedProviderAppId;
  serviceRunning: boolean;
  restartPending: boolean;
  restartInFlight: boolean;
  disposed: boolean;
};

type OpenWrtShellMutationState = Pick<
  OpenWrtProviderManagerMountState,
  | "disposed"
  | "restartInFlight"
  | "restartPending"
  | "selectedApp"
  | "serviceRunning"
>;

const APP_LABELS: Record<SharedProviderAppId, string> = {
  claude: "Claude",
  codex: "Codex",
  gemini: "Gemini",
};
const OPENWRT_NATIVE_PAGE_HOST_CLASS = "ccswitch-openwrt-native-page-host";
const OPENWRT_NATIVE_PAGE_SECTION_CLASS =
  "ccswitch-openwrt-native-page-section";
const OPENWRT_NATIVE_PAGE_MAP_CLASS = "ccswitch-openwrt-native-page-map";
const OPENWRT_PROVIDER_UI_HOST_CLASS = "ccswitch-openwrt-provider-ui-host";
const OPENWRT_PROVIDER_UI_MOUNT_ATTRIBUTE = "data-ccswitch-provider-ui-mount";
const OPENWRT_PROVIDER_UI_LIGHT_DOM_STYLE_ID =
  "ccswitch-openwrt-provider-ui-inline-styles";

type OpenWrtProviderUiMountKind =
  | "page-shell"
  | "provider-manager"
  | "runtime-surface";

const SHADOW_STYLESHEET_CACHE = new WeakMap<Document, CSSStyleSheet>();

function clearTarget(target: HTMLElement) {
  while (target.firstChild) {
    target.removeChild(target.firstChild);
  }
}

function getDefaultThemeForTarget(target: HTMLElement): "light" | "dark" {
  const existingTheme = target.dataset.ccswitchTheme;
  if (existingTheme === "dark" || existingTheme === "light") {
    return existingTheme;
  }

  const doc = target.ownerDocument;
  if (
    doc.documentElement.classList.contains("dark") ||
    doc.body.classList.contains("dark")
  ) {
    return "dark";
  }

  return "light";
}

function getAdoptedStylesheet(doc: Document): CSSStyleSheet {
  let sheet = SHADOW_STYLESHEET_CACHE.get(doc);
  if (!sheet) {
    sheet = new CSSStyleSheet();
    sheet.replaceSync(providerUiCss);
    SHADOW_STYLESHEET_CACHE.set(doc, sheet);
  }
  return sheet;
}

function ensureLightDomStyles(doc: Document) {
  if (doc.getElementById(OPENWRT_PROVIDER_UI_LIGHT_DOM_STYLE_ID)) {
    return;
  }

  const style = doc.createElement("style");
  style.id = OPENWRT_PROVIDER_UI_LIGHT_DOM_STYLE_ID;
  style.textContent = providerUiCss;
  doc.head.appendChild(style);
}

function decorateProviderUiHost(
  target: HTMLElement,
  mountKind: OpenWrtProviderUiMountKind,
): () => void {
  const hadHostClass = target.classList.contains(
    OPENWRT_PROVIDER_UI_HOST_CLASS,
  );
  const hadDarkClass = target.classList.contains("dark");
  const previousMountKind = target.getAttribute(
    OPENWRT_PROVIDER_UI_MOUNT_ATTRIBUTE,
  );
  const previousTheme = target.getAttribute("data-ccswitch-theme");
  const nextTheme = previousTheme ?? getDefaultThemeForTarget(target);

  target.classList.add(OPENWRT_PROVIDER_UI_HOST_CLASS);
  target.classList.toggle("dark", nextTheme === "dark");
  target.setAttribute(OPENWRT_PROVIDER_UI_MOUNT_ATTRIBUTE, mountKind);
  target.dataset.ccswitchTheme = nextTheme;

  return () => {
    if (!hadHostClass) {
      target.classList.remove(OPENWRT_PROVIDER_UI_HOST_CLASS);
    }
    target.classList.toggle("dark", hadDarkClass);

    if (previousMountKind === null) {
      target.removeAttribute(OPENWRT_PROVIDER_UI_MOUNT_ATTRIBUTE);
    } else {
      target.setAttribute(
        OPENWRT_PROVIDER_UI_MOUNT_ATTRIBUTE,
        previousMountKind,
      );
    }

    if (previousTheme === null) {
      delete target.dataset.ccswitchTheme;
    } else {
      target.setAttribute("data-ccswitch-theme", previousTheme);
    }
  };
}

function attachShadowHost(
  target: HTMLElement,
  mountKind: OpenWrtProviderUiMountKind,
): { reactMount: HTMLElement; dispose: () => void } {
  clearTarget(target);

  const doc = target.ownerDocument;
  const shadow = target.shadowRoot ?? target.attachShadow({ mode: "open" });
  while (shadow.firstChild) {
    shadow.removeChild(shadow.firstChild);
  }

  if (
    typeof CSSStyleSheet === "undefined" ||
    !("adoptedStyleSheets" in shadow)
  ) {
    const style = doc.createElement("style");
    style.textContent = providerUiCss;
    shadow.appendChild(style);
  } else {
    shadow.adoptedStyleSheets = [getAdoptedStylesheet(doc)];
  }

  const reactMount = doc.createElement("div");
  reactMount.className = OPENWRT_PROVIDER_UI_HOST_CLASS;
  reactMount.classList.toggle("dark", target.classList.contains("dark"));
  reactMount.dataset.ccswitchProviderUiMount = mountKind;
  shadow.appendChild(reactMount);

  return {
    reactMount,
    dispose() {
      while (shadow.firstChild) {
        shadow.removeChild(shadow.firstChild);
      }
    },
  };
}

function decorateNativePageHost(target: HTMLElement): () => void {
  const section = target.closest(".cbi-section");
  const map = target.closest(".cbi-map");

  target.classList.add(OPENWRT_NATIVE_PAGE_HOST_CLASS);
  section?.classList.add(OPENWRT_NATIVE_PAGE_SECTION_CLASS);
  map?.classList.add(OPENWRT_NATIVE_PAGE_MAP_CLASS);

  return () => {
    target.classList.remove(OPENWRT_NATIVE_PAGE_HOST_CLASS);
    section?.classList.remove(OPENWRT_NATIVE_PAGE_SECTION_CLASS);
    map?.classList.remove(OPENWRT_NATIVE_PAGE_MAP_CLASS);
  };
}

function acquireThemeLease(): () => void {
  return () => {};
}

function withThemeLease<T>(callback: (release: () => void) => T): T {
  const releaseThemeLease = acquireThemeLease();
  let completed = false;

  try {
    const result = callback(releaseThemeLease);
    completed = true;
    return result;
  } finally {
    if (!completed) {
      releaseThemeLease();
    }
  }
}

function shouldUseShadowDom(): boolean {
  if (
    typeof process !== "undefined" &&
    typeof process.env !== "undefined" &&
    process.env.CCSWITCH_USE_SHADOW_DOM === "0"
  ) {
    return false;
  }

  const runtimeFlag = (
    globalThis as typeof globalThis & {
      CCSWITCH_USE_SHADOW_DOM?: boolean | number | string;
    }
  ).CCSWITCH_USE_SHADOW_DOM;

  return !(runtimeFlag === false || runtimeFlag === 0 || runtimeFlag === "0");
}

function getServiceStatusLabel(isRunning: boolean): string {
  return isRunning ? "running" : "stopped";
}

function getMutationVerb(
  mutation: OpenWrtProviderMutationEvent["mutation"],
): string {
  if (mutation === "save") {
    return "saved";
  }

  if (mutation === "activate") {
    return "activated";
  }

  return "deleted";
}

function getProviderViewFromMutation(
  event: OpenWrtProviderMutationEvent,
): SharedProviderView | null {
  const { activeProvider, providers } = event.providerState;
  const { providerId } = event;

  if (providerId) {
    const matchedProvider =
      providers.find((provider) => provider.providerId === providerId) ??
      (activeProvider.providerId === providerId ? activeProvider : null);

    if (matchedProvider) {
      return matchedProvider;
    }
  }

  if (activeProvider.configured) {
    return activeProvider;
  }

  return null;
}

function getProviderNameFromMutation(
  event: OpenWrtProviderMutationEvent,
): string {
  return (
    getProviderViewFromMutation(event)?.name.trim() ||
    event.providerId ||
    `${APP_LABELS[event.appId]} provider`
  );
}

function buildMutationShellMessage(
  event: OpenWrtProviderMutationEvent,
): string {
  const providerName = getProviderNameFromMutation(event);
  const verb = getMutationVerb(event.mutation);

  if (event.restartRequired) {
    return `${providerName} was ${verb}. Restart the service to apply provider changes.`;
  }

  if (!event.serviceRunning) {
    return `${providerName} was ${verb}. The service is stopped, so no restart is needed right now.`;
  }

  return `${providerName} was ${verb}. Changes are available immediately.`;
}

function getMutationShellMessageKind(
  event: OpenWrtProviderMutationEvent,
): OpenWrtShellMessageKind {
  return event.restartRequired ? "info" : "success";
}

function buildSharedProviderShellState(
  state: OpenWrtProviderManagerMountState,
): SharedProviderShellState {
  return {
    serviceName: "cc-switch service",
    serviceStatusLabel: getServiceStatusLabel(state.serviceRunning),
    restartPending: state.restartPending,
    restartInFlight: state.restartInFlight,
  };
}

function getShellRestartState(
  shell: OpenWrtSharedProviderShellApi,
): OpenWrtShellRestartState {
  const restartState = shell.getRestartState?.();

  return {
    pending: restartState?.pending ?? false,
    inFlight: restartState?.inFlight ?? false,
  };
}

function syncStateFromShell(
  state: OpenWrtShellMutationState,
  shell: OpenWrtSharedProviderShellApi,
) {
  state.selectedApp = shell.getSelectedApp();
  state.serviceRunning = shell.getServiceStatus().isRunning;
  const restartState = getShellRestartState(shell);
  state.restartPending = restartState.pending;
  state.restartInFlight = restartState.inFlight;
}

function handleProviderMutationEvent(
  state: OpenWrtShellMutationState,
  shell: OpenWrtSharedProviderShellApi,
  rerender: () => void,
  event: OpenWrtProviderMutationEvent,
) {
  if (state.disposed) {
    return;
  }

  const currentRestartState = getShellRestartState(shell);
  const nextRestartState = {
    pending: currentRestartState.pending || event.restartRequired,
    inFlight: currentRestartState.inFlight,
  };

  if (event.restartRequired) {
    shell.setRestartState?.(nextRestartState);
  }

  state.selectedApp = shell.getSelectedApp();
  state.serviceRunning = event.serviceRunning;
  state.restartPending = nextRestartState.pending;
  state.restartInFlight = nextRestartState.inFlight;
  shell.showMessage(
    getMutationShellMessageKind(event),
    buildMutationShellMessage(event),
  );
  rerender();
}

function mountOpenWrtSharedProviderManager(
  options: OpenWrtSharedProviderMountOptions,
) {
  return withThemeLease((releaseThemeLease) => {
    const releaseProviderUiHost = decorateProviderUiHost(
      options.target,
      "provider-manager",
    );
    const initialRestartState = getShellRestartState(options.shell);
    const state: OpenWrtProviderManagerMountState = {
      mounted: null,
      selectedApp: options.shell.getSelectedApp(),
      serviceRunning: options.shell.getServiceStatus().isRunning,
      restartPending: initialRestartState.pending,
      restartInFlight: initialRestartState.inFlight,
      disposed: false,
    };
    let unsubscribe: (() => void) | undefined;

    const adapter = createOpenWrtProviderAdapter(options.transport, {
      getServiceRunning() {
        state.serviceRunning = options.shell.getServiceStatus().isRunning;
        return state.serviceRunning;
      },
      async onProviderMutation(event) {
        handleProviderMutationEvent(state, options.shell, rerender, event);
      },
    });
    const useShadowDom = shouldUseShadowDom();
    const shadowMount = useShadowDom
      ? attachShadowHost(options.target, "provider-manager")
      : null;

    function createManagerProps(): SharedProviderManagerProps {
      syncStateFromShell(state, options.shell);

      return {
        adapter,
        selectedApp: state.selectedApp,
        onSelectedAppChange(appId) {
          if (state.disposed) {
            return;
          }

          options.shell.setSelectedApp(appId);
          syncStateFromShell(state, options.shell);
          rerender();
        },
        shellState: buildSharedProviderShellState(state),
      };
    }

    function rerender() {
      if (state.disposed || !state.mounted) {
        return;
      }

      state.mounted.update(createManagerProps());
    }

    if (!useShadowDom) {
      ensureLightDomStyles(options.target.ownerDocument);
      clearTarget(options.target);
    }
    state.mounted = mountSharedProviderManager(
      shadowMount?.reactMount ?? options.target,
      createManagerProps(),
    );
    unsubscribe = options.shell.subscribe?.(() => {
      if (state.disposed) {
        return;
      }

      syncStateFromShell(state, options.shell);
      rerender();
    });

    return {
      unmount() {
        state.disposed = true;
        unsubscribe?.();
        state.mounted?.unmount();
        if (shadowMount) {
          shadowMount.dispose();
        } else {
          clearTarget(options.target);
        }
        releaseProviderUiHost();
        releaseThemeLease();
        options.shell.clearMessage();
      },
    };
  });
}

function mountOpenWrtSharedRuntimeSurface(
  options: OpenWrtSharedRuntimeMountOptions,
) {
  return withThemeLease((releaseThemeLease) => {
    const releaseProviderUiHost = decorateProviderUiHost(
      options.target,
      "runtime-surface",
    );
    let mounted: MountedSharedRuntimeSurface | null = null;
    const useShadowDom = shouldUseShadowDom();
    const shadowMount = useShadowDom
      ? attachShadowHost(options.target, "runtime-surface")
      : null;

    if (!useShadowDom) {
      ensureLightDomStyles(options.target.ownerDocument);
      clearTarget(options.target);
    }
    mounted = mountSharedRuntimeSurface(
      shadowMount?.reactMount ?? options.target,
      {
        adapter: createOpenWrtRuntimeAdapter(options.transport),
      },
    );

    return {
      unmount() {
        mounted?.unmount();
        mounted = null;
        if (shadowMount) {
          shadowMount.dispose();
        } else {
          clearTarget(options.target);
        }
        releaseProviderUiHost();
        releaseThemeLease();
      },
    };
  });
}

function mountOpenWrtPageShell(options: OpenWrtSharedPageMountOptions) {
  return withThemeLease((releaseThemeLease) => {
    const releaseHostDecoration = decorateNativePageHost(options.target);
    const releaseProviderUiHost = decorateProviderUiHost(
      options.target,
      "page-shell",
    );
    const useShadowDom = shouldUseShadowDom();
    const shadowMount = useShadowDom
      ? attachShadowHost(options.target, "page-shell")
      : null;
    const root = createRoot(shadowMount?.reactMount ?? options.target);

    if (!useShadowDom) {
      ensureLightDomStyles(options.target.ownerDocument);
      clearTarget(options.target);
    }
    root.render(
      createElement(OpenWrtPageShell, {
        options,
      }),
    );

    return {
      unmount() {
        root.unmount();
        if (shadowMount) {
          shadowMount.dispose();
        } else {
          clearTarget(options.target);
        }
        releaseProviderUiHost();
        releaseHostDecoration();
        releaseThemeLease();
        options.shell.clearMessage();
      },
    };
  });
}

const api: OpenWrtSharedProviderBundleApi = {
  capabilities: {
    pageShell: true,
    providerManager: true,
    runtimeSurface: true,
  },
  mount(options) {
    return mountOpenWrtSharedProviderManager(options);
  },
  mountRuntimeSurface(options) {
    return mountOpenWrtSharedRuntimeSurface(options);
  },
  mountPage(options) {
    return mountOpenWrtPageShell(options);
  },
};

export const openWrtSharedProviderBundleApi = api;

export const __private__ = {
  acquireThemeLease,
  buildMutationShellMessage,
  buildSharedProviderShellState,
  getMutationShellMessageKind,
  getShellRestartState,
  getProviderNameFromMutation,
  handleProviderMutationEvent,
  mountOpenWrtPageShell,
  mountOpenWrtSharedRuntimeSurface,
  syncStateFromShell,
  withThemeLease,
};

(globalThis as OpenWrtSharedProviderGlobal)[
  OPENWRT_SHARED_PROVIDER_UI_GLOBAL_KEY
] = api;

export type {
  OpenWrtHostConfigPayload,
  OpenWrtHostState,
  OpenWrtPageMessage,
  OpenWrtSharedPageMountOptions,
  OpenWrtSharedPageShellApi,
  OpenWrtSharedProviderShellApi,
  OpenWrtShellMessageKind,
} from "./pageTypes";
