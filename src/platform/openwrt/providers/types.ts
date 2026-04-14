import type {
  SharedProviderAppId,
  SharedProviderCapabilities,
  SharedProviderEditorPayload,
  SharedProviderState,
} from "@/shared/providers/domain";

export interface OpenWrtRpcResult {
  ok?: boolean;
  error?: string;
  message?: string;
  provider?: Record<string, unknown>;
  activeProviderId?: string | null;
  active_provider_id?: string | null;
  providers?: unknown;
  items?: unknown;
  savedProviders?: unknown;
  providerMap?: unknown;
  service?: Record<string, unknown>;
  runtime?: Record<string, unknown>;
  apps?: unknown;
  app?: string;
  providerId?: string | null;
  provider_id?: string | null;
  configured?: boolean;
  baseUrl?: string;
  base_url?: string;
  tokenField?: string;
  token_field?: string;
  failoverQueue?: unknown;
  failover_queue?: unknown;
}

export interface OpenWrtProviderTransport {
  listProviders(appId: SharedProviderAppId): Promise<OpenWrtRpcResult | null>;
  listSavedProviders(
    appId: SharedProviderAppId,
  ): Promise<OpenWrtRpcResult | null>;
  getActiveProvider(appId: SharedProviderAppId): Promise<OpenWrtRpcResult>;
  getProviderFailoverState?(
    appId: SharedProviderAppId,
    providerId: string,
  ): Promise<OpenWrtRpcResult | null>;
  upsertProvider?(
    appId: SharedProviderAppId,
    provider: SharedProviderEditorPayload,
  ): Promise<OpenWrtRpcResult>;
  saveProvider?(
    appId: SharedProviderAppId,
    provider: SharedProviderEditorPayload,
  ): Promise<OpenWrtRpcResult>;
  upsertProviderByProviderId?(
    appId: SharedProviderAppId,
    providerId: string,
    provider: SharedProviderEditorPayload,
  ): Promise<OpenWrtRpcResult>;
  upsertProviderById?(
    appId: SharedProviderAppId,
    providerId: string,
    provider: SharedProviderEditorPayload,
  ): Promise<OpenWrtRpcResult>;
  upsertActiveProvider?(
    appId: SharedProviderAppId,
    provider: SharedProviderEditorPayload,
  ): Promise<OpenWrtRpcResult>;
  deleteProviderByProviderId?(
    appId: SharedProviderAppId,
    providerId: string,
  ): Promise<OpenWrtRpcResult>;
  deleteProviderById?(
    appId: SharedProviderAppId,
    providerId: string,
  ): Promise<OpenWrtRpcResult>;
  activateProviderByProviderId?(
    appId: SharedProviderAppId,
    providerId: string,
  ): Promise<OpenWrtRpcResult>;
  activateProviderById?(
    appId: SharedProviderAppId,
    providerId: string,
  ): Promise<OpenWrtRpcResult>;
  switchProviderByProviderId?(
    appId: SharedProviderAppId,
    providerId: string,
  ): Promise<OpenWrtRpcResult>;
  switchProviderById?(
    appId: SharedProviderAppId,
    providerId: string,
  ): Promise<OpenWrtRpcResult>;
  addToFailoverQueue?(
    appId: SharedProviderAppId,
    providerId: string,
  ): Promise<OpenWrtRpcResult | null>;
  removeFromFailoverQueue?(
    appId: SharedProviderAppId,
    providerId: string,
  ): Promise<OpenWrtRpcResult | null>;
  setAutoFailoverEnabled?(
    appId: SharedProviderAppId,
    enabled: boolean,
  ): Promise<OpenWrtRpcResult | null>;
  reorderFailoverQueue?(
    appId: SharedProviderAppId,
    providerIds: string[],
  ): Promise<OpenWrtRpcResult | null>;
  setMaxRetries?(
    appId: SharedProviderAppId,
    value: number,
  ): Promise<OpenWrtRpcResult | null>;
  restartService(): Promise<OpenWrtRpcResult>;
}

export type OpenWrtProviderMutationKind = "save" | "activate" | "delete";

export interface OpenWrtProviderMutationEvent {
  appId: SharedProviderAppId;
  mutation: OpenWrtProviderMutationKind;
  providerId: string | null;
  serviceRunning: boolean;
  restartRequired: boolean;
  providerState: SharedProviderState;
  capabilities: SharedProviderCapabilities;
}

export interface OpenWrtProviderRuntimeHooks {
  getServiceRunning?(): boolean | Promise<boolean>;
  onProviderMutation?(
    event: OpenWrtProviderMutationEvent,
  ): void | Promise<void>;
}
