import { cn } from "@/lib/utils";
import {
  SHARED_RUNTIME_CHIP_CLASSNAMES,
  type SharedRuntimeChipTone,
} from "./presentation";

export function SharedRuntimeStatusChip({
  label,
  tone,
  className,
}: {
  label: string;
  tone: SharedRuntimeChipTone;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-medium",
        SHARED_RUNTIME_CHIP_CLASSNAMES[tone],
        className,
      )}
    >
      {label}
    </span>
  );
}
