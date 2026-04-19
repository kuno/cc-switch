export interface HostConfig {
  enabled: boolean;
  listenAddr: string;
  listenPort: string;
  httpProxy: string;
  httpsProxy: string;
  logLevel: string;
}

export interface RuntimeStatus {
  service?: {
    running?: boolean;
    reachable?: boolean;
    version?: string;
    listenAddress?: string;
    listenPort?: number;
    proxyEnabled?: boolean;
    enableLogging?: boolean;
    statusSource?: string;
  };
  runtime?: {
    running?: boolean;
    uptime_seconds?: number;
    last_error?: string | null;
  };
}

const UBUS_ANONYMOUS_SESSION = "00000000000000000000000000000000";

function sessionToken(): string {
  const parent = window.parent as unknown as {
    L?: { env?: { sessionid?: string; token?: string } };
  } | undefined;

  const env = parent?.L?.env;
  if (env?.sessionid) {
    return env.sessionid;
  }
  return UBUS_ANONYMOUS_SESSION;
}

function ubusBaseUrl(): string {
  const parent = window.parent as unknown as {
    L?: { url?: (path: string) => string };
  } | undefined;
  if (parent?.L?.url) {
    try {
      return parent.L.url("admin/ubus");
    } catch {
      // fall through
    }
  }
  return "/cgi-bin/luci/admin/ubus";
}

async function ubusCall<T>(
  object: string,
  method: string,
  args: Record<string, unknown> = {},
): Promise<T> {
  const response = await fetch(ubusBaseUrl(), {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: Date.now(),
      method: "call",
      params: [sessionToken(), object, method, args],
    }),
  });
  if (!response.ok) {
    throw new Error(`ubus HTTP ${response.status}`);
  }
  const data = await response.json();
  if (data.error) {
    throw new Error(data.error.message ?? "ubus error");
  }
  const tuple = data.result as [number, unknown] | undefined;
  if (!tuple) {
    throw new Error("ubus malformed response");
  }
  const [code, payload] = tuple;
  if (code !== 0) {
    throw new Error(`ubus code ${code}`);
  }
  return payload as T;
}

export function getHostConfig(): Promise<HostConfig & { ok: boolean }> {
  return ubusCall("ccswitch", "get_host_config");
}

export function setHostConfig(
  host: Partial<HostConfig>,
): Promise<{ ok: boolean; error?: string } & Partial<HostConfig>> {
  return ubusCall("ccswitch", "set_host_config", { host });
}

export function getRuntimeStatus(): Promise<RuntimeStatus & { ok: boolean }> {
  return ubusCall("ccswitch", "get_runtime_status");
}

export function restartService(): Promise<{ ok: boolean; error?: string }> {
  return ubusCall("ccswitch", "restart_service");
}
