import type {
  AssistantMessage,
  ToolResultMessage,
  UserMessage,
} from "@moontide/run-protocol";
import type { ContentBlock } from "@moontide/llm/protocol";
import type { LlmMessage } from "@moontide/run-protocol";
import type { Message } from "@moontide/llm/protocol";
import { summarizeToolResultContent } from "@moontide/session";
import type { ToolResultSummary } from "@moontide/session";

export function userMessageToSessionText(message: UserMessage): string {
  return message.content;
}

export function assistantMessageToContentBlocks(message: AssistantMessage): ContentBlock[] {
  const blocks: ContentBlock[] = [];
  for (const block of message.content) {
    if (block.type === "text") {
      blocks.push({ type: "text", text: block.text });
      continue;
    }
    if (block.type === "thinking") {
      blocks.push({ type: "thinking", thinking: block.text });
      continue;
    }
    blocks.push({
      type: "tool_use",
      id: block.toolCallId,
      name: block.toolName,
      input: block.args,
      ...(block.argumentStatus !== undefined ? { argumentStatus: block.argumentStatus } : {}),
      ...(block.rawArguments !== undefined ? { rawArguments: block.rawArguments } : {}),
    });
  }
  return blocks;
}

export function toolResultToSummary(message: ToolResultMessage): ToolResultSummary {
  const prefix = message.isError ? "Error: " : "";
  return summarizeToolResultContent(`${prefix}${message.content}`);
}

export function llmProtocolMessagesToPort(messages: readonly Message[]): LlmMessage[] {
  const out: LlmMessage[] = [];
  for (const message of messages) {
    if (typeof message.content === "string") {
      out.push({ role: message.role, content: message.content });
      continue;
    }
    for (const block of message.content) {
      if (block.type === "text") {
        out.push({ role: message.role, content: block.text });
      } else if (block.type === "tool_result") {
        out.push({
          role: "tool",
          content: typeof block.content === "string" ? block.content : JSON.stringify(block.content),
          toolCallId: block.tool_use_id,
        });
      }
    }
  }
  return out;
}

export function llmResponseToAssistantMessage(
  content: ContentBlock[],
  timestamp = Date.now(),
): AssistantMessage {
  const assistantContent: AssistantMessage["content"] = [];
  for (const block of content) {
    if (block.type === "text") {
      assistantContent.push({ type: "text", text: block.text });
      continue;
    }
    if (block.type === "thinking") {
      assistantContent.push({ type: "thinking", text: block.thinking });
      continue;
    }
    if (block.type === "tool_use") {
      assistantContent.push({
        type: "toolCall",
        toolCallId: block.id,
        toolName: block.name,
        args: block.input,
        ...(block.argumentStatus !== undefined ? { argumentStatus: block.argumentStatus } : {}),
        ...(block.rawArguments !== undefined ? { rawArguments: block.rawArguments } : {}),
      });
    }
  }
  return { role: "assistant", content: assistantContent, timestamp };
}
