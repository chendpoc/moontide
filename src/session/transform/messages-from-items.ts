import type { ContentBlock } from "../../llm/protocol/types.js";
import { formatToolSummary } from "../../context/composer/artifact/project.js";
import { newEventId } from "../../utils/id.js";
import type { SessionItem, SessionMessage } from "../types.js";

function flushToolResults(
  pending: ContentBlock[],
  meta: Pick<SessionMessage, "sessionId" | "turn" | "at">,
  messages: SessionMessage[],
): void {
  if (pending.length === 0) {
    return;
  }
  messages.push({
    id: newEventId(),
    sessionId: meta.sessionId,
    turn: meta.turn,
    at: meta.at,
    role: "user",
    content: [...pending],
  });
  pending.length = 0;
}

/** Session Item Log → in-memory SessionMessage[] (skips compaction / checkpoint / routing). */
export function messagesFromItems(items: readonly SessionItem[]): SessionMessage[] {
  const messages: SessionMessage[] = [];
  const pendingToolResults: ContentBlock[] = [];
  let pendingMeta: Pick<SessionMessage, "sessionId" | "turn" | "at"> = {
    sessionId: "",
    turn: 0,
    at: new Date().toISOString(),
  };

  for (const item of items) {
    switch (item.kind) {
      case "user_message":
        flushToolResults(pendingToolResults, pendingMeta, messages);
        messages.push({
          id: item.id,
          sessionId: item.sessionId,
          turn: item.turn,
          at: item.at,
          role: "user",
          content: item.text,
        });
        pendingMeta = { sessionId: item.sessionId, turn: item.turn, at: item.at };
        break;
      case "assistant_message":
        flushToolResults(pendingToolResults, pendingMeta, messages);
        messages.push({
          id: item.id,
          sessionId: item.sessionId,
          turn: item.turn,
          at: item.at,
          role: "assistant",
          content: item.blocks,
        });
        pendingMeta = { sessionId: item.sessionId, turn: item.turn, at: item.at };
        break;
      case "tool_outcome":
        pendingMeta = { sessionId: item.sessionId, turn: item.turn, at: item.at };
        pendingToolResults.push({
          type: "tool_result",
          tool_use_id: item.toolUseId,
          content: formatToolSummary(item.resultSummary, item.artifactId),
        });
        break;
      case "tool_invocation":
        break;
      case "compaction":
      case "checkpoint_created":
      case "routing":
        flushToolResults(pendingToolResults, pendingMeta, messages);
        break;
      default: {
        const _exhaustive: never = item;
        void _exhaustive;
      }
    }
  }

  flushToolResults(pendingToolResults, pendingMeta, messages);
  return messages;
}

/** @deprecated Use messagesFromItems */
export function contextFromItems(items: readonly SessionItem[]): SessionMessage[] {
  return messagesFromItems(items);
}
