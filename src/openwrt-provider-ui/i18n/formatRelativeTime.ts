import i18n from "./index";

const RELATIVE_TIME_THRESHOLD_MS = 60_000;
const ABSOLUTE_TIME_THRESHOLD_MS = 7 * 24 * 60 * 60 * 1000;

function normalizeEpochMs(value: number): number {
  if (!Number.isFinite(value) || value <= 0) {
    return 0;
  }

  return value > 1_000_000_000_000 ? value : value * 1000;
}

export function formatRelativeTime(
  epochMs: number,
  now: number = Date.now(),
): string {
  const normalizedEpochMs = normalizeEpochMs(epochMs);

  if (!normalizedEpochMs) {
    return i18n.t("openwrt.activity.unknownTime");
  }

  const diffMs = now - normalizedEpochMs;

  if (diffMs < RELATIVE_TIME_THRESHOLD_MS) {
    return i18n.t("openwrt.activity.justNow");
  }

  const lang = i18n.language || "en";

  if (diffMs > ABSOLUTE_TIME_THRESHOLD_MS) {
    return new Intl.DateTimeFormat(lang, {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    }).format(new Date(normalizedEpochMs));
  }

  const rtf = new Intl.RelativeTimeFormat(lang, { numeric: "auto" });
  const minutes = Math.round(-diffMs / 60_000);

  if (Math.abs(minutes) < 60) {
    return rtf.format(minutes, "minute");
  }

  const hours = Math.round(minutes / 60);

  if (Math.abs(hours) < 24) {
    return rtf.format(hours, "hour");
  }

  const days = Math.round(hours / 24);

  return rtf.format(days, "day");
}
