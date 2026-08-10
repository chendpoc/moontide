/** Model registry entry. See docs/spec/llm-provider.md §9.3. */

import type { AdapterFamily } from "../presets/presets.js";
import type { CapabilityStatus } from "../capabilities/types.js";
import type { ThinkingLevel } from "../protocol/types.js";

export interface ModelRoute {
  modelId: string;
  /** Adapters allowed for this model on this preset route. */
  adapterFamilies?: AdapterFamily[];
  /** Per-level thinking capability on this route. */
  thinkingLevels?: Partial<Record<ThinkingLevel, CapabilityStatus>>;
}

export interface ModelRegistryEntry {
  displayName: string;
  contextWindow: number;
  supportsTools: boolean;
  supportsThinking: boolean;
  maxOutputTokens: number;
  defaultThinking: ThinkingLevel;
  routes: Record<string, ModelRoute>;
  prefer: string[];
}
