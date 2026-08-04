import type { SessionItem, SessionItemKind } from "../../../session/types.js";
import { formatToolSummary } from "../../../context/composer/artifact/project.js";
import { emitDraft } from "../../../log/event-hub.js";
import { traceDraftsFromBlocks } from "../../../session/block-registry.js";
import { truncateOneLine } from "../../../utils/text.js";

function previewInput(input: Record<string, unknown>): string {
  const parts = Object.entries(input)
    .slice(0, 3)
    .map(([key, value]) => `${key}=${String(value).slice(0, 30)}`);
  return parts.join(" ");
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

/** Project one Session Item into Agent Event drafts (observability only). */
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
