import { MoonStar, SunMedium } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
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
const OPENWRT_PAGE_THEME_DARK_CLASS =
  "ccswitch-openwrt-provider-ui-theme-dark";

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

  return "light";
}

function clearLegacyGlobalDarkThemeLeak() {
  if (typeof document === "undefined") {
    return;
  }

  document.documentElement.classList.remove("dark");
  document.body.classList.remove("dark");
}

function applyTheme(theme: OpenWrtPageTheme) {
  if (typeof document === "undefined") {
    return;
  }

  clearLegacyGlobalDarkThemeLeak();
  document.body.classList.toggle(
    OPENWRT_PAGE_THEME_DARK_CLASS,
    theme === "dark",
  );
  document.body.dataset.ccswitchTheme = theme;
}

function clearTheme() {
  if (typeof document === "undefined") {
    return;
  }

  clearLegacyGlobalDarkThemeLeak();
  document.body.classList.remove(OPENWRT_PAGE_THEME_DARK_CLASS);
  delete document.body.dataset.ccswitchTheme;
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
      onClick={onToggle}
      aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} theme`}
    >
      {theme === "dark" ? (
        <SunMedium className="h-4 w-4" />
      ) : (
        <MoonStar className="h-4 w-4" />
      )}
      <span>{theme === "dark" ? "Light" : "Dark"}</span>
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
  const previousHostDraftRef = useRef(createHostDraft(shell.getHostState()));
  const activityHostRef = useRef<ActivityDrawerHostHandle | null>(null);
  const providerPanelRef = useRef<ProviderSidePanelHandle | null>(null);

  useEffect(() => {
    applyTheme(theme);
    if (typeof window !== "undefined") {
      window.localStorage.setItem(OPENWRT_PAGE_THEME_STORAGE_KEY, theme);
    }

    return () => {
      clearTheme();
    };
  }, [theme]);

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

  return (
    <div
      className={
        theme === "dark"
          ? "ccswitch-openwrt-provider-ui-shell ccswitch-openwrt-page-shell dark"
          : "ccswitch-openwrt-provider-ui-shell ccswitch-openwrt-page-shell"
      }
    >
      <header className="owt-header">
        <div>
          <div className="owt-breadcrumb">OpenWrt / Services</div>
          <h1 className="owt-page-title">CC Switch</h1>
        </div>
        <div className="owt-header-actions">
          <ThemeToggle
            theme={theme}
            onToggle={() =>
              setTheme((current) => (current === "dark" ? "light" : "dark"))
            }
          />
        </div>
      </header>

      <main className="owt-main">
        <section className="owt-slot owt-slot-alert" data-slot="alert-strip">
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

        <section className="owt-slot owt-slot-apps" data-slot="apps-grid">
          <AppsGrid
            options={options}
            onOpenActivity={handleOpenActivity}
            onOpenProviderPanel={handleOpenProviderPanel}
          />
        </section>

        <section className="owt-slot owt-slot-daemon" data-slot="daemon-card">
          <DaemonCard
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
      />
    </div>
  );
}
