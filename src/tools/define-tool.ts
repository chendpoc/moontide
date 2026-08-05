import { validationError } from "../errors/factories.js";
import type { ToolDefinition, ToolHandler, ToolPermissionRule, ToolCapability } from "./types.js";

const TOOL_CAPABILITIES: readonly ToolCapability[] = ["read", "write", "network", "exec", "mixed"];

export interface ToolSpec {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
  permission: ToolPermissionRule;
  capability: ToolCapability;
  run: ToolHandler;
  enabled?: () => boolean;
}

function schemaProperties(spec: ToolSpec): Record<string, unknown> | undefined {
  const props = spec.input_schema.properties;
  return props && typeof props === "object" ? (props as Record<string, unknown>) : undefined;
}

function specToDefinition(spec: ToolSpec): ToolDefinition {
  return {
    schema: {
      name: spec.name,
      description: spec.description,
      input_schema: spec.input_schema,
    },
    handler: spec.run,
    permission: spec.permission,
    capability: spec.capability,
  };
}

/** Validate permission rule references exist on the tool input schema. */
export function validateToolSpec(spec: ToolSpec): void {
  if (!spec.name) {
    throw validationError("ToolSpec missing name");
  }
  if (!spec.description) {
    throw validationError(`Tool "${spec.name}": missing description`);
  }
  if (spec.input_schema.type !== "object") {
    throw validationError(`Tool "${spec.name}": input_schema.type must be "object"`);
  }
  if (!TOOL_CAPABILITIES.includes(spec.capability)) {
    throw validationError(`Tool "${spec.name}": invalid capability "${spec.capability}"`);
  }

  const props = schemaProperties(spec);
  switch (spec.permission.kind) {
    case "path":
    case "bash":
      if (!props || !(spec.permission.field in props)) {
        throw validationError(
          `Tool "${spec.name}": ${spec.permission.kind} permission requires input_schema.properties.${spec.permission.field}`,
        );
      }
      break;
    case "fixed":
      if (!["allow", "deny", "ask"].includes(spec.permission.decision)) {
        throw validationError(`Tool "${spec.name}": invalid fixed permission decision`);
      }
      break;
  }
}

export function defineTool(spec: ToolSpec): ToolDefinition {
  validateToolSpec(spec);
  return specToDefinition(spec);
}

export function defineOptionalTool(
  spec: ToolSpec,
  enabled: () => boolean,
): ToolDefinition | null {
  if (!enabled()) {
    return null;
  }
  return defineTool(spec);
}

/** Reconstruct ToolSpec from a registered tool (conformance tests). */
export function toolDefinitionToSpec(tool: ToolDefinition): ToolSpec {
  return {
    name: tool.schema.name,
    description: tool.schema.description,
    input_schema: tool.schema.input_schema as Record<string, unknown>,
    permission: tool.permission,
    capability: tool.capability,
    run: tool.handler,
  };
}

/** Build ToolDefinition[] from declarative specs; skips specs with enabled() === false. */
export function defineTools(specs: ToolSpec[]): ToolDefinition[] {
  return specs
    .filter((spec) => spec.enabled?.() ?? true)
    .map((spec) => defineTool(spec));
}

export type ToolFactory = () => ToolDefinition[] | null;

export interface ToolManifestEntry {
  factory: ToolFactory;
  optional?: boolean;
}

function validateToolDefinition(tool: ToolDefinition): void {
  if (!tool.schema.name) {
    throw validationError("ToolDefinition missing schema.name");
  }
  if (!tool.permission) {
    throw validationError(`Tool "${tool.schema.name}" missing permission`);
  }
  if (!tool.capability) {
    throw validationError(`Tool "${tool.schema.name}" missing capability`);
  }
  validateToolSpec(toolDefinitionToSpec(tool));
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
      throw validationError("Required tool factory returned null");
    }
  }
  return tools;
}
