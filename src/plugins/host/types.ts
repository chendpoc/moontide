export type PluginKind = "mcp" | "sidecar" | "wasm";

export type PluginAttach = "startup" | "runtime" | "manual";

export type SidecarTransport = "stdio" | "in-process";

export interface PluginManifestEntry {
  id: string;
  kind: PluginKind;
  attach: PluginAttach;
  entry?: string;
  requires?: string[];
  capabilities?: string[];
  transport?: SidecarTransport;
}

export interface PluginManifest {
  plugins: PluginManifestEntry[];
}

export interface AttachedPlugin {
  id: string;
  kind: PluginKind;
  dispose: () => void;
}

export type { SidecarHookSpec, SidecarToolSpec } from "../sdk/types.js";
