import { useEffect, useRef, useState, type ReactNode } from "react";
import { CheckCircle2, Loader2, RefreshCcw, Save } from "lucide-react";
import type { TFunction } from "i18next";
import { useTranslation } from "react-i18next";
import type {
  OpenWrtHostConfigPayload,
  OpenWrtHostState,
} from "../pageTypes";

const DEFAULT_LOG_LEVELS = ["error", "warn", "info", "debug", "trace"];

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

function getStatusLabel(isRunning: boolean, t: TFunction): string {
  return isRunning
    ? t("openwrt.daemon.status.running")
    : t("openwrt.daemon.status.stopped");
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
    <div className="owt-daemon-field">
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
}: DaemonCardProps) {
  const { t } = useTranslation();
  const saveFlashTimeoutRef = useRef<number | null>(null);
  const previousSaveInFlightRef = useRef(saveInFlight);
  const [showSaveFlash, setShowSaveFlash] = useState(false);
  const statusLabel = getStatusLabel(isRunning, t);
  const healthLabel = restartInFlight
    ? t("openwrt.daemon.restarting")
    : getHealthLabel(host.health, t);
  const healthTone = restartInFlight ? "accent" : getHealthTone(host.health);
  const logLevelOptions = getLogLevelOptions(draft.logLevel);

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

        <label className="owt-chip-select">
          <select
            value={draft.logLevel}
            onChange={(event) => onDraftChange("logLevel", event.target.value)}
            aria-label={t("openwrt.daemon.logLevel")}
          >
            {logLevelOptions.map((level) => (
              <option key={level} value={level}>
                {capitalize(level)}
              </option>
            ))}
          </select>
        </label>

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

      <div className="owt-daemon-divider" />

      <div className="owt-daemon-grid">
        <DaemonField
          label={t("openwrt.daemon.listenAddress")}
          htmlFor="owt-listenAddr"
        >
          <input
            id="owt-listenAddr"
            type="text"
            className="owt-field-input owt-field-input--mono"
            value={draft.listenAddr}
            onChange={(event) =>
              onDraftChange("listenAddr", event.target.value)
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
            value={draft.listenPort}
            onChange={(event) =>
              onDraftChange("listenPort", event.target.value)
            }
          />
        </DaemonField>

        <DaemonField
          label={t("openwrt.daemon.httpProxy")}
          htmlFor="owt-httpProxy"
        >
          <input
            id="owt-httpProxy"
            type="text"
            className="owt-field-input owt-field-input--mono"
            value={draft.httpProxy}
            onChange={(event) => onDraftChange("httpProxy", event.target.value)}
          />
        </DaemonField>

        <DaemonField
          label={t("openwrt.daemon.httpsProxy")}
          htmlFor="owt-httpsProxy"
        >
          <input
            id="owt-httpsProxy"
            type="text"
            className="owt-field-input owt-field-input--mono"
            value={draft.httpsProxy}
            onChange={(event) =>
              onDraftChange("httpsProxy", event.target.value)
            }
          />
        </DaemonField>
      </div>
    </div>
  );
}
