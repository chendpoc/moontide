import type { ToolSchema } from "@moontide/llm/protocol";
import type { ToolHandler, ToolPermissionRule, ToolCapability } from "@moontide/tools";
import type { SidecarHookPhase } from "./phases.js";
import type { SidecarHookSpec } from "./types.js";

export type SidecarHookHandler = (ctx: unknown) => unknown | Promise<unknown>;

export type SidecarHookEntry =
  | SidecarHookHandler
  | {
      handler: SidecarHookHandler;
      order?: number;
      errorPolicy?: "fail-open" | "fail-closed";
    };

export interface SidecarToolDefinition {
  schema: ToolSchema;
  handler: ToolHandler;
  permission?: ToolPermissionRule;
  capability?: ToolCapability;
}

export interface SidecarPluginDefinition {
  hooks?: Partial<Record<SidecarHookPhase, Record<string, SidecarHookEntry>>>;
  tools?: Record<string, SidecarToolDefinition>;
}

export function defineSidecarPlugin(definition: SidecarPluginDefinition): SidecarPluginDefinition {
  return definition;
}

export function resolveSidecarHookEntry(entry: SidecarHookEntry): {
  handler: SidecarHookHandler;
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
    permission: tool.permission,
    capability: tool.capability,
  }));
}
