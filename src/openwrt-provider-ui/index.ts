import "@/index.css";
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
  disposed: boolean;
};

type OpenWrtShellMutationState = Pick<
  OpenWrtProviderManagerMountState,
  "disposed" | "restartPending" | "selectedApp" | "serviceRunning"
>;

const APP_LABELS: Record<SharedProviderAppId, string> = {
  claude: "Claude",
  codex: "Codex",
  gemini: "Gemini",
};

function clearTarget(target: HTMLElement) {
  while (target.firstChild) {
    target.removeChild(target.firstChild);
  }
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
  };
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

  state.selectedApp = shell.getSelectedApp();
  state.serviceRunning = event.serviceRunning;
  state.restartPending = event.restartRequired;
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
    restartPending: false,
    disposed: false,
  };

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
    return {
      adapter,
      selectedApp: state.selectedApp,
      onSelectedAppChange(appId) {
        if (state.disposed) {
          return;
        }

        const nextSelectedApp = options.shell.setSelectedApp(appId);
        if (nextSelectedApp === state.selectedApp) {
          return;
        }

        state.selectedApp = nextSelectedApp;
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

  return {
    unmount() {
      state.disposed = true;
      state.mounted?.unmount();
      clearTarget(options.target);
      options.shell.clearMessage();
    },
  };
}

function mountOpenWrtSharedRuntimeSurface(
  options: OpenWrtSharedRuntimeMountOptions,
) {
  let mounted: MountedSharedRuntimeSurface | null = null;

  clearTarget(options.target);
  mounted = mountSharedRuntimeSurface(options.target, {
    adapter: createOpenWrtRuntimeAdapter(options.transport),
  });

  return {
    unmount() {
      mounted?.unmount();
      mounted = null;
      clearTarget(options.target);
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
  buildMutationShellMessage,
  buildSharedProviderShellState,
  getProviderNameFromMutation,
  handleProviderMutationEvent,
  mountOpenWrtSharedRuntimeSurface,
};

(globalThis as OpenWrtSharedProviderGlobal)[
  OPENWRT_SHARED_PROVIDER_UI_GLOBAL_KEY
] = api;
