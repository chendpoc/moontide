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

export class ToolRegistry {
  private toolsByName: Map<string, ToolDefinition>;
  private pluginTools: ToolDefinition[] = [];

  constructor(private readonly builtinFactory: () => ToolDefinition[] = () => []) {
    this.toolsByName = buildToolMap(builtinFactory());
  }

  private rebuild(): void {
    this.toolsByName = buildToolMap([...this.builtinFactory(), ...this.pluginTools]);
  }

  pluginToolName(pluginId: string, toolName: string): string {
    return `${pluginId}__${toolName}`;
  }

  addPluginTools(tools: ToolDefinition[]): () => void {
    this.pluginTools = [...this.pluginTools, ...tools];
    this.rebuild();
    return () => {
      this.pluginTools = this.pluginTools.filter((tool) => !tools.includes(tool));
      this.rebuild();
    };
  }

  getTools(): ToolDefinition[] {
    return [...this.toolsByName.values()];
  }

  getTool(name: string): ToolDefinition | undefined {
    return this.toolsByName.get(name);
  }

  getToolSchemas() {
    return this.getTools().map((tool) => tool.schema);
  }

  /** Test-only: replace the full builtin + plugin catalog. */
  setTools(tools: ToolDefinition[]): void {
    this.toolsByName = buildToolMap(tools);
  }

  reset(): void {
    this.pluginTools = [];
    this.rebuild();
  }

  /** Rebuild catalog after dynamic gates change (e.g. Deep Task Mode via `deep:` prefix). */
  refresh(): void {
    this.rebuild();
  }
}
