import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createRoot } from "react-dom/client";
import { SharedProviderManager } from "./SharedProviderManager";
import type { SharedProviderManagerProps } from "./managerTypes";

export interface MountedSharedProviderManager {
  update(nextProps: SharedProviderManagerProps): void;
  unmount(): void;
}

export function createSharedProviderManagerQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        refetchOnWindowFocus: false,
      },
      mutations: {
        retry: false,
      },
    },
  });
}

export function mountSharedProviderManager(
  container: Element | DocumentFragment,
  props: SharedProviderManagerProps,
): MountedSharedProviderManager {
  const root = createRoot(container);
  const queryClient = createSharedProviderManagerQueryClient();

  function render(nextProps: SharedProviderManagerProps) {
    root.render(
      <QueryClientProvider client={queryClient}>
        <SharedProviderManager {...nextProps} />
      </QueryClientProvider>,
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
