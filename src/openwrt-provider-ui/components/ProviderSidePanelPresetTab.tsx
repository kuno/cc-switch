import type { SharedProviderPreset } from "@/shared/providers/domain";

export type ProviderSidePanelPresetGroup = {
  id: "official" | "platform" | "compatible";
  label: string;
  hint: string;
  presets: SharedProviderPreset[];
};

interface ProviderSidePanelPresetTabProps {
  groups: ProviderSidePanelPresetGroup[];
  selectedPresetId: string;
  onPresetSelect: (presetId: string) => void;
}

function PresetCard({
  title,
  description,
  meta,
  selected,
  onClick,
}: {
  title: string;
  description: string;
  meta: string;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className="owt-provider-panel__preset-card"
      data-selected={selected}
      onClick={onClick}
    >
      <div className="owt-provider-panel__preset-title">{title}</div>
      <div className="owt-provider-panel__preset-description">{description}</div>
      <div className="owt-provider-panel__preset-meta">{meta}</div>
    </button>
  );
}

export function ProviderSidePanelPresetTab({
  groups,
  selectedPresetId,
  onPresetSelect,
}: ProviderSidePanelPresetTabProps) {
  return (
    <div className="owt-provider-panel__tab-stack">
      <div className="owt-provider-panel__preset-intro">
        <div className="owt-provider-panel__eyebrow">Preset browser</div>
        <p className="owt-provider-panel__preset-lead">
          Start from an official endpoint, a platform template, or a compatible
          gateway.
        </p>
        <p className="owt-provider-panel__preset-subtext">
          Presets speed up setup but never save automatically.
        </p>
      </div>

      <section className="owt-provider-panel__preset-group">
        <div className="owt-provider-panel__preset-group-label">Custom</div>
        <PresetCard
          title="Custom draft"
          description="Keep the fields fully editable without applying a preset."
          meta="Manual endpoint and token configuration"
          selected={selectedPresetId === "custom"}
          onClick={() => onPresetSelect("custom")}
        />
      </section>

      {groups.map((group) => (
        <section className="owt-provider-panel__preset-group" key={group.id}>
          <div className="owt-provider-panel__preset-group-label">
            {group.label}
          </div>
          <div className="owt-provider-panel__preset-group-hint">
            {group.hint}
          </div>
          <div className="owt-provider-panel__preset-grid">
            {group.presets.map((preset) => (
              <PresetCard
                key={preset.id}
                title={preset.providerName}
                description={preset.description || "No extra notes provided."}
                meta={
                  preset.model
                    ? `${preset.baseUrl} · ${preset.model}`
                    : preset.baseUrl
                }
                selected={selectedPresetId === preset.id}
                onClick={() => onPresetSelect(preset.id)}
              />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
