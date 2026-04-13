import type { SharedProviderAppId } from "@/shared/providers/domain";

export interface OpenWrtRuntimeRpcResult {
  ok?: boolean;
  error?: string;
  message?: string;
  status_json?: string;
  list_json?: string;
  providers_json?: string;
  service?: unknown;
  runtime?: unknown;
  apps?: unknown;
  app?: string;
  providers?: unknown;
  items?: unknown;
  savedProviders?: unknown;
  providerMap?: unknown;
  [key: string]: unknown;
}

export interface OpenWrtRuntimeTransport {
  failoverControlsAvailable?: boolean;
  getRuntimeStatus(): Promise<OpenWrtRuntimeRpcResult | null>;
  getAppRuntimeStatus(
    appId: SharedProviderAppId,
  ): Promise<OpenWrtRuntimeRpcResult | null>;
  getAvailableFailoverProviders?(
    appId: SharedProviderAppId,
  ): Promise<OpenWrtRuntimeRpcResult | null>;
  addToFailoverQueue?(
    appId: SharedProviderAppId,
    providerId: string,
  ): Promise<OpenWrtRuntimeRpcResult | null>;
  removeFromFailoverQueue?(
    appId: SharedProviderAppId,
    providerId: string,
  ): Promise<OpenWrtRuntimeRpcResult | null>;
  setAutoFailoverEnabled?(
    appId: SharedProviderAppId,
    enabled: boolean,
  ): Promise<OpenWrtRuntimeRpcResult | null>;
}
