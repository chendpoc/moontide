import type { HookPhase } from "../agent/hooks/phases.js";
import type { HookHandler } from "../agent/hooks/types.js";
import type { ToolSchema } from "../llm/protocol/types.js";
import type { ToolHandler } from "../tools/types.js";
import type { SidecarHookSpec } from "../plugin-host/types.js";

export type SidecarHookEntry =
  | HookHandler<HookPhase>
  | {
      handler: HookHandler<HookPhase>;
      order?: number;
      errorPolicy?: "fail-open" | "fail-closed";
    };

export interface SidecarToolDefinition {
  schema: ToolSchema;
  handler: ToolHandler;
}

export interface SidecarPluginDefinition {
  hooks?: Partial<Record<HookPhase, Record<string, SidecarHookEntry>>>;
  tools?: Record<string, SidecarToolDefinition>;
}

export function defineSidecarPlugin(definition: SidecarPluginDefinition): SidecarPluginDefinition {
  return definition;
}

export function resolveSidecarHookEntry(entry: SidecarHookEntry): {
  handler: HookHandler<HookPhase>;
  order?: number;
  errorPolicy?: "fail-open" | "fail-closed";
} {
  if (typeof entry === "function") {
    return { handler: entry };
  }
  return entry;
}

export function listSidecarHooks(definition: SidecarPluginDefinition): SidecarHookSpec[] {
  const specs: SidecarHookSpec[] = [];
  for (const [phase, handlers] of Object.entries(definition.hooks ?? {})) {
    for (const [name, entry] of Object.entries(handlers ?? {})) {
      const resolved = resolveSidecarHookEntry(entry);
      specs.push({
        phase,
        name,
        order: resolved.order,
        errorPolicy: resolved.errorPolicy,
      });
    }
  }
  return specs;
}

export function listSidecarTools(
  definition: SidecarPluginDefinition,
): Array<{ name: string } & SidecarToolDefinition> {
  return Object.entries(definition.tools ?? {}).map(([name, tool]) => ({
    name,
    schema: tool.schema,
    handler: tool.handler,
  }));
}
