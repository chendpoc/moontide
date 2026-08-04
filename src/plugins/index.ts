export {
  PluginHost,
  bootstrapPlugins,
  resolvePluginEntry,
} from "./host/index.js";
export { loadPluginManifest } from "./host/manifest.js";
export type {
  AttachedPlugin,
  PluginAttach,
  PluginKind,
  PluginManifest,
  PluginManifestEntry,
  SidecarTransport,
} from "./host/types.js";

export {
  defineSidecarPlugin,
  listSidecarHooks,
  listSidecarTools,
  resolveSidecarHookEntry,
} from "./sdk/index.js";
export type {
  SidecarHookEntry,
  SidecarHookSpec,
  SidecarPluginDefinition,
  SidecarToolDefinition,
  SidecarToolSpec,
} from "./sdk/index.js";

export { attachInProcessSidecar } from "./host/sidecar/bridge.js";
export { runSidecarProcess as runSidecarMain } from "./host/sidecar/run-sidecar.js";
