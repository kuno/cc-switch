import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import {
  SharedRuntimeEmptyState,
  SharedRuntimeErrorState,
  SharedRuntimeLoadingState,
} from "@/shared/runtime";

describe("SharedRuntimeStates", () => {
  it("renders the loading skeleton copy", () => {
    render(<SharedRuntimeLoadingState />);

    expect(screen.getByText("Loading runtime status...")).toBeInTheDocument();
    expect(
      screen.getByText(
        "Fetching service status, provider health, and failover state.",
      ),
    ).toBeInTheDocument();
  });

  it("renders an explanatory error state instead of collapsing to empty", () => {
    const onRetry = vi.fn();

    render(
      <SharedRuntimeErrorState
        detail="rpcd returned malformed JSON from get_runtime_status"
        onRetry={onRetry}
      />,
    );

    expect(
      screen.getByText("Could not load runtime status."),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "rpcd returned malformed JSON from get_runtime_status",
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();
  });

  it("renders the empty state copy when no runtime snapshot is available", () => {
    render(
      <SharedRuntimeEmptyState
        title="No runtime status available."
        description="Refresh to load the latest service status and provider health for this router."
      />,
    );

    expect(screen.getByText("No runtime status available.")).toBeInTheDocument();
    expect(
      screen.getByText(
        "Refresh to load the latest service status and provider health for this router.",
      ),
    ).toBeInTheDocument();
  });
});
