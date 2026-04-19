import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type {
  SharedRuntimeProxyStatus,
  SharedRuntimeServiceStatus,
} from "@/shared/runtime";
import { SharedRuntimeServiceSummaryCard } from "@/shared/runtime";

function createServiceStatus(
  partial: Partial<SharedRuntimeServiceStatus> = {},
): SharedRuntimeServiceStatus {
  return {
    running: true,
    reachable: true,
    listenAddress: "127.0.0.1",
    listenPort: 15721,
    proxyEnabled: true,
    enableLogging: true,
    statusSource: "live-status",
    statusError: null,
    ...partial,
  };
}

function createRuntimeStatus(
  partial: Partial<SharedRuntimeProxyStatus> = {},
): SharedRuntimeProxyStatus {
  return {
    running: true,
    address: "127.0.0.1",
    port: 15721,
    activeConnections: 3,
    totalRequests: 41,
    successRequests: 39,
    failedRequests: 2,
    successRate: 95.1,
    uptimeSeconds: 3661,
    currentProvider: "Primary",
    currentProviderId: "provider-primary",
    lastRequestAt: null,
    lastError: null,
    failoverCount: 2,
    activeTargets: [],
    ...partial,
  };
}

describe("SharedRuntimeServiceSummaryCard", () => {
  it("renders live daemon status distinctly from fallback state", () => {
    const { rerender } = render(
      <SharedRuntimeServiceSummaryCard
        service={createServiceStatus()}
        runtime={createRuntimeStatus()}
      />,
    );

    expect(screen.getByText("Running")).toBeInTheDocument();
    expect(screen.getByText("Live daemon status")).toBeInTheDocument();
    expect(
      screen.getByText(
        "Showing live daemon status from the running proxy service.",
      ),
    ).toBeInTheDocument();

    rerender(
      <SharedRuntimeServiceSummaryCard
        service={createServiceStatus({
          running: false,
          reachable: false,
          statusSource: "config-fallback",
          statusError: "daemon connect ECONNREFUSED",
        })}
        runtime={createRuntimeStatus()}
      />,
    );

    expect(screen.getByText("Stopped")).toBeInTheDocument();
    expect(screen.getByText("Config fallback")).toBeInTheDocument();
    expect(
      screen.getByText(
        "The daemon could not be reached. Showing saved OpenWrt configuration and failover context instead.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Runtime detail: daemon connect ECONNREFUSED"),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "Live telemetry is unavailable while this view is showing config or unreachable fallback state.",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText("Active connections")).not.toBeInTheDocument();
    expect(screen.queryByText("Total requests")).not.toBeInTheDocument();
    expect(screen.queryByText("Success rate")).not.toBeInTheDocument();
    expect(screen.queryByText("Failover count")).not.toBeInTheDocument();
    expect(screen.queryByText("Uptime")).not.toBeInTheDocument();
  });

  it("renders summary metrics from the runtime snapshot", () => {
    render(
      <SharedRuntimeServiceSummaryCard
        service={createServiceStatus({
          listenAddress: "::1",
          listenPort: 59999,
        })}
        runtime={createRuntimeStatus({
          activeConnections: 9,
          totalRequests: 1052,
          successRate: 88.5,
          failoverCount: 7,
          uptimeSeconds: 90061,
        })}
      />,
    );

    expect(screen.getByText("::1:59999")).toBeInTheDocument();
    expect(screen.getByText("9")).toBeInTheDocument();
    expect(screen.getByText("1,052")).toBeInTheDocument();
    expect(screen.getByText("88.5%")).toBeInTheDocument();
    expect(screen.getByText("7")).toBeInTheDocument();
    expect(screen.getByText("1d 1h 1m 1s")).toBeInTheDocument();
  });

  it("treats unreachable non-live states as telemetry-unavailable", () => {
    render(
      <SharedRuntimeServiceSummaryCard
        service={createServiceStatus({
          running: false,
          reachable: false,
          statusSource: "unknown-source",
        })}
        runtime={createRuntimeStatus({
          running: false,
          activeConnections: 0,
          totalRequests: 0,
          successRate: 0,
          failoverCount: 0,
          uptimeSeconds: 0,
        })}
      />,
    );

    expect(
      screen.getByText(
        "Live telemetry is unavailable while this view is showing config or unreachable fallback state.",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText("Active connections")).not.toBeInTheDocument();
    expect(screen.getByText("127.0.0.1:15721")).toBeInTheDocument();
  });
});
