/** MoonTide LLM protocol types. See docs/spec/llm-provider.md §9.1. */

export type Role = "user" | "assistant";

export type ContentBlock =
  | { type: "text"; text: string }
  | { type: "thinking"; thinking: string }
  | { type: "tool_use"; id: string; name: string; input: Record<string, unknown> }
  | { type: "tool_result"; tool_use_id: string; content: string | ContentBlock[] };

export interface Message {
  role: Role;
  content: string | ContentBlock[];
}

export interface ToolSchema {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}

export interface LLMRequest {
  model: string;
  system: string;
  messages: Message[];
  tools: ToolSchema[];
  maxTokens: number;
  thinkingLevel?: "off" | "low" | "medium" | "high";
  sessionId?: string;
  fallbacks?: string[];
}

export interface LLMResponse {
  content: ContentBlock[];
  stopReason: string;
  usage?: { inputTokens: number; outputTokens: number };
  model?: string;
}
