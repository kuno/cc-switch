import type {
  SharedProviderAppId,
  SharedProviderCapabilities,
  SharedProviderEditorPayload,
  SharedProviderState,
} from "./types";

export interface ProviderPlatformAdapter {
  listProviderState(appId: SharedProviderAppId): Promise<SharedProviderState>;
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
  restartServiceIfNeeded(): Promise<void>;
  getCapabilities(
    appId: SharedProviderAppId,
  ): Promise<SharedProviderCapabilities>;
}
