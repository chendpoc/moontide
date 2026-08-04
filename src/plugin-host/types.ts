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

export interface SidecarHookSpec {
  phase: string;
  name: string;
  order?: number;
  errorPolicy?: "fail-open" | "fail-closed";
}

export interface SidecarToolSpec {
  name: string;
  schema: Record<string, unknown>;
}

export interface AttachedPlugin {
  id: string;
  kind: PluginKind;
  dispose: () => void;
}
