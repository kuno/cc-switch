import type { SharedRuntimeState } from "./types";

export interface RuntimeSurfacePlatformAdapter {
  getRuntimeState(): Promise<SharedRuntimeState>;
}
