/** Model routing observation. See docs/spec/llm-provider.md §9.5. */

export interface RoutingDecision {
  logicalModelId: string;
  providerPresetId: string;
  vendorModelId: string;
  thinkingLevel: "off" | "low" | "medium" | "high";
  mode: "manual" | "auto";
  reason?: string;
}

/** Resolved provider route for LLMProvider selection (PR5). */
export interface ResolvedRoute {
  logicalModelId: string;
  providerPresetId: string;
  vendorModelId: string;
  adapterFamily: string;
  thinkingLevel: "off" | "low" | "medium" | "high";
}
