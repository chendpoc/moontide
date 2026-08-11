export {
  PluginHost,
  bootstrapPlugins,
  resolvePluginEntry,
  loadPluginManifest,
  attachInProcessSidecar,
  runSidecarProcess as runSidecarMain,
} from "@moontide/sidecar-host";
export type {
  AttachedPlugin,
  PluginAttach,
  PluginKind,
  PluginManifest,
  PluginManifestEntry,
  SidecarHookSpec,
  SidecarToolSpec,
  SidecarTransport,
} from "@moontide/sidecar-host";

export {
  defineSidecarPlugin,
  listSidecarHooks,
  listSidecarTools,
  resolveSidecarHookEntry,
} from "@moontide/plugins-sdk";
export type {
  SidecarHookEntry,
  SidecarHookHandler,
  SidecarHookPhase,
  SidecarPluginDefinition,
  SidecarToolDefinition,
} from "@moontide/plugins-sdk";
