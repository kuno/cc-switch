import { CheckCircle2, KeyRound, Pencil, ShieldCheck, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import type { SharedProviderAppId, SharedProviderView } from "../domain";
import {
  SHARED_PROVIDER_APP_PRESENTATION,
  type SharedProviderCardActionVisibility,
  getSharedProviderDisplayName,
} from "./presentation";

type SharedProviderDetailTab = "general" | "credentials";

interface SharedProviderDetailPanelProps {
  appId: SharedProviderAppId;
  provider: SharedProviderView;
  detailTab: SharedProviderDetailTab;
  actionVisibility: SharedProviderCardActionVisibility;
  isBusy?: boolean;
  isActivatePending?: boolean;
  onDetailTabChange: (tab: SharedProviderDetailTab) => void;
  onEdit?: () => void;
  onActivate?: () => void;
}

function DetailField({
  label,
  value,
  mono = false,
  wide = false,
}: {
  label: string;
  value: string;
  mono?: boolean;
  wide?: boolean;
}) {
  return (
    <div
      className={cn(
        "ccswitch-openwrt-stat-card rounded-2xl border border-border-default/70 bg-background/80 p-4",
        wide && "sm:col-span-2",
      )}
    >
      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
        {label}
      </p>
      <p
        className={cn(
          "mt-2 break-all text-sm font-medium text-foreground",
          mono && "font-mono text-[13px]",
        )}
      >
        {value}
      </p>
    </div>
  );
}

export function SharedProviderDetailPanel({
  appId,
  provider,
  detailTab,
  actionVisibility,
  isBusy = false,
  isActivatePending = false,
  onDetailTabChange,
  onEdit,
  onActivate,
}: SharedProviderDetailPanelProps) {
  const appPresentation = SHARED_PROVIDER_APP_PRESENTATION[appId];
  const providerName = getSharedProviderDisplayName(provider);
  const secretValue = provider.tokenConfigured
    ? provider.tokenMasked || "Stored secret"
    : "No stored secret";
  const secretPolicy = provider.tokenConfigured
    ? "Blank preserves the stored secret during edits."
    : "Add a token in the editor to store credentials for this provider.";
  const notesValue = provider.notes || "No notes saved for this provider.";

  return (
    <section
      data-ccswitch-region="provider-detail-panel"
      className="ccswitch-openwrt-group rounded-[24px] border border-border-default/80 bg-background/85 p-4 shadow-sm sm:p-5"
    >
      <div className="flex flex-col gap-4 border-b border-border-default/70 pb-4">
        <div className="flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <span
                className={cn(
                  "rounded-full px-3 py-1 text-xs font-semibold",
                  appPresentation.chipClassName,
                )}
              >
                {appPresentation.label}
              </span>
              <span className="rounded-full border border-border-default bg-background px-3 py-1 text-xs font-medium text-muted-foreground">
                {provider.active ? "Active route" : "Saved provider"}
              </span>
              {provider.tokenConfigured ? (
                <span className="rounded-full border border-border-default bg-background px-3 py-1 text-xs font-medium text-muted-foreground">
                  Stored secret
                </span>
              ) : null}
            </div>
            <div className="space-y-1">
              <h3 className="text-xl font-semibold text-foreground">
                {providerName}
              </h3>
              <p className="text-sm text-muted-foreground">
                Review selected-provider details using the current OpenWrt
                provider contract, then open the editor when you need to change
                General or Credentials values.
              </p>
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            {actionVisibility.edit ? (
              <Button type="button" onClick={onEdit} disabled={isBusy}>
                <Pencil className="h-4 w-4" />
                Edit provider
              </Button>
            ) : null}
            {actionVisibility.activate ? (
              <Button
                type="button"
                variant="outline"
                onClick={onActivate}
                disabled={isBusy}
                aria-busy={isActivatePending}
              >
                {isActivatePending ? (
                  <Zap className="h-4 w-4 animate-pulse" />
                ) : (
                  <Zap className="h-4 w-4" />
                )}
                Activate route
              </Button>
            ) : null}
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-3">
          <DetailField
            label="Base URL"
            value={provider.baseUrl || "No base URL saved"}
            mono
          />
          <DetailField
            label="Token field"
            value={provider.tokenField}
            mono
          />
          <DetailField
            label="Provider ID"
            value={provider.providerId || "No provider ID"}
            mono
          />
        </div>
      </div>

      <Tabs
        value={detailTab}
        onValueChange={(value) =>
          onDetailTabChange(value as SharedProviderDetailTab)
        }
        className="mt-4 w-full"
      >
        <TabsList className="grid w-full grid-cols-2 rounded-2xl border border-border-default/70 bg-muted/30 p-1">
          <TabsTrigger value="general">General</TabsTrigger>
          <TabsTrigger value="credentials">Credentials</TabsTrigger>
        </TabsList>

        <TabsContent value="general" className="mt-4 space-y-4">
          <div
            className={cn(
              "rounded-[24px] border p-4 shadow-sm",
              appPresentation.panelClassName,
            )}
          >
            <div className="flex items-start gap-3">
              <div className="rounded-2xl border border-border-default/70 bg-background/80 p-2 text-muted-foreground">
                <CheckCircle2 className="h-4 w-4" />
              </div>
              <div className="space-y-1">
                <p className="text-base font-semibold text-foreground">
                  General provider settings
                </p>
                <p className="text-sm text-muted-foreground">
                  These values come from the selected-provider detail contract
                  already available on the OpenWrt path.
                </p>
              </div>
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <DetailField label="Provider name" value={providerName} />
            <DetailField
              label="Route status"
              value={provider.active ? "Active provider" : "Saved provider"}
            />
            <DetailField
              label="Base URL"
              value={provider.baseUrl || "No base URL saved"}
              mono
              wide
            />
            <DetailField
              label="Model"
              value={provider.model || "No model override"}
            />
            <DetailField
              label="Notes"
              value={notesValue}
              wide
            />
          </div>
        </TabsContent>

        <TabsContent value="credentials" className="mt-4 space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <DetailField label="Provider name" value={providerName} />
            <DetailField label="Secret policy" value={secretPolicy} />
            <DetailField
              label="Token field"
              value={provider.tokenField}
              mono
            />
            <DetailField
              label="Stored secret state"
              value={secretValue}
              mono={provider.tokenConfigured}
            />
            <DetailField
              label="Endpoint"
              value={provider.baseUrl || "No base URL saved"}
              mono
              wide
            />
            <DetailField
              label="Model default"
              value={provider.model || "No model override"}
            />
            <DetailField label="Notes" value={notesValue} wide />
          </div>

          <div className="ccswitch-openwrt-inline-note rounded-2xl border border-border-default/70 bg-muted/20 px-4 py-3 text-sm text-muted-foreground">
            <div className="flex items-start gap-3">
              <div className="rounded-2xl border border-border-default/70 bg-background/80 p-2 text-muted-foreground">
                <ShieldCheck className="h-4 w-4" />
              </div>
              <div className="space-y-1">
                <p className="font-medium text-foreground">
                  Secret-safe reads only
                </p>
                <p>
                  This pane shows token field and masked secret state only. Raw
                  secrets are never rendered here.
                </p>
              </div>
            </div>
          </div>

          {provider.tokenConfigured ? (
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
                    Leave the token blank in the editor to preserve the stored
                    secret.
                  </p>
                </div>
              </div>
            </div>
          ) : null}
        </TabsContent>
      </Tabs>
    </section>
  );
}
