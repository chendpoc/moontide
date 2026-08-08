import type { ContentBlock } from "@moontide/llm/protocol";
import {
  applyItemToMessages,
  flushPendingToolResults,
  type MessagesFromItemsState,
} from "../item-handlers.js";
import type { SessionItem, SessionMessage } from "../types.js";

/** Session Item Log → in-memory SessionMessage[] (skips compaction / checkpoint / routing). */
export function messagesFromItems(items: readonly SessionItem[]): SessionMessage[] {
  const state: MessagesFromItemsState = {
    messages: [],
    pendingToolResults: [] as ContentBlock[],
    pendingMeta: {
      sessionId: "",
      turn: 0,
      at: new Date().toISOString(),
    },
  };

  for (const item of items) {
    applyItemToMessages(item, state);
  }

  flushPendingToolResults(state);
  return state.messages;
}
