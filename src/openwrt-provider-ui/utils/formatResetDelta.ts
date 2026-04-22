export function formatResetDelta(
  resetUnixSeconds: number | null | undefined,
): string {
  if (resetUnixSeconds == null) {
    return "";
  }

  const deltaSeconds = Math.trunc(resetUnixSeconds - Date.now() / 1000);

  if (deltaSeconds <= 0) {
    return "now";
  }

  const hours = Math.floor(deltaSeconds / 3600);
  const minutes = Math.floor((deltaSeconds % 3600) / 60);

  if (hours > 0) {
    return `${hours}h${minutes}m`;
  }

  return `${minutes}m`;
}
