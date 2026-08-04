import { registerDefaultTools } from "./register-defaults.js";
import type { ToolDefinition } from "./types.js";

function buildToolMap(tools: ToolDefinition[]): Map<string, ToolDefinition> {
  const byName = new Map<string, ToolDefinition>();
  for (const tool of tools) {
    const name = tool.schema.name;
    if (name) {
      byName.set(name, tool);
    }
  }
  return byName;
}

let toolsByName = buildToolMap(registerDefaultTools());
let pluginTools: ToolDefinition[] = [];

function rebuildToolRegistry(): void {
  toolsByName = buildToolMap([...registerDefaultTools(), ...pluginTools]);
}

export function pluginToolName(pluginId: string, toolName: string): string {
  return `${pluginId}__${toolName}`;
}

export function addPluginTools(tools: ToolDefinition[]): () => void {
  pluginTools = [...pluginTools, ...tools];
  rebuildToolRegistry();
  return () => {
    pluginTools = pluginTools.filter((tool) => !tools.includes(tool));
    rebuildToolRegistry();
  };
}

export function getTools(): ToolDefinition[] {
  return [...toolsByName.values()];
}

export function getTool(name: string): ToolDefinition | undefined {
  return toolsByName.get(name);
}

export function setTools(tools: ToolDefinition[]): void {
  toolsByName = buildToolMap(tools);
}

export function resetTools(): void {
  pluginTools = [];
  toolsByName = buildToolMap(registerDefaultTools());
}
