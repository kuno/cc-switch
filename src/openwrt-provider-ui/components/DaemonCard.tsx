import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  CheckCircle2,
  ChevronRight,
  Globe2,
  Loader2,
  Pencil,
  PlugZap,
  RefreshCcw,
  Save,
} from "lucide-react";
import type { TFunction } from "i18next";
import { useTranslation } from "react-i18next";
import type {
  OpenWrtDaemonLogTail,
  OpenWrtHostConfigPayload,
  OpenWrtHostState,
  OpenWrtOutboundProxyTestResult,
} from "../pageTypes";

const DEFAULT_LOG_LEVELS = ["error", "warn", "info", "debug", "trace"];
const LOG_TAIL_LINES = 80;
const LOG_TAIL_MAX_BYTES = 32768;

type EditTarget = "endpoint" | "proxy" | null;
type ProxyStatus = "idle" | "ok" | "fail" | "checking";

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

  async function refreshLogs() {
    if (typeof onLoadDaemonLogTail !== "function") {
      setLogError(t("openwrt.daemon.logs.unavailable"));
      return;
    }

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
      setLogLoading(false);
    }
  }

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
          <span className="owt-daemon-status__dot" aria-hidden="true" />
          {statusLabel}
        </div>

        <span
          className="owt-daemon-health owt-status-pill"
          data-tone={healthTone}
        >
          <span className="owt-status-pill__dot" aria-hidden="true" />
          {healthLabel}
        </span>

        <span className="owt-daemon-row__spacer" aria-hidden="true" />

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

      <div className="owt-daemon-summary">
        <span className="owt-daemon-summary__segment">
          <Globe2 className="h-4 w-4" aria-hidden="true" />
          <span className="owt-daemon-summary__label">
            {t("openwrt.daemon.listeningOn")}
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

        <span className="owt-daemon-summary__sep" aria-hidden="true">
          ·
        </span>

        <span className="owt-daemon-summary__segment">
          <PlugZap className="h-4 w-4" aria-hidden="true" />
          <span className="owt-daemon-summary__label">
            {t("openwrt.daemon.upstreamProxy")}
          </span>
          <button
            type="button"
            className={`owt-inline-token${
              proxyStatus === "fail" ? " owt-inline-token--fail" : ""
            }${
              proxyStatus === "checking" ? " owt-inline-token--checking" : ""
            }`}
            onClick={() => setEditTarget(editTarget === "proxy" ? null : "proxy")}
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

      <details className="owt-log-drawer">
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
