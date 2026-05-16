import { AlertTriangle, CheckCircle2, Info, Loader2, X } from "lucide-react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";

export type AppNotificationKind = "success" | "info" | "warning" | "error";

export interface AppNotification {
  action?: {
    disabled?: boolean;
    label: string;
    onClick: () => void;
  };
  busy?: boolean;
  detail: string;
  id: string;
  kind: AppNotificationKind;
  title: string;
}

export interface AppNotificationStackProps {
  notifications: AppNotification[];
  onDismiss: (id: string) => void;
}

function NotificationIcon({
  busy,
  kind,
}: {
  busy?: boolean;
  kind: AppNotificationKind;
}): ReactNode {
  if (busy) return <Loader2 className="h-4 w-4 animate-spin" />;
  if (kind === "success") return <CheckCircle2 className="h-4 w-4" />;
  if (kind === "info") return <Info className="h-4 w-4" />;
  return <AlertTriangle className="h-4 w-4" />;
}

export function AppNotificationStack({
  notifications,
  onDismiss,
}: AppNotificationStackProps) {
  const { t } = useTranslation();

  if (!notifications.length) {
    return null;
  }

  return (
    <div className="owt-notification-stack" data-slot="app-notifications">
      {notifications.map((notification) => (
        <div
          key={notification.id}
          className={`owt-notification-popup owt-notification-popup--${notification.kind}`}
          role={notification.kind === "error" ? "alert" : "status"}
          aria-live={notification.kind === "error" ? "assertive" : "polite"}
          aria-busy={notification.busy === true}
        >
          <div className="owt-notification-popup__icon" aria-hidden="true">
            <NotificationIcon
              busy={notification.busy}
              kind={notification.kind}
            />
          </div>

          <div className="owt-notification-popup__copy">
            <strong>{notification.title}</strong>
            <span>{notification.detail}</span>
          </div>

          {notification.action ? (
            <button
              type="button"
              className="owt-notification-popup__action"
              onClick={notification.action.onClick}
              disabled={notification.action.disabled}
            >
              {notification.action.label}
            </button>
          ) : null}

          <button
            type="button"
            className="owt-notification-popup__close"
            onClick={() => onDismiss(notification.id)}
            aria-label={t("common.close")}
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      ))}
    </div>
  );
}
