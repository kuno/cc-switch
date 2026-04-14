import {
  Loader2,
  MoonStar,
  RefreshCcw,
  Save,
  SunMedium,
} from "lucide-react";
import { QueryClientProvider } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { createOpenWrtProviderAdapter } from "@/platform/openwrt/providers";
import {
  createSharedProviderManagerQueryClient,
  SharedProviderManager,
} from "@/shared/providers";
import type { SharedProviderView } from "@/shared/providers/domain";
import type {
  OpenWrtHostConfigPayload,
  OpenWrtHostState,
  OpenWrtPageMessage,
  OpenWrtPageTheme,
  OpenWrtSharedPageMountOptions,
} from "./pageTypes";

const OPENWRT_PAGE_THEME_STORAGE_KEY = "ccswitch-openwrt-native-page-theme";

type HostDraft = OpenWrtHostConfigPayload;

type ShellSnapshot = {
  host: OpenWrtHostState;
  isRunning: boolean;
  restartInFlight: boolean;
  restartPending: boolean;
  message: OpenWrtPageMessage | null;
};

export interface OpenWrtPageShellProps {
  options: OpenWrtSharedPageMountOptions;
}

function createHostDraft(host: OpenWrtHostState): HostDraft {
  return {
    listenAddr: host.listenAddr,
    listenPort: host.listenPort,
    httpProxy: host.httpProxy,
    httpsProxy: host.httpsProxy,
    logLevel: host.logLevel,
  };
}

function isHostDraftEqual(left: HostDraft, right: HostDraft): boolean {
  return (
    left.listenAddr === right.listenAddr &&
    left.listenPort === right.listenPort &&
    left.httpProxy === right.httpProxy &&
    left.httpsProxy === right.httpsProxy &&
    left.logLevel === right.logLevel
  );
}

function getHostSnapshot(
  options: OpenWrtSharedPageMountOptions,
): ShellSnapshot {
  const host = options.shell.getHostState();
  const restartState = options.shell.getRestartState?.();

  return {
    host,
    isRunning: options.shell.getServiceStatus().isRunning,
    restartInFlight: restartState?.inFlight ?? false,
    restartPending: restartState?.pending ?? false,
    message: options.shell.getMessage(),
  };
}

function getInitialTheme(): OpenWrtPageTheme {
  if (typeof window === "undefined") {
    return "light";
  }

  const storedTheme = window.localStorage.getItem(
    OPENWRT_PAGE_THEME_STORAGE_KEY,
  );
  if (storedTheme === "dark" || storedTheme === "light") {
    return storedTheme;
  }

  const rootHasDark =
    document.documentElement.classList.contains("dark") ||
    document.body.classList.contains("dark");

  return rootHasDark ? "dark" : "light";
}

function applyTheme(theme: OpenWrtPageTheme) {
  if (typeof document === "undefined") {
    return;
  }

  document.documentElement.classList.toggle("dark", theme === "dark");
  document.body.classList.toggle("dark", theme === "dark");
  document.body.dataset.ccswitchTheme = theme;
}

function getHealthTone(health: OpenWrtHostState["health"]): string {
  switch (health) {
    case "healthy":
      return "healthy";
    case "degraded":
      return "warning";
    case "stopped":
      return "muted";
    default:
      return "neutral";
  }
}

function getHealthLabel(health: OpenWrtHostState["health"]): string {
  switch (health) {
    case "healthy":
      return "Healthy";
    case "degraded":
      return "Degraded";
    case "stopped":
      return "Stopped";
    default:
      return "Unknown";
  }
}

function getStatusLabel(status: OpenWrtHostState["status"]): string {
  return status === "running" ? "Running" : "Stopped";
}

function getMessageToneClass(message: OpenWrtPageMessage | null): string {
  if (!message) {
    return "";
  }

  if (message.kind === "success") {
    return "ccswitch-openwrt-page-note--success";
  }

  if (message.kind === "error") {
    return "ccswitch-openwrt-page-note--error";
  }

  return "ccswitch-openwrt-page-note--info";
}

function getProviderNameFromMutation(
  providerId: string | null,
  providerState: {
    activeProvider: SharedProviderView;
    providers: SharedProviderView[];
  },
): string {
  if (providerId) {
    const matchedProvider =
      providerState.providers.find((provider) => provider.providerId === providerId) ??
      (providerState.activeProvider.providerId === providerId
        ? providerState.activeProvider
        : null);

    if (matchedProvider?.name.trim()) {
      return matchedProvider.name.trim();
    }
  }

  if (providerState.activeProvider.name.trim()) {
    return providerState.activeProvider.name.trim();
  }

  return providerId || "Provider";
}

function getMutationMessage(
  mutation: "save" | "activate" | "delete",
  providerName: string,
  serviceRunning: boolean,
  restartRequired: boolean,
): {
  kind: "success" | "info";
  text: string;
} {
  const verb =
    mutation === "save"
      ? "saved"
      : mutation === "activate"
        ? "activated"
        : "deleted";

  if (restartRequired) {
    return {
      kind: "info",
      text: `${providerName} was ${verb}. Restart the service to apply provider changes.`,
    };
  }

  if (!serviceRunning) {
    return {
      kind: "success",
      text: `${providerName} was ${verb}. The service is stopped, so no restart is needed right now.`,
    };
  }

  return {
    kind: "success",
    text: `${providerName} was ${verb}. Changes are available immediately.`,
  };
}

export function OpenWrtPageShell({
  options,
}: OpenWrtPageShellProps) {
  const [snapshot, setSnapshot] = useState(() => getHostSnapshot(options));
  const [hostDraft, setHostDraft] = useState(() =>
    createHostDraft(options.shell.getHostState()),
  );
  const [theme, setTheme] = useState<OpenWrtPageTheme>(() => getInitialTheme());
  const [saveInFlight, setSaveInFlight] = useState(false);
  const previousHostDraftRef = useRef(createHostDraft(options.shell.getHostState()));
  const queryClient = useMemo(() => createSharedProviderManagerQueryClient(), []);
  const providerAdapter = useMemo(
    () =>
      createOpenWrtProviderAdapter(options.transport, {
        getServiceRunning() {
          return options.shell.getServiceStatus().isRunning;
        },
        async onProviderMutation(event) {
          if (event.restartRequired) {
            options.shell.setRestartState?.({
              pending: true,
            });
          }

          const message = getMutationMessage(
            event.mutation,
            getProviderNameFromMutation(event.providerId, event.providerState),
            event.serviceRunning,
            event.restartRequired,
          );
          options.shell.showMessage(message.kind, message.text);
        },
      }),
    [options],
  );

  useEffect(() => () => {
    queryClient.clear();
  }, [queryClient]);

  useEffect(() => {
    applyTheme(theme);
    if (typeof window !== "undefined") {
      window.localStorage.setItem(OPENWRT_PAGE_THEME_STORAGE_KEY, theme);
    }
  }, [theme]);

  useEffect(() => {
    const nextSnapshot = getHostSnapshot(options);
    setSnapshot(nextSnapshot);
    setHostDraft(createHostDraft(nextSnapshot.host));
    previousHostDraftRef.current = createHostDraft(nextSnapshot.host);

    return options.shell.subscribe?.(() => {
      setSnapshot(getHostSnapshot(options));
    });
  }, [options]);

  useEffect(() => {
    const nextDraft = createHostDraft(snapshot.host);

    setHostDraft((current) =>
      isHostDraftEqual(current, previousHostDraftRef.current) ? nextDraft : current,
    );
    previousHostDraftRef.current = nextDraft;
  }, [snapshot.host]);

  const isDirty = useMemo(
    () => !isHostDraftEqual(hostDraft, createHostDraft(snapshot.host)),
    [hostDraft, snapshot.host],
  );

  async function handleSave() {
    setSaveInFlight(true);
    try {
      const nextHost = await options.shell.saveHostConfig(hostDraft);
      setSnapshot(getHostSnapshot(options));
      setHostDraft(createHostDraft(nextHost));
      previousHostDraftRef.current = createHostDraft(nextHost);
    } finally {
      setSaveInFlight(false);
    }
  }

  async function handleRestart() {
    await options.shell.restartService();
  }

  return (
    <div className="ccswitch-openwrt-page-shell">
      <section className="ccswitch-openwrt-daemon-card">
        <div className="ccswitch-openwrt-daemon-card__head">
          <div className="ccswitch-openwrt-daemon-card__intro">
            <p className="ccswitch-openwrt-daemon-card__eyebrow">
              {snapshot.host.serviceLabel}
            </p>
            <div className="ccswitch-openwrt-daemon-card__status-row">
              <h1 className="ccswitch-openwrt-daemon-card__title">
                {getStatusLabel(snapshot.host.status)}
              </h1>
              <span
                className="ccswitch-openwrt-daemon-chip"
                data-tone={getHealthTone(snapshot.host.health)}
              >
                {getHealthLabel(snapshot.host.health)}
              </span>
            </div>
            <p className="ccswitch-openwrt-daemon-card__summary">
              {snapshot.host.listenAddr}:{snapshot.host.listenPort}
              {snapshot.host.proxyEnabled ? " • outbound proxy enabled" : " • direct route"}
            </p>
          </div>

          <div className="ccswitch-openwrt-daemon-card__actions">
            <button
              type="button"
              className="ccswitch-openwrt-daemon-button"
              onClick={() =>
                setTheme((current) => (current === "dark" ? "light" : "dark"))
              }
              aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} theme`}
            >
              {theme === "dark" ? (
                <SunMedium className="h-4 w-4" />
              ) : (
                <MoonStar className="h-4 w-4" />
              )}
              {theme === "dark" ? "Light" : "Dark"}
            </button>
            <button
              type="button"
              className="ccswitch-openwrt-daemon-button"
              onClick={() => {
                void handleRestart();
              }}
              disabled={snapshot.restartInFlight}
            >
              {snapshot.restartInFlight ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <RefreshCcw className="h-4 w-4" />
              )}
              Restart
            </button>
            <button
              type="button"
              className="ccswitch-openwrt-daemon-button ccswitch-openwrt-daemon-button--primary"
              onClick={() => {
                void handleSave();
              }}
              disabled={!isDirty || saveInFlight}
            >
              {saveInFlight ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Save className="h-4 w-4" />
              )}
              Save
            </button>
          </div>
        </div>

        {snapshot.message ? (
          <div
            className={`ccswitch-openwrt-page-note ${getMessageToneClass(snapshot.message)}`}
          >
            {snapshot.message.text}
          </div>
        ) : null}

        <div className="ccswitch-openwrt-daemon-card__divider" />

        <div className="ccswitch-openwrt-daemon-grid">
          <label className="ccswitch-openwrt-daemon-field">
            <span>Listen address</span>
            <input
              type="text"
              value={hostDraft.listenAddr}
              onChange={(event) =>
                setHostDraft((current) => ({
                  ...current,
                  listenAddr: event.target.value,
                }))
              }
            />
          </label>
          <label className="ccswitch-openwrt-daemon-field">
            <span>Listen port</span>
            <input
              type="text"
              inputMode="numeric"
              value={hostDraft.listenPort}
              onChange={(event) =>
                setHostDraft((current) => ({
                  ...current,
                  listenPort: event.target.value,
                }))
              }
            />
          </label>
          <label className="ccswitch-openwrt-daemon-field ccswitch-openwrt-daemon-field--wide">
            <span>HTTP proxy</span>
            <input
              type="text"
              value={hostDraft.httpProxy}
              onChange={(event) =>
                setHostDraft((current) => ({
                  ...current,
                  httpProxy: event.target.value,
                }))
              }
            />
          </label>
          <label className="ccswitch-openwrt-daemon-field ccswitch-openwrt-daemon-field--wide">
            <span>HTTPS proxy</span>
            <input
              type="text"
              value={hostDraft.httpsProxy}
              onChange={(event) =>
                setHostDraft((current) => ({
                  ...current,
                  httpsProxy: event.target.value,
                }))
              }
            />
          </label>
          <label className="ccswitch-openwrt-daemon-field">
            <span>Logging</span>
            <select
              value={hostDraft.logLevel}
              onChange={(event) =>
                setHostDraft((current) => ({
                  ...current,
                  logLevel: event.target.value,
                }))
              }
            >
              <option value="error">error</option>
              <option value="warn">warn</option>
              <option value="info">info</option>
              <option value="debug">debug</option>
              <option value="trace">trace</option>
            </select>
          </label>
        </div>
      </section>

      <section className="ccswitch-openwrt-workspace-shell">
        <div className="ccswitch-openwrt-workspace-shell__head">
          <div>
            <p className="ccswitch-openwrt-daemon-card__eyebrow">
              Provider workspace
            </p>
            <h2 className="ccswitch-openwrt-workspace-shell__title">
              Configure routes and provider details
            </h2>
          </div>
        </div>
        <div className="ccswitch-openwrt-workspace-shell__body">
          <QueryClientProvider client={queryClient}>
            <SharedProviderManager
              adapter={providerAdapter}
              selectedApp={snapshot.host.app}
              onSelectedAppChange={(appId) => {
                options.shell.setSelectedApp(appId);
              }}
              shellState={{
                serviceName: snapshot.host.serviceLabel,
                serviceStatusLabel: getStatusLabel(snapshot.host.status).toLowerCase(),
                restartInFlight: snapshot.restartInFlight,
                restartPending: snapshot.restartPending,
              }}
            />
          </QueryClientProvider>
        </div>
      </section>
    </div>
  );
}
