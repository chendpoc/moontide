/** Model routing observation. See docs/spec/llm-provider.md §9.5. */

import type { AdapterFamily } from "../presets/presets.js";
import type { ThinkingLevel } from "../protocol/types.js";

export interface RoutingDecision {
  logicalModelId: string;
  providerPresetId: string;
  vendorModelId: string;
  thinkingLevel: ThinkingLevel;
  mode: "manual" | "auto";
  reason?: string;
}

/** Resolved provider route for LLMProvider selection. */
export interface ResolvedRoute {
  logicalModelId: string;
  providerPresetId: string;
  vendorModelId: string;
  adapterFamily: AdapterFamily;
  thinkingLevel: ThinkingLevel;
}
