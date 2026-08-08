import type { ContentBlock, Message } from "@moontide/llm/protocol";
import type { SessionContext, SessionMessage } from "../types.js";

export interface MessagesFromContextOptions {
  /** Include only entries with turn <= this value. */
  upToTurn?: number;
}

function filterMessages(
  messages: readonly SessionMessage[],
  options?: MessagesFromContextOptions,
): SessionMessage[] {
  if (options?.upToTurn === undefined) {
    return [...messages];
  }
  return messages.filter((entry) => entry.turn <= options.upToTurn!);
}

function isToolResultOnly(content: string | ContentBlock[]): content is ContentBlock[] {
  return (
    Array.isArray(content) &&
    content.length > 0 &&
    content.every((block) => block.type === "tool_result")
  );
}

function flushToolResults(blocks: ContentBlock[], messages: Message[]): void {
  if (blocks.length === 0) {
    return;
  }
  messages.push({ role: "user", content: blocks });
}

/** SessionContext.messages → protocol Message[]. */
export function messagesFromContext(
  context: SessionContext,
  options?: MessagesFromContextOptions,
): Message[] {
  const messages: Message[] = [];
  let pendingToolResults: ContentBlock[] = [];

  for (const entry of filterMessages(context.messages, options)) {
    if (entry.role === "user" && isToolResultOnly(entry.content)) {
      pendingToolResults.push(...entry.content);
      continue;
    }

    flushToolResults(pendingToolResults, messages);
    pendingToolResults = [];
    messages.push({ role: entry.role, content: entry.content });
  }

  flushToolResults(pendingToolResults, messages);
  return messages;
}
