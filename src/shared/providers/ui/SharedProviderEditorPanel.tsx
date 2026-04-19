import { type FormEvent, type ReactNode, type RefObject, useId } from "react";
import {
  CheckCircle2,
  FileText,
  KeyRound,
  Layers3,
  Link2,
  Loader2,
  Plus,
  RotateCw,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
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
  type SharedProviderTokenField,
} from "../domain";
import {
  SHARED_PROVIDER_APP_PRESENTATION,
  type SharedProviderPresetBrowseGroup,
} from "./presentation";

const FIELD_CLASS_NAME =
  "ccswitch-openwrt-field flex h-10 w-full rounded-md border border-border-default bg-background px-3 py-2 text-sm shadow-sm transition-colors placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-blue-500/20 disabled:cursor-not-allowed disabled:opacity-50";

interface SharedProviderEditorPanelProps {
  open: boolean;
  appId: SharedProviderAppId;
  mode: "add" | "edit";
  draft: SharedProviderEditorPayload;
  selectedPresetId: string;
  selectedPreset: SharedProviderPreset | null;
  presetGroups: SharedProviderPresetBrowseGroup[];
  tokenFieldOptions: ReadonlyArray<{
    value: SharedProviderTokenField;
    label: string;
  }>;
  disabled?: boolean;
  savePending?: boolean;
  supportsPresets: boolean;
  supportsBlankSecretPreserve: boolean;
  hasStoredSecret: boolean;
  initialFocusRef?: RefObject<HTMLInputElement>;
  onOpenChange: (open: boolean) => void;
  onPresetChange: (presetId: string) => void;
  onDraftChange: (draft: SharedProviderEditorPayload) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}

function PresetChip({
  active,
  headline,
  label,
  description,
  meta,
  accentColor,
  onClick,
}: {
  active: boolean;
  headline?: string;
  label: string;
  description?: string;
  meta?: string;
  accentColor?: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className={cn(
        "ccswitch-openwrt-preset-chip rounded-2xl border px-3 py-3 text-left transition-all",
        active
          ? "border-border-active bg-accent text-foreground shadow-sm"
          : "border-border-default bg-background hover:border-border-active hover:bg-muted/40",
      )}
      style={active && accentColor ? { borderColor: accentColor } : undefined}
      onClick={onClick}
    >
      {headline ? (
        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
          {headline}
        </p>
      ) : null}
      <p className="mt-1 font-medium">{label}</p>
      {description ? (
        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
          {description}
        </p>
      ) : null}
      {meta ? (
        <p className="mt-3 text-[11px] font-medium text-muted-foreground">
          {meta}
        </p>
      ) : null}
    </button>
  );
}

function EditorSection({
  icon: Icon,
  title,
  description,
  children,
}: {
  icon: typeof Layers3;
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <section className="ccswitch-openwrt-group rounded-[24px] border border-border-default/80 bg-muted/15 p-4 sm:p-5">
      <div className="flex items-start gap-3">
        <div className="rounded-2xl border border-border-default/70 bg-background p-2 text-muted-foreground">
          <Icon className="h-4 w-4" />
        </div>
        <div className="min-w-0 space-y-1">
          <h3 className="text-base font-semibold text-foreground">{title}</h3>
          <p className="text-sm text-muted-foreground">{description}</p>
        </div>
      </div>
      <div className="mt-4 space-y-4">{children}</div>
    </section>
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
  initialFocusRef,
  onOpenChange,
  onPresetChange,
  onDraftChange,
  onSubmit,
}: SharedProviderEditorPanelProps) {
  const fieldIdPrefix = useId();
  const appPresentation = SHARED_PROVIDER_APP_PRESENTATION[appId];
  const appLabel = appPresentation.label;
  const title =
    mode === "edit"
      ? `Update ${appLabel} provider`
      : `Save ${appLabel} provider`;
  const description =
    mode === "edit"
      ? `Update the saved ${appLabel} provider for this router.`
      : `Save a new ${appLabel} provider from a preset or a custom draft.`;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="ccswitch-openwrt-provider-ui-dialog ccswitch-openwrt-dialog-shell max-w-6xl overflow-hidden p-0"
        zIndex="alert"
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          initialFocusRef?.current?.focus();
        }}
        onCloseAutoFocus={(event) => {
          event.preventDefault();
        }}
      >
        <DialogHeader className="border-b border-border-default bg-gradient-to-br from-background via-background to-muted/40">
          <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
            <div className="space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                <span
                  className={cn(
                    "rounded-full px-3 py-1 text-xs font-semibold",
                    appPresentation.chipClassName,
                  )}
                >
                  {appLabel}
                </span>
                <span className="rounded-full border border-border-default bg-background/80 px-3 py-1 text-xs font-medium text-muted-foreground">
                  {mode === "edit"
                    ? "Update saved provider"
                    : "Save new provider"}
                </span>
              </div>
              <div className="space-y-1">
                <DialogTitle className="text-xl">{title}</DialogTitle>
                <DialogDescription className="max-w-2xl leading-relaxed">
                  {description}
                </DialogDescription>
              </div>
            </div>

            <div className="rounded-[24px] border border-border-default/80 bg-background/80 p-4 shadow-sm xl:max-w-sm">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                Save behavior
              </p>
              <p className="mt-2 text-sm text-muted-foreground">
                Choosing a preset only fills this draft. The current provider
                stays unchanged until you press{" "}
                {mode === "edit" ? "Update provider" : "Save provider"}.
              </p>
            </div>
          </div>
        </DialogHeader>
        <form className="flex min-h-0 flex-1 flex-col" onSubmit={onSubmit}>
          <div
            className={cn(
              "grid min-h-0 flex-1 gap-0",
              supportsPresets
                ? "grid-cols-1 grid-rows-[minmax(0,0.8fr)_minmax(0,1.2fr)] xl:grid-cols-[minmax(320px,0.88fr)_minmax(0,1.12fr)] xl:grid-rows-1"
                : "grid-cols-1",
            )}
          >
            {supportsPresets ? (
              <div className="flex min-h-0 flex-col border-b border-border-default bg-muted/10 xl:border-b-0 xl:border-r">
                <div
                  className="flex-1 overflow-y-auto px-5 py-5 sm:px-6"
                  data-ccswitch-dialog-scroll-region
                >
                  <div className="space-y-5">
                    <div className="space-y-1">
                      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                        Preset browser
                      </p>
                      <h3 className="text-base font-semibold text-foreground">
                        Start from an official endpoint, a platform template, or
                        a compatible gateway.
                      </h3>
                      <p className="text-sm text-muted-foreground">
                        Presets speed up setup but never save automatically.
                      </p>
                    </div>

                    <div className="space-y-4">
                      <section className="space-y-2">
                        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                          Custom
                        </p>
                        <PresetChip
                          active={selectedPresetId === "custom"}
                          label="Custom draft"
                          description="Keep the current fields editable without applying a preset."
                          meta="Manual endpoint and token configuration"
                          onClick={() => onPresetChange("custom")}
                        />
                      </section>

                      {presetGroups.map((group) => (
                        <section key={group.id} className="space-y-2">
                          <div className="space-y-1">
                            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                              {group.label}
                            </p>
                            <p className="text-xs leading-relaxed text-muted-foreground">
                              {group.hint}
                            </p>
                          </div>
                          <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-1">
                            {group.presets.map((preset) => (
                              <PresetChip
                                key={preset.id}
                                active={preset.id === selectedPresetId}
                                label={preset.label}
                                description={
                                  preset.description || preset.baseUrl
                                }
                                meta={preset.model || preset.baseUrl}
                                accentColor={preset.accentColor}
                                onClick={() => onPresetChange(preset.id)}
                              />
                            ))}
                          </div>
                        </section>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            ) : null}

            <div className="flex min-h-0 flex-col overflow-hidden">
              <div
                className="flex-1 space-y-4 overflow-y-auto px-5 py-5 sm:px-6"
                data-ccswitch-dialog-scroll-region
              >
                <section
                  className={cn(
                    "ccswitch-openwrt-group rounded-[24px] border p-4 shadow-sm",
                    selectedPreset
                      ? appPresentation.panelClassName
                      : "border-border-default/80 bg-muted/15",
                  )}
                >
                  <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                    Selected preset
                  </p>
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    <p className="text-base font-semibold text-foreground">
                      {selectedPreset ? selectedPreset.label : "Custom draft"}
                    </p>
                    {selectedPreset ? (
                      <span className="rounded-full border border-border-default/70 bg-background/80 px-2.5 py-1 text-xs font-medium text-muted-foreground">
                        {selectedPreset.model || "No model default"}
                      </span>
                    ) : null}
                  </div>
                  <p className="mt-2 text-sm text-muted-foreground">
                    {selectedPreset
                      ? selectedPreset.description ||
                        getGenericPresetDescription()
                      : "Custom mode keeps the current fields editable without applying a preset."}
                  </p>
                  <div className="mt-4 grid gap-2 text-xs text-muted-foreground sm:grid-cols-2">
                    <div className="ccswitch-openwrt-stat-card rounded-2xl border border-border-default/70 bg-background/70 px-3 py-2">
                      <span className="font-semibold text-foreground">
                        Base URL:
                      </span>{" "}
                      {draft.baseUrl || "Set in the form"}
                    </div>
                    <div className="ccswitch-openwrt-stat-card rounded-2xl border border-border-default/70 bg-background/70 px-3 py-2">
                      <span className="font-semibold text-foreground">
                        Token field:
                      </span>{" "}
                      {draft.tokenField}
                    </div>
                  </div>
                </section>

                <EditorSection
                  icon={Layers3}
                  title="Identity"
                  description="Name the saved provider and optionally pin a model default for this router."
                >
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div className="space-y-2">
                      <Label htmlFor={`${fieldIdPrefix}-name`}>
                        Provider name
                      </Label>
                      <Input
                        id={`${fieldIdPrefix}-name`}
                        ref={initialFocusRef}
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
                </EditorSection>

                <EditorSection
                  icon={Link2}
                  title="Endpoint & auth"
                  description="Configure the base URL, token field, and secret handling used by this provider."
                >
                  <div className="space-y-2">
                    <Label htmlFor={`${fieldIdPrefix}-base-url`}>
                      Base URL
                    </Label>
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
                      <Label htmlFor={`${fieldIdPrefix}-token`}>
                        API token
                      </Label>
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
                          mode === "edit" &&
                          supportsBlankSecretPreserve &&
                          hasStoredSecret
                            ? "Leave blank to keep the stored secret"
                            : "Enter the secret for this provider"
                        }
                        required={
                          mode === "add" || !supportsBlankSecretPreserve
                        }
                        disabled={disabled}
                      />
                    </div>
                  </div>

                  {mode === "edit" &&
                  supportsBlankSecretPreserve &&
                  hasStoredSecret ? (
                    <div className="ccswitch-openwrt-inline-note rounded-2xl border border-border-default/70 bg-background px-4 py-3 text-sm text-muted-foreground">
                      <div className="flex items-start gap-3">
                        <div className="rounded-2xl border border-border-default/70 bg-muted/20 p-2 text-muted-foreground">
                          <KeyRound className="h-4 w-4" />
                        </div>
                        <div className="space-y-1">
                          <p className="font-medium text-foreground">
                            Stored secret detected
                          </p>
                          <p>
                            Leave the token blank to preserve the stored secret.
                          </p>
                        </div>
                      </div>
                    </div>
                  ) : null}
                </EditorSection>

                <EditorSection
                  icon={FileText}
                  title="Optional notes"
                  description="Capture why this provider exists or how it should be used on this device."
                >
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
                </EditorSection>
              </div>
            </div>
          </div>

          <div className="flex flex-col gap-3 border-t border-border-default bg-muted/20 px-5 py-4 sm:px-6 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex items-start gap-3 text-sm text-muted-foreground">
              <div className="rounded-2xl border border-border-default/70 bg-background p-2 text-muted-foreground">
                <CheckCircle2 className="h-4 w-4" />
              </div>
              <p className="max-w-xl">
                Review the draft, then{" "}
                {mode === "edit"
                  ? "update the saved provider"
                  : "save the new provider"}
                . The router keeps the current configuration until this action
                completes.
              </p>
            </div>
            <div className="flex flex-col-reverse gap-2 sm:flex-row">
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
            </div>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
