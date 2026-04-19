import type { SharedRuntimeProviderHealth } from "../domain";
import {
  getSharedRuntimeHealthLabel,
  getSharedRuntimeHealthTone,
} from "./presentation";
import { SharedRuntimeStatusChip } from "./SharedRuntimeStatusChip";

export function SharedRuntimeHealthBadge({
  health,
  label,
  className,
}: {
  health: SharedRuntimeProviderHealth | null | undefined;
  label?: string;
  className?: string;
}) {
  return (
    <SharedRuntimeStatusChip
      label={label ?? getSharedRuntimeHealthLabel(health)}
      tone={getSharedRuntimeHealthTone(health)}
      className={className}
    />
  );
}
