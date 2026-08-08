import type { ContentBlock } from "@moontide/llm/protocol";
import { formatToolSummary } from "./tool-summary.js";
import type { SessionItem, SessionItemKind, SessionMessage } from "./types.js";
import { newEventId } from "@moontide/shared/utils/id.js";

/** Accumulator while folding Session Item Log → SessionMessage[]. */
export interface MessagesFromItemsState {
  messages: SessionMessage[];
  pendingToolResults: ContentBlock[];
  pendingMeta: Pick<SessionMessage, "sessionId" | "turn" | "at">;
}

export function flushPendingToolResults(state: MessagesFromItemsState): void {
  if (state.pendingToolResults.length === 0) {
    return;
  }
  state.messages.push({
    id: newEventId(),
    sessionId: state.pendingMeta.sessionId,
    turn: state.pendingMeta.turn,
    at: state.pendingMeta.at,
    role: "user",
    content: [...state.pendingToolResults],
  });
  state.pendingToolResults.length = 0;
}

type ItemToMessagesHandler<K extends SessionItemKind> = (
  item: Extract<SessionItem, { kind: K }>,
  state: MessagesFromItemsState,
) => void;

const ITEM_TO_MESSAGES_HANDLERS: {
  [K in SessionItemKind]: ItemToMessagesHandler<K>;
} = {
  user_message(item, state) {
    flushPendingToolResults(state);
    state.messages.push({
      id: item.id,
      sessionId: item.sessionId,
      turn: item.turn,
      at: item.at,
      role: "user",
      content: item.text,
    });
    state.pendingMeta = { sessionId: item.sessionId, turn: item.turn, at: item.at };
  },
  assistant_message(item, state) {
    flushPendingToolResults(state);
    state.messages.push({
      id: item.id,
      sessionId: item.sessionId,
      turn: item.turn,
      at: item.at,
      role: "assistant",
      content: item.blocks,
    });
    state.pendingMeta = { sessionId: item.sessionId, turn: item.turn, at: item.at };
  },
  tool_outcome(item, state) {
    state.pendingMeta = { sessionId: item.sessionId, turn: item.turn, at: item.at };
    state.pendingToolResults.push({
      type: "tool_result",
      tool_use_id: item.toolUseId,
      content: formatToolSummary(item.resultSummary, item.artifactId),
    });
  },
  tool_invocation(_item, _state) {
    // Represented on assistant_message.blocks; not a standalone SessionMessage row.
  },
  compaction(_item, state) {
    flushPendingToolResults(state);
  },
  checkpoint_created(_item, state) {
    flushPendingToolResults(state);
  },
  routing(_item, state) {
    flushPendingToolResults(state);
  },
  protocol_reminder(item, state) {
    flushPendingToolResults(state);
    state.messages.push({
      id: item.id,
      sessionId: item.sessionId,
      turn: item.turn,
      at: item.at,
      role: "user",
      content: item.text,
    });
    state.pendingMeta = { sessionId: item.sessionId, turn: item.turn, at: item.at };
  },
};

/** Apply one SessionItem to the messages-from-items fold state. */
export function applyItemToMessages(item: SessionItem, state: MessagesFromItemsState): void {
  switch (item.kind) {
    case "user_message":
      ITEM_TO_MESSAGES_HANDLERS.user_message(item, state);
      break;
    case "assistant_message":
      ITEM_TO_MESSAGES_HANDLERS.assistant_message(item, state);
      break;
    case "tool_outcome":
      ITEM_TO_MESSAGES_HANDLERS.tool_outcome(item, state);
      break;
    case "tool_invocation":
      ITEM_TO_MESSAGES_HANDLERS.tool_invocation(item, state);
      break;
    case "compaction":
      ITEM_TO_MESSAGES_HANDLERS.compaction(item, state);
      break;
    case "checkpoint_created":
      ITEM_TO_MESSAGES_HANDLERS.checkpoint_created(item, state);
      break;
    case "routing":
      ITEM_TO_MESSAGES_HANDLERS.routing(item, state);
      break;
    case "protocol_reminder":
      ITEM_TO_MESSAGES_HANDLERS.protocol_reminder(item, state);
      break;
  }
}
