import type { ContentBlock, Message } from "../../../llm/protocol/types.js";
import type { SessionLog } from "../../../session/log-types.js";

export interface LogToMessagesOptions {
  /** Include only log records with turn <= this value. */
  upToTurn?: number;
}

function filterLog(log: readonly SessionLog[], options?: LogToMessagesOptions): SessionLog[] {
  if (options?.upToTurn === undefined) {
    return [...log];
  }
  return log.filter((record) => record.turn <= options.upToTurn!);
}

function flushToolResults(blocks: ContentBlock[], messages: Message[]): void {
  if (blocks.length === 0) {
    return;
  }
  messages.push({ role: "user", content: blocks });
}

/** Replay session log into Ocula LLM messages (pure; no compaction). */
export function logToMessages(
  log: readonly SessionLog[],
  options?: LogToMessagesOptions,
): Message[] {
  const messages: Message[] = [];
  let pendingToolResults: ContentBlock[] = [];

  for (const record of filterLog(log, options)) {
    switch (record.kind) {
      case "user_message":
        flushToolResults(pendingToolResults, messages);
        pendingToolResults = [];
        messages.push({ role: "user", content: record.text });
        break;
      case "assistant_message":
        flushToolResults(pendingToolResults, messages);
        pendingToolResults = [];
        messages.push({ role: "assistant", content: record.blocks });
        break;
      case "tool_outcome":
        pendingToolResults.push({
          type: "tool_result",
          tool_use_id: record.toolUseId,
          content: record.resultSummary.summary,
        });
        break;
      case "tool_invocation":
      case "compaction":
      case "checkpoint_created":
      case "routing":
        break;
      default: {
        const _exhaustive: never = record;
        void _exhaustive;
      }
    }
  }

  flushToolResults(pendingToolResults, messages);
  return messages;
}
