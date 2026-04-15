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

export interface OpenWrtSharedPageShellApi
  extends OpenWrtSharedProviderShellApi {
  getHostState(): OpenWrtHostState;
  getMessage(): OpenWrtPageMessage | null;
  getUsageSummary(appId: SharedProviderAppId): Promise<OpenWrtUsageSummary>;
  refreshHostState(): Promise<OpenWrtHostState>;
  saveHostConfig(host: OpenWrtHostConfigPayload): Promise<OpenWrtHostState>;
}

export interface OpenWrtSharedPageMountOptions {
  target: HTMLElement;
  transport: OpenWrtProviderTransport;
  shell: OpenWrtSharedPageShellApi;
}
