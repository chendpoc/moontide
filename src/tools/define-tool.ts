import type { ToolDefinition, ToolHandler } from "./types.js";

export interface ToolSpec {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
  run: ToolHandler;
  enabled?: () => boolean;
}

/** Build ToolDefinition[] from declarative specs; skips specs with enabled() === false. */
export function defineTools(specs: ToolSpec[]): ToolDefinition[] {
  return specs
    .filter((spec) => spec.enabled?.() ?? true)
    .map((spec) => ({
      schema: {
        name: spec.name,
        description: spec.description,
        input_schema: spec.input_schema,
      },
      handler: spec.run,
    }));
}

export type ToolFactory = () => ToolDefinition[] | null;

export interface ToolManifestEntry {
  factory: ToolFactory;
  optional?: boolean;
}

/** Resolve manifest entries; skips optional factories that return null. */
export function resolveToolManifest(entries: ToolManifestEntry[]): ToolDefinition[] {
  const tools: ToolDefinition[] = [];
  for (const entry of entries) {
    const batch = entry.factory();
    if (batch) {
      tools.push(...batch);
    } else if (!entry.optional) {
      throw new Error("Required tool factory returned null");
    }
  }
  return tools;
}
