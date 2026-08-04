/** Format tool outcome summaries for LLM context (C2). */
import type { ToolResultSummary } from "../../../session/types.js";

export function formatToolSummary(summary: ToolResultSummary, artifactId?: string): string {
  if (artifactId) {
    return `${summary.summary}\n[artifact:${artifactId} · ${summary.byteCount} bytes stored — use read_artifact to load full output]`;
  }
  return summary.summary;
}
