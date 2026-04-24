import { CheckCircle2, Loader2 } from "lucide-react";
import type { ReactNode } from "react";
import type {
  SharedProviderClaudeAuthSummary,
  SharedProviderCodexAuthSummary,
  SharedProviderEditorPayload,
  SharedProviderTokenField,
  SharedProviderView,
} from "@/shared/providers/domain";

type CodexAuthMode = "api_key" | "codex_oauth";
type ClaudeAuthMode = "client_passthrough" | "claude_oauth";

interface ProviderSidePanelConfigureTabProps {
  appId: "claude" | "codex" | "gemini";
  draft: SharedProviderEditorPayload;
  editing: boolean;
  footerText: string;
  mode: "new" | "edit";
  provider: SharedProviderView | null;
  saveIdle: boolean;
  savePending: boolean;
  showSaveFlash: boolean;
  tokenFieldOptions: Array<{
    value: SharedProviderTokenField;
    label: string;
  }>;
  website: string;
  canSave: boolean;
  onCancel: () => void;
  onClearAuth: () => void;
  onDraftChange: (draft: SharedProviderEditorPayload) => void;
  onEdit: () => void;
  onPasteAuth: () => void;
  onSave: () => void;
}

interface ConfigureRowProps {
  editing: boolean;
  editable?: boolean;
  input?: ReactNode;
  label: string;
  value: ReactNode;
  valueClassName?: string;
}

function ConfigureRow({
  editing,
  editable = false,
  input,
  label,
  value,
  valueClassName,
}: ConfigureRowProps) {
  const valueClasses = [
    "owt-provider-panel__config-value",
    valueClassName,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className="owt-provider-panel__config-row">
      <div className="owt-provider-panel__config-label">{label}</div>
      {editing && editable ? (
        <div className="owt-provider-panel__config-input-wrap">{input}</div>
      ) : (
        <div className={valueClasses}>{value}</div>
      )}
    </div>
  );
}

function getCodexAuthMode(authMode?: string): CodexAuthMode {
  return authMode === "codex_oauth" ? "codex_oauth" : "api_key";
}

function getClaudeAuthMode(authMode?: string): ClaudeAuthMode {
  return authMode === "claude_oauth" ? "claude_oauth" : "client_passthrough";
}

function normalizeExpiresAt(value: number | null | undefined): string | null {
  if (!Number.isFinite(value) || value == null || value <= 0) {
    return null;
  }

  const epochMs = value > 1_000_000_000_000 ? value : value * 1000;

  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(epochMs));
}

function formatValue(
  value: string | null | undefined,
  fallback = "—",
): string {
  const trimmed = value?.trim();

  return trimmed ? trimmed : fallback;
}

function getStoredAuthConnectionLabel(
  summary:
    | SharedProviderCodexAuthSummary
    | SharedProviderClaudeAuthSummary
    | undefined,
): string {
  return summary ? "Connected" : "Not connected";
}

function getAuthJsonStatus(authContent: string | null | undefined): {
  invalid: boolean;
  label: string;
  tone: "fail" | "muted" | "success" | "warn";
} {
  if (authContent === "") {
    return {
      invalid: false,
      label: "Will clear on save",
      tone: "warn",
    };
  }

  if (!authContent) {
    return {
      invalid: false,
      label: "No content",
      tone: "muted",
    };
  }

  try {
    JSON.parse(authContent);
    const bytes = new Blob([authContent]).size;
    const sizeLabel =
      bytes >= 1024 ? `${(bytes / 1024).toFixed(1)} KB` : `${bytes} B`;

    return {
      invalid: false,
      label: `Valid JSON · ${sizeLabel}`,
      tone: "success",
    };
  } catch {
    return {
      invalid: true,
      label: "Invalid JSON",
      tone: "fail",
    };
  }
}

function buildStoredAuthSummaryRows(
  appId: "claude" | "codex" | "gemini",
  provider: SharedProviderView | null,
): Array<{ label: string; value: string }> {
  if (appId === "claude" && provider?.claudeAuth) {
    const summary = provider.claudeAuth;
    const rows = [
      {
        label: "Refresh token",
        value: summary.refreshTokenPresent ? "Present" : "Missing",
      },
    ];
    const expiresAt = normalizeExpiresAt(summary.expiresAtMs);

    if (summary.scopes.length) {
      rows.push({
        label: "Scopes",
        value: summary.scopes.join(", "),
      });
    }

    if (summary.subscriptionType) {
      rows.push({
        label: "Subscription",
        value: summary.subscriptionType,
      });
    }

    if (expiresAt) {
      rows.push({
        label: "Expires at",
        value: expiresAt,
      });
    }

    return rows;
  }

  if (appId === "codex" && provider?.codexAuth) {
    const summary = provider.codexAuth;
    const rows = [
      {
        label: "Refresh token",
        value: summary.refreshTokenPresent ? "Present" : "Missing",
      },
    ];
    const expiresAt = normalizeExpiresAt(summary.expiresAt);

    if (expiresAt) {
      rows.push({
        label: "Expires at",
        value: expiresAt,
      });
    }

    return rows;
  }

  return [];
}

export function ProviderSidePanelConfigureTab({
  appId,
  draft,
  editing,
  footerText,
  mode,
  provider,
  saveIdle,
  savePending,
  showSaveFlash,
  tokenFieldOptions,
  website,
  canSave,
  onCancel,
  onClearAuth,
  onDraftChange,
  onEdit,
  onPasteAuth,
  onSave,
}: ProviderSidePanelConfigureTabProps) {
  const isClaude = appId === "claude";
  const isCodex = appId === "codex";
  const codexAuthMode = getCodexAuthMode(draft.authMode);
  const claudeAuthMode = getClaudeAuthMode(draft.authMode);
  const showClaudeAuthModeSelector =
    isClaude &&
    (draft.authMode === "client_passthrough" ||
      draft.authMode === "claude_oauth");
  const authModeOptions = isCodex
    ? [
        { label: "API key", value: "api_key" as const },
        { label: "auth.json", value: "codex_oauth" as const },
      ]
    : showClaudeAuthModeSelector
      ? [
          {
            label: "Client passthrough",
            value: "client_passthrough" as const,
          },
          { label: "auth.json", value: "claude_oauth" as const },
        ]
      : [];
  const showAuthJsonFields =
    (isCodex && codexAuthMode === "codex_oauth") ||
    (showClaudeAuthModeSelector && claudeAuthMode === "claude_oauth");
  const authModeValue = isCodex ? codexAuthMode : claudeAuthMode;
  const primaryEnvMapping =
    tokenFieldOptions.find((option) => option.value === draft.tokenField)
      ?.label ?? draft.tokenField;
  const storedAuthSummaryRows = buildStoredAuthSummaryRows(appId, provider);
  const storedAuthConnectionLabel = getStoredAuthConnectionLabel(
    isClaude ? provider?.claudeAuth : provider?.codexAuth,
  );
  const authJsonStatus = getAuthJsonStatus(draft.authContent);
  const tokenValue = provider?.tokenConfigured
    ? provider.tokenMasked || "Configured"
    : "Not configured";
  const authTextareaValue =
    draft.authContent === "" ? "" : draft.authContent ?? "";

  return (
    <div className="owt-provider-panel__config">
      <div className="owt-provider-panel__config-group">
        <div className="owt-provider-panel__config-group-title">General</div>

        <ConfigureRow
          editing={editing}
          editable
          label="Provider name"
          input={
            <input
              aria-label="Provider name"
              className="owt-provider-panel__config-input"
              type="text"
              value={draft.name}
              onChange={(event) =>
                onDraftChange({
                  ...draft,
                  name: event.target.value,
                })
              }
            />
          }
          value={formatValue(draft.name)}
        />

        <ConfigureRow
          editing={editing}
          editable
          label="Model"
          input={
            <input
              aria-label="Model"
              className="owt-provider-panel__config-input"
              type="text"
              value={draft.model}
              onChange={(event) =>
                onDraftChange({
                  ...draft,
                  model: event.target.value,
                })
              }
            />
          }
          value={formatValue(draft.model, "Default model")}
        />

        <ConfigureRow
          editing={editing}
          label="Website URL"
          value={formatValue(website, "Not available")}
          valueClassName="owt-provider-panel__config-value--mono owt-provider-panel__config-value--muted"
        />

        <ConfigureRow
          editing={editing}
          editable
          label="Notes"
          input={
            <textarea
              aria-label="Notes"
              className="owt-provider-panel__config-input owt-provider-panel__config-textarea"
              value={draft.notes}
              onChange={(event) =>
                onDraftChange({
                  ...draft,
                  notes: event.target.value,
                })
              }
            />
          }
          value={formatValue(draft.notes, "—")}
          valueClassName="owt-provider-panel__config-value--multiline"
        />
      </div>

      <div className="owt-provider-panel__config-group">
        <div className="owt-provider-panel__config-group-title">Credentials</div>

        <ConfigureRow
          editing={editing}
          editable
          label="Base URL"
          input={
            <input
              aria-label="Base URL"
              className="owt-provider-panel__config-input owt-provider-panel__config-input--mono"
              type="text"
              value={draft.baseUrl}
              onChange={(event) =>
                onDraftChange({
                  ...draft,
                  baseUrl: event.target.value,
                })
              }
            />
          }
          value={formatValue(draft.baseUrl)}
          valueClassName="owt-provider-panel__config-value--mono"
        />

        {authModeOptions.length ? (
          <ConfigureRow
            editing={editing}
            editable
            label="Auth mode"
            input={
              <select
                aria-label="Auth mode"
                className="owt-provider-panel__config-input"
                value={authModeValue}
                onChange={(event) =>
                  onDraftChange({
                    ...draft,
                    authMode: event.target.value,
                  })
                }
              >
                {authModeOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            }
            value={
              authModeOptions.find((option) => option.value === authModeValue)
                ?.label ?? "API key"
            }
          />
        ) : null}

        {!showAuthJsonFields ? (
          <>
            <ConfigureRow
              editing={editing}
              label="Env mapping"
              value={formatValue(primaryEnvMapping)}
              valueClassName="owt-provider-panel__config-value--mono"
            />

            <ConfigureRow
              editing={editing}
              editable
              label="API token"
              input={
                <input
                  aria-label="API token"
                  className="owt-provider-panel__config-input owt-provider-panel__config-input--mono"
                  type="password"
                  value={draft.token}
                  placeholder="Enter the secret for this provider"
                  onChange={(event) =>
                    onDraftChange({
                      ...draft,
                      token: event.target.value,
                    })
                  }
                />
              }
              value={tokenValue}
              valueClassName="owt-provider-panel__config-value--mono owt-provider-panel__config-value--muted"
            />
          </>
        ) : (
          <>
            <ConfigureRow
              editing={editing}
              editable
              label="auth.json"
              input={
                <div className="owt-provider-panel__auth-editor">
                  <textarea
                    aria-label="auth.json"
                    className="owt-provider-panel__config-input owt-provider-panel__config-input--mono owt-provider-panel__config-textarea owt-provider-panel__auth-textarea"
                    rows={8}
                    spellCheck={false}
                    value={authTextareaValue}
                    placeholder={
                      'Paste the contents of auth.json, e.g.\n{\n  "OPENAI_API_KEY": "sk-…",\n  "tokens": { … },\n  "account_id": "…"\n}'
                    }
                    onChange={(event) =>
                      onDraftChange({
                        ...draft,
                        authContent: event.target.value.trim()
                          ? event.target.value
                          : null,
                      })
                    }
                  />
                  <div className="owt-provider-panel__auth-meta">
                    <span
                      className="owt-provider-panel__auth-status"
                      data-tone={authJsonStatus.tone}
                    >
                      {authJsonStatus.label}
                    </span>
                    <div className="owt-provider-panel__auth-actions">
                      <button
                        type="button"
                        className="owt-provider-panel__button owt-provider-panel__button--ghost"
                        onClick={onPasteAuth}
                      >
                        Paste from clipboard
                      </button>
                      <button
                        type="button"
                        className="owt-provider-panel__button owt-provider-panel__button--ghost"
                        onClick={onClearAuth}
                      >
                        Clear auth
                      </button>
                    </div>
                  </div>
                  <div className="owt-provider-panel__auth-hint">
                    Pasted contents are stored as this provider&apos;s{" "}
                    <code>auth.json</code>. The daemon writes it to the
                    app&apos;s config directory on save.
                  </div>
                </div>
              }
              value={storedAuthConnectionLabel}
            />

            {!editing
              ? storedAuthSummaryRows.map((row) => (
                  <ConfigureRow
                    key={row.label}
                    editing={editing}
                    label={row.label}
                    value={row.value}
                    valueClassName={
                      row.label === "Expires at"
                        ? "owt-provider-panel__config-value--mono"
                        : undefined
                    }
                  />
                ))
              : null}
          </>
        )}
      </div>

      <div className="owt-provider-panel__config-actions">
        <span className="owt-provider-panel__config-footer-copy">
          {footerText}
        </span>
        <div className="owt-provider-panel__config-footer-actions">
          {mode === "edit" && !editing ? (
            <button
              type="button"
              className="owt-provider-panel__button"
              onClick={onEdit}
            >
              Edit
            </button>
          ) : (
            <>
              <button
                type="button"
                className="owt-provider-panel__button"
                onClick={onCancel}
              >
                Cancel
              </button>
              <button
                type="button"
                className="owt-provider-panel__button owt-provider-panel__button--primary"
                data-idle={saveIdle && !showSaveFlash ? "true" : "false"}
                data-saved={showSaveFlash ? "true" : "false"}
                disabled={!canSave || savePending || authJsonStatus.invalid}
                onClick={onSave}
              >
                {savePending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : showSaveFlash ? (
                  <CheckCircle2 className="h-4 w-4" />
                ) : null}
                {savePending ? "Saving…" : showSaveFlash ? "Saved" : "Save"}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
