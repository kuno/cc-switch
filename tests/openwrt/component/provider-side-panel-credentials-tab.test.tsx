import { useRef } from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ProviderSidePanelHost, type ProviderSidePanelHandle } from "@/openwrt-provider-ui/components/ProviderSidePanelHost";
import { ProviderSidePanelCredentialsTab } from "@/openwrt-provider-ui/components/ProviderSidePanelCredentialsTab";
import type { OpenWrtSharedPageShellApi } from "@/openwrt-provider-ui/pageTypes";
import type { OpenWrtProviderTransport } from "@/platform/openwrt/providers";
import { SHARED_PROVIDER_TOKEN_FIELD_OPTIONS } from "@/shared/providers/ui/presentation";
import { createBridgeFixture } from "./fixtures/bridge";
import { createDeferred, createProviderTransportFixture } from "./fixtures/providerTransport";
import {
  createClaudeAuthSummary,
  createCodexAuthSummary,
  createProviderDraft,
  createProviderState,
  createProviderView,
} from "../provider-panel-fixtures";

function HostHarness({
  shell,
  transport,
}: {
  shell: OpenWrtSharedPageShellApi;
  transport: OpenWrtProviderTransport;
}) {
  const panelRef = useRef<ProviderSidePanelHandle | null>(null);

  return (
    <>
      <button
        type="button"
        onClick={() => panelRef.current?.openForApp("codex")}
      >
        Open codex provider panel
      </button>
      <ProviderSidePanelHost
        ref={panelRef}
        selectedApp="codex"
        shell={shell}
        transport={transport}
      />
    </>
  );
}

describe("ProviderSidePanelCredentialsTab", () => {
  it("keeps API-key inputs masked while updating the local credentials draft", () => {
    const draft = createProviderDraft("claude", {
      baseUrl: "https://api.anthropic.com",
      token: "",
    });
    const onDraftChange = vi.fn();
    const { container } = render(
      <ProviderSidePanelCredentialsTab
        appId="claude"
        authPending={false}
        draft={draft}
        onDraftChange={onDraftChange}
        onFileSelect={() => {}}
        onRemoveCodexAuth={() => {}}
        onUploadCodexAuth={() => {}}
        onRemoveClaudeAuth={() => {}}
        onUploadClaudeAuth={() => {}}
        provider={createProviderView("claude", {
          active: true,
          providerId: "claude-primary",
        })}
        selectedFileName=""
        tokenFieldOptions={[...SHARED_PROVIDER_TOKEN_FIELD_OPTIONS.claude]}
      />,
    );

    const apiKeyInput = screen.getByLabelText("API key");

    expect(apiKeyInput).toHaveAttribute("type", "password");

    fireEvent.change(screen.getByLabelText("Base URL"), {
      target: {
        value: "https://api.deepseek.com/anthropic",
      },
    });
    expect(onDraftChange).toHaveBeenLastCalledWith({
      ...draft,
      baseUrl: "https://api.deepseek.com/anthropic",
    });

    fireEvent.change(screen.getByLabelText("Env key"), {
      target: {
        value: "ANTHROPIC_API_KEY",
      },
    });
    expect(onDraftChange).toHaveBeenLastCalledWith({
      ...draft,
      tokenField: "ANTHROPIC_API_KEY",
    });

    fireEvent.change(apiKeyInput, {
      target: {
        value: "super-secret-token",
      },
    });
    expect(onDraftChange).toHaveBeenLastCalledWith({
      ...draft,
      token: "super-secret-token",
    });
    expect(container).not.toHaveTextContent("super-secret-token");
  });

  it("renders the codex auth.json controls and stored auth summary", async () => {
    const user = userEvent.setup();
    const onFileSelect = vi.fn();
    const draft = createProviderDraft("codex", {
      authMode: "codex_oauth",
      baseUrl: "https://api.openai.com/v1",
    });
    const { container } = render(
      <ProviderSidePanelCredentialsTab
        appId="codex"
        authPending={false}
        draft={draft}
        onDraftChange={() => {}}
        onFileSelect={onFileSelect}
        onRemoveCodexAuth={() => {}}
        onUploadCodexAuth={() => {}}
        onRemoveClaudeAuth={() => {}}
        onUploadClaudeAuth={() => {}}
        provider={createProviderView("codex", {
          active: true,
          authMode: "codex_oauth",
          codexAuth: createCodexAuthSummary({
            accountId: "acct-codex",
          }),
          providerId: "codex-primary",
        })}
        selectedFileName="auth.json"
        tokenFieldOptions={[...SHARED_PROVIDER_TOKEN_FIELD_OPTIONS.codex]}
      />,
    );

    expect(
      screen.getByRole("button", {
        name: "auth.json",
      }),
    ).toHaveAttribute("data-active", "true");
    expect(screen.getByText("Stored auth.json")).toBeInTheDocument();
    expect(screen.getByText(/Account ID: acct-codex/)).toBeInTheDocument();
    expect(
      screen.getByRole("button", {
        name: "Upload auth.json",
      }),
    ).toBeEnabled();
    expect(
      screen.getByRole("button", {
        name: "Remove",
      }),
    ).toBeEnabled();

    const fileInput = container.querySelector(
      'input[type="file"]',
    ) as HTMLInputElement;
    const file = new File(['{"refresh_token":"token"}'], "auth.json", {
      type: "application/json",
    });

    await user.upload(fileInput, file);

    expect(onFileSelect).toHaveBeenCalledWith(file);
  });

  it("renders the claude auth.json controls and stored auth summary", async () => {
    const user = userEvent.setup();
    const onFileSelect = vi.fn();
    const draft = createProviderDraft("claude", {
      authMode: "claude_oauth",
      baseUrl: "https://api.anthropic.com",
    });
    const { container } = render(
      <ProviderSidePanelCredentialsTab
        appId="claude"
        authPending={false}
        draft={draft}
        onDraftChange={() => {}}
        onFileSelect={onFileSelect}
        onRemoveCodexAuth={() => {}}
        onUploadCodexAuth={() => {}}
        onRemoveClaudeAuth={() => {}}
        onUploadClaudeAuth={() => {}}
        provider={createProviderView("claude", {
          active: true,
          authMode: "claude_oauth",
          claudeAuth: createClaudeAuthSummary({
            subscriptionType: "max",
          }),
          providerId: "claude-primary",
        })}
        selectedFileName="auth.json"
        tokenFieldOptions={[...SHARED_PROVIDER_TOKEN_FIELD_OPTIONS.claude]}
      />,
    );

    expect(
      screen.getByRole("button", {
        name: "auth.json",
      }),
    ).toHaveAttribute("data-active", "true");
    expect(screen.getByText("Stored auth.json")).toBeInTheDocument();
    expect(screen.getByText(/Subscription type: max/)).toBeInTheDocument();
    expect(screen.getByText(/Scopes:/)).toBeInTheDocument();

    const fileInput = container.querySelector(
      'input[type="file"]',
    ) as HTMLInputElement;
    const file = new File(['{"accessToken":"token"}'], "auth.json", {
      type: "application/json",
    });

    await user.upload(fileInput, file);

    expect(onFileSelect).toHaveBeenCalledWith(file);
  });

  it("saves edited credentials through the provider transport", async () => {
    const user = userEvent.setup();
    const shell = createBridgeFixture({
      selectedApp: "codex",
    });
    const codexProvider = createProviderView("codex", {
      active: true,
      authMode: "api_key",
      baseUrl: "https://api.openai.com/v1",
      model: "gpt-5.4",
      name: "OpenAI Official",
      providerId: "codex-primary",
      tokenConfigured: true,
    });
    const { transport } = createProviderTransportFixture({
      codex: createProviderState("codex", [codexProvider]),
    });

    render(<HostHarness shell={shell} transport={transport} />);

    await user.click(
      screen.getByRole("button", {
        name: "Open codex provider panel",
      }),
    );
    await screen.findByRole("dialog", {
      name: "Codex providers",
    });

    await user.click(
      screen.getByRole("button", {
        name: "Credentials",
      }),
    );
    await user.clear(screen.getByLabelText("Base URL"));
    await user.type(
      screen.getByLabelText("Base URL"),
      "https://proxy.example.com/v1",
    );
    await user.type(screen.getByLabelText("API key"), "sk-provider-secret");

    await user.click(
      screen.getByRole("button", {
        name: "Save",
      }),
    );

    await waitFor(() =>
      expect(transport.upsertProviderByProviderId).toHaveBeenCalled(),
    );
    expect(transport.upsertProviderByProviderId).toHaveBeenCalledWith(
      "codex",
      "codex-primary",
      expect.objectContaining({
        authMode: "api_key",
        baseUrl: "https://proxy.example.com/v1",
        token: "sk-provider-secret",
        tokenField: "OPENAI_API_KEY",
      }),
    );
  });

  it("disables auth.json actions while an upload is in flight", async () => {
    const user = userEvent.setup();
    const shell = createBridgeFixture({
      selectedApp: "codex",
    });
    const codexProvider = createProviderView("codex", {
      active: true,
      authMode: "codex_oauth",
      name: "OpenAI Official",
      providerId: "codex-primary",
      tokenConfigured: true,
    });
    const { transport } = createProviderTransportFixture({
      codex: createProviderState("codex", [codexProvider]),
    });
    const uploadDeferred = createDeferred<{ ok: true }>();

    transport.uploadCodexAuth = vi.fn(() => uploadDeferred.promise);

    render(<HostHarness shell={shell} transport={transport} />);

    await user.click(
      screen.getByRole("button", {
        name: "Open codex provider panel",
      }),
    );
    await screen.findByRole("dialog", {
      name: "Codex providers",
    });
    await user.click(
      screen.getByRole("button", {
        name: "Credentials",
      }),
    );

    const fileInput = document.querySelector(
      '.owt-provider-panel input[type="file"]',
    ) as HTMLInputElement;
    const file = new File(['{"refresh_token":"token"}'], "auth.json", {
      type: "application/json",
    });
    Object.defineProperty(file, "text", {
      value: vi.fn(async () => '{"refresh_token":"token"}'),
    });

    fireEvent.change(fileInput, {
      target: {
        files: [file],
      },
    });
    expect(
      screen.getByRole("button", {
        name: "Upload auth.json",
      }),
    ).toBeEnabled();
    await user.click(
      screen.getByRole("button", {
        name: "Upload auth.json",
      }),
    );

    await waitFor(() =>
      expect(transport.uploadCodexAuth).toHaveBeenCalledWith(
        "codex",
        "codex-primary",
        '{"refresh_token":"token"}',
      ),
    );
    expect(
      screen.getByRole("button", {
        name: "Upload auth.json",
      }),
    ).toBeDisabled();
    expect(
      screen.getByRole("button", {
        name: "Remove",
      }),
    ).toBeDisabled();

    uploadDeferred.resolve({
      ok: true,
    });

    await waitFor(() =>
      expect(
        screen.getByRole("button", {
          name: "Upload auth.json",
        }),
      ).toBeDisabled(),
    );
  });

  it("uploads Claude auth.json through the provider transport", async () => {
    const user = userEvent.setup();
    const shell = createBridgeFixture({
      selectedApp: "claude",
    });
    const claudeProvider = createProviderView("claude", {
      active: true,
      authMode: "claude_oauth",
      name: "Claude Official",
      providerId: "claude-primary",
    });
    const { transport } = createProviderTransportFixture({
      claude: createProviderState("claude", [claudeProvider]),
    });
    const uploadDeferred = createDeferred<{ ok: true }>();

    transport.uploadClaudeAuth = vi.fn(() => uploadDeferred.promise);

    function ClaudeHostHarness({
      shell: currentShell,
      transport: currentTransport,
    }: {
      shell: OpenWrtSharedPageShellApi;
      transport: OpenWrtProviderTransport;
    }) {
      const panelRef = useRef<ProviderSidePanelHandle | null>(null);

      return (
        <>
          <button
            type="button"
            onClick={() => panelRef.current?.openForApp("claude")}
          >
            Open claude provider panel
          </button>
          <ProviderSidePanelHost
            ref={panelRef}
            selectedApp="claude"
            shell={currentShell}
            transport={currentTransport}
          />
        </>
      );
    }

    render(<ClaudeHostHarness shell={shell} transport={transport} />);

    await user.click(
      screen.getByRole("button", {
        name: "Open claude provider panel",
      }),
    );
    await screen.findByRole("dialog", {
      name: "Claude providers",
    });
    await user.click(
      screen.getByRole("button", {
        name: "Credentials",
      }),
    );

    const fileInput = document.querySelector(
      '.owt-provider-panel input[type="file"]',
    ) as HTMLInputElement;
    const file = new File(['{"accessToken":"token"}'], "auth.json", {
      type: "application/json",
    });
    Object.defineProperty(file, "text", {
      value: vi.fn(async () => '{"accessToken":"token"}'),
    });

    fireEvent.change(fileInput, {
      target: {
        files: [file],
      },
    });
    await user.click(
      screen.getByRole("button", {
        name: "Upload auth.json",
      }),
    );

    await waitFor(() =>
      expect(transport.uploadClaudeAuth).toHaveBeenCalledWith(
        "claude",
        "claude-primary",
        '{"accessToken":"token"}',
      ),
    );

    uploadDeferred.resolve({
      ok: true,
    });
  });
});
