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
  setRestartState?(state: { pending?: boolean; inFlight?: boolean }): void;
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
  upstreamProxy?: string;
  httpProxy: string;
  httpsProxy: string;
  proxyEnabled: boolean;
  logLevel: string;
}

export interface OpenWrtHostConfigPayload {
  listenAddr: string;
  listenPort: string;
  upstreamProxy?: string;
  httpProxy?: string;
  httpsProxy?: string;
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

export interface OpenWrtStatusDaemon {
  health: boolean;
  running: boolean;
  uptimeSeconds: number;
  lastError: string | null;
  checkedAt: string;
}

export interface OpenWrtStatusProviderStats {
  requestCount?: number;
  totalTokens?: number;
  totalCost?: string | number;
  successRate?: number;
  avgLatencyMs?: number;
}

export interface OpenWrtStatusActiveProvider {
  providerId?: string | null;
  provider_id?: string | null;
  id?: string | null;
  name?: string | null;
  [key: string]: unknown;
}

export interface OpenWrtStatusProvider {
  name?: string | null;
  configured?: boolean;
  stats?: OpenWrtStatusProviderStats | null;
  quota?: Record<string, unknown> | null;
  health?: Record<string, unknown> | null;
  circuit?: Record<string, unknown> | null;
  [key: string]: unknown;
}

export interface OpenWrtStatusFailoverQueueEntry {
  providerId?: string | null;
  provider_id?: string | null;
  providerName?: string | null;
  provider_name?: string | null;
  name?: string | null;
  position?: number | null;
  sortIndex?: number | null;
  sort_index?: number | null;
  active?: boolean;
  health?: Record<string, unknown> | null;
  [key: string]: unknown;
}

export interface OpenWrtStatusFailoverProviderStatus {
  inFailoverQueue?: boolean;
  in_failover_queue?: boolean;
  queuePosition?: number | null;
  queue_position?: number | null;
  sortIndex?: number | null;
  sort_index?: number | null;
  currentRole?: string | null;
  current_role?: string | null;
  available?: boolean;
  unavailableReasons?: string[];
  unavailable_reasons?: string[];
  health?: Record<string, unknown> | null;
  circuit?: Record<string, unknown> | null;
  quota?: Record<string, unknown> | null;
  [key: string]: unknown;
}

export interface OpenWrtStatusApp {
  mode?: string | null;
  proxyEnabled?: boolean;
  proxy_enabled?: boolean;
  health?: boolean | null;
  healthReason?: string | null;
  health_reason?: string | null;
  maxRetries: number;
  max_retries?: number;
  usage?: (Partial<OpenWrtUsageSummary> & { window?: unknown }) | null;
  activeProvider?: OpenWrtStatusActiveProvider | null;
  active_provider?: OpenWrtStatusActiveProvider | null;
  providers?: Record<string, OpenWrtStatusProvider>;
  failoverQueue?: OpenWrtStatusFailoverQueueEntry[];
  failover_queue?: OpenWrtStatusFailoverQueueEntry[];
  failoverStatus?: Record<string, OpenWrtStatusFailoverProviderStatus>;
  failover_status?: Record<string, OpenWrtStatusFailoverProviderStatus>;
  recentActivity?:
    | OpenWrtRecentActivityItem[]
    | { entries?: OpenWrtRecentActivityItem[] };
  recent_activity?:
    | OpenWrtRecentActivityItem[]
    | { entries?: OpenWrtRecentActivityItem[] };
  [key: string]: unknown;
}

export interface OpenWrtStatusResponse {
  daemon?: OpenWrtStatusDaemon;
  apps: Partial<Record<SharedProviderAppId, OpenWrtStatusApp>>;
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

export interface OpenWrtDaemonLogTail {
  source: string;
  path: string;
  linesRequested: number;
  bytesRequested: number;
  linesReturned: number;
  bytesRead: number;
  fileSize: number;
  truncated: boolean;
  entries: string[];
}

export interface OpenWrtOutboundProxyTestResult {
  configured: boolean;
  httpProxyConfigured: boolean;
  httpsProxyConfigured: boolean;
  source: string;
  proxyUrl: string | null;
  testUrl: string;
  tested: boolean;
  success: boolean;
  status: number | null;
  latencyMs: number | null;
  error: string | null;
}

export interface OpenWrtSharedPageShellApi
  extends OpenWrtSharedProviderShellApi {
  getHostState(): OpenWrtHostState;
  getMessage(): OpenWrtPageMessage | null;
  getProviderStats(appId: SharedProviderAppId): Promise<OpenWrtProviderStat[]>;
  getQuota(): Promise<QuotaResponse>;
  getStatus(): Promise<OpenWrtStatusResponse>;
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
  getDaemonLogTail?(
    lines?: number,
    maxBytes?: number,
  ): Promise<OpenWrtDaemonLogTail>;
  testUpstreamProxy?(
    proxyUrl: string,
  ): Promise<OpenWrtOutboundProxyTestResult>;
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
