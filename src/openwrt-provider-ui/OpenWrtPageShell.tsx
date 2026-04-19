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
  OpenWrtRecentActivityItem,
  OpenWrtProviderStat,
  OpenWrtSharedPageMountOptions,
  OpenWrtUsageSummary,
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

type UsageState = {
  summary: OpenWrtUsageSummary | null;
  loading: boolean;
  error: string | null;
};

type ProviderStatsState = {
  providers: OpenWrtProviderStat[];
  loading: boolean;
  error: string | null;
};

type RecentActivityState = {
  entries: OpenWrtRecentActivityItem[];
  loading: boolean;
  error: string | null;
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

function formatCount(value: number): string {
  return new Intl.NumberFormat("en-US").format(value);
}

function formatPercent(value: number): string {
  if (!Number.isFinite(value)) {
    return "0.0%";
  }

  return `${value.toFixed(1)}%`;
}

function formatUsd(value: string): string {
  const numeric = Number(value);

  if (!Number.isFinite(numeric)) {
    return value || "$0.00";
  }

  const fractionDigits = numeric !== 0 && Math.abs(numeric) < 1 ? 4 : 2;

  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  }).format(numeric);
}

function formatLatency(value: number): string {
  if (!Number.isFinite(value) || value <= 0) {
    return "n/a";
  }

  return `${Math.round(value)} ms`;
}

function normalizeEpochMs(value: number): number {
  if (!Number.isFinite(value) || value <= 0) {
    return 0;
  }

  return value > 1_000_000_000_000 ? value : value * 1000;
}

function formatRecentActivityTime(value: number): string {
  const epochMs = normalizeEpochMs(value);

  if (!epochMs) {
    return "Unknown time";
  }

  const diffMs = Date.now() - epochMs;
  const diffMinutes = Math.round(diffMs / 60000);

  if (diffMinutes <= 1) {
    return "Just now";
  }

  if (diffMinutes < 60) {
    return `${diffMinutes}m ago`;
  }

  if (diffMinutes < 1440) {
    return `${Math.round(diffMinutes / 60)}h ago`;
  }

  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(epochMs));
}

function getRecentActivityStatusTone(statusCode: number): string {
  if (statusCode >= 200 && statusCode < 300) {
    return "healthy";
  }

  if (statusCode >= 400) {
    return "warning";
  }

  return "neutral";
}

function getRecentActivityStatusLabel(statusCode: number): string {
  if (statusCode >= 200 && statusCode < 300) {
    return "Success";
  }

  if (statusCode > 0) {
    return `HTTP ${statusCode}`;
  }

  return "Unknown";
}

function getTotalTokenCount(summary: OpenWrtUsageSummary | null): number {
  if (!summary) {
    return 0;
  }

  return (
    summary.totalInputTokens +
    summary.totalOutputTokens +
    summary.totalCacheCreationTokens +
    summary.totalCacheReadTokens
  );
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
  const [usageState, setUsageState] = useState<UsageState>({
    summary: null,
    loading: true,
    error: null,
  });
  const [providerStatsState, setProviderStatsState] = useState<ProviderStatsState>({
    providers: [],
    loading: true,
    error: null,
  });
  const [recentActivityState, setRecentActivityState] = useState<RecentActivityState>({
    entries: [],
    loading: true,
    error: null,
  });
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

  useEffect(() => {
    let cancelled = false;

    setUsageState((current) => ({
      ...current,
      loading: true,
      error: null,
    }));

    void options.shell
      .getUsageSummary(snapshot.host.app)
      .then((summary) => {
        if (cancelled) {
          return;
        }

        setUsageState({
          summary,
          loading: false,
          error: null,
        });
      })
      .catch((error) => {
        if (cancelled) {
          return;
        }

        setUsageState({
          summary: null,
          loading: false,
          error: error instanceof Error ? error.message : String(error),
        });
      });

    return () => {
      cancelled = true;
    };
  }, [options, snapshot.host.app]);

  useEffect(() => {
    let cancelled = false;

    setRecentActivityState({
      entries: [],
      loading: true,
      error: null,
    });

    void options.shell
      .getRecentActivity(snapshot.host.app)
      .then((entries) => {
        if (cancelled) {
          return;
        }

        setRecentActivityState({
          entries,
          loading: false,
          error: null,
        });
      })
      .catch((error) => {
        if (cancelled) {
          return;
        }

        setRecentActivityState({
          entries: [],
          loading: false,
          error: error instanceof Error ? error.message : String(error),
        });
      });

    return () => {
      cancelled = true;
    };
  }, [options, snapshot.host.app]);

  useEffect(() => {
    let cancelled = false;

    setProviderStatsState({
      providers: [],
      loading: true,
      error: null,
    });

    void options.shell
      .getProviderStats(snapshot.host.app)
      .then((providers) => {
        if (cancelled) {
          return;
        }

        setProviderStatsState({
          providers,
          loading: false,
          error: null,
        });
      })
      .catch((error) => {
        if (cancelled) {
          return;
        }

        setProviderStatsState({
          providers: [],
          loading: false,
          error: error instanceof Error ? error.message : String(error),
        });
      });

    return () => {
      cancelled = true;
    };
  }, [options, snapshot.host.app]);

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
        <div className="ccswitch-openwrt-workspace-shell__usage">
          <div className="ccswitch-openwrt-workspace-shell__usage-head">
            <div>
              <p className="ccswitch-openwrt-daemon-card__eyebrow">
                Usage summary
              </p>
              <p className="ccswitch-openwrt-workspace-shell__usage-summary">
                Local usage totals for the selected app. Provider quota and
                balance remain separate from this OpenWrt surface.
              </p>
            </div>
          </div>
          {usageState.error ? (
            <div className="ccswitch-openwrt-page-note ccswitch-openwrt-page-note--info">
              {usageState.error}
            </div>
          ) : (
            <div className="ccswitch-openwrt-workspace-shell__usage-grid">
              <div className="ccswitch-openwrt-stat-card ccswitch-openwrt-workspace-shell__usage-card">
                <p className="ccswitch-openwrt-workspace-shell__usage-label">
                  Requests
                </p>
                <p className="ccswitch-openwrt-workspace-shell__usage-value">
                  {usageState.loading
                    ? "Loading…"
                    : formatCount(usageState.summary?.totalRequests ?? 0)}
                </p>
              </div>
              <div className="ccswitch-openwrt-stat-card ccswitch-openwrt-workspace-shell__usage-card">
                <p className="ccswitch-openwrt-workspace-shell__usage-label">
                  Cost
                </p>
                <p className="ccswitch-openwrt-workspace-shell__usage-value">
                  {usageState.loading
                    ? "Loading…"
                    : formatUsd(usageState.summary?.totalCost ?? "0")}
                </p>
              </div>
              <div className="ccswitch-openwrt-stat-card ccswitch-openwrt-workspace-shell__usage-card">
                <p className="ccswitch-openwrt-workspace-shell__usage-label">
                  Tokens
                </p>
                <p className="ccswitch-openwrt-workspace-shell__usage-value">
                  {usageState.loading
                    ? "Loading…"
                    : formatCount(getTotalTokenCount(usageState.summary))}
                </p>
              </div>
              <div className="ccswitch-openwrt-stat-card ccswitch-openwrt-workspace-shell__usage-card">
                <p className="ccswitch-openwrt-workspace-shell__usage-label">
                  Success
                </p>
                <p className="ccswitch-openwrt-workspace-shell__usage-value">
                  {usageState.loading
                    ? "Loading…"
                    : formatPercent(usageState.summary?.successRate ?? 0)}
                </p>
              </div>
            </div>
          )}
          <div className="ccswitch-openwrt-workspace-shell__provider-usage">
            <div className="ccswitch-openwrt-workspace-shell__provider-usage-head">
              <div>
                <p className="ccswitch-openwrt-daemon-card__eyebrow">
                  Providers
                </p>
                <p className="ccswitch-openwrt-workspace-shell__usage-summary">
                  Recent local totals grouped by provider for the selected app.
                </p>
              </div>
            </div>
            {providerStatsState.error ? (
              <div className="ccswitch-openwrt-page-note ccswitch-openwrt-page-note--info">
                {providerStatsState.error}
              </div>
            ) : providerStatsState.loading ? (
              <div className="ccswitch-openwrt-workspace-shell__provider-usage-empty">
                Loading provider usage…
              </div>
            ) : providerStatsState.providers.length > 0 ? (
              <div className="ccswitch-openwrt-workspace-shell__provider-usage-list">
                {providerStatsState.providers.slice(0, 5).map((provider) => (
                  <div
                    className="ccswitch-openwrt-workspace-shell__provider-usage-row"
                    key={`${provider.providerId}-${provider.providerName}`}
                  >
                    <div className="ccswitch-openwrt-workspace-shell__provider-usage-main">
                      <p className="ccswitch-openwrt-workspace-shell__provider-name">
                        {provider.providerName || provider.providerId}
                      </p>
                      <p className="ccswitch-openwrt-workspace-shell__provider-meta">
                        {formatCount(provider.requestCount)} requests ·{" "}
                        {formatCount(provider.totalTokens)} tokens ·{" "}
                        {formatLatency(provider.avgLatencyMs)}
                      </p>
                    </div>
                    <div className="ccswitch-openwrt-workspace-shell__provider-usage-metrics">
                      <span>{formatUsd(provider.totalCost)}</span>
                      <span>{formatPercent(provider.successRate)}</span>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="ccswitch-openwrt-workspace-shell__provider-usage-empty">
                No provider usage has been recorded for this app yet.
              </div>
            )}
          </div>
          <div className="ccswitch-openwrt-workspace-shell__recent-activity">
            <div className="ccswitch-openwrt-workspace-shell__provider-usage-head">
              <div>
                <p className="ccswitch-openwrt-daemon-card__eyebrow">
                  Recent activity
                </p>
                <p className="ccswitch-openwrt-workspace-shell__usage-summary">
                  Latest local requests recorded for the selected app.
                </p>
              </div>
            </div>
            {recentActivityState.error ? (
              <div className="ccswitch-openwrt-page-note ccswitch-openwrt-page-note--info">
                {recentActivityState.error}
              </div>
            ) : recentActivityState.loading ? (
              <div className="ccswitch-openwrt-workspace-shell__provider-usage-empty">
                Loading recent activity…
              </div>
            ) : recentActivityState.entries.length > 0 ? (
              <div className="ccswitch-openwrt-workspace-shell__recent-activity-list">
                {recentActivityState.entries.map((entry) => (
                  <div
                    className="ccswitch-openwrt-workspace-shell__recent-activity-row"
                    key={entry.requestId || `${entry.providerId}-${entry.createdAt}`}
                  >
                    <div className="ccswitch-openwrt-workspace-shell__recent-activity-main">
                      <div className="ccswitch-openwrt-workspace-shell__recent-activity-title">
                        <p className="ccswitch-openwrt-workspace-shell__provider-name">
                          {entry.providerName || entry.providerId}
                        </p>
                        <span
                          className="ccswitch-openwrt-daemon-chip"
                          data-tone={getRecentActivityStatusTone(entry.statusCode)}
                        >
                          {getRecentActivityStatusLabel(entry.statusCode)}
                        </span>
                      </div>
                      <p className="ccswitch-openwrt-workspace-shell__provider-meta">
                        {entry.model || "Default model"} ·{" "}
                        {formatRecentActivityTime(entry.createdAt)}
                      </p>
                    </div>
                    <div className="ccswitch-openwrt-workspace-shell__recent-activity-metrics">
                      <span>{formatCount(entry.totalTokens)} tokens</span>
                      <span>{formatUsd(entry.totalCost)}</span>
                      <span>{formatLatency(entry.latencyMs)}</span>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="ccswitch-openwrt-workspace-shell__provider-usage-empty">
                No recent activity has been recorded for this app yet.
              </div>
            )}
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
