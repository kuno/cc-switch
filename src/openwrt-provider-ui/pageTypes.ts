import type { OpenWrtProviderTransport } from "@/platform/openwrt/providers";
import type { SharedProviderAppId } from "@/shared/providers/domain";

export type OpenWrtPageTheme = "light" | "dark";

export type OpenWrtShellMessageKind = "success" | "error" | "info";

export interface OpenWrtSharedProviderShellApi {
  getSelectedApp(): SharedProviderAppId;
  setSelectedApp(appId: SharedProviderAppId): SharedProviderAppId;
  getServiceStatus(): {
    isRunning: boolean;
  };
  getRestartState?(): {
    pending: boolean;
    inFlight: boolean;
  };
  setRestartState?(state: {
    pending?: boolean;
    inFlight?: boolean;
  }): void;
  subscribe?(listener: () => void): () => void;
  refreshServiceStatus(): Promise<{
    isRunning: boolean;
  }>;
  showMessage(kind: OpenWrtShellMessageKind, text: string): void;
  clearMessage(): void;
  restartService(): Promise<{
    isRunning: boolean;
  }>;
}

export interface OpenWrtHostState {
  app: "claude" | "codex" | "gemini";
  status: "running" | "stopped";
  health: "healthy" | "degraded" | "stopped" | "unknown";
  listenAddr: string;
  listenPort: string;
  version: string;
  serviceLabel: string;
  httpProxy: string;
  httpsProxy: string;
  proxyEnabled: boolean;
  logLevel: string;
}

export interface OpenWrtHostConfigPayload {
  listenAddr: string;
  listenPort: string;
  httpProxy: string;
  httpsProxy: string;
  logLevel: string;
}

export interface OpenWrtPageMessage {
  kind: OpenWrtShellMessageKind;
  text: string;
}

export interface OpenWrtUsageSummary {
  totalRequests: number;
  totalCost: string;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCacheCreationTokens: number;
  totalCacheReadTokens: number;
  successRate: number;
}

export interface QuotaResponse {
  providers: ProviderQuotaSnapshot[];
  timestamp: string;
}

export interface ProviderQuotaSnapshot {
  app_type: string;
  provider_id: string;
  provider_name: string;
  source?: string | null;
  status?: string | null;
  windows: QuotaWindow[];
  balances?: BalanceSnapshot[];
  representative_claim?: string | null;
  overage_status?: string | null;
  fallback_percentage?: number | null;
  requests_remaining?: number | null;
  requests_limit?: number | null;
  tokens_remaining?: number | null;
  tokens_limit?: number | null;
  captured_at: number;
}

export interface QuotaWindow {
  name: string;
  status?: string | null;
  utilization?: number | null;
  reset?: number | null;
}

export interface BalanceSnapshot {
  plan_name?: string | null;
  currency?: string | null;
  total?: number | null;
  used?: number | null;
  remaining?: number | null;
  is_valid?: boolean | null;
  invalid_message?: string | null;
}

export interface OpenWrtProviderStat {
  providerId: string;
  providerName: string;
  requestCount: number;
  totalTokens: number;
  totalCost: string;
  successRate: number;
  avgLatencyMs: number;
}

export interface OpenWrtRecentActivityItem {
  requestId: string;
  providerId: string;
  providerName: string;
  model: string;
  totalTokens: number;
  totalCost: string;
  statusCode: number;
  latencyMs: number;
  createdAt: number;
}

export interface OpenWrtRequestLog {
  requestId: string;
  providerId: string;
  providerName?: string;
  appType: string;
  model: string;
  requestModel?: string | null;
  costMultiplier: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  inputCostUsd: string;
  outputCostUsd: string;
  cacheReadCostUsd: string;
  cacheCreationCostUsd: string;
  totalCostUsd: string;
  isStreaming: boolean;
  latencyMs: number;
  firstTokenMs?: number | null;
  durationMs?: number | null;
  statusCode: number;
  errorMessage?: string | null;
  createdAt: number;
  dataSource?: string | null;
}

export interface OpenWrtPaginatedRequestLogs {
  data: OpenWrtRequestLog[];
  total: number;
  page: number;
  pageSize: number;
}

export interface OpenWrtSharedPageShellApi
  extends OpenWrtSharedProviderShellApi {
  getHostState(): OpenWrtHostState;
  getMessage(): OpenWrtPageMessage | null;
  getProviderStats(appId: SharedProviderAppId): Promise<OpenWrtProviderStat[]>;
  getQuota(): Promise<QuotaResponse>;
  getRequestDetail(
    appId: SharedProviderAppId,
    requestId: string,
  ): Promise<OpenWrtRequestLog | null>;
  getRequestLogs(
    appId: SharedProviderAppId,
    page?: number,
    pageSize?: number,
    providerId?: string,
  ): Promise<OpenWrtPaginatedRequestLogs>;
  getRecentActivity(
    appId: SharedProviderAppId,
  ): Promise<OpenWrtRecentActivityItem[]>;
  getUsageSummary(appId: SharedProviderAppId): Promise<OpenWrtUsageSummary>;
  refreshHostState(): Promise<OpenWrtHostState>;
  saveHostConfig(host: OpenWrtHostConfigPayload): Promise<OpenWrtHostState>;
}

export interface OpenWrtSharedPageMountOptions {
  target: HTMLElement;
  transport: OpenWrtProviderTransport;
  shell: OpenWrtSharedPageShellApi;
}
