import type {
  SharedProviderCodexAuthSummary,
  SharedProviderEditorPayload,
  SharedProviderTokenField,
  SharedProviderView,
} from "@/shared/providers/domain";

type CodexAuthMode = "api_key" | "codex_oauth";

interface ProviderSidePanelCredentialsTabProps {
  appId: "claude" | "codex" | "gemini";
  draft: SharedProviderEditorPayload;
  provider: SharedProviderView | null;
  selectedFileName: string;
  authPending: boolean;
  tokenFieldOptions: Array<{
    value: SharedProviderTokenField;
    label: string;
  }>;
  onDraftChange: (draft: SharedProviderEditorPayload) => void;
  onFileSelect: (file: File | null) => void;
  onUploadCodexAuth: () => void;
  onRemoveCodexAuth: () => void;
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

function getSecretPolicyText(
  provider: SharedProviderView | null,
  authMode?: string,
): string {
  if (authMode === "client_passthrough") {
    return "Token is optional. Client credentials are forwarded automatically.";
  }

  if (authMode === "codex_oauth") {
    return "auth.json manages the secret. API key entry is not required.";
  }

  if (provider?.tokenConfigured) {
    return "Blank preserves the stored secret.";
  }

  return "Provide a secret before saving this provider.";
}

function getCodexAuthMode(authMode?: string): CodexAuthMode {
  return authMode === "codex_oauth" ? "codex_oauth" : "api_key";
}

function StoredAuthSummary({
  summary,
}: {
  summary: SharedProviderCodexAuthSummary;
}) {
  const expiresAtLabel = normalizeExpiresAt(summary.expiresAt);

  return (
    <div className="owt-provider-panel__note">
      <div className="owt-provider-panel__note-title">Stored auth.json</div>
      <div>Account ID: {summary.accountId || "Unavailable"}</div>
      <div>
        Refresh token present: {summary.refreshTokenPresent ? "yes" : "no"}
      </div>
      {expiresAtLabel ? <div>Expires at: {expiresAtLabel}</div> : null}
    </div>
  );
}

export function ProviderSidePanelCredentialsTab({
  appId,
  draft,
  provider,
  selectedFileName,
  authPending,
  tokenFieldOptions,
  onDraftChange,
  onFileSelect,
  onUploadCodexAuth,
  onRemoveCodexAuth,
}: ProviderSidePanelCredentialsTabProps) {
  const isCodex = appId === "codex";
  const codexAuthMode = getCodexAuthMode(draft.authMode);
  const showAuthJsonFields = isCodex && codexAuthMode === "codex_oauth";
  const canManageSavedAuth = Boolean(provider?.providerId);
  const secretPolicyText = getSecretPolicyText(provider, draft.authMode);

  return (
    <div className="owt-provider-panel__fields">
      <label className="owt-provider-panel__field owt-provider-panel__field--wide">
        <span className="owt-provider-panel__label">Base URL</span>
        <input
          className="owt-provider-panel__input owt-provider-panel__input--mono"
          type="text"
          value={draft.baseUrl}
          onChange={(event) =>
            onDraftChange({
              ...draft,
              baseUrl: event.target.value,
            })
          }
        />
      </label>

      {isCodex ? (
        <div className="owt-provider-panel__field owt-provider-panel__field--wide">
          <span className="owt-provider-panel__label">
            Authentication mode
          </span>
          <div className="owt-provider-panel__segment">
            <button
              type="button"
              className="owt-provider-panel__segment-button"
              data-active={codexAuthMode === "api_key"}
              onClick={() =>
                onDraftChange({
                  ...draft,
                  authMode: "api_key",
                })
              }
            >
              API key
            </button>
            <button
              type="button"
              className="owt-provider-panel__segment-button"
              data-active={codexAuthMode === "codex_oauth"}
              onClick={() =>
                onDraftChange({
                  ...draft,
                  authMode: "codex_oauth",
                })
              }
            >
              auth.json
            </button>
          </div>
        </div>
      ) : null}

      {!showAuthJsonFields ? (
        <>
          <label className="owt-provider-panel__field">
            <span className="owt-provider-panel__label">Env key</span>
            <select
              className="owt-provider-panel__input owt-provider-panel__input--mono"
              value={draft.tokenField}
              onChange={(event) =>
                onDraftChange({
                  ...draft,
                  tokenField: event.target.value as SharedProviderTokenField,
                })
              }
            >
              {tokenFieldOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>

          <label className="owt-provider-panel__field">
            <span className="owt-provider-panel__label">API key</span>
            <input
              className="owt-provider-panel__input owt-provider-panel__input--mono"
              type="password"
              value={draft.token}
              onChange={(event) =>
                onDraftChange({
                  ...draft,
                  token: event.target.value,
                })
              }
              placeholder="Enter the secret for this provider"
            />
          </label>

          <label className="owt-provider-panel__field owt-provider-panel__field--wide">
            <span className="owt-provider-panel__label">
              Secret policy
              <span className="owt-provider-panel__label-note">
                Blank preserves stored value
              </span>
            </span>
            <input
              className="owt-provider-panel__input"
              type="text"
              readOnly
              value={secretPolicyText}
            />
          </label>
        </>
      ) : (
        <>
          <div className="owt-provider-panel__field owt-provider-panel__field--wide">
            <span className="owt-provider-panel__label">auth.json</span>
            <label
              className="owt-provider-panel__file"
              data-disabled={!canManageSavedAuth || authPending}
            >
              <input
                type="file"
                accept="application/json,.json"
                disabled={!canManageSavedAuth || authPending}
                onChange={(event) =>
                  onFileSelect(event.target.files?.[0] ?? null)
                }
              />
              <span className="owt-provider-panel__file-button">
                Choose file
              </span>
              <span className="owt-provider-panel__file-name">
                {selectedFileName || "No file chosen"}
              </span>
            </label>
          </div>

          <div className="owt-provider-panel__field owt-provider-panel__field--wide">
            <div className="owt-provider-panel__note">
              {canManageSavedAuth
                ? "Upload or remove auth.json for this saved provider."
                : "Save this provider first, then upload auth.json for the saved provider ID."}
            </div>
          </div>

          <div className="owt-provider-panel__field owt-provider-panel__field--wide">
            <div className="owt-provider-panel__actions">
              <button
                type="button"
                className="owt-provider-panel__button owt-provider-panel__button--ghost"
                disabled={!canManageSavedAuth || authPending || !selectedFileName}
                onClick={onUploadCodexAuth}
              >
                Upload auth.json
              </button>
              <button
                type="button"
                className="owt-provider-panel__button owt-provider-panel__button--ghost"
                disabled={!canManageSavedAuth || authPending || !provider?.codexAuth}
                onClick={onRemoveCodexAuth}
              >
                Remove
              </button>
            </div>
          </div>

          {provider?.codexAuth ? (
            <div className="owt-provider-panel__field owt-provider-panel__field--wide">
              <StoredAuthSummary summary={provider.codexAuth} />
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}
