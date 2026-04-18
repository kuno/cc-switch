import { AlertTriangle, Loader2 } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { OpenWrtHostState, OpenWrtPageMessage } from "../pageTypes";

type AlertStripVariant =
  | "stopped"
  | "unreachable"
  | "restarting"
  | "restart-failed";

export interface AlertStripProps {
  host: OpenWrtHostState;
  isRunning: boolean;
  restartInFlight: boolean;
  message: OpenWrtPageMessage | null;
  onRestart: () => void;
}

function getListenEndpoint(host: OpenWrtHostState): string {
  const address = host.listenAddr.trim() || "0.0.0.0";
  const port = host.listenPort.trim() || "15721";

  return `${address}:${port}`;
}

function getRestartFailureDetail(message: OpenWrtPageMessage | null): string {
  const text = message?.text?.trim();

  if (!text) {
    return "The router daemon did not acknowledge the restart request.";
  }

  if (/^failed to restart service\.?$/i.test(text)) {
    return "The router daemon did not acknowledge the restart request.";
  }

  return text.replace(/^restart failed:\s*/i, "");
}

function getAlertContent(
  variant: AlertStripVariant,
  host: OpenWrtHostState,
  message: OpenWrtPageMessage | null,
): {
  actionLabel: string | null;
  detail: string;
  title: string;
} {
  const endpoint = getListenEndpoint(host);
  const proxy = host.httpProxy.trim() || host.httpsProxy.trim();

  switch (variant) {
    case "restarting":
      return {
        title: "Restarting daemon…",
        detail: `Waiting for OpenWrt to confirm the service at ${endpoint}.`,
        actionLabel: null,
      };
    case "restart-failed":
      return {
        title: "Restart failed:",
        detail: getRestartFailureDetail(message),
        actionLabel: "Retry restart",
      };
    case "unreachable":
      return {
        title: "Daemon not reachable.",
        detail: proxy
          ? `The daemon at ${endpoint} did not respond while proxy routing points to ${proxy}.`
          : `The daemon at ${endpoint} did not respond. Check the service and retry.`,
        actionLabel: "Restart now",
      };
    case "stopped":
    default:
      return {
        title: "Daemon stopped.",
        detail:
          "All app routing is offline until the CC Switch service is restarted.",
        actionLabel: "Restart now",
      };
  }
}

function isRestartFailureMessage(message: OpenWrtPageMessage | null): boolean {
  return message?.kind === "error" && /restart/i.test(message.text);
}

export function AlertStrip({
  host,
  isRunning,
  restartInFlight,
  message,
  onRestart,
}: AlertStripProps) {
  const anchorRef = useRef<HTMLSpanElement | null>(null);
  const previousRestartInFlightRef = useRef(restartInFlight);
  const [portalHost, setPortalHost] = useState<HTMLDivElement | null>(null);
  const [restartFailureDetail, setRestartFailureDetail] = useState<
    string | null
  >(() =>
    isRestartFailureMessage(message) ? getRestartFailureDetail(message) : null,
  );

  useLayoutEffect(() => {
    const anchor = anchorRef.current;
    const slot = anchor?.parentElement;
    const main = slot?.parentElement;

    if (!slot || !main) {
      return;
    }

    const hostElement = document.createElement("div");
    hostElement.className = "owt-alert-strip-host";
    main.insertBefore(hostElement, slot);
    slot.hidden = true;
    setPortalHost(hostElement);

    return () => {
      slot.hidden = false;
      hostElement.remove();
    };
  }, []);

  useEffect(() => {
    if (restartInFlight) {
      setRestartFailureDetail(null);
      previousRestartInFlightRef.current = true;
      return;
    }

    if (previousRestartInFlightRef.current && message?.kind === "error") {
      setRestartFailureDetail(getRestartFailureDetail(message));
    } else if (isRestartFailureMessage(message)) {
      setRestartFailureDetail(getRestartFailureDetail(message));
    } else if (message?.kind !== "error") {
      setRestartFailureDetail(null);
    }

    previousRestartInFlightRef.current = false;
  }, [message, restartInFlight]);

  const variant: AlertStripVariant | null = restartInFlight
    ? "restarting"
    : restartFailureDetail
      ? "restart-failed"
      : !isRunning || host.status !== "running"
        ? "stopped"
        : host.health === "degraded"
          ? "unreachable"
          : null;

  useLayoutEffect(() => {
    if (!portalHost) {
      return;
    }

    portalHost.hidden = variant == null;
  }, [portalHost, variant]);

  const content = getAlertContent(
    variant ?? "stopped",
    host,
    restartFailureDetail
      ? { kind: "error", text: restartFailureDetail }
      : message,
  );

  return (
    <>
      <span ref={anchorRef} hidden aria-hidden="true" />
      {portalHost && variant
        ? createPortal(
            <div
              className={`owt-alert-strip owt-alert-strip--${variant}`}
              role={variant === "restart-failed" ? "alert" : "status"}
              aria-live={variant === "restart-failed" ? "assertive" : "polite"}
              aria-busy={restartInFlight}
            >
              <div className="owt-alert-strip__icon" aria-hidden="true">
                {variant === "restarting" ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <AlertTriangle className="h-4 w-4" />
                )}
              </div>

              <div className="owt-alert-strip__copy">
                <strong>{content.title}</strong>
                <span>{content.detail}</span>
              </div>

              {content.actionLabel ? (
                <button
                  type="button"
                  className="owt-alert-strip__action"
                  onClick={onRestart}
                  disabled={restartInFlight}
                >
                  {content.actionLabel}
                </button>
              ) : null}
            </div>,
            portalHost,
          )
        : null}
    </>
  );
}
