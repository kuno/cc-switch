import { type FormEvent, useId } from "react";
import { Loader2, Plus, RotateCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import {
  getGenericPresetDescription,
  type SharedProviderAppId,
  type SharedProviderEditorPayload,
  type SharedProviderPreset,
  type SharedProviderPresetGroup,
  type SharedProviderTokenField,
} from "../domain";
import { SHARED_PROVIDER_APP_PRESENTATION } from "./presentation";

const FIELD_CLASS_NAME =
  "flex h-9 w-full rounded-md border border-border-default bg-background px-3 py-2 text-sm shadow-sm transition-colors placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-blue-500/20 disabled:cursor-not-allowed disabled:opacity-50";

interface SharedProviderEditorPanelProps {
  open: boolean;
  appId: SharedProviderAppId;
  mode: "add" | "edit";
  draft: SharedProviderEditorPayload;
  selectedPresetId: string;
  selectedPreset: SharedProviderPreset | null;
  presetGroups: SharedProviderPresetGroup[];
  tokenFieldOptions: Array<{ value: SharedProviderTokenField; label: string }>;
  disabled?: boolean;
  savePending?: boolean;
  supportsPresets: boolean;
  supportsBlankSecretPreserve: boolean;
  hasStoredSecret: boolean;
  onOpenChange: (open: boolean) => void;
  onPresetChange: (presetId: string) => void;
  onDraftChange: (draft: SharedProviderEditorPayload) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}

function PresetButton({
  active,
  label,
  description,
  accentColor,
  onClick,
}: {
  active: boolean;
  label: string;
  description?: string;
  accentColor?: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className={cn(
        "rounded-xl border px-3 py-3 text-left transition-colors",
        active
          ? "border-border-active bg-accent text-foreground shadow-sm"
          : "border-border-default bg-background hover:border-border-active hover:bg-muted/40",
      )}
      style={active && accentColor ? { borderColor: accentColor } : undefined}
      onClick={onClick}
    >
      <p className="font-medium">{label}</p>
      {description ? (
        <p className="mt-1 text-xs text-muted-foreground">{description}</p>
      ) : null}
    </button>
  );
}

export function SharedProviderEditorPanel({
  open,
  appId,
  mode,
  draft,
  selectedPresetId,
  selectedPreset,
  presetGroups,
  tokenFieldOptions,
  disabled = false,
  savePending = false,
  supportsPresets,
  supportsBlankSecretPreserve,
  hasStoredSecret,
  onOpenChange,
  onPresetChange,
  onDraftChange,
  onSubmit,
}: SharedProviderEditorPanelProps) {
  const fieldIdPrefix = useId();
  const appLabel = SHARED_PROVIDER_APP_PRESENTATION[appId].label;
  const title = mode === "edit" ? "Edit provider" : "Add provider";
  const description =
    mode === "edit"
      ? `Update the saved ${appLabel} provider draft and close the panel when you are done.`
      : `Create a saved ${appLabel} provider from a grouped preset or a custom endpoint draft.`;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-5xl overflow-hidden p-0" zIndex="alert">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <form className="flex max-h-[80vh] flex-col" onSubmit={onSubmit}>
          <div className="grid gap-0 lg:grid-cols-[minmax(0,1.1fr)_minmax(300px,0.9fr)]">
            <div className="space-y-5 overflow-y-auto px-6 py-5">
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor={`${fieldIdPrefix}-name`}>Provider name</Label>
                  <Input
                    id={`${fieldIdPrefix}-name`}
                    value={draft.name}
                    onChange={(event) =>
                      onDraftChange({
                        ...draft,
                        name: event.target.value,
                      })
                    }
                    required
                    disabled={disabled}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor={`${fieldIdPrefix}-model`}>Model</Label>
                  <Input
                    id={`${fieldIdPrefix}-model`}
                    value={draft.model}
                    onChange={(event) =>
                      onDraftChange({
                        ...draft,
                        model: event.target.value,
                      })
                    }
                    placeholder="Optional model override"
                    disabled={disabled}
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor={`${fieldIdPrefix}-base-url`}>Base URL</Label>
                <Input
                  id={`${fieldIdPrefix}-base-url`}
                  value={draft.baseUrl}
                  onChange={(event) =>
                    onDraftChange({
                      ...draft,
                      baseUrl: event.target.value,
                    })
                  }
                  required
                  disabled={disabled}
                />
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor={`${fieldIdPrefix}-token-field`}>
                    Token field
                  </Label>
                  <select
                    id={`${fieldIdPrefix}-token-field`}
                    className={FIELD_CLASS_NAME}
                    value={draft.tokenField}
                    onChange={(event) =>
                      onDraftChange({
                        ...draft,
                        tokenField: event.target
                          .value as SharedProviderEditorPayload["tokenField"],
                      })
                    }
                    disabled={disabled}
                  >
                    {tokenFieldOptions.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor={`${fieldIdPrefix}-token`}>API token</Label>
                  <Input
                    id={`${fieldIdPrefix}-token`}
                    type="password"
                    value={draft.token}
                    onChange={(event) =>
                      onDraftChange({
                        ...draft,
                        token: event.target.value,
                      })
                    }
                    placeholder={
                      mode === "edit" && supportsBlankSecretPreserve
                        ? "Leave blank to keep the stored secret"
                        : "Enter the secret for this provider"
                    }
                    required={mode === "add" || !supportsBlankSecretPreserve}
                    disabled={disabled}
                  />
                  {mode === "edit" &&
                  supportsBlankSecretPreserve &&
                  hasStoredSecret ? (
                    <p className="text-xs text-muted-foreground">
                      Leave the token blank to preserve the stored secret.
                    </p>
                  ) : null}
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor={`${fieldIdPrefix}-notes`}>Notes</Label>
                <Textarea
                  id={`${fieldIdPrefix}-notes`}
                  value={draft.notes}
                  onChange={(event) =>
                    onDraftChange({
                      ...draft,
                      notes: event.target.value,
                    })
                  }
                  placeholder="Optional notes for this provider"
                  disabled={disabled}
                />
              </div>
            </div>

            <div className="border-t border-border-default bg-muted/10 px-6 py-5 lg:max-h-[80vh] lg:overflow-y-auto lg:border-l lg:border-t-0">
              <div className="space-y-4">
                <div className="space-y-1">
                  <h3 className="font-semibold">Presets</h3>
                  <p className="text-sm text-muted-foreground">
                    Grouped presets only update the draft. Nothing is saved
                    until you submit the panel.
                  </p>
                </div>
                {supportsPresets ? (
                  <div className="space-y-4">
                    <div className="space-y-2">
                      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                        Custom
                      </p>
                      <PresetButton
                        active={selectedPresetId === "custom"}
                        label="Custom draft"
                        description="Keep the current fields editable without applying a preset."
                        onClick={() => onPresetChange("custom")}
                      />
                    </div>

                    {presetGroups.map((group) => (
                      <section key={group.category.id} className="space-y-2">
                        <div className="space-y-1">
                          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                            {group.category.label}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {group.category.hint}
                          </p>
                        </div>
                        <div className="grid gap-2">
                          {group.presets.map((preset) => (
                            <PresetButton
                              key={preset.id}
                              active={preset.id === selectedPresetId}
                              label={preset.label}
                              description={preset.description || preset.baseUrl}
                              accentColor={preset.accentColor}
                              onClick={() => onPresetChange(preset.id)}
                            />
                          ))}
                        </div>
                      </section>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">
                    Presets are unavailable for this adapter.
                  </p>
                )}

                <div className="rounded-xl border border-border-default bg-background p-4">
                  <p className="text-sm font-medium">
                    {selectedPreset ? selectedPreset.label : "Custom draft"}
                  </p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {selectedPreset
                      ? selectedPreset.description ||
                        getGenericPresetDescription()
                      : "Custom mode keeps the current fields editable without applying a preset."}
                  </p>
                </div>
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={savePending}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={disabled}>
              {savePending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : mode === "edit" ? (
                <RotateCw className="h-4 w-4" />
              ) : (
                <Plus className="h-4 w-4" />
              )}
              {mode === "edit" ? "Update provider" : "Save provider"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
