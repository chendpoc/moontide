export type {
  AttachedPlugin,
  PluginAttach,
  PluginKind,
  PluginManifest,
  PluginManifestEntry,
  SidecarHookSpec,
  SidecarToolSpec,
  SidecarTransport,
} from "./types.js";
export { loadPluginManifest } from "./manifest.js";
export { PluginHost, bootstrapPlugins, getPluginHost, resetPluginHost } from "./host.js";
export { SidecarBridge, attachInProcessSidecar } from "./sidecar/bridge.js";
