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
  Download,
  Globe2,
  AlertTriangle,
  Loader2,
  Pencil,
  PlugZap,
  RefreshCcw,
  Save,
  Trash2,
  Upload,
} from "lucide-react";
import type { TFunction } from "i18next";
import { useTranslation } from "react-i18next";
import type {
  OpenWrtDaemonLogTail,
  OpenWrtBackupEntry,
  OpenWrtBackupList,
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
type BackupOperation =
  | "list"
  | "create"
  | "download"
  | "import"
  | "restore"
  | "delete"
  | null;
type PendingBackupAction = {
  filename: string;
  kind: "delete" | "restore";
} | null;

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

function formatBackupSize(sizeBytes: number, t: TFunction): string {
  if (!Number.isFinite(sizeBytes) || sizeBytes < 0) {
    return t("openwrt.daemon.backups.unknownSize");
  }

  if (sizeBytes < 1024) {
    return t("openwrt.daemon.backups.sizeBytes", { value: sizeBytes });
  }

  if (sizeBytes < 1024 * 1024) {
    return t("openwrt.daemon.backups.sizeKilobytes", {
      value: (sizeBytes / 1024).toFixed(1),
    });
  }

  return t("openwrt.daemon.backups.sizeMegabytes", {
    value: (sizeBytes / 1024 / 1024).toFixed(2),
  });
}

function formatBackupTime(value: string, t: TFunction): string {
  const timestamp = Date.parse(value);

  if (!Number.isFinite(timestamp)) {
    return t("openwrt.daemon.backups.unknownTime");
  }

  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(timestamp));
}

function schemaLabel(
  schemaVersion: number | null | undefined,
  supportedSchemaVersion: number | null | undefined,
  t: TFunction,
): string {
  const version =
    typeof schemaVersion === "number"
      ? String(schemaVersion)
      : t("openwrt.daemon.backups.unknownSchema");
  const supported =
    typeof supportedSchemaVersion === "number"
      ? String(supportedSchemaVersion)
      : t("common.unknown");

  return t("openwrt.daemon.backups.schemaValue", {
    version,
    supported,
  });
}

function downloadBase64File(filename: string, dataBase64: string) {
  if (typeof window === "undefined" || typeof document === "undefined") {
    return;
  }

  const binary = window.atob(dataBase64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  const blob = new Blob([bytes], { type: "application/octet-stream" });
  const url = window.URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.style.display = "none";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.URL.revokeObjectURL(url);
}

function readFileAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const value = String(reader.result ?? "");
      resolve(value.includes(",") ? value.split(",").pop() ?? "" : value);
    };
    reader.onerror = () => reject(reader.error ?? new Error("read failed"));
    reader.readAsDataURL(file);
  });
}

function isSupportedBackupImportFile(file: File): boolean {
  return /\.(db|sqlite|sqlite3)$/i.test(file.name.trim());
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
  onListBackups,
  onCreateBackup,
  onDownloadBackup,
  onImportBackup,
  onDeleteBackup,
  onRestoreBackup,
  onNotify,
}: DaemonCardProps) {
  const { t } = useTranslation();
  const saveFlashTimeoutRef = useRef<number | null>(null);
  const previousSaveInFlightRef = useRef(saveInFlight);
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
  const [backupDrawerOpen, setBackupDrawerOpen] = useState(false);
  const [backupList, setBackupList] = useState<OpenWrtBackupList | null>(null);
  const [backupError, setBackupError] = useState<string | null>(null);
  const [backupOperation, setBackupOperation] = useState<BackupOperation>(null);
  const [pendingBackupAction, setPendingBackupAction] =
    useState<PendingBackupAction>(null);
  const logViewerRef = useRef<HTMLDivElement | null>(null);
  const importInputRef = useRef<HTMLInputElement | null>(null);
  const logRefreshInFlightRef = useRef(false);
  const backupRefreshInFlightRef = useRef(false);
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
  const destructiveBackupInFlight =
    backupOperation === "restore" || backupOperation === "import";
  const proxyTooltip = useMemo(() => {
    if (proxyStatus === "checking") return t("openwrt.daemon.proxyChecking");
    if (proxyStatus === "ok") return t("openwrt.daemon.proxyReachable");
    if (proxyStatus === "fail") {
      return proxyError || t("openwrt.daemon.proxyUnreachable");
    }
    return t("openwrt.daemon.proxyNotChecked");
  }, [proxyError, proxyStatus, t]);

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

  const refreshBackups = useCallback(async () => {
    if (backupRefreshInFlightRef.current) {
      return;
    }

    if (typeof onListBackups !== "function") {
      setBackupError(t("openwrt.daemon.backups.unavailable"));
      return;
    }

    backupRefreshInFlightRef.current = true;
    setBackupOperation("list");
    setBackupError(null);
    try {
      setBackupList(await onListBackups());
    } catch (error) {
      setBackupError(error instanceof Error ? error.message : String(error));
    } finally {
      backupRefreshInFlightRef.current = false;
      setBackupOperation(null);
    }
  }, [onListBackups, t]);

  async function runBackupOperation<T>(
    operation: BackupOperation,
    action: () => Promise<T>,
    successMessage: string,
  ): Promise<T | null> {
    setBackupOperation(operation);
    setBackupError(null);
    try {
      const result = await action();
      onNotify?.("success", successMessage);
      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setBackupError(message);
      onNotify?.("error", message);
      return null;
    } finally {
      setBackupOperation(null);
    }
  }

  async function createBackup() {
    if (typeof onCreateBackup !== "function") {
      setBackupError(t("openwrt.daemon.backups.unavailable"));
      return;
    }

    const result = await runBackupOperation(
      "create",
      onCreateBackup,
      t("openwrt.daemon.backups.createSuccess"),
    );
    if (result) {
      await refreshBackups();
    }
  }

  async function downloadBackup(filename: string) {
    if (typeof onDownloadBackup !== "function") {
      setBackupError(t("openwrt.daemon.backups.unavailable"));
      return;
    }

    const result = await runBackupOperation(
      "download",
      () => onDownloadBackup(filename),
      t("openwrt.daemon.backups.downloadSuccess"),
    );
    if (result) {
      downloadBase64File(result.filename || filename, result.dataBase64);
    }
  }

  async function importBackup(file: File) {
    if (typeof onImportBackup !== "function") {
      setBackupError(t("openwrt.daemon.backups.unavailable"));
      return;
    }

    if (!isSupportedBackupImportFile(file)) {
      const message = t("openwrt.daemon.backups.invalidImportFile");
      setBackupError(message);
      onNotify?.("error", message);
      return;
    }

    const result = await runBackupOperation(
      "import",
      async () => onImportBackup(file.name || null, await readFileAsBase64(file)),
      t("openwrt.daemon.backups.importSuccess"),
    );
    if (result) {
      await refreshBackups();
    }
  }

  async function deleteBackup(filename: string) {
    if (typeof onDeleteBackup !== "function") {
      setBackupError(t("openwrt.daemon.backups.unavailable"));
      return;
    }

    const result = await runBackupOperation(
      "delete",
      () => onDeleteBackup(filename),
      t("openwrt.daemon.backups.deleteSuccess"),
    );
    if (result) {
      setPendingBackupAction(null);
      await refreshBackups();
    }
  }

  async function restoreBackup(filename: string) {
    if (typeof onRestoreBackup !== "function") {
      setBackupError(t("openwrt.daemon.backups.unavailable"));
      return;
    }

    const result = await runBackupOperation(
      "restore",
      () => onRestoreBackup(filename),
      t("openwrt.daemon.backups.restoreSuccess"),
    );
    if (result) {
      setPendingBackupAction(null);
      await refreshBackups();
    }
  }

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
    if (!backupDrawerOpen || backupList) {
      return;
    }

    void refreshBackups();
  }, [backupDrawerOpen, backupList, refreshBackups]);

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
            disabled={restartInFlight || destructiveBackupInFlight}
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
            disabled={
              !isDirty || saveInFlight || showSaveFlash || destructiveBackupInFlight
            }
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

      <details
        className="owt-backup-drawer"
        onToggle={(event) => setBackupDrawerOpen(event.currentTarget.open)}
      >
        <summary className="owt-log-drawer__summary">
          <ChevronRight className="owt-log-drawer__chevron h-4 w-4" />
          <span className="owt-log-drawer__title">
            {t("openwrt.daemon.backups.title")}
          </span>
          <span className="owt-backup-drawer__scope">
            {t("openwrt.daemon.backups.dbOnly")}
          </span>
          <span className="owt-log-drawer__spacer" aria-hidden="true" />
          {backupList ? (
            <span className="owt-log-drawer__freshness">
              {t("openwrt.daemon.backups.count", {
                count: backupList.backups.length,
              })}
            </span>
          ) : null}
          <button
            type="button"
            className="owt-pill owt-log-drawer__refresh"
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              void refreshBackups();
            }}
            disabled={backupOperation !== null}
            title={t("openwrt.daemon.backups.refresh")}
            aria-label={t("openwrt.daemon.backups.refreshAria")}
          >
            {backupOperation === "list" ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <RefreshCcw className="h-4 w-4" />
            )}
            {t("openwrt.daemon.backups.refresh")}
          </button>
        </summary>

        <div className="owt-backup-drawer__body">
          <div className="owt-backup-drawer__topline">
            <div className="owt-backup-drawer__meta">
              <span>
                {t("openwrt.daemon.backups.databaseFile", {
                  file: backupList?.databaseFile || "cc-switch.db",
                })}
              </span>
              <span>
                {t("openwrt.daemon.backups.currentSchema", {
                  version:
                    backupList?.currentSchemaVersion ??
                    t("common.unknown"),
                  supported:
                    backupList?.supportedSchemaVersion ??
                    t("common.unknown"),
                })}
              </span>
            </div>
            <div className="owt-backup-drawer__actions">
              <input
                ref={importInputRef}
                type="file"
                accept=".db,.sqlite,.sqlite3,application/octet-stream"
                className="owt-visually-hidden"
                onChange={(event) => {
                  const file = event.currentTarget.files?.[0];
                  event.currentTarget.value = "";
                  if (file) void importBackup(file);
                }}
              />
              <button
                type="button"
                className="owt-pill owt-pill--idle"
                disabled={backupOperation !== null}
                onClick={() => importInputRef.current?.click()}
              >
                {backupOperation === "import" ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Upload className="h-4 w-4" />
                )}
                {t("openwrt.daemon.backups.import")}
              </button>
              <button
                type="button"
                className="owt-pill owt-pill--primary"
                disabled={backupOperation !== null}
                onClick={() => void createBackup()}
              >
                {backupOperation === "create" ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Save className="h-4 w-4" />
                )}
                {t("openwrt.daemon.backups.create")}
              </button>
            </div>
          </div>

          <div className="owt-backup-warning" role="note">
            <AlertTriangle className="h-4 w-4" aria-hidden="true" />
            <span>
              {t("openwrt.daemon.backups.restoreScopeDbOnly")}
            </span>
          </div>

          {backupError ? (
            <div className="owt-backup-error" role="alert">
              {backupError}
            </div>
          ) : null}

          {backupOperation === "list" && !backupList ? (
            <div className="owt-backup-empty" role="status">
              <Loader2 className="h-4 w-4 animate-spin" />
              {t("openwrt.daemon.backups.loading")}
            </div>
          ) : backupList && backupList.backups.length ? (
            <div className="owt-backup-list">
              {backupList.backups.map((backup) => (
                <div className="owt-backup-row" key={backup.filename}>
                  <div className="owt-backup-row__main">
                    <span className="owt-backup-row__name">
                      {backup.filename}
                    </span>
                    <span className="owt-backup-row__meta">
                      {formatBackupTime(backup.createdAt, t)} ·{" "}
                      {formatBackupSize(backup.sizeBytes, t)} ·{" "}
                      {schemaLabel(
                        backup.schemaVersion,
                        backup.supportedSchemaVersion,
                        t,
                      )}
                    </span>
                  </div>
                  <div className="owt-backup-row__actions">
                    <button
                      type="button"
                      className="owt-backup-icon-button"
                      disabled={backupOperation !== null}
                      title={t("openwrt.daemon.backups.download")}
                      aria-label={t("openwrt.daemon.backups.downloadNamed", {
                        filename: backup.filename,
                      })}
                      onClick={() => void downloadBackup(backup.filename)}
                    >
                      <Download className="h-4 w-4" />
                    </button>
                    <button
                      type="button"
                      className="owt-backup-icon-button owt-backup-icon-button--restore"
                      disabled={backupOperation !== null}
                      title={t("openwrt.daemon.backups.restore")}
                      aria-label={t("openwrt.daemon.backups.restoreNamed", {
                        filename: backup.filename,
                      })}
                      onClick={() =>
                        setPendingBackupAction({
                          filename: backup.filename,
                          kind: "restore",
                        })
                      }
                    >
                      <RefreshCcw className="h-4 w-4" />
                    </button>
                    <button
                      type="button"
                      className="owt-backup-icon-button owt-backup-icon-button--danger"
                      disabled={backupOperation !== null}
                      title={t("openwrt.daemon.backups.delete")}
                      aria-label={t("openwrt.daemon.backups.deleteNamed", {
                        filename: backup.filename,
                      })}
                      onClick={() =>
                        setPendingBackupAction({
                          filename: backup.filename,
                          kind: "delete",
                        })
                      }
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                  {pendingBackupAction?.filename === backup.filename ? (
                    <div
                      className="owt-backup-confirm"
                      data-kind={pendingBackupAction.kind}
                      role="group"
                      aria-label={
                        pendingBackupAction.kind === "restore"
                          ? t("openwrt.daemon.backups.restoreConfirmTitle", {
                              filename: backup.filename,
                            })
                          : t("openwrt.daemon.backups.deleteConfirmTitle", {
                              filename: backup.filename,
                            })
                      }
                    >
                      <div className="owt-backup-confirm__copy">
                        <strong>
                          {pendingBackupAction.kind === "restore"
                            ? t("openwrt.daemon.backups.restoreConfirmTitle", {
                                filename: backup.filename,
                              })
                            : t("openwrt.daemon.backups.deleteConfirmTitle", {
                                filename: backup.filename,
                              })}
                        </strong>
                        <span>
                          {pendingBackupAction.kind === "restore"
                            ? t("openwrt.daemon.backups.restoreConfirm", {
                                filename: backup.filename,
                              })
                            : t("openwrt.daemon.backups.deleteConfirm", {
                                filename: backup.filename,
                              })}
                        </span>
                      </div>
                      <div className="owt-backup-confirm__actions">
                        <button
                          type="button"
                          className="owt-pill owt-pill--idle"
                          disabled={backupOperation !== null}
                          onClick={() => setPendingBackupAction(null)}
                        >
                          {t("common.cancel")}
                        </button>
                        <button
                          type="button"
                          className={
                            pendingBackupAction.kind === "restore"
                              ? "owt-pill owt-pill--primary"
                              : "owt-pill owt-pill--danger"
                          }
                          disabled={backupOperation !== null}
                          onClick={() =>
                            pendingBackupAction.kind === "restore"
                              ? void restoreBackup(backup.filename)
                              : void deleteBackup(backup.filename)
                          }
                        >
                          {backupOperation === pendingBackupAction.kind ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : pendingBackupAction.kind === "restore" ? (
                            <RefreshCcw className="h-4 w-4" />
                          ) : (
                            <Trash2 className="h-4 w-4" />
                          )}
                          {pendingBackupAction.kind === "restore"
                            ? t("openwrt.daemon.backups.confirmRestore")
                            : t("openwrt.daemon.backups.confirmDelete")}
                        </button>
                      </div>
                    </div>
                  ) : null}
                </div>
              ))}
            </div>
          ) : backupList ? (
            <div className="owt-backup-empty">
              {t("openwrt.daemon.backups.empty")}
            </div>
          ) : null}
        </div>
      </details>

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
