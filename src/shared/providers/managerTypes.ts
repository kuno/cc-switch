import type { ProviderPlatformAdapter } from "./domain";
import type { SharedProviderAppId } from "./domain";

export type SharedProviderMutationAction = "saved" | "activated" | "deleted";

export interface SharedProviderMutationEvent {
  action: SharedProviderMutationAction;
  appId: SharedProviderAppId;
  providerId: string | null;
  providerName: string;
  requiresServiceRestart: boolean;
}

export interface SharedProviderShellState {
  serviceName?: string;
  serviceStatusLabel?: string | null;
  restartPending?: boolean;
  restartInFlight?: boolean;
}

export interface SharedProviderManagerProps {
  adapter: ProviderPlatformAdapter;
  appIds?: SharedProviderAppId[];
  selectedApp?: SharedProviderAppId;
  defaultApp?: SharedProviderAppId;
  onSelectedAppChange?: (appId: SharedProviderAppId) => void;
  onRestartRequired?: (event: SharedProviderMutationEvent) => void;
  shellState?: SharedProviderShellState;
  className?: string;
}
