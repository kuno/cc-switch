import { useEffect, useMemo, useState } from "react";
import type { MutableRefObject } from "react";
import type { OpenWrtSharedPageShellApi } from "../pageTypes";
import { ActivitySidePanel } from "./ActivitySidePanel";

export interface ActivityDrawerHostHandle {
  close: () => void;
  openForApp: (appId: string | null) => void;
}

export interface ActivityDrawerHostProps {
  shell: OpenWrtSharedPageShellApi;
  shellRef?: MutableRefObject<ActivityDrawerHostHandle | null>;
  onOpenChange?: (open: boolean) => void;
}

export function ActivityDrawerHost({
  shell,
  shellRef,
  onOpenChange,
}: ActivityDrawerHostProps) {
  const [open, setOpen] = useState(false);
  const [appId, setAppId] = useState<string | null>(null);
  const handle = useMemo<ActivityDrawerHostHandle>(
    () => ({
      close() {
        setOpen(false);
      },
      openForApp(nextAppId) {
        setAppId(nextAppId);
        setOpen(true);
      },
    }),
    [],
  );

  useEffect(() => {
    onOpenChange?.(open);
  }, [onOpenChange, open]);

  useEffect(() => {
    if (!shellRef) {
      return;
    }

    shellRef.current = handle;

    return () => {
      if (shellRef.current === handle) {
        shellRef.current = null;
      }
    };
  }, [handle, shellRef]);

  return (
    <ActivitySidePanel
      open={open}
      appId={appId}
      showScrim={false}
      onClose={() => {
        setOpen(false);
      }}
      shell={shell}
    />
  );
}
