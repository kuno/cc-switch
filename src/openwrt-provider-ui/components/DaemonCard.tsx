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

function getStatusLabel(isRunning: boolean): string {
  return isRunning ? "Running" : "Stopped";
}

function getStatusHint({
  health,
  isRunning,
  restartInFlight,
  restartPending,
}: Pick<DaemonCardProps, "isRunning" | "restartInFlight" | "restartPending"> & {
  health: OpenWrtHostState["health"];
}): string {
  if (restartInFlight) {
    return "Restarting daemon now.";
  }

  if (restartPending) {
    return "Restart pending to apply provider changes.";
  }

  if (!isRunning || health === "stopped") {
    return "Daemon is stopped. Saved configuration remains available below.";
  }

  if (health === "healthy") {
    return "Daemon is accepting traffic on the configured listener.";
  }

  if (health === "degraded") {
    return "Daemon is reachable, but health checks report degraded service.";
  }

  return "Daemon status could not be fully confirmed. Review connection settings.";
}

function getVersionLabel(version: string): string {
  const trimmed = version.trim();

  return trimmed ? `Version ${trimmed}` : "Version unavailable";
}

function getLogLevelOptions(value: string): string[] {
  if (!value.trim() || DEFAULT_LOG_LEVELS.includes(value)) {
    return DEFAULT_LOG_LEVELS;
  }

  return [value, ...DEFAULT_LOG_LEVELS];
}

function DaemonField({
  children,
  label,
}: {
  children: ReactNode;
  label: string;
}) {
  return (
    <label className="owt-daemon-field">
      <span className="owt-daemon-field__label">{label}</span>
      {children}
    </label>
  );
}

export function DaemonCard({
  host,
  draft,
  isRunning,
  isDirty,
  saveInFlight,
  restartInFlight,
  restartPending,
  message,
  messageToneClass,
  onDraftChange,
  onSave,
  onRestart,
}: DaemonCardProps) {
  const statusLabel = getStatusLabel(isRunning);
  const healthLabel = getHealthLabel(host.health);
  const healthTone = getHealthTone(host.health);
  const versionLabel = getVersionLabel(host.version);
  const statusHint = getStatusHint({
    health: host.health,
    isRunning,
    restartInFlight,
    restartPending,
  });
  const logLevelOptions = getLogLevelOptions(draft.logLevel);

  return (
    <div
      className="owt-daemon-card"
      aria-label={host.serviceLabel || "Daemon control"}
    >
      <div className="owt-daemon-card__top">
        <div className="owt-daemon-card__intro">
          <p className="owt-daemon-card__eyebrow">{host.serviceLabel}</p>
          <div className="owt-daemon-card__status-row">
            <span
              className="owt-daemon-status"
              data-running={isRunning ? "true" : "false"}
            >
              <span className="owt-daemon-status__dot" aria-hidden="true" />
              {statusLabel}
            </span>
            <span className="owt-daemon-health" data-tone={healthTone}>
              {healthLabel}
            </span>
            <span
              className="owt-daemon-version"
              title={`Daemon version ${versionLabel}`}
            >
              {versionLabel}
            </span>
          </div>
          <p className="owt-daemon-card__hint">{statusHint}</p>
        </div>

        <button
          type="button"
          className="owt-daemon-button"
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
      </div>

      {message ? (
        <div className={`ccswitch-openwrt-page-note ${messageToneClass}`}>
          {message.text}
        </div>
      ) : null}

      <div className="owt-daemon-divider" />

      <div className="owt-daemon-grid">
        <DaemonField label="Listen address">
          <input
            type="text"
            className="owt-daemon-control owt-daemon-control--mono"
            value={draft.listenAddr}
            onChange={(event) =>
              onDraftChange("listenAddr", event.target.value)
            }
          />
        </DaemonField>

        <DaemonField label="Listen port">
          <input
            type="text"
            inputMode="numeric"
            className="owt-daemon-control owt-daemon-control--mono"
            value={draft.listenPort}
            onChange={(event) =>
              onDraftChange("listenPort", event.target.value)
            }
          />
        </DaemonField>

        <DaemonField label="HTTP proxy">
          <input
            type="text"
            className="owt-daemon-control owt-daemon-control--mono"
            value={draft.httpProxy}
            onChange={(event) => onDraftChange("httpProxy", event.target.value)}
          />
        </DaemonField>

        <DaemonField label="HTTPS proxy">
          <input
            type="text"
            className="owt-daemon-control owt-daemon-control--mono"
            value={draft.httpsProxy}
            onChange={(event) =>
              onDraftChange("httpsProxy", event.target.value)
            }
          />
        </DaemonField>

        <DaemonField label="Log level">
          <select
            className="owt-daemon-control"
            value={draft.logLevel}
            onChange={(event) => onDraftChange("logLevel", event.target.value)}
          >
            {logLevelOptions.map((level) => (
              <option key={level} value={level}>
                {level}
              </option>
            ))}
          </select>
        </DaemonField>

        <div className="owt-daemon-actions">
          <button
            type="button"
            className="owt-daemon-button owt-daemon-button--primary"
            onClick={onSave}
            disabled={!isDirty || saveInFlight}
          >
            {saveInFlight ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Save className="h-4 w-4" />
            )}
            {saveInFlight ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}
