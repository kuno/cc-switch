import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import {
  SharedProviderCard,
  getSharedProviderCardActionVisibility,
  type SharedProviderCapabilities,
  type SharedProviderView,
} from "@/shared/providers";

function createProvider(
  partial: Partial<SharedProviderView> & {
    providerId: string;
    name: string;
    baseUrl: string;
  },
): SharedProviderView {
  return {
    configured: true,
    providerId: partial.providerId,
    name: partial.name,
    baseUrl: partial.baseUrl,
    tokenField: partial.tokenField ?? "OPENAI_API_KEY",
    tokenConfigured: partial.tokenConfigured ?? true,
    tokenMasked: partial.tokenMasked ?? "********",
    model: partial.model ?? "gpt-5.4",
    notes: partial.notes ?? "",
    active: partial.active ?? false,
  };
}

const fullCapabilities: SharedProviderCapabilities = {
  canAdd: true,
  canEdit: true,
  canDelete: true,
  canActivate: true,
  supportsPresets: true,
  supportsBlankSecretPreserve: true,
  requiresServiceRestart: true,
};

describe("SharedProviderCard", () => {
  it("renders provider state chips and hides activate for the active provider", () => {
    const provider = createProvider({
      providerId: "alpha",
      name: "Alpha",
      baseUrl: "https://alpha.example.com/v1",
      active: true,
      notes: "Primary route",
    });

    render(
      <SharedProviderCard
        appId="codex"
        provider={provider}
        presetLabel="OpenRouter"
        actionVisibility={getSharedProviderCardActionVisibility(
          fullCapabilities,
          provider,
        )}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
      />,
    );

    expect(screen.getByText("Active provider")).toBeInTheDocument();
    expect(screen.getByText("Stored secret")).toBeInTheDocument();
    expect(screen.getByText("Preset: OpenRouter")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Edit Alpha" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Activate Alpha" }),
    ).not.toBeInTheDocument();
  });

  it("hides unsupported actions instead of rendering disabled placeholders", () => {
    const provider = createProvider({
      providerId: "beta",
      name: "Beta",
      baseUrl: "https://beta.example.com/v1",
      active: false,
      tokenConfigured: false,
    });

    render(
      <SharedProviderCard
        appId="codex"
        provider={provider}
        actionVisibility={getSharedProviderCardActionVisibility(
          {
            ...fullCapabilities,
            canEdit: false,
            canDelete: false,
            canActivate: false,
          },
          provider,
        )}
      />,
    );

    expect(
      screen.queryByRole("button", { name: "Edit Beta" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Activate Beta" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Delete Beta" }),
    ).not.toBeInTheDocument();
    expect(screen.queryByText("Stored secret")).not.toBeInTheDocument();
  });

  it("surfaces busy semantics on the active action controls", () => {
    const provider = createProvider({
      providerId: "gamma",
      name: "Gamma",
      baseUrl: "https://gamma.example.com/v1",
      active: false,
    });

    render(
      <SharedProviderCard
        appId="codex"
        provider={provider}
        actionVisibility={getSharedProviderCardActionVisibility(
          fullCapabilities,
          provider,
        )}
        isBusy
        isActivatePending
        onEdit={vi.fn()}
        onActivate={vi.fn()}
        onDelete={vi.fn()}
      />,
    );

    expect(screen.getByText("Gamma").closest("article")).toHaveAttribute(
      "aria-busy",
      "true",
    );
    expect(screen.getByRole("button", { name: "Activate Gamma" })).toHaveAttribute(
      "aria-busy",
      "true",
    );
    expect(screen.getByRole("button", { name: "Edit Gamma" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Delete Gamma" })).toBeDisabled();
  });
});
