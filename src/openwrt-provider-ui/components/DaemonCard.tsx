import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  CheckCircle2,
  ChevronRight,
  Database,
  Download,
  Globe2,
  Loader2,
  Lock,
  Pencil,
  PlugZap,
  RefreshCcw,
  Save,
  Upload,
  CircleAlert,
} from "lucide-react";
import type { TFunction } from "i18next";
import { useTranslation } from "react-i18next";
import type {
  OpenWrtDaemonLogTail,
  OpenWrtBackupEntry,
  OpenWrtBackupList,
  OpenWrtConfigBackupManifest,
  OpenWrtConfigRestoreEvent,
  OpenWrtHostConfigPayload,
  OpenWrtHostState,
  OpenWrtOutboundProxyTestResult,
  OpenWrtShellMessageKind,
} from "../pageTypes";

const DEFAULT_LOG_LEVELS = ["error", "warn", "info", "debug", "trace"];
const LOG_TAIL_LINES = 80;
const LOG_TAIL_MAX_BYTES = 256 * 1024;

type EditTarget = "endpoint" | "proxy" | null;
type ProxyStatus = "idle" | "ok" | "fail" | "checking";

type BackupBackendStatus = "pending" | "available" | "error";

export interface DaemonCardProps {
  host: OpenWrtHostState;
  draft: OpenWrtHostConfigPayload;
  isRunning: boolean;
  isDirty: boolean;
  saveInFlight: boolean;
  restartInFlight: boolean;
  restartPending: boolean;
  onDraftChange: <Key extends keyof OpenWrtHostConfigPayload>(
    key: Key,
    value: OpenWrtHostConfigPayload[Key],
  ) => void;
  onSave: () => void;
  onRestart: () => void;
  onTestUpstreamProxy?: (
    proxyUrl: string,
  ) => Promise<OpenWrtOutboundProxyTestResult>;
  onLoadDaemonLogTail?: (
    lines: number,
    maxBytes: number,
  ) => Promise<OpenWrtDaemonLogTail>;
  // The DB-only backup callbacks below are retained on the prop interface so
  // the OpenWrt shell wiring keeps compiling, but the daemon card no longer
  // renders the DB backup drawer. The design replaces it with a whole-app
  // backup/restore admin row whose backend is still pending.
  onListBackups?: () => Promise<OpenWrtBackupList>;
  onCreateBackup?: () => Promise<{ backup: OpenWrtBackupEntry }>;
  onDownloadBackup?: (
    filename: string,
  ) => Promise<{ filename: string; dataBase64: string }>;
  onImportBackup?: (
    filename: string | null,
    dataBase64: string,
  ) => Promise<{ backup: OpenWrtBackupEntry }>;
  onDeleteBackup?: (filename: string) => Promise<unknown>;
  onRestoreBackup?: (
    filename: string,
  ) => Promise<{
    restoredBackup: OpenWrtBackupEntry;
    safetyBackup?: OpenWrtBackupEntry | null;
    uciRestoreSupported: boolean;
  }>;
  onDownloadConfigBackup?: () => Promise<{
    filename: string;
    dataBase64?: string;
    downloadUrl?: string;
  }>;
  onDryRunConfigRestore?: (
    filename: string,
    dataBase64: string,
  ) => Promise<{ manifest: OpenWrtConfigBackupManifest }>;
  onDryRunConfigRestoreFile?: (
    file: File,
  ) => Promise<{ manifest: OpenWrtConfigBackupManifest }>;
  onStartConfigRestore?: (
    filename: string,
    dataBase64: string,
  ) => Promise<{ jobId: string }>;
  onStartConfigRestoreFile?: (file: File) => Promise<{ jobId: string }>;
  onGetConfigRestoreJob?: (
    jobId: string,
  ) => Promise<OpenWrtConfigRestoreEvent>;
  onProbeConfigBackupRestore?: () => Promise<{ available: boolean }>;
  onNotify?: (kind: OpenWrtShellMessageKind, text: string) => void;
}

function getHealthTone(health: OpenWrtHostState["health"]): string {
  switch (health) {
    case "healthy":
      return "success";
    case "degraded":
      return "accent";
    case "stopped":
      return "neutral";
    default:
      return "neutral";
  }
}

function getHealthLabel(
  health: OpenWrtHostState["health"],
  t: TFunction,
): string {
  switch (health) {
    case "healthy":
      return t("openwrt.daemon.health.healthy");
    case "degraded":
      return t("health.degraded");
    case "stopped":
      return t("openwrt.daemon.health.stopped");
    default:
      return t("common.unknown");
  }
}

function getStatusLabel(t: TFunction): string {
  return t("openwrt.pageShell.daemonHeading");
}

function getLogLevelOptions(value: string): string[] {
  if (!value.trim() || DEFAULT_LOG_LEVELS.includes(value)) {
    return DEFAULT_LOG_LEVELS;
  }
  return [value, ...DEFAULT_LOG_LEVELS];
}

function capitalize(input: string): string {
  if (!input) return input;
  return input.charAt(0).toUpperCase() + input.slice(1);
}

function formatEndpoint(listenAddr: string, listenPort: string): string {
  const addr = listenAddr.trim() || "0.0.0.0";
  const port = listenPort.trim() || "15721";
  return `${addr}:${port}`;
}

function formatCheckedAt(timestamp: number | null, t: TFunction): string {
  if (!timestamp) return t("openwrt.daemon.logs.notLoaded");

  const elapsedSeconds = Math.max(0, Math.round((Date.now() - timestamp) / 1000));
  if (elapsedSeconds < 5) return t("openwrt.daemon.logs.checkedJustNow");
  if (elapsedSeconds < 60) {
    return t("openwrt.daemon.logs.checkedSecondsAgo", {
      count: elapsedSeconds,
    });
  }

  return t("openwrt.daemon.logs.checkedMinutesAgo", {
    count: Math.round(elapsedSeconds / 60),
  });
}

function getLogLineTone(line: string): string {
  if (/\b(error|ERROR)\b/.test(line)) return "error";
  if (/\b(warn|WARN)\b/.test(line)) return "warn";
  if (/\b(debug|DEBUG)\b/.test(line)) return "debug";
  return "info";
}

function splitLogLine(line: string): {
  level: string;
  message: string;
  timestamp: string;
} | null {
  const match = line.match(
    /^(\S+)\s+(TRACE|DEBUG|INFO|WARN|WARNING|ERROR)\b\s*(.*)$/i,
  );
  if (!match) return null;

  return {
    timestamp: match[1],
    level: match[2].toUpperCase() === "WARNING" ? "WARN" : match[2].toUpperCase(),
    message: match[3],
  };
}

function normalizeProxyStatus(
  result: OpenWrtOutboundProxyTestResult,
): ProxyStatus {
  if (!result.tested) return "idle";
  return result.success ? "ok" : "fail";
}

function DaemonField({
  children,
  label,
  htmlFor,
}: {
  children: ReactNode;
  label: string;
  htmlFor?: string;
}) {
  return (
    <div className="owt-edit-popover__field">
      <label className="owt-daemon-cell-label" htmlFor={htmlFor}>
        {label}
      </label>
      {children}
    </div>
  );
}

export function DaemonCard({
  host,
  draft,
  isRunning,
  isDirty,
  saveInFlight,
  restartInFlight,
  onDraftChange,
  onSave,
  onRestart,
  onTestUpstreamProxy,
  onLoadDaemonLogTail,
  onDownloadConfigBackup,
  onDryRunConfigRestore,
  onDryRunConfigRestoreFile,
  onStartConfigRestore,
  onStartConfigRestoreFile,
  onGetConfigRestoreJob,
  onProbeConfigBackupRestore,
  onNotify,
}: DaemonCardProps) {
  const { t } = useTranslation();
  const saveFlashTimeoutRef = useRef<number | null>(null);
  const previousSaveInFlightRef = useRef(saveInFlight);
  const restoreInputRef = useRef<HTMLInputElement | null>(null);
  const [showSaveFlash, setShowSaveFlash] = useState(false);
  const [editTarget, setEditTarget] = useState<EditTarget>(null);
  const [endpointDraft, setEndpointDraft] = useState({
    listenAddr: draft.listenAddr,
    listenPort: draft.listenPort,
  });
  const effectiveDraftProxy =
    draft.upstreamProxy ?? draft.httpsProxy ?? draft.httpProxy ?? "";
  const [proxyDraft, setProxyDraft] = useState(effectiveDraftProxy);
  const [proxyStatus, setProxyStatus] = useState<ProxyStatus>("idle");
  const [proxyError, setProxyError] = useState<string | null>(null);
  const [logTail, setLogTail] = useState<OpenWrtDaemonLogTail | null>(null);
  const [logLoading, setLogLoading] = useState(false);
  const [logError, setLogError] = useState<string | null>(null);
  const [logCheckedAt, setLogCheckedAt] = useState<number | null>(null);
  const [logDrawerOpen, setLogDrawerOpen] = useState(false);
  const logViewerRef = useRef<HTMLDivElement | null>(null);
  const logRefreshInFlightRef = useRef(false);
  const [, forceFreshnessTick] = useState(0);
  const statusLabel = getStatusLabel(t);
  const healthLabel = restartInFlight
    ? t("openwrt.daemon.restarting")
    : getHealthLabel(host.health, t);
  const healthTone = restartInFlight ? "accent" : getHealthTone(host.health);
  const logLevelOptions = getLogLevelOptions(draft.logLevel);
  const endpointLabel = formatEndpoint(draft.listenAddr, draft.listenPort);
  const upstreamProxyLabel =
    effectiveDraftProxy.trim() || t("openwrt.daemon.upstreamProxyDirect");
  const logFreshness = formatCheckedAt(logCheckedAt, t);
  const proxyTooltip = useMemo(() => {
    if (proxyStatus === "checking") return t("openwrt.daemon.proxyChecking");
    if (proxyStatus === "ok") return t("openwrt.daemon.proxyReachable");
    if (proxyStatus === "fail") {
      return proxyError || t("openwrt.daemon.proxyUnreachable");
    }
    return t("openwrt.daemon.proxyNotChecked");
  }, [proxyError, proxyStatus, t]);

  const [backupBackendStatus, setBackupBackendStatus] =
    useState<BackupBackendStatus>("pending");
  const backupDisabledTip =
    backupBackendStatus === "error"
      ? t("openwrt.daemon.backupRestore.backendErrorTip")
      : t("openwrt.daemon.backupRestore.disabledTip");
  const backupRestoreAvailable = backupBackendStatus === "available";

  useEffect(() => {
    let cancelled = false;
    const hasCallbacks =
      onDownloadConfigBackup &&
      ((onDryRunConfigRestore && onStartConfigRestore) ||
        (onDryRunConfigRestoreFile && onStartConfigRestoreFile)) &&
      onGetConfigRestoreJob &&
      onProbeConfigBackupRestore;

    if (!hasCallbacks) {
      setBackupBackendStatus("pending");
      return;
    }

    setBackupBackendStatus("pending");
    void onProbeConfigBackupRestore()
      .then((capability) => {
        if (!cancelled) {
          setBackupBackendStatus(capability.available ? "available" : "error");
        }
      })
      .catch(() => {
        if (!cancelled) setBackupBackendStatus("error");
      });

    return () => {
      cancelled = true;
    };
  }, [
    onDownloadConfigBackup,
    onDryRunConfigRestore,
    onDryRunConfigRestoreFile,
    onGetConfigRestoreJob,
    onProbeConfigBackupRestore,
    onStartConfigRestore,
    onStartConfigRestoreFile,
  ]);

  useEffect(() => {
    if (saveInFlight) {
      setShowSaveFlash(false);
      previousSaveInFlightRef.current = true;
      return;
    }

    if (previousSaveInFlightRef.current && !isDirty) {
      setShowSaveFlash(true);
      if (saveFlashTimeoutRef.current !== null) {
        window.clearTimeout(saveFlashTimeoutRef.current);
      }
      saveFlashTimeoutRef.current = window.setTimeout(() => {
        setShowSaveFlash(false);
        saveFlashTimeoutRef.current = null;
      }, 1400);
    }

    previousSaveInFlightRef.current = false;
  }, [isDirty, saveInFlight]);

  useEffect(
    () => () => {
      if (saveFlashTimeoutRef.current !== null) {
        window.clearTimeout(saveFlashTimeoutRef.current);
      }
    },
    [],
  );

  useEffect(() => {
    if (editTarget !== "endpoint") {
      setEndpointDraft({
        listenAddr: draft.listenAddr,
        listenPort: draft.listenPort,
      });
    }
    if (editTarget !== "proxy") {
      setProxyDraft(effectiveDraftProxy);
    }
  }, [draft.listenAddr, draft.listenPort, effectiveDraftProxy, editTarget]);

  useEffect(() => {
    setProxyStatus("idle");
    setProxyError(null);
  }, [effectiveDraftProxy]);

  useEffect(() => {
    if (!logCheckedAt) return;

    const timer = window.setInterval(() => {
      forceFreshnessTick((tick) => tick + 1);
    }, 1000);
    return () => window.clearInterval(timer);
  }, [logCheckedAt]);

  function savePopover() {
    if (editTarget === "endpoint") {
      onDraftChange("listenAddr", endpointDraft.listenAddr.trim());
      onDraftChange("listenPort", endpointDraft.listenPort.trim());
    } else if (editTarget === "proxy") {
      onDraftChange("upstreamProxy", proxyDraft.trim());
    }
    setEditTarget(null);
  }

  async function recheckProxy() {
    const proxyUrl = proxyDraft.trim() || effectiveDraftProxy.trim();
    if (!proxyUrl || typeof onTestUpstreamProxy !== "function") {
      setProxyStatus("idle");
      setProxyError(null);
      return;
    }

    setProxyStatus("checking");
    setProxyError(null);
    try {
      const result = await onTestUpstreamProxy(proxyUrl);
      setProxyStatus(normalizeProxyStatus(result));
      setProxyError(result.error ?? null);
    } catch (error) {
      setProxyStatus("fail");
      setProxyError(error instanceof Error ? error.message : String(error));
    }
  }

  const refreshLogs = useCallback(async () => {
    if (logRefreshInFlightRef.current) {
      return;
    }

    if (typeof onLoadDaemonLogTail !== "function") {
      setLogError(t("openwrt.daemon.logs.unavailable"));
      return;
    }

    logRefreshInFlightRef.current = true;
    setLogLoading(true);
    setLogError(null);
    try {
      const nextTail = await onLoadDaemonLogTail(
        LOG_TAIL_LINES,
        LOG_TAIL_MAX_BYTES,
      );
      setLogTail(nextTail);
      setLogCheckedAt(Date.now());
    } catch (error) {
      setLogError(error instanceof Error ? error.message : String(error));
    } finally {
      logRefreshInFlightRef.current = false;
      setLogLoading(false);
    }
  }, [onLoadDaemonLogTail, t]);

  useEffect(() => {
    if (!logDrawerOpen) {
      return;
    }

    void refreshLogs();
    const timer = window.setInterval(() => {
      void refreshLogs();
    }, 3000);

    return () => window.clearInterval(timer);
  }, [logDrawerOpen, refreshLogs]);

  useEffect(() => {
    if (!logDrawerOpen || !logTail?.entries.length || logError) {
      return;
    }

    const viewer = logViewerRef.current;
    if (!viewer) {
      return;
    }

    viewer.scrollTop = viewer.scrollHeight;
  }, [logDrawerOpen, logError, logTail]);

  const fileToBase64 = useCallback((file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const result = String(reader.result || "");
        resolve(result.includes(",") ? result.split(",").pop() || "" : result);
      };
      reader.onerror = () =>
        reject(reader.error || new Error("Failed to read restore archive."));
      reader.readAsDataURL(file);
    });
  }, []);

  const downloadBase64File = useCallback((filename: string, dataBase64: string) => {
    const binary = window.atob(dataBase64);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }
    const url = URL.createObjectURL(
      new Blob([bytes], { type: "application/gzip" }),
    );
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
  }, []);

  const downloadUrlFile = useCallback((filename: string, downloadUrl: string) => {
    const anchor = document.createElement("a");
    anchor.href = downloadUrl;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
  }, []);

  const pollRestoreJob = useCallback(
    async (jobId: string) => {
      if (!onGetConfigRestoreJob) return;
      for (let attempt = 0; attempt < 120; attempt += 1) {
        const event = await onGetConfigRestoreJob(jobId);
        if (event.step === "verify" && event.state === "done") {
          onNotify?.("success", t("openwrt.daemon.backupRestore.restoreDone"));
          return;
        }
        if (event.state === "failed") {
          const rollback = event.rolledBack
            ? ` ${t("openwrt.daemon.backupRestore.rolledBack")}`
            : "";
          onNotify?.(
            "error",
            `${event.error || t("openwrt.daemon.backupRestore.restoreFailed")}${rollback}`,
          );
          return;
        }
        await new Promise((resolve) => window.setTimeout(resolve, 750));
      }
      onNotify?.("info", t("openwrt.daemon.backupRestore.restoreStillRunning"));
    },
    [onGetConfigRestoreJob, onNotify, t],
  );

  const handleDownloadConfigBackup = useCallback(async () => {
    if (!onDownloadConfigBackup) return;
    try {
      const result = await onDownloadConfigBackup();
      if (result.downloadUrl) {
        downloadUrlFile(result.filename, result.downloadUrl);
      } else if (result.dataBase64) {
        downloadBase64File(result.filename, result.dataBase64);
      } else {
        throw new Error("Backup download returned an empty payload.");
      }
      onNotify?.("success", t("openwrt.daemon.backupRestore.downloadReady"));
    } catch (error) {
      onNotify?.("error", error instanceof Error ? error.message : String(error));
    }
  }, [downloadBase64File, downloadUrlFile, onDownloadConfigBackup, onNotify, t]);

  const handleRestoreFile = useCallback(
    async (file: File) => {
      if (
        (!onDryRunConfigRestore || !onStartConfigRestore) &&
        (!onDryRunConfigRestoreFile || !onStartConfigRestoreFile)
      ) {
        return;
      }

      try {
        const useFileUpload = !!(
          onDryRunConfigRestoreFile && onStartConfigRestoreFile
        );
        const dataBase64 = useFileUpload ? "" : await fileToBase64(file);
        const dryRun = useFileUpload
          ? await onDryRunConfigRestoreFile(file)
          : await onDryRunConfigRestore!(file.name, dataBase64);
        const confirmed = window.confirm(
          t("openwrt.daemon.backupRestore.confirmRestore", {
            apps: dryRun.manifest.appCount,
            providers: dryRun.manifest.providerCount,
            version: dryRun.manifest.daemonVersion,
          }),
        );
        if (!confirmed) return;
        const started = useFileUpload
          ? await onStartConfigRestoreFile!(file)
          : await onStartConfigRestore!(file.name, dataBase64);
        onNotify?.("info", t("openwrt.daemon.backupRestore.restoreStarted"));
        void pollRestoreJob(started.jobId);
      } catch (error) {
        onNotify?.("error", error instanceof Error ? error.message : String(error));
      } finally {
        if (restoreInputRef.current) restoreInputRef.current.value = "";
      }
    },
    [
      fileToBase64,
      onDryRunConfigRestore,
      onDryRunConfigRestoreFile,
      onNotify,
      onStartConfigRestore,
      onStartConfigRestoreFile,
      pollRestoreJob,
      t,
    ],
  );

  return (
    <div
      className="owt-daemon-card"
      aria-label={host.serviceLabel || t("openwrt.daemon.controlAria")}
    >
      <div className="owt-daemon-row">
        <div
          className="owt-daemon-status"
          data-running={isRunning ? "true" : "false"}
        >
          <span
            className="owt-daemon-health owt-status-pill"
            data-tone={healthTone}
          >
            <span className="owt-status-pill__dot" aria-hidden="true" />
            {healthLabel}
          </span>
          <span className="owt-daemon-status__label">{statusLabel}</span>
        </div>

        <div className="owt-daemon-summary">
          <span className="owt-daemon-summary__segment">
            <span className="owt-daemon-summary__head">
              <Globe2 className="h-3 w-3" aria-hidden="true" />
              <span className="owt-daemon-summary__label">
                {t("openwrt.daemon.listeningOn")}
              </span>
            </span>
            <button
              type="button"
              className="owt-inline-token"
              onClick={() =>
                setEditTarget(editTarget === "endpoint" ? null : "endpoint")
              }
              aria-haspopup="dialog"
            >
              <span>{endpointLabel}</span>
              <Pencil className="h-3 w-3" aria-hidden="true" />
            </button>
          </span>

          <span className="owt-daemon-summary__segment">
            <span className="owt-daemon-summary__head">
              <PlugZap className="h-3 w-3" aria-hidden="true" />
              <span className="owt-daemon-summary__label">
                {t("openwrt.daemon.upstreamProxy")}
              </span>
            </span>
            <button
              type="button"
              className={`owt-inline-token${
                proxyStatus === "fail" ? " owt-inline-token--fail" : ""
              }${
                proxyStatus === "checking" ? " owt-inline-token--checking" : ""
              }`}
              onClick={() =>
                setEditTarget(editTarget === "proxy" ? null : "proxy")
              }
              aria-haspopup="dialog"
              title={proxyTooltip}
            >
              <span>{upstreamProxyLabel}</span>
              {proxyStatus === "checking" ? (
                <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
              ) : (
                <Pencil className="h-3 w-3" aria-hidden="true" />
              )}
            </button>
          </span>
        </div>

        <span className="owt-daemon-row__spacer" aria-hidden="true" />

        <div className="owt-daemon-actions">
          <button
            type="button"
            className="owt-pill owt-pill--primary"
            onClick={onRestart}
            disabled={restartInFlight}
          >
            {restartInFlight ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <RefreshCcw className="h-4 w-4" />
            )}
            {restartInFlight
              ? t("openwrt.daemon.restarting")
              : t("openwrt.daemon.restart")}
          </button>

          <button
            type="button"
            className={
              showSaveFlash
                ? "owt-pill owt-pill--saved-flash"
                : isDirty
                  ? "owt-pill owt-pill--primary"
                  : "owt-pill owt-pill--idle"
            }
            onClick={onSave}
            disabled={!isDirty || saveInFlight || showSaveFlash}
            title={t("openwrt.daemon.persistConfig")}
          >
            {saveInFlight ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : showSaveFlash ? (
              <CheckCircle2 className="h-4 w-4" />
            ) : (
              <Save className="h-4 w-4" />
            )}
            {saveInFlight
              ? t("openwrt.daemon.saving")
              : showSaveFlash
                ? t("openwrt.daemon.saved")
                : t("common.save")}
          </button>
        </div>
      </div>

      {editTarget ? (
        <div
          className="owt-edit-popover"
          role="dialog"
          aria-label={
            editTarget === "endpoint"
              ? t("openwrt.daemon.editEndpoint")
              : t("openwrt.daemon.editProxy")
          }
        >
          <div className="owt-edit-popover__title">
            {editTarget === "endpoint"
              ? t("openwrt.daemon.editEndpoint")
              : t("openwrt.daemon.editProxy")}
          </div>

          {editTarget === "endpoint" ? (
            <>
              <div className="owt-edit-popover__row">
                <DaemonField
                  label={t("openwrt.daemon.listenAddress")}
                  htmlFor="owt-listenAddr"
                >
                  <input
                    id="owt-listenAddr"
                    type="text"
                    className="owt-field-input owt-field-input--mono"
                    value={endpointDraft.listenAddr}
                    onChange={(event) =>
                      setEndpointDraft((current) => ({
                        ...current,
                        listenAddr: event.target.value,
                      }))
                    }
                  />
                </DaemonField>
                <DaemonField
                  label={t("openwrt.daemon.listenPort")}
                  htmlFor="owt-listenPort"
                >
                  <input
                    id="owt-listenPort"
                    type="text"
                    inputMode="numeric"
                    className="owt-field-input owt-field-input--mono"
                    value={endpointDraft.listenPort}
                    onChange={(event) =>
                      setEndpointDraft((current) => ({
                        ...current,
                        listenPort: event.target.value,
                      }))
                    }
                  />
                </DaemonField>
              </div>
              <p className="owt-edit-popover__help">
                {t("openwrt.daemon.endpointHelp")}
              </p>
            </>
          ) : (
            <>
              <DaemonField
                label={t("openwrt.daemon.proxyUrl")}
                htmlFor="owt-upstreamProxy"
              >
                <div className="owt-field-control">
                  <input
                    id="owt-upstreamProxy"
                    type="text"
                    className="owt-field-input owt-field-input--mono"
                    value={proxyDraft}
                    placeholder="http://host:port or socks5://host:port"
                    onChange={(event) => {
                      setProxyDraft(event.target.value);
                      setProxyStatus("idle");
                      setProxyError(null);
                    }}
                  />
                  <button
                    type="button"
                    className="owt-field-check"
                    onClick={() => void recheckProxy()}
                    disabled={proxyStatus === "checking"}
                    title={t("openwrt.daemon.recheckProxy")}
                    aria-label={t("openwrt.daemon.recheckProxy")}
                  >
                    {proxyStatus === "checking" ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <RefreshCcw className="h-4 w-4" />
                    )}
                  </button>
                </div>
              </DaemonField>
              <p
                className={`owt-edit-popover__help${
                  proxyStatus === "fail" ? " owt-edit-popover__help--fail" : ""
                }`}
              >
                {proxyStatus === "fail"
                  ? proxyError || t("openwrt.daemon.proxyUnreachable")
                  : proxyStatus === "ok"
                    ? t("openwrt.daemon.proxyReachable")
                    : t("openwrt.daemon.proxyHelp")}
              </p>
            </>
          )}

          <div className="owt-edit-popover__foot">
            <button
              type="button"
              className="owt-pill owt-pill--idle"
              onClick={() => setEditTarget(null)}
            >
              {t("common.cancel")}
            </button>
            <button
              type="button"
              className="owt-pill owt-pill--primary"
              onClick={savePopover}
            >
              {t("common.save")}
            </button>
          </div>
        </div>
      ) : null}

      <div className="owt-daemon-divider" />

      {/*
        Whole-app Backup & restore admin row. The buttons stay disabled until
        the daemon capability probe confirms that the archive endpoints are
        available.
      */}
      <section
        className="owt-admin-row"
        data-backend-status={backupBackendStatus}
        aria-label={t("openwrt.daemon.backupRestore.ariaLabel")}
      >
        <div className="owt-admin-row__label">
          <Database
            className="owt-admin-row__leading-icon"
            aria-hidden="true"
          />
          <span className="owt-admin-row__label-stack">
            <span className="owt-admin-row__title">
              {t("openwrt.daemon.backupRestore.title")}
            </span>
            <span className="owt-admin-row__sub">
              {t("openwrt.daemon.backupRestore.lastBackupNever")}
            </span>
          </span>
        </div>

        <div className="owt-admin-row__meta">
          <span
            className="owt-admin-row__pending"
            tabIndex={0}
            data-tip={t(
              `openwrt.daemon.backupRestore.backendStatus.${backupBackendStatus}.tip`,
            )}
            aria-label={t(
              `openwrt.daemon.backupRestore.backendStatus.${backupBackendStatus}.aria`,
            )}
          >
            {backupBackendStatus === "available" ? (
              <CheckCircle2 className="h-3 w-3" aria-hidden="true" />
            ) : (
              <CircleAlert className="h-3 w-3" aria-hidden="true" />
            )}
            {t(
              `openwrt.daemon.backupRestore.backendStatus.${backupBackendStatus}.label`,
            )}
          </span>
          <span
            className="owt-admin-row__secret"
            tabIndex={0}
            data-tip={t("openwrt.daemon.backupRestore.includesCredentialsTip")}
            aria-label={t(
              "openwrt.daemon.backupRestore.includesCredentialsAria",
            )}
          >
            <Lock className="h-3 w-3" aria-hidden="true" />
            {t("openwrt.daemon.backupRestore.includesCredentials")}
          </span>
        </div>

        <span className="owt-admin-row__spacer" aria-hidden="true" />

        <div className="owt-admin-row__actions">
          <input
            ref={restoreInputRef}
            type="file"
            accept=".tar,.tar.gz,.tgz,application/gzip,application/x-tar"
            hidden
            onChange={(event) => {
              const file = event.currentTarget.files?.[0];
              if (file) void handleRestoreFile(file);
            }}
          />
          <button
            type="button"
            className="owt-pill owt-pill--idle"
            disabled={!backupRestoreAvailable}
            data-tip-disabled={backupRestoreAvailable ? undefined : backupDisabledTip}
            onClick={() => restoreInputRef.current?.click()}
          >
            <Upload className="h-4 w-4" aria-hidden="true" />
            {t("openwrt.daemon.backupRestore.restoreAction")}
          </button>
          <button
            type="button"
            className="owt-pill owt-pill--primary"
            disabled={!backupRestoreAvailable}
            data-tip-disabled={backupRestoreAvailable ? undefined : backupDisabledTip}
            onClick={() => void handleDownloadConfigBackup()}
          >
            <Download className="h-4 w-4" aria-hidden="true" />
            {t("openwrt.daemon.backupRestore.downloadAction")}
          </button>
        </div>
      </section>

      <details
        className="owt-log-drawer"
        onToggle={(event) => setLogDrawerOpen(event.currentTarget.open)}
      >
        <summary className="owt-log-drawer__summary">
          <ChevronRight className="owt-log-drawer__chevron h-4 w-4" />
          <span className="owt-log-drawer__title">
            {t("openwrt.daemon.logs.title")}
          </span>
          <label
            className="owt-chip-select owt-log-drawer__loglevel"
            onClick={(event) => event.stopPropagation()}
          >
            <select
              value={draft.logLevel}
              onChange={(event) =>
                onDraftChange("logLevel", event.target.value)
              }
              aria-label={t("openwrt.daemon.logLevel")}
            >
              {logLevelOptions.map((level) => (
                <option key={level} value={level}>
                  {capitalize(level)}
                </option>
              ))}
            </select>
          </label>
          <span className="owt-log-drawer__spacer" aria-hidden="true" />
          <span className="owt-log-drawer__freshness">{logFreshness}</span>
          <button
            type="button"
            className="owt-pill owt-log-drawer__refresh"
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              void refreshLogs();
            }}
            disabled={logLoading}
            title={t("openwrt.daemon.logs.refresh")}
          >
            {logLoading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <RefreshCcw className="h-4 w-4" />
            )}
            {t("openwrt.daemon.logs.refresh")}
          </button>
        </summary>

        <div
          ref={logViewerRef}
          className="owt-log-viewer"
          tabIndex={0}
          aria-label={t("openwrt.daemon.logs.viewerAria")}
        >
          {logError ? (
            <div className="owt-log-viewer__empty" data-tone="fail">
              {logError}
            </div>
          ) : logTail && logTail.entries.length ? (
            <pre className="owt-log-viewer__pre">
              {logTail.entries.map((line, index) => {
                const parsed = splitLogLine(line);

                return (
                  <span
                    // Log output is append-only text; index is stable enough for this bounded tail view.
                    key={`${index}-${line.slice(0, 24)}`}
                    className="owt-log-viewer__line"
                    data-tone={getLogLineTone(line)}
                  >
                    {parsed ? (
                      <>
                        <span className="owt-log-viewer__timestamp">
                          {parsed.timestamp}
                        </span>{" "}
                        <span
                          className="owt-log-viewer__level"
                          data-level={parsed.level.toLowerCase()}
                        >
                          {parsed.level}
                        </span>{" "}
                        <span className="owt-log-viewer__message">
                          {parsed.message}
                        </span>
                      </>
                    ) : (
                      line
                    )}
                    {"\n"}
                  </span>
                );
              })}
            </pre>
          ) : (
            <div className="owt-log-viewer__empty">
              {t("openwrt.daemon.logs.empty")}
            </div>
          )}
        </div>
      </details>
    </div>
  );
}
