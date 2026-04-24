import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { SharedProviderAppId } from "@/shared/providers/domain";
import {
  ActivityDrawerHost,
  type ActivityDrawerHostHandle,
} from "./components/ActivityDrawerHost";
import { AlertStrip } from "./components/AlertStrip";
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

/** Version strings surfaced in the daemon footer. */
const LUCI_APP_VERSION = formatVersion(__OPENWRT_LUCI_APP_VERSION__, "unknown");
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

function getMessageToneClass(message: OpenWrtPageMessage | null): string {
  if (!message) return "";
  if (message.kind === "success") return "ccswitch-openwrt-page-note--success";
  if (message.kind === "error") return "ccswitch-openwrt-page-note--error";
  return "ccswitch-openwrt-page-note--info";
}

function formatVersion(
  raw: string | null | undefined,
  fallback: string,
): string {
  const trimmed = (raw ?? "").trim();
  if (!trimmed) return fallback;
  return trimmed.startsWith("v") ? trimmed : `v${trimmed}`;
}

/** Icon-based theme toggle — matches revised/index.html .theme-toggle. */
function ThemeToggle({
  theme,
  onToggle,
}: {
  theme: OpenWrtPageTheme;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      className="owt-theme-toggle"
      data-theme={theme}
      onClick={onToggle}
      aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} theme`}
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

export function OpenWrtPageShell({ options }: OpenWrtPageShellProps) {
  const shell = options.shell;
  const [snapshot, setSnapshot] = useState(() => getHostSnapshot(options));
  const [hostDraft, setHostDraft] = useState(() =>
    createHostDraft(shell.getHostState()),
  );
  const [theme, setTheme] = useState<OpenWrtPageTheme>(() => getInitialTheme());
  const [saveInFlight, setSaveInFlight] = useState(false);
  const [providerMutationVersion, setProviderMutationVersion] = useState(0);
  const previousHostDraftRef = useRef(createHostDraft(shell.getHostState()));
  const activityHostRef = useRef<ActivityDrawerHostHandle | null>(null);
  const providerPanelRef = useRef<ProviderSidePanelHandle | null>(null);

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

  function handleOpenActivity(appId: SharedProviderAppId) {
    shell.setSelectedApp(appId);
    activityHostRef.current?.openForApp(appId);
  }

  function handleOpenProviderPanel(appId: SharedProviderAppId) {
    shell.setSelectedApp(appId);
    providerPanelRef.current?.openForApp(appId);
  }

  const handleProviderMutation = useCallback(() => {
    setProviderMutationVersion((current) => current + 1);
  }, []);

  const daemonVersion = formatVersion(
    snapshot.host.version,
    DAEMON_FALLBACK_VERSION,
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
        <section data-slot="alert-strip">
          <AlertStrip
            host={snapshot.host}
            isRunning={snapshot.isRunning}
            restartInFlight={snapshot.restartInFlight}
            message={snapshot.message}
            onRestart={() => {
              void handleRestart();
            }}
          />
        </section>

        <div className="owt-page__title-row">
          <h1 className="owt-page__title">CC Switch</h1>
          <ThemeToggle
            theme={theme}
            onToggle={() =>
              setTheme((current) => (current === "dark" ? "light" : "dark"))
            }
          />
        </div>

        <h2 id="owt-apps-heading" className="owt-visually-hidden">
          Apps
        </h2>

        <section data-slot="apps-grid" aria-labelledby="owt-apps-heading">
          <AppsGrid
            options={options}
            onOpenActivity={handleOpenActivity}
            onOpenProviderPanel={handleOpenProviderPanel}
            providerMutationVersion={providerMutationVersion}
          />
        </section>

        <hr className="owt-page__section-divider" aria-hidden="true" />

        <h2 id="owt-daemon-heading" className="owt-visually-hidden">
          Daemon
        </h2>

        <section data-slot="daemon-card" aria-labelledby="owt-daemon-heading">
          <DaemonCard
            appVersion={LUCI_APP_VERSION}
            daemonVersion={daemonVersion}
            host={snapshot.host}
            draft={hostDraft}
            isRunning={snapshot.isRunning}
            isDirty={isDirty}
            saveInFlight={saveInFlight}
            restartInFlight={snapshot.restartInFlight}
            restartPending={snapshot.restartPending}
            message={snapshot.message}
            messageToneClass={getMessageToneClass(snapshot.message)}
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
          />
        </section>
      </main>

      <ActivityDrawerHost shell={shell} shellRef={activityHostRef} />
      <ProviderSidePanelHost
        ref={providerPanelRef}
        selectedApp={snapshot.host.app}
        shell={shell}
        transport={options.transport}
        onProviderMutation={handleProviderMutation}
      />
    </div>
  );
}
