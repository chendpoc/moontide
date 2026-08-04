import type { ToolDefinition, ToolHandler, ToolPermissionRule } from "./types.js";

export interface ToolSpec {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
  permission: ToolPermissionRule;
  run: ToolHandler;
  enabled?: () => boolean;
}

function schemaProperties(spec: ToolSpec): Record<string, unknown> | undefined {
  const props = spec.input_schema.properties;
  return props && typeof props === "object" ? (props as Record<string, unknown>) : undefined;
}

/** Validate permission rule references exist on the tool input schema. */
export function validateToolSpec(spec: ToolSpec): void {
  const props = schemaProperties(spec);
  switch (spec.permission.kind) {
    case "path":
    case "bash":
      if (!props || !(spec.permission.field in props)) {
        throw new Error(
          `Tool "${spec.name}": ${spec.permission.kind} permission requires input_schema.properties.${spec.permission.field}`,
        );
      }
      break;
    case "fixed":
      if (!["allow", "deny", "ask"].includes(spec.permission.decision)) {
        throw new Error(`Tool "${spec.name}": invalid fixed permission decision`);
      }
      break;
  }
}

/** Build ToolDefinition[] from declarative specs; skips specs with enabled() === false. */
export function defineTools(specs: ToolSpec[]): ToolDefinition[] {
  return specs
    .filter((spec) => spec.enabled?.() ?? true)
    .map((spec) => {
      validateToolSpec(spec);
      return {
        schema: {
          name: spec.name,
          description: spec.description,
          input_schema: spec.input_schema,
        },
        handler: spec.run,
        permission: spec.permission,
      };
    });
}

export type ToolFactory = () => ToolDefinition[] | null;

export interface ToolManifestEntry {
  factory: ToolFactory;
  optional?: boolean;
}

function validateToolDefinition(tool: ToolDefinition): void {
  if (!tool.schema.name) {
    throw new Error("ToolDefinition missing schema.name");
  }
  if (!tool.permission) {
    throw new Error(`Tool "${tool.schema.name}" missing permission`);
  }
}

/** Resolve manifest entries; skips optional factories that return null. */
export function resolveToolManifest(entries: ToolManifestEntry[]): ToolDefinition[] {
  const tools: ToolDefinition[] = [];
  for (const entry of entries) {
    const batch = entry.factory();
    if (batch) {
      for (const tool of batch) {
        validateToolDefinition(tool);
      }
      tools.push(...batch);
    } else if (!entry.optional) {
      throw new Error("Required tool factory returned null");
    }
  }
  return tools;
}
