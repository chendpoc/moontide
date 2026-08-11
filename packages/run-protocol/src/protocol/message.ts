/** Minimal LLM-facing message roles for agent-core transcript. */

import type { ToolArgumentStatus } from "@moontide/shared/protocol/tool.js";

export type { ToolArgumentStatus };

export interface TextContent {
  type: "text";
  text: string;
}

export interface ThinkingContent {
  type: "thinking";
  text: string;
}

export interface ToolCallContent {
  type: "toolCall";
  toolCallId: string;
  toolName: string;
  args: Record<string, unknown>;
  argumentStatus?: ToolArgumentStatus;
  rawArguments?: string;
}

export type AssistantContent = TextContent | ThinkingContent | ToolCallContent;

export interface UserMessage {
  role: "user";
  content: string;
  timestamp?: number;
}

export interface AssistantMessage {
  role: "assistant";
  content: AssistantContent[];
  timestamp?: number;
}

export interface ToolResultMessage {
  role: "toolResult";
  toolCallId: string;
  toolName: string;
  content: string;
  isError?: boolean;
  timestamp?: number;
}

export type AgentMessage = UserMessage | AssistantMessage | ToolResultMessage;

export function isAssistantMessage(message: AgentMessage): message is AssistantMessage {
  return message.role === "assistant";
}
