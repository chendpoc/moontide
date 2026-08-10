/** MoonTide LLM protocol types. See docs/spec/llm-provider.md §9.1. */

export type Role = "user" | "assistant";

export type ThinkingLevel = "off" | "low" | "medium" | "high";

/** Provider-neutral tool invocation policy. */
export type ToolChoice =
  | { mode: "none" }
  | { mode: "auto" }
  | { mode: "required" }
  | { mode: "specified"; name: string };

export type ToolArgumentStatus = "ok" | "malformed_tool_arguments";

export type ContentBlock =
  | { type: "text"; text: string }
  | { type: "thinking"; thinking: string }
  | {
      type: "tool_use";
      id: string;
      name: string;
      input: Record<string, unknown>;
      argumentStatus?: ToolArgumentStatus;
      rawArguments?: string;
    }
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

export type LLMStopReason =
  | "end_turn"
  | "tool_use"
  | "max_tokens"
  | "content_filter"
  | "provider_error";

export interface LLMRequest {
  model: string;
  system: string;
  messages: Message[];
  tools: ToolSchema[];
  maxTokens: number;
  thinkingLevel?: ThinkingLevel;
  /** Tool invocation policy; defaults via {@link resolveToolChoice}. */
  toolChoice?: ToolChoice;
  /** OpenAI-compatible JSON mode (`json_object`). */
  responseFormat?: "text" | "json_object";
  sessionId?: string;
  fallbacks?: string[];
}

export interface LLMResponse {
  content: ContentBlock[];
  stopReason: LLMStopReason;
  usage?: { inputTokens: number; outputTokens: number };
  model?: string;
}

/** Default tool choice when caller omits `toolChoice`. */
export function resolveToolChoice(request: Pick<LLMRequest, "tools" | "toolChoice">): ToolChoice | undefined {
  if (request.toolChoice) {
    return request.toolChoice;
  }
  if (request.tools.length === 0) {
    return undefined;
  }
  return { mode: "auto" };
}
