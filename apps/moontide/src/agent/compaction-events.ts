import type { CompactResult } from "@moontide/context-composer/compaction";

/** Agent Event draft for context compaction (product-layer emit). */
export interface CompactEventDraft {
  turn: number;
  mode: "prune" | "summary" | "auto";
  result: CompactResult;
}

export function buildCompactEventDraft(
  turn: number,
  result: CompactResult,
  mode: CompactEventDraft["mode"],
): CompactEventDraft {
  return { turn, mode, result };
}
