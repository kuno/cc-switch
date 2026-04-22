import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { AppCard } from "@/openwrt-provider-ui/components/AppCard";
import type { ProviderQuotaSnapshot } from "@/openwrt-provider-ui/types/quota";
import {
  createProviderStat,
  createRecentActivity,
  createSharedProviderState,
  createUsageSummary,
} from "../fixtures/openwrtProviderUi";
import { createBridgeFixture } from "./fixtures/bridge";

function makeWindowSnapshot(
  overrides: Partial<ProviderQuotaSnapshot> = {},
): ProviderQuotaSnapshot {
  return {
    app_type: "claude",
    provider_id: "kimi",
    provider_name: "Kimi",
    source: "subscription_quota",
    windows: [
      {
        name: "Monthly tokens",
        utilization: 0.42,
        reset: 1_750_000_000,
      },
    ],
    balances: null,
    captured_at: Date.now() / 1000,
    ...overrides,
  };
}

function makeBalanceSnapshot(
  overrides: Partial<ProviderQuotaSnapshot> = {},
): ProviderQuotaSnapshot {
  return {
    app_type: "claude",
    provider_id: "openrouter",
    provider_name: "OpenRouter",
    source: "balance",
    windows: [],
    balances: [
      {
        currency: "USD",
        total: 50,
        used: 37.66,
        remaining: 12.34,
        is_valid: true,
      },
    ],
    captured_at: Date.now() / 1000,
    ...overrides,
  };
}

function renderCardWithQuota(quota: ProviderQuotaSnapshot | undefined) {
  const bridge = createBridgeFixture({
    host: { app: "claude", status: "running", health: "healthy" },
    serviceStatus: { isRunning: true },
  });

  return render(
    <AppCard
      appId="claude"
      hostState={bridge.getHostState()}
      serviceRunning={bridge.getServiceStatus().isRunning}
      providerState={createSharedProviderState("claude")}
      summary={createUsageSummary()}
      providerStats={[createProviderStat("claude")]}
      recentActivity={[createRecentActivity("claude")]}
      loading={false}
      error={null}
      quotaSnapshot={quota}
      onOpenActivity={() => {}}
      onOpenProviderPanel={() => {}}
    />,
  );
}

describe("AppCard quota band", () => {
  it("renders window name and remaining percentage for a subscription snapshot", () => {
    renderCardWithQuota(makeWindowSnapshot());

    expect(screen.getByText("Monthly tokens")).toBeInTheDocument();
    expect(screen.getByText("58% remaining")).toBeInTheDocument();
  });

  it("renders currency-formatted remaining balance for a balance snapshot", () => {
    renderCardWithQuota(makeBalanceSnapshot());

    // Intl.NumberFormat formats 12.34 USD as "$12.34" in en-US
    expect(screen.getByText(/12\.34/)).toBeInTheDocument();
    expect(screen.getByText(/remaining/)).toBeInTheDocument();
  });

  it("does not render a quota band when both windows and balances are empty", () => {
    const { container } = renderCardWithQuota(
      makeWindowSnapshot({ windows: [], balances: [] }),
    );

    expect(container.querySelector(".owt-quota-band")).toBeNull();
  });

  it("renders nothing when quotaSnapshot is undefined", () => {
    const { container } = renderCardWithQuota(undefined);

    expect(container.querySelector(".owt-quota-band")).toBeNull();
  });
});
