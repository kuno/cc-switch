import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { RefreshCcw } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { SharedProviderAppId } from "@/shared/providers/domain";
import {
  ActivityDrawerHost,
  type ActivityDrawerHostHandle,
} from "./components/ActivityDrawerHost";
import {
  AppNotificationStack,
  type AppNotification,
} from "./components/AppNotificationStack";
import { AppsGrid } from "./components/AppsGrid";
import { DaemonCard } from "./components/DaemonCard";
import {
  ProviderSidePanelHost,
  type ProviderSidePanelHandle,
} from "./components/ProviderSidePanelHost";
import type {
  OpenWrtHostConfigPayload,
  OpenWrtHostState,
  OpenWrtPageMessage,
  OpenWrtPageTheme,
  OpenWrtSharedPageMountOptions,
} from "./pageTypes";

const OPENWRT_PAGE_THEME_STORAGE_KEY = "ccswitch-openwrt-native-page-theme";

const DAEMON_FALLBACK_VERSION = "v0.4.2";

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
    upstreamProxy: host.upstreamProxy || host.httpsProxy || host.httpProxy,
    logLevel: host.logLevel,
  };
}

function isHostDraftEqual(left: HostDraft, right: HostDraft): boolean {
  return (
    left.listenAddr === right.listenAddr &&
    left.listenPort === right.listenPort &&
    left.upstreamProxy === right.upstreamProxy &&
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
  if (typeof window === "undefined") return "light";

  const storedTheme = window.localStorage.getItem(
    OPENWRT_PAGE_THEME_STORAGE_KEY,
  );
  if (storedTheme === "dark" || storedTheme === "light") {
    return storedTheme;
  }
  return "light";
}

function applyTheme(target: HTMLElement, theme: OpenWrtPageTheme) {
  target.classList.toggle("dark", theme === "dark");
  target.dataset.ccswitchTheme = theme;
  const inner = target.shadowRoot?.querySelector<HTMLElement>(
    ".ccswitch-openwrt-provider-ui-host",
  );
  if (inner) {
    inner.classList.toggle("dark", theme === "dark");
    inner.dataset.ccswitchTheme = theme;
  }
}

function clearTheme(target: HTMLElement) {
  target.classList.remove("dark");
  delete target.dataset.ccswitchTheme;
  const inner = target.shadowRoot?.querySelector<HTMLElement>(
    ".ccswitch-openwrt-provider-ui-host",
  );
  if (inner) {
    inner.classList.remove("dark");
    delete inner.dataset.ccswitchTheme;
  }
}

function formatVersion(
  raw: string | null | undefined,
  fallback: string,
): string {
  const trimmed = (raw ?? "").trim();
  if (!trimmed) return fallback;
  return trimmed.startsWith("v") ? trimmed : `v${trimmed}`;
}

function getListenEndpoint(host: OpenWrtHostState): string {
  const address = host.listenAddr.trim() || "0.0.0.0";
  const port = host.listenPort.trim() || "15721";

  return `${address}:${port}`;
}

function getRestartFailureDetail(
  message: OpenWrtPageMessage | null,
  fallback: string,
): string {
  const text = message?.text?.trim();

  if (!text || /^failed to restart service\.?$/i.test(text)) {
    return fallback;
  }

  return text.replace(/^restart failed:\s*/i, "");
}

function getDaemonStatusNotification(
  snapshot: ShellSnapshot,
  restartFailureDetail: string | null,
  t: ReturnType<typeof useTranslation>["t"],
  onRestart: () => void,
): AppNotification | null {
  const endpoint = getListenEndpoint(snapshot.host);
  const proxy =
    (snapshot.host.upstreamProxy ?? "").trim() ||
    snapshot.host.httpsProxy.trim() ||
    snapshot.host.httpProxy.trim();

  if (snapshot.restartInFlight) {
    return {
      id: `daemon:restarting:${endpoint}`,
      kind: "warning",
      title: t("openwrt.alertStrip.restartingTitle"),
      detail: t("openwrt.alertStrip.restartingDetail", { endpoint }),
      busy: true,
    };
  }

  if (restartFailureDetail) {
    return {
      id: `daemon:restart-failed:${restartFailureDetail}`,
      kind: "error",
      title: t("openwrt.alertStrip.restartFailedTitle"),
      detail: restartFailureDetail,
      action: {
        label: t("openwrt.alertStrip.retryRestart"),
        onClick: onRestart,
      },
    };
  }

  if (!snapshot.isRunning || snapshot.host.status !== "running") {
    return {
      id: "daemon:stopped",
      kind: "error",
      title: t("openwrt.alertStrip.daemonStoppedTitle"),
      detail: t("openwrt.alertStrip.daemonStoppedDetail"),
      action: {
        label: t("openwrt.alertStrip.restartNow"),
        onClick: onRestart,
      },
    };
  }

  if (snapshot.host.health === "degraded") {
    return {
      id: `daemon:unreachable:${endpoint}:${proxy}`,
      kind: "error",
      title: t("openwrt.alertStrip.daemonNotReachableTitle"),
      detail: proxy
        ? t("openwrt.alertStrip.daemonNotReachableWithProxy", {
            endpoint,
            proxy,
          })
        : t("openwrt.alertStrip.daemonNotReachableNoProxy", { endpoint }),
      action: {
        label: t("openwrt.alertStrip.restartNow"),
        onClick: onRestart,
      },
    };
  }

  return null;
}

function isRestartFailureMessage(message: OpenWrtPageMessage | null): boolean {
  return message?.kind === "error" && /restart/i.test(message.text);
}

/** Icon-based theme toggle — matches revised/index.html .theme-toggle. */
function ThemeToggle({
  theme,
  onToggle,
}: {
  theme: OpenWrtPageTheme;
  onToggle: () => void;
}) {
  const { t } = useTranslation();

  return (
    <button
      type="button"
      className="owt-theme-toggle"
      data-theme={theme}
      onClick={onToggle}
      aria-label={
        theme === "dark"
          ? t("openwrt.pageShell.switchToLightTheme")
          : t("openwrt.pageShell.switchToDarkTheme")
      }
    >
      <svg
        className="owt-theme-toggle__sun"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <circle cx="12" cy="12" r="4" />
        <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
      </svg>
      <svg
        className="owt-theme-toggle__moon"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
      </svg>
    </button>
  );
}

function PageFooter({
  luciAppVersion,
  daemonVersion,
}: {
  luciAppVersion: string;
  daemonVersion: string;
}) {
  const { t } = useTranslation();

  return (
    <footer
      className="owt-page-foot"
      role="contentinfo"
      aria-label={t("openwrt.pageShell.versionsAria")}
    >
      <div className="owt-page-foot__versions">
        <span className="owt-page-foot__item">
          <span className="owt-page-foot__label">
            {t("openwrt.daemon.luciAppLabel")}
          </span>
          <span
            className="owt-page-foot__version"
            title={t("openwrt.daemon.luciAppVersion")}
          >
            {luciAppVersion}
          </span>
        </span>
        <span className="owt-page-foot__sep" aria-hidden="true">
          ·
        </span>
        <span className="owt-page-foot__item">
          <span className="owt-page-foot__label">
            {t("openwrt.daemon.daemonLabel")}
          </span>
          <span
            className="owt-page-foot__version"
            title={t("openwrt.daemon.daemonVersion")}
          >
            {daemonVersion}
          </span>
        </span>
      </div>
      <div className="owt-page-foot__credit">
        {t("openwrt.pageShell.footerCreditPrefix")}{" "}
        <a
          href="https://github.com/farion1231/cc-switch"
          target="_blank"
          rel="noopener noreferrer"
        >
          farion1231/cc-switch
        </a>
      </div>
    </footer>
  );
}

export function OpenWrtPageShell({ options }: OpenWrtPageShellProps) {
  const { t } = useTranslation();
  const shell = options.shell;
  const [snapshot, setSnapshot] = useState(() => getHostSnapshot(options));
  const [hostDraft, setHostDraft] = useState(() =>
    createHostDraft(shell.getHostState()),
  );
  const [theme, setTheme] = useState<OpenWrtPageTheme>(() => getInitialTheme());
  const [saveInFlight, setSaveInFlight] = useState(false);
  const [manualRefreshInFlight, setManualRefreshInFlight] = useState(false);
  const [manualRefreshVersion, setManualRefreshVersion] = useState(0);
  const [providerMutationVersion, setProviderMutationVersion] = useState(0);
  const previousHostDraftRef = useRef(createHostDraft(shell.getHostState()));
  const activityHostRef = useRef<ActivityDrawerHostHandle | null>(null);
  const providerPanelRef = useRef<ProviderSidePanelHandle | null>(null);
  const previousRestartInFlightRef = useRef(snapshot.restartInFlight);
  const [activityDrawerOpen, setActivityDrawerOpen] = useState(false);
  const [providerPanelOpen, setProviderPanelOpen] = useState(false);
  const [dismissedNotifications, setDismissedNotifications] = useState<
    ReadonlySet<string>
  >(() => new Set());
  const [restartFailureDetail, setRestartFailureDetail] = useState<
    string | null
  >(() =>
    isRestartFailureMessage(snapshot.message)
      ? getRestartFailureDetail(
          snapshot.message,
          t("openwrt.alertStrip.restartFailureDetail"),
        )
      : null,
  );

  useEffect(() => {
    applyTheme(options.target, theme);
    if (typeof window !== "undefined") {
      window.localStorage.setItem(OPENWRT_PAGE_THEME_STORAGE_KEY, theme);
    }
    return () => {
      clearTheme(options.target);
    };
  }, [options.target, theme]);

  useEffect(() => {
    const nextSnapshot = getHostSnapshot(options);
    setSnapshot(nextSnapshot);
    setHostDraft(createHostDraft(nextSnapshot.host));
    previousHostDraftRef.current = createHostDraft(nextSnapshot.host);

    return shell.subscribe?.(() => {
      setSnapshot(getHostSnapshot(options));
    });
  }, [options, shell]);

  useEffect(() => {
    const nextDraft = createHostDraft(snapshot.host);
    setHostDraft((current) =>
      isHostDraftEqual(current, previousHostDraftRef.current)
        ? nextDraft
        : current,
    );
    previousHostDraftRef.current = nextDraft;
  }, [snapshot.host]);

  const isDirty = useMemo(
    () => !isHostDraftEqual(hostDraft, createHostDraft(snapshot.host)),
    [hostDraft, snapshot.host],
  );

  useEffect(() => {
    if (snapshot.restartInFlight) {
      setRestartFailureDetail(null);
      previousRestartInFlightRef.current = true;
      return;
    }

    if (
      previousRestartInFlightRef.current &&
      snapshot.message?.kind === "error"
    ) {
      setRestartFailureDetail(
        getRestartFailureDetail(
          snapshot.message,
          t("openwrt.alertStrip.restartFailureDetail"),
        ),
      );
    } else if (isRestartFailureMessage(snapshot.message)) {
      setRestartFailureDetail(
        getRestartFailureDetail(
          snapshot.message,
          t("openwrt.alertStrip.restartFailureDetail"),
        ),
      );
    } else if (snapshot.message?.kind !== "error") {
      setRestartFailureDetail(null);
    }

    previousRestartInFlightRef.current = false;
  }, [snapshot.message, snapshot.restartInFlight, t]);

  async function handleSave() {
    setSaveInFlight(true);
    try {
      const nextHost = await shell.saveHostConfig(hostDraft);
      setSnapshot(getHostSnapshot(options));
      setHostDraft(createHostDraft(nextHost));
      previousHostDraftRef.current = createHostDraft(nextHost);
    } finally {
      setSaveInFlight(false);
    }
  }

  async function handleRestart() {
    await shell.restartService();
  }

  async function handleManualRefresh() {
    if (manualRefreshInFlight) {
      return;
    }

    setManualRefreshInFlight(true);
    try {
      await Promise.allSettled([
        shell.refreshHostState(),
        shell.refreshServiceStatus(),
      ]);
      setSnapshot(getHostSnapshot(options));
    } finally {
      setManualRefreshVersion((current) => current + 1);
    }
  }

  function handleOpenActivity(appId: SharedProviderAppId) {
    setProviderPanelOpen(false);
    setActivityDrawerOpen(true);
    providerPanelRef.current?.close();
    activityHostRef.current?.openForApp(appId);
  }

  function handleOpenProviderPanel(
    appId: SharedProviderAppId,
    providerId?: string,
  ) {
    shell.setSelectedApp(appId);
    setActivityDrawerOpen(false);
    setProviderPanelOpen(true);
    activityHostRef.current?.close();
    providerPanelRef.current?.openForApp(appId, providerId);
  }

  function handleCloseOverlay() {
    setActivityDrawerOpen(false);
    setProviderPanelOpen(false);
    activityHostRef.current?.close();
    providerPanelRef.current?.close();
  }

  const handleProviderMutation = useCallback(() => {
    setProviderMutationVersion((current) => current + 1);
  }, []);
  const handleManualRefreshComplete = useCallback(() => {
    setManualRefreshInFlight(false);
  }, []);

  const daemonVersion = formatVersion(
    snapshot.host.version,
    DAEMON_FALLBACK_VERSION,
  );
  const luciAppVersion = formatVersion(
    __OPENWRT_LUCI_APP_VERSION__,
    t("openwrt.daemon.unknownVersion"),
  );
  const notifications = [
    getDaemonStatusNotification(snapshot, restartFailureDetail, t, () => {
      void handleRestart();
    }),
  ].filter(
    (notification): notification is AppNotification =>
      notification !== null && !dismissedNotifications.has(notification.id),
  );

  return (
    <div
      className={
        theme === "dark"
          ? "ccswitch-openwrt-provider-ui-shell ccswitch-openwrt-page-shell dark"
          : "ccswitch-openwrt-provider-ui-shell ccswitch-openwrt-page-shell"
      }
    >
      <main className="owt-main">
        <div className="owt-page__title-row">
          <h1 className="owt-page__title">{t("app.title")}</h1>
          <div className="owt-page__title-actions">
            <button
              type="button"
              className="owt-title-icon-button"
              data-spinning={manualRefreshInFlight ? "true" : "false"}
              onClick={() => {
                void handleManualRefresh();
              }}
              disabled={manualRefreshInFlight}
              aria-label={t("openwrt.pageShell.refreshUiState")}
              title={t("openwrt.pageShell.refreshUiState")}
            >
              <RefreshCcw className="h-4 w-4" aria-hidden="true" />
            </button>
            <ThemeToggle
              theme={theme}
              onToggle={() =>
                setTheme((current) => (current === "dark" ? "light" : "dark"))
              }
            />
          </div>
        </div>

        <h2 id="owt-apps-heading" className="owt-visually-hidden">
          {t("openwrt.pageShell.appsHeading")}
        </h2>

        <section data-slot="apps-grid" aria-labelledby="owt-apps-heading">
          <AppsGrid
            options={options}
            onOpenActivity={handleOpenActivity}
            onOpenProviderPanel={handleOpenProviderPanel}
            onManualRefreshComplete={handleManualRefreshComplete}
            providerMutationVersion={providerMutationVersion}
            refreshVersion={manualRefreshVersion}
          />
        </section>

        <section data-slot="daemon-section">
          <div data-slot="daemon-card">
            <DaemonCard
              host={snapshot.host}
              draft={hostDraft}
              isRunning={snapshot.isRunning}
              isDirty={isDirty}
              saveInFlight={saveInFlight}
              restartInFlight={snapshot.restartInFlight}
              restartPending={snapshot.restartPending}
              onDraftChange={(key, value) =>
                setHostDraft((current) => ({
                  ...current,
                  [key]: value,
                }))
              }
              onSave={() => {
                void handleSave();
              }}
              onRestart={() => {
                void handleRestart();
              }}
              onTestUpstreamProxy={shell.testUpstreamProxy?.bind(shell)}
              onLoadDaemonLogTail={shell.getDaemonLogTail?.bind(shell)}
              onListBackups={shell.listBackups?.bind(shell)}
              onCreateBackup={shell.createBackup?.bind(shell)}
              onDownloadBackup={shell.downloadBackup?.bind(shell)}
              onImportBackup={shell.importBackup?.bind(shell)}
              onDeleteBackup={shell.deleteBackup?.bind(shell)}
              onRestoreBackup={shell.restoreBackup?.bind(shell)}
              onDownloadConfigBackup={shell.downloadConfigBackup?.bind(shell)}
              onDryRunConfigRestore={shell.dryRunConfigRestore?.bind(shell)}
              onDryRunConfigRestoreFile={shell.dryRunConfigRestoreFile?.bind(shell)}
              onStartConfigRestore={shell.startConfigRestore?.bind(shell)}
              onStartConfigRestoreFile={shell.startConfigRestoreFile?.bind(shell)}
              onGetConfigRestoreJob={shell.getConfigRestoreJob?.bind(shell)}
              onProbeConfigBackupRestore={shell.probeConfigBackupRestore?.bind(shell)}
              onNotify={shell.showMessage.bind(shell)}
            />
          </div>
        </section>

        <PageFooter
          luciAppVersion={luciAppVersion}
          daemonVersion={daemonVersion}
        />
      </main>

      <button
        type="button"
        className="owt-overlay-scrim"
        data-open={activityDrawerOpen || providerPanelOpen ? "true" : "false"}
        tabIndex={activityDrawerOpen || providerPanelOpen ? 0 : -1}
        aria-label={t("openwrt.pageShell.closeOpenDrawer")}
        onClick={handleCloseOverlay}
      />

      <AppNotificationStack
        notifications={notifications}
        onDismiss={(id) =>
          setDismissedNotifications((current) => new Set(current).add(id))
        }
      />

      <ActivityDrawerHost
        shell={shell}
        shellRef={activityHostRef}
        onOpenChange={setActivityDrawerOpen}
      />
      <ProviderSidePanelHost
        ref={providerPanelRef}
        selectedApp={snapshot.host.app}
        shell={shell}
        transport={options.transport}
        onOpenChange={setProviderPanelOpen}
        onProviderMutation={handleProviderMutation}
      />
    </div>
  );
}
