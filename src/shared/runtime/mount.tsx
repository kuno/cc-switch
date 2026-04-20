import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createRoot } from "react-dom/client";
import { PortalContainerContext } from "@/shared/contexts/PortalContainerContext";
import {
  SharedRuntimeSurface,
  type SharedRuntimeSurfaceProps,
} from "./SharedRuntimeSurface";

export interface MountedSharedRuntimeSurface {
  update(nextProps: SharedRuntimeSurfaceProps): void;
  unmount(): void;
}

export function createSharedRuntimeSurfaceQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        refetchOnWindowFocus: false,
      },
    },
  });
}

export function mountSharedRuntimeSurface(
  container: Element | DocumentFragment,
  props: SharedRuntimeSurfaceProps,
  portalContainer: HTMLElement | null = null,
): MountedSharedRuntimeSurface {
  const root = createRoot(container);
  const queryClient = createSharedRuntimeSurfaceQueryClient();

  function render(nextProps: SharedRuntimeSurfaceProps) {
    root.render(
      <PortalContainerContext.Provider value={portalContainer}>
        <QueryClientProvider client={queryClient}>
          <SharedRuntimeSurface {...nextProps} />
        </QueryClientProvider>
      </PortalContainerContext.Provider>,
    );
  }

  render(props);

  return {
    update(nextProps) {
      render(nextProps);
    },
    unmount() {
      root.unmount();
      queryClient.clear();
    },
  };
}
