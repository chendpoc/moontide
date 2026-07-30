import { emitDraft } from "../events/bus.js";
import type { CompactResult } from "./compact.js";

export function emitCompactEvent(
  turn: number,
  result: CompactResult,
  mode: "prune" | "summary" | "auto",
): void {
  emitDraft({
    turn,
    phase: "pre_llm",
    channel: "context",
    kind: "context_compact",
    payload: {
      mode,
      beforeTokens: result.beforeTokens,
      afterTokens: result.afterTokens,
      savedTokens: result.beforeTokens - result.afterTokens,
      truncatedToolResults: result.truncatedToolResults,
      keepFromIndex: result.keepFromIndex,
    },
    preview: `${mode} ${result.beforeTokens}→${result.afterTokens}`,
  });
}
