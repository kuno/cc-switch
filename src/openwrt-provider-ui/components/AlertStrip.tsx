import type { TFunction } from "i18next";
import { Loader2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
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

function getRestartFailureDetail(
  message: OpenWrtPageMessage | null,
  t: TFunction,
): string {
  const text = message?.text?.trim();

  if (!text) {
    return t("openwrt.alertStrip.restartFailureDetail");
  }

  if (/^failed to restart service\.?$/i.test(text)) {
    return t("openwrt.alertStrip.restartFailureDetail");
  }

  return text.replace(/^restart failed:\s*/i, "");
}

function getAlertContent(
  variant: AlertStripVariant,
  host: OpenWrtHostState,
  message: OpenWrtPageMessage | null,
  t: TFunction,
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
        title: t("openwrt.alertStrip.restartingTitle"),
        detail: t("openwrt.alertStrip.restartingDetail", { endpoint }),
        actionLabel: null,
      };
    case "restart-failed":
      return {
        title: t("openwrt.alertStrip.restartFailedTitle"),
        detail: getRestartFailureDetail(message, t),
        actionLabel: t("openwrt.alertStrip.retryRestart"),
      };
    case "unreachable":
      return {
        title: t("openwrt.alertStrip.daemonNotReachableTitle"),
        detail: proxy
          ? t("openwrt.alertStrip.daemonNotReachableWithProxy", {
              endpoint,
              proxy,
            })
          : t("openwrt.alertStrip.daemonNotReachableNoProxy", { endpoint }),
        actionLabel: t("openwrt.alertStrip.restartNow"),
      };
    case "stopped":
    default:
      return {
        title: t("openwrt.alertStrip.daemonStoppedTitle"),
        detail: t("openwrt.alertStrip.daemonStoppedDetail"),
        actionLabel: t("openwrt.alertStrip.restartNow"),
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
  const { t } = useTranslation();
  const previousRestartInFlightRef = useRef(restartInFlight);
  const [restartFailureDetail, setRestartFailureDetail] = useState<
    string | null
  >(() =>
    isRestartFailureMessage(message) ? getRestartFailureDetail(message, t) : null,
  );

  useEffect(() => {
    if (restartInFlight) {
      setRestartFailureDetail(null);
      previousRestartInFlightRef.current = true;
      return;
    }

    if (previousRestartInFlightRef.current && message?.kind === "error") {
      setRestartFailureDetail(getRestartFailureDetail(message, t));
    } else if (isRestartFailureMessage(message)) {
      setRestartFailureDetail(getRestartFailureDetail(message, t));
    } else if (message?.kind !== "error") {
      setRestartFailureDetail(null);
    }

    previousRestartInFlightRef.current = false;
  }, [message, restartInFlight, t]);

  const variant: AlertStripVariant | null = restartInFlight
    ? "restarting"
    : restartFailureDetail
      ? "restart-failed"
      : !isRunning || host.status !== "running"
        ? "stopped"
        : host.health === "degraded"
          ? "unreachable"
          : null;

  if (!variant) {
    return null;
  }

  const content = getAlertContent(
    variant,
    host,
    restartFailureDetail
      ? { kind: "error", text: restartFailureDetail }
      : message,
    t,
  );

  return (
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
          <span className="owt-alert-strip__dot" />
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
    </div>
  );
}
