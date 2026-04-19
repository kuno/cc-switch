import type {
  SharedProviderAppId,
  SharedProviderCapabilities,
  SharedProviderEditorPayload,
  SharedProviderFailoverState,
  SharedProviderState,
} from "./types";

export interface ProviderPlatformAdapter {
  listProviderState(appId: SharedProviderAppId): Promise<SharedProviderState>;
  getProviderFailoverState?(
    appId: SharedProviderAppId,
    providerId: string,
  ): Promise<SharedProviderFailoverState>;
  saveProvider(
    appId: SharedProviderAppId,
    draft: SharedProviderEditorPayload,
    providerId?: string,
  ): Promise<void>;
  activateProvider(
    appId: SharedProviderAppId,
    providerId: string,
  ): Promise<void>;
  deleteProvider(appId: SharedProviderAppId, providerId: string): Promise<void>;
  addToFailoverQueue?(
    appId: SharedProviderAppId,
    providerId: string,
  ): Promise<void>;
  removeFromFailoverQueue?(
    appId: SharedProviderAppId,
    providerId: string,
  ): Promise<void>;
  setAutoFailoverEnabled?(
    appId: SharedProviderAppId,
    enabled: boolean,
  ): Promise<void>;
  reorderFailoverQueue?(
    appId: SharedProviderAppId,
    providerIds: string[],
  ): Promise<void>;
  setMaxRetries?(
    appId: SharedProviderAppId,
    value: number,
  ): Promise<void>;
  uploadCodexAuth?(
    appId: SharedProviderAppId,
    providerId: string,
    authJsonText: string,
  ): Promise<void>;
  removeCodexAuth?(
    appId: SharedProviderAppId,
    providerId: string,
  ): Promise<void>;
  uploadClaudeAuth?(
    appId: SharedProviderAppId,
    providerId: string,
    authJsonText: string,
  ): Promise<void>;
  removeClaudeAuth?(
    appId: SharedProviderAppId,
    providerId: string,
  ): Promise<void>;
  restartServiceIfNeeded(): Promise<void>;
  getCapabilities(
    appId: SharedProviderAppId,
  ): Promise<SharedProviderCapabilities>;
}

export type ProviderFailoverControlAdapter = Required<
  Pick<
    ProviderPlatformAdapter,
    | "getProviderFailoverState"
    | "addToFailoverQueue"
    | "removeFromFailoverQueue"
    | "setAutoFailoverEnabled"
    | "reorderFailoverQueue"
    | "setMaxRetries"
  >
>;

export function supportsProviderFailoverControls(
  adapter: ProviderPlatformAdapter,
): adapter is ProviderPlatformAdapter & ProviderFailoverControlAdapter {
  return (
    typeof adapter.getProviderFailoverState === "function" &&
    typeof adapter.addToFailoverQueue === "function" &&
    typeof adapter.removeFromFailoverQueue === "function" &&
    typeof adapter.setAutoFailoverEnabled === "function" &&
    typeof adapter.reorderFailoverQueue === "function" &&
    typeof adapter.setMaxRetries === "function"
  );
}
