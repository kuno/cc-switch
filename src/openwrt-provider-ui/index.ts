import "./openwrt-provider-ui.css";
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

export const OPENWRT_SHARED_PROVIDER_UI_GLOBAL_KEY =
  "__CCSWITCH_OPENWRT_SHARED_PROVIDER_UI__";

export type OpenWrtShellMessageKind = "success" | "error" | "info";

export interface OpenWrtSharedProviderShellApi {
  getSelectedApp(): SharedProviderAppId;
  setSelectedApp(appId: SharedProviderAppId): SharedProviderAppId;
  getServiceStatus(): {
    isRunning: boolean;
  };
  getRestartState?(): {
    pending: boolean;
    inFlight: boolean;
  };
  setRestartState?(state: {
    pending?: boolean;
    inFlight?: boolean;
  }): void;
  subscribe?(listener: () => void): () => void;
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

export interface OpenWrtSharedRuntimeMountOptions {
  target: HTMLElement;
  transport: OpenWrtRuntimeTransport;
}

export interface OpenWrtSharedProviderBundleCapabilities {
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
}

type OpenWrtSharedProviderGlobal = typeof globalThis & {
  [OPENWRT_SHARED_PROVIDER_UI_GLOBAL_KEY]?: OpenWrtSharedProviderBundleApi;
};

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
const OPENWRT_SHARED_PROVIDER_UI_THEME_CLASS =
  "ccswitch-openwrt-provider-ui-theme";
let activeThemeLeaseCount = 0;

function clearTarget(target: HTMLElement) {
  while (target.firstChild) {
    target.removeChild(target.firstChild);
  }
}

function acquireThemeLease(): () => void {
  if (typeof document === "undefined") {
    return () => {};
  }

  if (activeThemeLeaseCount === 0) {
    document.body.classList.add(OPENWRT_SHARED_PROVIDER_UI_THEME_CLASS);
  }

  activeThemeLeaseCount += 1;

  return () => {
    if (typeof document === "undefined") {
      return;
    }

    activeThemeLeaseCount = Math.max(0, activeThemeLeaseCount - 1);
    if (activeThemeLeaseCount === 0) {
      document.body.classList.remove(OPENWRT_SHARED_PROVIDER_UI_THEME_CLASS);
    }
  };
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

function syncStateFromShell(
  state: OpenWrtShellMutationState,
  shell: OpenWrtSharedProviderShellApi,
) {
  state.selectedApp = shell.getSelectedApp();
  state.serviceRunning = shell.getServiceStatus().isRunning;

  const restartState = shell.getRestartState?.();
  if (restartState) {
    state.restartPending = restartState.pending;
    state.restartInFlight = restartState.inFlight;
  }
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

  shell.setRestartState?.({
    pending: event.restartRequired,
    inFlight: false,
  });
  state.selectedApp = shell.getSelectedApp();
  state.serviceRunning = event.serviceRunning;
  state.restartPending = event.restartRequired;
  state.restartInFlight = false;
  shell.showMessage("success", buildMutationShellMessage(event));
  rerender();
}

function mountOpenWrtSharedProviderManager(
  options: OpenWrtSharedProviderMountOptions,
) {
  const state: OpenWrtProviderManagerMountState = {
    mounted: null,
    selectedApp: options.shell.getSelectedApp(),
    serviceRunning: options.shell.getServiceStatus().isRunning,
    restartPending: options.shell.getRestartState?.().pending ?? false,
    restartInFlight: options.shell.getRestartState?.().inFlight ?? false,
    disposed: false,
  };
  const releaseThemeLease = acquireThemeLease();
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

  clearTarget(options.target);
  state.mounted = mountSharedProviderManager(
    options.target,
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
      clearTarget(options.target);
      releaseThemeLease();
      options.shell.clearMessage();
    },
  };
}

function mountOpenWrtSharedRuntimeSurface(
  options: OpenWrtSharedRuntimeMountOptions,
) {
  let mounted: MountedSharedRuntimeSurface | null = null;
  const releaseThemeLease = acquireThemeLease();

  clearTarget(options.target);
  mounted = mountSharedRuntimeSurface(options.target, {
    adapter: createOpenWrtRuntimeAdapter(options.transport),
  });

  return {
    unmount() {
      mounted?.unmount();
      mounted = null;
      clearTarget(options.target);
      releaseThemeLease();
    },
  };
}

const api: OpenWrtSharedProviderBundleApi = {
  capabilities: {
    providerManager: true,
    runtimeSurface: true,
  },
  mount(options) {
    return mountOpenWrtSharedProviderManager(options);
  },
  mountRuntimeSurface(options) {
    return mountOpenWrtSharedRuntimeSurface(options);
  },
};

export const openWrtSharedProviderBundleApi = api;

export const __private__ = {
  acquireThemeLease,
  buildMutationShellMessage,
  buildSharedProviderShellState,
  getProviderNameFromMutation,
  handleProviderMutationEvent,
  mountOpenWrtSharedRuntimeSurface,
  syncStateFromShell,
};

(globalThis as OpenWrtSharedProviderGlobal)[
  OPENWRT_SHARED_PROVIDER_UI_GLOBAL_KEY
] = api;
