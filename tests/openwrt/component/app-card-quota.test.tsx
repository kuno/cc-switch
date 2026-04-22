import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AppCard } from "@/openwrt-provider-ui/components/AppCard";
import type { ProviderQuotaSnapshot } from "@/openwrt-provider-ui/types/quota";
import { formatResetDelta } from "@/openwrt-provider-ui/utils/formatResetDelta";
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

function renderQuotaBarForUtilization(utilization: number) {
  return renderCardWithQuota(
    makeWindowSnapshot({
      windows: [
        {
          name: "Monthly tokens",
          utilization,
          reset: 1_800_000_000,
        },
      ],
    }),
  );
}

describe("AppCard quota band", () => {
  it("renders window name, remaining quota, reset delta, and a draining bar for a subscription snapshot", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));

    try {
      const reset = Math.trunc(Date.now() / 1000) + 3 * 3600 + 42 * 60;
      const { container } = renderCardWithQuota(
        makeWindowSnapshot({
          windows: [
            {
              name: "Monthly tokens",
              utilization: 0.42,
              reset,
            },
          ],
        }),
      );

      expect(screen.getByText("Monthly tokens")).toBeInTheDocument();
      expect(screen.getByText("58% remaining")).toBeInTheDocument();
      expect(screen.getByText("resets 3h42m")).toBeInTheDocument();
      expect(container.querySelector(".owt-quota-bar__fill")).toHaveClass(
        "owt-quota-bar--success",
      );
      expect(container.querySelector(".owt-quota-bar__fill")).toHaveStyle({
        width: "58%",
      });
    } finally {
      vi.useRealTimers();
    }
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

  describe("formatResetDelta", () => {
    beforeEach(() => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it("returns an empty string for null input", () => {
      expect(formatResetDelta(null)).toBe("");
    });

    it("returns now for past timestamps", () => {
      const past = Math.trunc(Date.now() / 1000) - 1;

      expect(formatResetDelta(past)).toBe("now");
    });

    it("formats minute-only deltas without a leading hour segment", () => {
      const reset = Math.trunc(Date.now() / 1000) + 42 * 60;

      expect(formatResetDelta(reset)).toBe("42m");
    });

    it("formats hour and minute deltas", () => {
      const reset = Math.trunc(Date.now() / 1000) + 3 * 3600 + 42 * 60;

      expect(formatResetDelta(reset)).toBe("3h42m");
    });
  });

  describe("WindowRow remaining thresholds", () => {
    it("uses the danger class when 15% remains", () => {
      const { container } = renderQuotaBarForUtilization(0.85);

      expect(container.querySelector(".owt-quota-bar__fill")).toHaveClass(
        "owt-quota-bar--danger",
      );
    });

    it("uses the warning class when 35% remains", () => {
      const { container } = renderQuotaBarForUtilization(0.65);

      expect(container.querySelector(".owt-quota-bar__fill")).toHaveClass(
        "owt-quota-bar--warning",
      );
    });

    it("uses the success class when 70% remains", () => {
      const { container } = renderQuotaBarForUtilization(0.3);

      expect(container.querySelector(".owt-quota-bar__fill")).toHaveClass(
        "owt-quota-bar--success",
      );
    });
  });
});
