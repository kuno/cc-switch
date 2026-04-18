import {
  CheckCircle2,
  Loader2,
  Plus,
  Search,
  Trash2,
  X,
  Zap,
} from "lucide-react";
import type {
  SharedProviderAppId,
  SharedProviderEditorPayload,
  SharedProviderTokenField,
  SharedProviderView,
} from "@/shared/providers/domain";
import {
  ProviderSidePanelCredentialsTab,
} from "./ProviderSidePanelCredentialsTab";
import {
  ProviderSidePanelGeneralTab,
} from "./ProviderSidePanelGeneralTab";
import {
  ProviderSidePanelPresetTab,
  type ProviderSidePanelPresetGroup,
} from "./ProviderSidePanelPresetTab";

export type ProviderSidePanelTab = "preset" | "general" | "credentials";

interface ProviderSidePanelProps {
  appId: SharedProviderAppId;
  open: boolean;
  loading: boolean;
  error: string | null;
  mode: "new" | "edit";
  providers: SharedProviderView[];
  filteredProviders: SharedProviderView[];
  selectedProviderId: string | null;
  selectedProvider: SharedProviderView | null;
  draft: SharedProviderEditorPayload;
  website: string;
  tab: ProviderSidePanelTab;
  search: string;
  selectedPresetId: string;
  presetGroups: ProviderSidePanelPresetGroup[];
  tokenFieldOptions: Array<{
    value: SharedProviderTokenField;
    label: string;
  }>;
  selectedFileName: string;
  authPending: boolean;
  savePending: boolean;
  deletePending: boolean;
  activatePending: boolean;
  canActivate: boolean;
  canDelete: boolean;
  canSave: boolean;
  saveIdle: boolean;
  footerText: string;
  onClose: () => void;
  onSearchChange: (search: string) => void;
  onSelectProvider: (providerId: string) => void;
  onAddProvider: () => void;
  onTabChange: (tab: ProviderSidePanelTab) => void;
  onPresetSelect: (presetId: string) => void;
  onDraftChange: (draft: SharedProviderEditorPayload) => void;
  onWebsiteChange: (website: string) => void;
  onFileSelect: (file: File | null) => void;
  onUploadCodexAuth: () => void;
  onRemoveCodexAuth: () => void;
  onActivate: () => void;
  onDelete: () => void;
  onCancel: () => void;
  onSave: () => void;
}

const APP_LABELS: Record<SharedProviderAppId, string> = {
  claude: "Claude",
  codex: "Codex",
  gemini: "Gemini",
};

function getPanelSubtitle(
  appId: SharedProviderAppId,
  mode: "new" | "edit",
  provider: SharedProviderView | null,
): string {
  if (mode === "new") {
    return `New ${APP_LABELS[appId]} provider`;
  }

  return provider?.providerId || `Saved ${APP_LABELS[appId]} provider`;
}

function getStatusLabel(
  mode: "new" | "edit",
  provider: SharedProviderView | null,
): string {
  if (mode === "new") {
    return "Draft";
  }

  return provider?.active ? "Active" : "Saved";
}

export function ProviderSidePanel({
  appId,
  open,
  loading,
  error,
  mode,
  providers,
  filteredProviders,
  selectedProviderId,
  selectedProvider,
  draft,
  website,
  tab,
  search,
  selectedPresetId,
  presetGroups,
  tokenFieldOptions,
  selectedFileName,
  authPending,
  savePending,
  deletePending,
  activatePending,
  canActivate,
  canDelete,
  canSave,
  saveIdle,
  footerText,
  onClose,
  onSearchChange,
  onSelectProvider,
  onAddProvider,
  onTabChange,
  onPresetSelect,
  onDraftChange,
  onWebsiteChange,
  onFileSelect,
  onUploadCodexAuth,
  onRemoveCodexAuth,
  onActivate,
  onDelete,
  onCancel,
  onSave,
}: ProviderSidePanelProps) {
  const providerName =
    (mode === "new"
      ? draft.name.trim() || "New provider"
      : selectedProvider?.name.trim()) || "Provider";

  return (
    <div className="owt-provider-panel-shell" data-open={open}>
      <button
        type="button"
        className="owt-provider-panel__scrim"
        aria-hidden={!open}
        tabIndex={open ? 0 : -1}
        onClick={onClose}
      />

      <aside
        className="owt-provider-panel"
        aria-hidden={!open}
        aria-label={`${APP_LABELS[appId]} providers`}
        role="dialog"
      >
        <header className="owt-provider-panel__header">
          <div className="owt-provider-panel__app-badge" data-app={appId}>
            {APP_LABELS[appId].slice(0, 1)}
          </div>
          <div className="owt-provider-panel__header-copy">
            <h3 className="owt-provider-panel__title">{APP_LABELS[appId]}</h3>
            <div className="owt-provider-panel__subtitle">
              {providerName} · {getPanelSubtitle(appId, mode, selectedProvider)}
            </div>
          </div>
          <button
            type="button"
            className="owt-provider-panel__close"
            onClick={onClose}
            aria-label="Close provider panel"
          >
            <X className="h-4 w-4" />
          </button>
        </header>

        <div className="owt-provider-panel__body">
          <nav className="owt-provider-panel__rail" aria-label="Saved providers">
            <label className="owt-provider-panel__search">
              <Search className="h-4 w-4" />
              <input
                type="text"
                placeholder="Search provider or endpoint"
                value={search}
                onChange={(event) => onSearchChange(event.target.value)}
              />
            </label>

            <div className="owt-provider-panel__rail-scroll">
              {providers.length === 0 ? (
                <div className="owt-provider-panel__empty">
                  No providers yet. Create one from a preset or a custom draft.
                </div>
              ) : filteredProviders.length === 0 ? (
                <div className="owt-provider-panel__empty">
                  No providers match “{search.trim()}”.
                </div>
              ) : (
                filteredProviders.map((provider) => (
                  <button
                    type="button"
                    key={provider.providerId || provider.name}
                    className="owt-provider-panel__provider-row"
                    data-active={provider.providerId === selectedProviderId}
                    onClick={() =>
                      provider.providerId
                        ? onSelectProvider(provider.providerId)
                        : undefined
                    }
                  >
                    <div
                      className="owt-provider-panel__provider-mark"
                      data-app={appId}
                    >
                      {(provider.name || provider.providerId || APP_LABELS[appId])
                        .slice(0, 1)
                        .toUpperCase()}
                    </div>
                    <div className="owt-provider-panel__provider-copy">
                      <div className="owt-provider-panel__provider-name">
                        {provider.name || provider.providerId || "Provider"}
                      </div>
                      <div className="owt-provider-panel__provider-url">
                        {provider.baseUrl || "No base URL saved"}
                      </div>
                    </div>
                    <span
                      className="owt-provider-panel__provider-chip"
                      data-tone={provider.active ? "active" : "idle"}
                    >
                      {provider.active ? "Active" : "Saved"}
                    </span>
                  </button>
                ))
              )}
            </div>

            <div className="owt-provider-panel__rail-foot">
              <button
                type="button"
                className="owt-provider-panel__button"
                onClick={onAddProvider}
              >
                <Plus className="h-4 w-4" />
                Add provider
              </button>
            </div>
          </nav>

          <section className="owt-provider-panel__detail">
            <div className="owt-provider-panel__detail-head">
              <div>
                <div className="owt-provider-panel__detail-title">
                  {providerName}
                </div>
                <div className="owt-provider-panel__detail-url">
                  {draft.baseUrl || "Not saved yet"}
                </div>
              </div>

              <div className="owt-provider-panel__detail-meta">
                {selectedProvider?.providerId ? (
                  <span className="owt-provider-panel__id-chip">
                    {selectedProvider.providerId}
                  </span>
                ) : null}
                <span
                  className="owt-provider-panel__status-chip"
                  data-tone={mode === "new" ? "draft" : selectedProvider?.active ? "active" : "idle"}
                >
                  {getStatusLabel(mode, selectedProvider)}
                </span>
                {canActivate ? (
                  <button
                    type="button"
                    className="owt-provider-panel__button owt-provider-panel__button--ghost"
                    disabled={activatePending}
                    onClick={onActivate}
                  >
                    {activatePending ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Zap className="h-4 w-4" />
                    )}
                    Set active
                  </button>
                ) : null}
              </div>
            </div>

            <div className="owt-provider-panel__tabs" role="tablist">
              {(["preset", "general", "credentials"] as const).map((value) => (
                <button
                  key={value}
                  type="button"
                  className="owt-provider-panel__tab"
                  data-active={tab === value}
                  onClick={() => onTabChange(value)}
                >
                  {value === "preset"
                    ? "Preset"
                    : value === "general"
                      ? "General"
                      : "Credentials"}
                </button>
              ))}
            </div>

            <div className="owt-provider-panel__content">
              {loading ? (
                <div className="owt-provider-panel__state">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Loading provider workspace…
                </div>
              ) : error ? (
                <div className="owt-provider-panel__state owt-provider-panel__state--error">
                  {error}
                </div>
              ) : tab === "preset" ? (
                <ProviderSidePanelPresetTab
                  groups={presetGroups}
                  selectedPresetId={selectedPresetId}
                  onPresetSelect={onPresetSelect}
                />
              ) : tab === "general" ? (
                <ProviderSidePanelGeneralTab
                  draft={draft}
                  website={website}
                  onDraftChange={onDraftChange}
                  onWebsiteChange={onWebsiteChange}
                />
              ) : (
                <ProviderSidePanelCredentialsTab
                  appId={appId}
                  draft={draft}
                  provider={selectedProvider}
                  selectedFileName={selectedFileName}
                  authPending={authPending}
                  tokenFieldOptions={tokenFieldOptions}
                  onDraftChange={onDraftChange}
                  onFileSelect={onFileSelect}
                  onUploadCodexAuth={onUploadCodexAuth}
                  onRemoveCodexAuth={onRemoveCodexAuth}
                />
              )}
            </div>
          </section>
        </div>

        <footer className="owt-provider-panel__footer">
          <div className="owt-provider-panel__footer-copy">
            <CheckCircle2 className="h-4 w-4" />
            <span>{footerText}</span>
          </div>

          <div className="owt-provider-panel__footer-actions">
            {canDelete ? (
              <button
                type="button"
                className="owt-provider-panel__button owt-provider-panel__button--danger"
                disabled={deletePending}
                onClick={onDelete}
              >
                {deletePending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Trash2 className="h-4 w-4" />
                )}
                Delete
              </button>
            ) : null}
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
              data-idle={saveIdle}
              disabled={!canSave || savePending || loading}
              onClick={onSave}
            >
              {savePending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : null}
              Save
            </button>
          </div>
        </footer>
      </aside>
    </div>
  );
}
