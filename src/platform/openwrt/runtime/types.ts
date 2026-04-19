import type { SharedProviderAppId } from "@/shared/providers/domain";

export interface OpenWrtRuntimeRpcResult {
  ok?: boolean;
  error?: string;
  message?: string;
  status_json?: string;
  service?: unknown;
  runtime?: unknown;
  apps?: unknown;
  app?: string;
  [key: string]: unknown;
}

export interface OpenWrtRuntimeTransport {
  getRuntimeStatus(): Promise<OpenWrtRuntimeRpcResult | null>;
  getAppRuntimeStatus(
    appId: SharedProviderAppId,
  ): Promise<OpenWrtRuntimeRpcResult | null>;
}
