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

    expect(screen.getByText("Loading runtime surface...")).toBeInTheDocument();
    expect(
      screen.getByText(
        "Fetching service status, app health, and failover queue previews.",
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
      screen.getByText("Unable to load runtime status."),
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
        title="No app runtime data yet."
        description="Once the backend reports a runtime snapshot, the read-only cards will appear here."
      />,
    );

    expect(screen.getByText("No app runtime data yet.")).toBeInTheDocument();
    expect(
      screen.getByText(
        "Once the backend reports a runtime snapshot, the read-only cards will appear here.",
      ),
    ).toBeInTheDocument();
  });
});
