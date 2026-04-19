import type { ReactNode } from "react";
import { Loader2, RefreshCcw, Save } from "lucide-react";
import type {
  OpenWrtHostConfigPayload,
  OpenWrtHostState,
  OpenWrtPageMessage,
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
  message: OpenWrtPageMessage | null;
  messageToneClass: string;
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

function getStatusLabel(isRunning: boolean): string {
  return isRunning ? "Running" : "Stopped";
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
  message,
  messageToneClass,
  onDraftChange,
  onSave,
  onRestart,
}: DaemonCardProps) {
  const statusLabel = getStatusLabel(isRunning);
  const healthLabel = getHealthLabel(host.health);
  const healthTone = getHealthTone(host.health);
  const logLevelOptions = getLogLevelOptions(draft.logLevel);

  return (
    <div
      className="owt-daemon-card"
      aria-label={host.serviceLabel || "Daemon control"}
    >
      {/* Single top row: status · health · log-level select · spacer · Restart · Save */}
      <div className="owt-daemon-row">
        <div
          className="owt-daemon-status"
          data-running={isRunning ? "true" : "false"}
        >
          <span className="owt-daemon-status__dot" aria-hidden="true" />
          {statusLabel}
        </div>

        <span
          className="owt-daemon-health owt-chip owt-chip--dot"
          data-tone={healthTone}
        >
          {healthLabel}
        </span>

        <label className="owt-chip-select">
          <select
            value={draft.logLevel}
            onChange={(event) => onDraftChange("logLevel", event.target.value)}
            aria-label="Log level"
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
          {restartInFlight ? "Restarting…" : "Restart"}
        </button>

        <button
          type="button"
          className={
            isDirty
              ? "owt-pill owt-pill--primary"
              : "owt-pill owt-pill--idle"
          }
          onClick={onSave}
          disabled={!isDirty || saveInFlight}
          title="Persist current daemon config"
        >
          {saveInFlight ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Save className="h-4 w-4" />
          )}
          {saveInFlight ? "Saving…" : "Save"}
        </button>
      </div>

      {message ? (
        <div className={`ccswitch-openwrt-page-note ${messageToneClass}`}>
          {message.text}
        </div>
      ) : null}

      <div className="owt-daemon-divider" />

      {/* Flat 4-column grid — no inner sub-cards */}
      <div className="owt-daemon-grid">
        <DaemonField label="Listen address" htmlFor="owt-listenAddr">
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

        <DaemonField label="Listen port" htmlFor="owt-listenPort">
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

        <DaemonField label="HTTP proxy" htmlFor="owt-httpProxy">
          <input
            id="owt-httpProxy"
            type="text"
            className="owt-field-input owt-field-input--mono"
            value={draft.httpProxy}
            onChange={(event) => onDraftChange("httpProxy", event.target.value)}
          />
        </DaemonField>

        <DaemonField label="HTTPS proxy" htmlFor="owt-httpsProxy">
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
