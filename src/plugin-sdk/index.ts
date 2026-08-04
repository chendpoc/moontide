export {
  defineSidecarPlugin,
  listSidecarHooks,
  listSidecarTools,
  resolveSidecarHookEntry,
} from "./define.js";
export type {
  SidecarHookEntry,
  SidecarPluginDefinition,
  SidecarToolDefinition,
} from "./define.js";
export { runSidecarProcess as runSidecarMain } from "../plugin-host/sidecar/run-sidecar.js";
