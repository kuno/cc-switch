import type { SharedProviderEditorPayload } from "@/shared/providers/domain";

interface ProviderSidePanelGeneralTabProps {
  draft: SharedProviderEditorPayload;
  website: string;
  onDraftChange: (draft: SharedProviderEditorPayload) => void;
  onWebsiteChange: (website: string) => void;
}

export function ProviderSidePanelGeneralTab({
  draft,
  website,
  onDraftChange,
  onWebsiteChange,
}: ProviderSidePanelGeneralTabProps) {
  return (
    <div className="owt-provider-panel__fields">
      <label className="owt-provider-panel__field">
        <span className="owt-provider-panel__label">Provider name</span>
        <input
          className="owt-provider-panel__input"
          type="text"
          value={draft.name}
          onChange={(event) =>
            onDraftChange({
              ...draft,
              name: event.target.value,
            })
          }
        />
      </label>

      <label className="owt-provider-panel__field">
        <span className="owt-provider-panel__label">Model</span>
        <input
          className="owt-provider-panel__input"
          type="text"
          value={draft.model}
          onChange={(event) =>
            onDraftChange({
              ...draft,
              model: event.target.value,
            })
          }
        />
      </label>

      <label className="owt-provider-panel__field owt-provider-panel__field--wide">
        <span className="owt-provider-panel__label">
          Website URL
          <span className="owt-provider-panel__label-note">
            Presentation only
          </span>
        </span>
        <input
          className="owt-provider-panel__input owt-provider-panel__input--mono"
          type="url"
          value={website}
          onChange={(event) => onWebsiteChange(event.target.value)}
          placeholder="https://example.com"
        />
      </label>

      <label className="owt-provider-panel__field owt-provider-panel__field--wide">
        <span className="owt-provider-panel__label">Notes</span>
        <textarea
          className="owt-provider-panel__input owt-provider-panel__textarea"
          value={draft.notes}
          onChange={(event) =>
            onDraftChange({
              ...draft,
              notes: event.target.value,
            })
          }
        />
      </label>
    </div>
  );
}
