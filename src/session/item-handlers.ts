import type { ContentBlock } from "../llm/protocol/types.js";
import { formatToolSummary } from "../context/composer/artifact/project.js";
import { emitDraft } from "../log/event-hub.js";
import { traceDraftsFromBlocks } from "./block-registry.js";
import type { SessionItem, SessionItemKind, SessionMessage } from "./types.js";
import { newEventId } from "../utils/id.js";
import { truncateOneLine } from "../utils/text.js";

function previewInput(input: Record<string, unknown>): string {
  const parts = Object.entries(input)
    .slice(0, 3)
    .map(([key, value]) => `${key}=${String(value).slice(0, 30)}`);
  return parts.join(" ");
}

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

type ItemToMessagesHandler = (item: SessionItem, state: MessagesFromItemsState) => void;

const ITEM_TO_MESSAGES_HANDLERS: Record<SessionItemKind, ItemToMessagesHandler> = {
  user_message(item, state) {
    if (item.kind !== "user_message") {
      return;
    }
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
    if (item.kind !== "assistant_message") {
      return;
    }
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
    if (item.kind !== "tool_outcome") {
      return;
    }
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
  compaction(item, state) {
    if (item.kind !== "compaction") {
      return;
    }
    flushPendingToolResults(state);
  },
  checkpoint_created(_item, state) {
    flushPendingToolResults(state);
  },
  routing(_item, state) {
    flushPendingToolResults(state);
  },
};

/** Apply one SessionItem to the messages-from-items fold state. */
export function applyItemToMessages(item: SessionItem, state: MessagesFromItemsState): void {
  ITEM_TO_MESSAGES_HANDLERS[item.kind](item, state);
}

type DeriveHandler = (item: SessionItem) => void;

const DERIVE_ITEM_HANDLERS: Record<SessionItemKind, DeriveHandler> = {
  user_message(item) {
    if (item.kind !== "user_message") {
      return;
    }
    emitDraft({
      turn: item.turn,
      phase: "pre_llm",
      channel: "conversation",
      kind: "user_prompt",
      payload: { text: item.text },
      preview: truncateOneLine(item.text, 80),
    });
  },
  assistant_message(item) {
    if (item.kind !== "assistant_message") {
      return;
    }
    for (const draft of traceDraftsFromBlocks(item.blocks, item.turn)) {
      emitDraft(draft);
    }
  },
  tool_invocation(item) {
    if (item.kind !== "tool_invocation") {
      return;
    }
    const input = item.input;
    emitDraft({
      turn: item.turn,
      phase: "post_llm",
      channel: "trace",
      kind: "tool_use",
      payload: {
        body: JSON.stringify(input),
        toolName: item.name,
        toolUseId: item.toolUseId,
        charCount: JSON.stringify(input).length,
        input,
      },
      preview: `${item.name} ${previewInput(input)}`.trim(),
    });
  },
  tool_outcome(item) {
    if (item.kind !== "tool_outcome") {
      return;
    }
    const body = formatToolSummary(item.resultSummary, item.artifactId);
    emitDraft({
      turn: item.turn,
      phase: "post_tool",
      channel: "trace",
      kind: "tool_result",
      payload: {
        body,
        toolUseId: item.toolUseId,
        charCount: body.length,
      },
      preview: truncateOneLine(body),
    });
  },
  compaction(item) {
    if (item.kind !== "compaction") {
      return;
    }
    emitDraft({
      turn: item.turn,
      phase: "pre_llm",
      channel: "context",
      kind: "context_compact",
      payload: {
        mode: item.compactionKind,
        beforeTokens: item.beforeTokens,
        afterTokens: item.afterTokens,
        savedTokens:
          item.beforeTokens !== undefined && item.afterTokens !== undefined
            ? item.beforeTokens - item.afterTokens
            : undefined,
      },
      preview: `${item.compactionKind} ${item.beforeTokens ?? "?"}→${item.afterTokens ?? "?"}`,
    });
  },
  checkpoint_created(_item) {},
  routing(_item) {},
};

export function deriveFromSessionItem(item: SessionItem): void {
  DERIVE_ITEM_HANDLERS[item.kind](item);
}

export function deriveConversationFinal(turn: number, text: string): void {
  emitDraft({
    turn,
    phase: "stop",
    channel: "conversation",
    kind: "final",
    payload: { text },
    preview: truncateOneLine(text, 80),
  });
}
