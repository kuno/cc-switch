import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type {
  SharedRuntimeAppStatus,
  SharedRuntimeFailoverQueueEntry,
  SharedRuntimeProviderHealth,
} from "@/shared/runtime";
import { SharedRuntimeAppCard } from "@/shared/runtime";
import type { SharedProviderView } from "@/shared/providers";

function createProvider(
  partial: Partial<SharedProviderView> = {},
): SharedProviderView {
  return {
    configured: true,
    providerId: "provider-a",
    name: "Provider A",
    baseUrl: "https://provider-a.example.com",
    tokenField: "OPENAI_API_KEY",
    tokenConfigured: true,
    tokenMasked: "********",
    model: "gpt-5.4",
    notes: "",
    active: true,
    ...partial,
  };
}

function createHealth(
  partial: Partial<SharedRuntimeProviderHealth> = {},
): SharedRuntimeProviderHealth {
  return {
    providerId: "provider-a",
    observed: true,
    healthy: true,
    consecutiveFailures: 0,
    lastSuccessAt: null,
    lastFailureAt: null,
    lastError: null,
    updatedAt: null,
    ...partial,
  };
}

function createQueueEntry(
  partial: Partial<SharedRuntimeFailoverQueueEntry> = {},
): SharedRuntimeFailoverQueueEntry {
  return {
    providerId: "provider-b",
    providerName: "Provider B",
    sortIndex: 2,
    active: false,
    health: createHealth({
      providerId: "provider-b",
      observed: true,
      healthy: false,
      consecutiveFailures: 2,
      lastError: "upstream timeout",
    }),
    ...partial,
  };
}

function createStatus(
  partial: Partial<SharedRuntimeAppStatus> = {},
): SharedRuntimeAppStatus {
  return {
    app: "codex",
    providerCount: 3,
    proxyEnabled: true,
    autoFailoverEnabled: true,
    maxRetries: 4,
    activeProviderId: "provider-a",
    activeProvider: createProvider(),
    activeProviderHealth: createHealth(),
    usingLegacyDefault: false,
    failoverQueueDepth: 2,
    failoverQueue: [createQueueEntry()],
    observedProviderCount: 2,
    healthyProviderCount: 1,
    unhealthyProviderCount: 1,
    ...partial,
  };
}

describe("SharedRuntimeAppCard", () => {
  it("renders the active provider, queue depth, and health counts without mutation controls", () => {
    render(
      <SharedRuntimeAppCard
        status={createStatus({
          failoverQueue: [
            createQueueEntry({
              providerId: "provider-b",
              providerName: "Provider B",
              sortIndex: 1,
              health: createHealth({
                providerId: "provider-b",
                observed: true,
                healthy: false,
                consecutiveFailures: 3,
                lastError: "upstream timeout",
              }),
            }),
            createQueueEntry({
              providerId: "provider-c",
              providerName: "Provider C",
              sortIndex: 2,
              health: createHealth({
                providerId: "provider-c",
                observed: true,
                healthy: true,
              }),
            }),
          ],
          failoverQueueDepth: 2,
        })}
      />,
    );

    expect(screen.getByText("Provider A")).toBeInTheDocument();
    expect(screen.getByText("Active provider ID: provider-a")).toBeInTheDocument();
    expect(screen.getByText("Proxy enabled")).toBeInTheDocument();
    expect(screen.getByText("Auto-failover enabled")).toBeInTheDocument();
    expect(screen.getByText("Read only")).toBeInTheDocument();
    expect(screen.getByText("3")).toBeInTheDocument();
    expect(screen.getByText("2 queued")).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("keeps unobserved health neutral and surfaces queue ordering", () => {
    render(
      <SharedRuntimeAppCard
        status={createStatus({
          activeProviderHealth: createHealth({
            observed: false,
            healthy: false,
            consecutiveFailures: 0,
          }),
          failoverQueue: [
            createQueueEntry({
              providerId: "provider-c",
              providerName: "Provider C",
              sortIndex: 9,
              health: createHealth({
                providerId: "provider-c",
                observed: false,
                healthy: false,
                consecutiveFailures: 0,
              }),
            }),
            createQueueEntry({
              providerId: "provider-b",
              providerName: "Provider B",
              sortIndex: 2,
              active: true,
              health: createHealth({
                providerId: "provider-b",
                observed: true,
                healthy: false,
                consecutiveFailures: 4,
                lastError: "TLS handshake failed",
              }),
            }),
          ],
        })}
      />,
    );

    expect(screen.getAllByText("Unknown")[0]).toBeInTheDocument();
    expect(
      screen.getByText("No live observation reported yet."),
    ).toBeInTheDocument();

    const providerBRow = screen.getByText("Provider B").closest("div");
    const providerCRow = screen.getByText("Provider C").closest("div");

    expect(providerBRow).not.toBeNull();
    expect(providerCRow).not.toBeNull();
    expect(
      providerBRow?.compareDocumentPosition(providerCRow as Node),
    ).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    expect(screen.getByText("Active provider")).toBeInTheDocument();
    expect(
      screen.getByText("No live health observation reported for this queue entry yet."),
    ).toBeInTheDocument();
    expect(screen.getAllByText("Unhealthy")).toHaveLength(2);
    expect(
      screen.getByText(/Last error:\s+TLS handshake failed/),
    ).toBeInTheDocument();
  });
});
