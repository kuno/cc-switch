import { describe, expect, it, vi } from "vitest";
import {
  __private__,
  createOpenWrtRuntimeAdapter,
  type OpenWrtRuntimeTransport,
} from "@/platform/openwrt/runtime";

function createTransport(
  overrides: Partial<OpenWrtRuntimeTransport> = {},
): OpenWrtRuntimeTransport {
  return {
    getRuntimeStatus: vi.fn().mockResolvedValue({
      ok: true,
      service: {
        running: false,
        reachable: false,
        listenAddress: "127.0.0.1",
        listenPort: 15721,
        proxyEnabled: true,
        enableLogging: true,
        statusSource: "config-fallback",
        statusError: "connection refused",
      },
      runtime: {
        running: false,
        address: "127.0.0.1",
        port: 15721,
        active_connections: 2,
        total_requests: 14,
        success_requests: 11,
        failed_requests: 3,
        success_rate: 78.6,
        uptime_seconds: 42,
        current_provider: "Claude A",
        current_provider_id: "provider-a",
        last_request_at: "2026-04-13T08:00:00Z",
        last_error: "dial tcp timeout",
        failover_count: 2,
        active_targets: [
          {
            app_type: "claude",
            provider_name: "Claude A",
            provider_id: "provider-a",
          },
        ],
      },
      apps: [],
    }),
    getAppRuntimeStatus: vi.fn().mockImplementation(async (appId) => ({
      ok: true,
      app: appId,
      providerCount: 1,
      proxyEnabled: appId !== "gemini",
      autoFailoverEnabled: appId === "claude",
      maxRetries: 3,
      activeProviderId: `${appId}-active`,
      activeProvider: {
        configured: true,
        providerId: `${appId}-active`,
        name: `${appId} active`,
        baseUrl: `https://${appId}.example.com`,
        tokenField:
          appId === "claude"
            ? "ANTHROPIC_AUTH_TOKEN"
            : appId === "codex"
              ? "OPENAI_API_KEY"
              : "GEMINI_API_KEY",
        tokenConfigured: true,
      },
      activeProviderHealth: {
        providerId: `${appId}-active`,
        observed: appId !== "gemini",
        healthy: appId === "codex",
        consecutiveFailures: appId === "claude" ? 2 : 0,
        lastSuccessAt:
          appId === "gemini" ? null : "2026-04-13T07:59:00Z",
        lastFailureAt:
          appId === "claude" ? "2026-04-13T07:58:00Z" : null,
        lastError: appId === "claude" ? "upstream timeout" : null,
        updatedAt: "2026-04-13T08:00:00Z",
      },
      usingLegacyDefault: appId === "gemini",
      failoverQueueDepth: appId === "claude" ? 1 : 0,
      failoverQueue:
        appId === "claude"
          ? [
              {
                providerId: "claude-backup",
                providerName: "Claude Backup",
                sortIndex: 0,
                active: false,
                health: {
                  providerId: "claude-backup",
                  observed: false,
                  healthy: true,
                },
              },
            ]
          : [],
      observedProviderCount: appId === "gemini" ? 0 : 1,
      healthyProviderCount: appId === "codex" ? 1 : 0,
      unhealthyProviderCount: appId === "claude" ? 1 : 0,
    })),
    ...overrides,
  };
}

describe("OpenWrt runtime adapter", () => {
  it("normalizes runtime service summary and app runtime cards from the OpenWrt RPCs", async () => {
    const transport = createTransport();
    const adapter = createOpenWrtRuntimeAdapter(transport);

    const state = await adapter.getRuntimeSurface();

    expect(state.service.running).toBe(false);
    expect(state.service.reachable).toBe(false);
    expect(state.service.statusSource).toBe("config-fallback");
    expect(state.service.statusError).toBe("connection refused");
    expect(state.runtime.activeConnections).toBe(2);
    expect(state.runtime.failoverCount).toBe(2);
    expect(state.apps).toHaveLength(3);
    expect(state.apps[0]).toEqual(
      expect.objectContaining({
        app: "claude",
        proxyEnabled: true,
        autoFailoverEnabled: true,
        failoverQueueDepth: 1,
        observedProviderCount: 1,
        healthyProviderCount: 0,
        unhealthyProviderCount: 1,
        usingLegacyDefault: false,
      }),
    );
    expect(state.apps[0]?.activeProvider.providerId).toBe("claude-active");
    expect(state.apps[0]?.activeProviderHealth).toEqual(
      expect.objectContaining({
        observed: true,
        healthy: false,
        lastError: "upstream timeout",
      }),
    );
    expect(state.apps[0]?.failoverQueue[0]).toEqual(
      expect.objectContaining({
        providerId: "claude-backup",
        sortIndex: 0,
        health: expect.objectContaining({
          observed: false,
          healthy: true,
        }),
      }),
    );
    expect(state.apps[2]).toEqual(
      expect.objectContaining({
        app: "gemini",
        proxyEnabled: false,
        usingLegacyDefault: true,
        observedProviderCount: 0,
      }),
    );
  });

  it("falls back to app data embedded in get_runtime_status when get_app_runtime_status fails", async () => {
    const transport = createTransport({
      getRuntimeStatus: vi.fn().mockResolvedValue({
        ok: true,
        service: {
          running: true,
          reachable: true,
          listenAddress: "0.0.0.0",
          listenPort: 15721,
          proxyEnabled: true,
          enableLogging: false,
          statusSource: "live-status",
        },
        runtime: {
          running: true,
          address: "0.0.0.0",
          port: 15721,
          active_connections: 1,
          total_requests: 7,
          success_requests: 7,
          failed_requests: 0,
          success_rate: 100,
          uptime_seconds: 61,
          current_provider: "Codex Primary",
          current_provider_id: "codex-primary",
          last_request_at: null,
          last_error: null,
          failover_count: 0,
          active_targets: [],
        },
        apps: [
          {
            app: "claude",
            providerCount: 0,
            proxyEnabled: false,
            autoFailoverEnabled: false,
            maxRetries: 0,
            activeProvider: { configured: false },
            failoverQueueDepth: 0,
            failoverQueue: [],
            observedProviderCount: 0,
            healthyProviderCount: 0,
            unhealthyProviderCount: 0,
          },
          {
            app: "codex",
            providerCount: 1,
            proxyEnabled: true,
            autoFailoverEnabled: false,
            maxRetries: 2,
            activeProviderId: "codex-primary",
            activeProvider: {
              configured: true,
              providerId: "codex-primary",
              name: "Codex Primary",
              baseUrl: "https://api.openai.com/v1",
              tokenField: "OPENAI_API_KEY",
              tokenConfigured: true,
            },
            activeProviderHealth: {
              providerId: "codex-primary",
              observed: true,
              healthy: true,
            },
            failoverQueueDepth: 0,
            failoverQueue: [],
            observedProviderCount: 1,
            healthyProviderCount: 1,
            unhealthyProviderCount: 0,
          },
          {
            app: "gemini",
            providerCount: 0,
            proxyEnabled: false,
            autoFailoverEnabled: false,
            maxRetries: 0,
            activeProvider: { configured: false },
            failoverQueueDepth: 0,
            failoverQueue: [],
            observedProviderCount: 0,
            healthyProviderCount: 0,
            unhealthyProviderCount: 0,
          },
        ],
      }),
      getAppRuntimeStatus: vi
        .fn()
        .mockResolvedValue({ ok: false, error: "router timeout" }),
    });
    const adapter = createOpenWrtRuntimeAdapter(transport);

    const state = await adapter.getRuntimeSurface();

    expect(state.service.statusSource).toBe("live-status");
    expect(state.apps[1]).toEqual(
      expect.objectContaining({
        app: "codex",
        providerCount: 1,
        activeProviderId: "codex-primary",
        observedProviderCount: 1,
        healthyProviderCount: 1,
      }),
    );
  });

  it("surfaces runtime transport failures instead of returning an empty shell state", async () => {
    const adapter = createOpenWrtRuntimeAdapter(
      createTransport({
        getRuntimeStatus: vi
          .fn()
          .mockResolvedValue({ ok: false, error: "permission denied" }),
      }),
    );

    await expect(adapter.getRuntimeSurface()).rejects.toThrow(
      "permission denied",
    );
  });

  it("loads a single app runtime record directly", async () => {
    const adapter = createOpenWrtRuntimeAdapter(createTransport());

    const appState = await adapter.getAppRuntimeStatus("codex");

    expect(appState).toEqual(
      expect.objectContaining({
        app: "codex",
        providerCount: 1,
        proxyEnabled: true,
        activeProviderId: "codex-active",
      }),
    );
  });

  it("normalizes Phase 8 failover-control methods only when the transport supports them", async () => {
    const transport = createTransport({
      failoverControlsAvailable: true,
      getAvailableFailoverProviders: vi.fn().mockResolvedValue({
        ok: true,
        providers: {
          "codex-backup": {
            configured: true,
            providerId: "codex-backup",
            name: "Codex Backup",
            baseUrl: "https://backup.example.com/v1",
            model: "gpt-5.4-mini",
            tokenConfigured: true,
            tokenField: "OPENAI_API_KEY",
          },
        },
      }),
      addToFailoverQueue: vi.fn().mockResolvedValue({ ok: true }),
      removeFromFailoverQueue: vi.fn().mockResolvedValue({ ok: true }),
      setAutoFailoverEnabled: vi.fn().mockResolvedValue({ ok: true }),
    });
    const adapter = createOpenWrtRuntimeAdapter(transport);

    await expect(
      adapter.getAvailableFailoverProviders?.("codex"),
    ).resolves.toEqual([
      {
        providerId: "codex-backup",
        providerName: "Codex Backup",
        model: "gpt-5.4-mini",
      },
    ]);
    await expect(
      adapter.addToFailoverQueue?.("codex", "codex-backup"),
    ).resolves.toBeUndefined();
    await expect(
      adapter.removeFromFailoverQueue?.("codex", "codex-backup"),
    ).resolves.toBeUndefined();
    await expect(
      adapter.setAutoFailoverEnabled?.("codex", true),
    ).resolves.toBeUndefined();

    expect(transport.getAvailableFailoverProviders).toHaveBeenCalledWith(
      "codex",
    );
    expect(transport.addToFailoverQueue).toHaveBeenCalledWith(
      "codex",
      "codex-backup",
    );
    expect(transport.removeFromFailoverQueue).toHaveBeenCalledWith(
      "codex",
      "codex-backup",
    );
    expect(transport.setAutoFailoverEnabled).toHaveBeenCalledWith(
      "codex",
      true,
    );
  });

  it("keeps the adapter read-only when the shell exposes stubs but capability is disabled", () => {
    const transport = createTransport({
      failoverControlsAvailable: false,
      getAvailableFailoverProviders: vi
        .fn()
        .mockResolvedValue({ ok: false, error: "method not found" }),
      addToFailoverQueue: vi
        .fn()
        .mockResolvedValue({ ok: false, error: "method not found" }),
      removeFromFailoverQueue: vi
        .fn()
        .mockResolvedValue({ ok: false, error: "method not found" }),
      setAutoFailoverEnabled: vi
        .fn()
        .mockResolvedValue({ ok: false, error: "method not found" }),
    });
    const adapter = createOpenWrtRuntimeAdapter(transport);

    expect(adapter.getAvailableFailoverProviders).toBeUndefined();
    expect(adapter.addToFailoverQueue).toBeUndefined();
    expect(adapter.removeFromFailoverQueue).toBeUndefined();
    expect(adapter.setAutoFailoverEnabled).toBeUndefined();
    expect(transport.getAvailableFailoverProviders).not.toHaveBeenCalled();
    expect(transport.addToFailoverQueue).not.toHaveBeenCalled();
    expect(transport.removeFromFailoverQueue).not.toHaveBeenCalled();
    expect(transport.setAutoFailoverEnabled).not.toHaveBeenCalled();
  });

  it("keeps the adapter read-only when Phase 8 transport methods are absent", () => {
    const adapter = createOpenWrtRuntimeAdapter(createTransport());

    expect(adapter.getAvailableFailoverProviders).toBeUndefined();
    expect(adapter.addToFailoverQueue).toBeUndefined();
    expect(adapter.removeFromFailoverQueue).toBeUndefined();
    expect(adapter.setAutoFailoverEnabled).toBeUndefined();
  });

  it("preserves unknown health as neutral data for structured payloads", () => {
    expect(
      __private__.normalizeHealth(
        {
          providerId: "provider-a",
          observed: false,
          healthy: true,
        },
        "provider-a",
      ),
    ).toEqual(
      expect.objectContaining({
        providerId: "provider-a",
        observed: false,
        healthy: true,
      }),
    );
  });
});
