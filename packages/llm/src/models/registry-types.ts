/** Model registry entry. See docs/spec/llm-provider.md §9.3. */

export interface ModelRoute {
  modelId: string;
}

export interface ModelRegistryEntry {
  displayName: string;
  contextWindow: number;
  supportsTools: boolean;
  supportsThinking: boolean;
  maxOutputTokens: number;
  defaultThinking: "off" | "low" | "medium" | "high";
  routes: Record<string, ModelRoute>;
  prefer: string[];
}
