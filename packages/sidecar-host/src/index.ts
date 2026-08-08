export { PluginHost, bootstrapPlugins, resolvePluginEntry } from "./host.js";
export { loadPluginManifest } from "./manifest.js";
export { attachInProcessSidecar } from "./sidecar/bridge.js";
export { runSidecarProcess } from "./sidecar/run-sidecar.js";
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
