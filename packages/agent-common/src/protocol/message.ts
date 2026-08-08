/** Minimal LLM-facing message roles for agent-core transcript. */

export interface TextContent {
  type: "text";
  text: string;
}

export interface ToolCallContent {
  type: "toolCall";
  toolCallId: string;
  toolName: string;
  args: Record<string, unknown>;
}

export type AssistantContent = TextContent | ToolCallContent;

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
