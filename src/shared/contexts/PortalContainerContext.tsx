import { createContext, useContext } from "react";

export const PortalContainerContext = createContext<HTMLElement | null>(null);

PortalContainerContext.displayName = "PortalContainerContext";

export function usePortalContainer(): HTMLElement | null {
  return useContext(PortalContainerContext);
}
