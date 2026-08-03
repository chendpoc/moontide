import type { ToolResultSummary } from "../../../session/log-types.js";

/** Project tool outcome summaries for LLM context (C2). */
export function projectToolResultSummary(summary: ToolResultSummary): string {
  return summary.summary;
}
