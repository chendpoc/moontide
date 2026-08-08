/** Resolved model profile for Context Composer budgeting. See docs/spec/llm-provider.md §9.4. */

export interface ModelProfile {
  logicalModelId: string;
  contextWindow: number;
  maxOutputTokens: number;
  supportsTools: boolean;
  supportsThinking: boolean;
  tokenCount: "api" | "estimate";
}
