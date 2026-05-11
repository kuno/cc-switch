import { CheckCircle2, Loader2, Pencil, Save, X } from "lucide-react";
import type { TFunction } from "i18next";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
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
  const valueClasses = ["owt-provider-panel__config-value", valueClassName]
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

function normalizeExpiresAt(
  value: number | null | undefined,
  language: string,
): string | null {
  if (!Number.isFinite(value) || value == null || value <= 0) {
    return null;
  }

  const epochMs = value > 1_000_000_000_000 ? value : value * 1000;

  return new Intl.DateTimeFormat(language, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(epochMs));
}

function formatValue(value: string | null | undefined, fallback = "—"): string {
  const trimmed = value?.trim();

  return trimmed ? trimmed : fallback;
}

function normalizeExternalUrl(value: string): string {
  const trimmed = value.trim();

  if (!trimmed) {
    return "";
  }

  return /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)
    ? trimmed
    : `https://${trimmed}`;
}

function openExternalUrl(value: string) {
  const url = normalizeExternalUrl(value);

  if (!url) {
    return;
  }

  window.open(url, "_blank", "noopener,noreferrer");
}

function getStoredAuthConnectionLabel(
  summary:
    | SharedProviderCodexAuthSummary
    | SharedProviderClaudeAuthSummary
    | undefined,
  t: TFunction,
): string {
  return summary
    ? t("openwrt.configure.connected")
    : t("openwrt.configure.notConnected");
}

function formatAuthContentSize(bytes: number, t: TFunction): string {
  return bytes >= 1024
    ? t("openwrt.configure.sizeKilobytes", {
        value: (bytes / 1024).toFixed(1),
      })
    : t("openwrt.configure.sizeBytes", { value: bytes });
}

function getAuthJsonStatus(
  authContent: string | null | undefined,
  t: TFunction,
): {
  invalid: boolean;
  label: string;
  tone: "fail" | "muted" | "success" | "warn";
} {
  if (authContent === "") {
    return {
      invalid: false,
      label: t("openwrt.configure.authWillClearOnSave"),
      tone: "warn",
    };
  }

  if (!authContent) {
    return {
      invalid: false,
      label: t("openwrt.configure.noContent"),
      tone: "muted",
    };
  }

  try {
    JSON.parse(authContent);
    const bytes = new Blob([authContent]).size;
    const sizeLabel = formatAuthContentSize(bytes, t);

    return {
      invalid: false,
      label: t("openwrt.configure.validJson", { size: sizeLabel }),
      tone: "success",
    };
  } catch {
    return {
      invalid: true,
      label: t("openwrt.configure.invalidJson"),
      tone: "fail",
    };
  }
}

function buildStoredAuthSummaryRows(
  appId: "claude" | "codex" | "gemini",
  provider: SharedProviderView | null,
  t: TFunction,
  language: string,
): Array<{ label: string; value: string }> {
  if (appId === "claude" && provider?.claudeAuth) {
    const summary = provider.claudeAuth;
    const rows = [
      {
        label: t("openwrt.configure.refreshToken"),
        value: summary.refreshTokenPresent
          ? t("openwrt.configure.present")
          : t("openwrt.configure.missing"),
      },
    ];
    const expiresAt = normalizeExpiresAt(summary.expiresAtMs, language);

    if (summary.scopes.length) {
      rows.push({
        label: t("openwrt.configure.scopes"),
        value: summary.scopes.join(", "),
      });
    }

    if (summary.subscriptionType) {
      rows.push({
        label: t("openwrt.configure.subscription"),
        value: summary.subscriptionType,
      });
    }

    if (expiresAt) {
      rows.push({
        label: t("openwrt.configure.expiresAt"),
        value: expiresAt,
      });
    }

    return rows;
  }

  if (appId === "codex" && provider?.codexAuth) {
    const summary = provider.codexAuth;
    const rows = [
      {
        label: t("openwrt.configure.refreshToken"),
        value: summary.refreshTokenPresent
          ? t("openwrt.configure.present")
          : t("openwrt.configure.missing"),
      },
    ];
    const expiresAt = normalizeExpiresAt(summary.expiresAt, language);

    if (expiresAt) {
      rows.push({
        label: t("openwrt.configure.expiresAt"),
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
  const { t, i18n: i18nextInstance } = useTranslation();
  const language = i18nextInstance.language || "en";
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
        { label: t("openwrt.configure.apiKey"), value: "api_key" as const },
        {
          label: t("openwrt.configure.authJson"),
          value: "codex_oauth" as const,
        },
      ]
    : showClaudeAuthModeSelector
      ? [
          {
            label: t("openwrt.configure.clientPassthrough"),
            value: "client_passthrough" as const,
          },
          {
            label: t("openwrt.configure.authJson"),
            value: "claude_oauth" as const,
          },
        ]
      : [];
  const showAuthJsonFields =
    (isCodex && codexAuthMode === "codex_oauth") ||
    (showClaudeAuthModeSelector && claudeAuthMode === "claude_oauth");
  const authModeValue = isCodex ? codexAuthMode : claudeAuthMode;
  const primaryEnvMapping =
    tokenFieldOptions.find((option) => option.value === draft.tokenField)
      ?.label ?? draft.tokenField;
  const storedAuthConnectionLabel = getStoredAuthConnectionLabel(
    isClaude ? provider?.claudeAuth : provider?.codexAuth,
    t,
  );
  const storedAuthSummaryRows = buildStoredAuthSummaryRows(
    appId,
    provider,
    t,
    language,
  );
  const authJsonStatus = getAuthJsonStatus(draft.authContent, t);
  const tokenValue = provider?.tokenConfigured
    ? provider.tokenMasked || t("openwrt.configure.configured")
    : t("openwrt.configure.notConfigured");
  const authTextareaValue =
    draft.authContent === "" ? "" : (draft.authContent ?? "");

  return (
    <div className="owt-provider-panel__config">
      <div className="owt-provider-panel__config-group">
        <div className="owt-provider-panel__config-group-title">
          {t("settings.general")}
        </div>

        <ConfigureRow
          editing={editing}
          editable
          label={t("provider.name")}
          input={
            <input
              aria-label={t("provider.name")}
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
          label={t("usage.model")}
          input={
            <input
              aria-label={t("usage.model")}
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
          value={formatValue(draft.model, t("openwrt.activity.defaultModel"))}
        />

        <ConfigureRow
          editing={editing}
          editable
          label={t("provider.websiteUrl")}
          input={
            <input
              aria-label={t("provider.websiteUrl")}
              className="owt-provider-panel__config-input owt-provider-panel__config-input--mono"
              placeholder={website || "https://example.com"}
              type="url"
              value={draft.websiteUrl ?? ""}
              onChange={(event) =>
                onDraftChange({
                  ...draft,
                  websiteUrl: event.target.value,
                })
              }
            />
          }
          value={
            website ? (
              <button
                className="owt-provider-panel__config-link"
                type="button"
                onClick={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  openExternalUrl(website);
                }}
              >
                {website}
              </button>
            ) : (
              t("openwrt.configure.notAvailable")
            )
          }
          valueClassName="owt-provider-panel__config-value--mono owt-provider-panel__config-value--muted"
        />

        <ConfigureRow
          editing={editing}
          editable
          label={t("provider.notes")}
          input={
            <textarea
              aria-label={t("provider.notes")}
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
        <div className="owt-provider-panel__config-group-title">
          {t("usageScript.credentialsConfig")}
        </div>

        <ConfigureRow
          editing={editing}
          editable
          label={t("usageScript.baseUrl")}
          input={
            <input
              aria-label={t("usageScript.baseUrl")}
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
            label={t("openwrt.configure.authMode")}
            input={
              <select
                aria-label={t("openwrt.configure.authMode")}
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
                ?.label ?? t("openwrt.configure.apiKey")
            }
          />
        ) : null}

        {!showAuthJsonFields ? (
          <>
            <ConfigureRow
              editing={editing}
              label={t("openwrt.configure.envMapping")}
              value={formatValue(primaryEnvMapping)}
              valueClassName="owt-provider-panel__config-value--mono"
            />

            <ConfigureRow
              editing={editing}
              editable
              label={t("openwrt.configure.apiToken")}
              input={
                <input
                  aria-label={t("openwrt.configure.apiToken")}
                  className="owt-provider-panel__config-input owt-provider-panel__config-input--mono"
                  type="password"
                  value={draft.token}
                  placeholder={t("openwrt.configure.apiTokenPlaceholder")}
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
              label={t("openwrt.configure.authJson")}
              input={
                <div className="owt-provider-panel__auth-editor">
                  <textarea
                    aria-label={t("openwrt.configure.authJson")}
                    className="owt-provider-panel__config-input owt-provider-panel__config-input--mono owt-provider-panel__config-textarea owt-provider-panel__auth-textarea"
                    rows={8}
                    spellCheck={false}
                    value={authTextareaValue}
                    placeholder={t("openwrt.configure.authJsonPlaceholder")}
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
                        {t("openwrt.configure.pasteFromClipboard")}
                      </button>
                      <button
                        type="button"
                        className="owt-provider-panel__button owt-provider-panel__button--ghost"
                        onClick={onClearAuth}
                      >
                        {t("openwrt.configure.clearAuth")}
                      </button>
                    </div>
                  </div>
                  <div className="owt-provider-panel__auth-hint">
                    {t("openwrt.configure.authJsonHintPrefix")}{" "}
                    <code>auth.json</code>
                    {t("openwrt.configure.authJsonHintSuffix")}
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
                      row.label === t("openwrt.configure.expiresAt")
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
              className="owt-provider-panel__button owt-provider-panel__button--compact"
              onClick={onEdit}
            >
              <Pencil className="h-4 w-4" aria-hidden="true" />
              {t("common.edit")}
            </button>
          ) : (
            <>
              <button
                type="button"
                className="owt-provider-panel__button owt-provider-panel__button--compact"
                onClick={onCancel}
              >
                <X className="h-4 w-4" aria-hidden="true" />
                {t("common.cancel")}
              </button>
              <button
                type="button"
                className="owt-provider-panel__button owt-provider-panel__button--primary owt-provider-panel__button--compact"
                data-idle={saveIdle && !showSaveFlash ? "true" : "false"}
                data-saved={showSaveFlash ? "true" : "false"}
                disabled={!canSave || savePending || authJsonStatus.invalid}
                onClick={onSave}
              >
                {savePending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : showSaveFlash ? (
                  <CheckCircle2 className="h-4 w-4" />
                ) : (
                  <Save className="h-4 w-4" aria-hidden="true" />
                )}
                {savePending
                  ? t("openwrt.configure.saving")
                  : showSaveFlash
                    ? t("openwrt.configure.saved")
                    : t("common.save")}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
