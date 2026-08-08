import type { ArtifactStore } from "./artifact-store.js";
import { summarizeToolResultContent } from "../content-map.js";
import { formatToolSummary } from "../tool-summary.js";
import { artifactPath } from "../paths.js";
import type { ToolResultSummary } from "../types.js";
import { writeText } from "@moontide/shared/utils/fs.js";
import { newEventId } from "@moontide/shared/utils/id.js";
import { byteLengthUtf8 } from "@moontide/shared/utils/utf8.js";

export interface SpillOptions {
  thresholdBytes: number;
  previewMaxSummaryChars: number;
}

export interface SpilledToolResult {
  content: string;
  summary: ToolResultSummary;
  artifactId?: string;
}

/** Store oversized tool output in ArtifactStore; return summary for session + model. */
export async function maybeSpillToolResult(
  sessionId: string,
  toolUseId: string,
  content: string,
  artifactStore: ArtifactStore,
  workdir: string,
  spill: SpillOptions,
): Promise<SpilledToolResult> {
  const byteCount = byteLengthUtf8(content);

  if (byteCount <= spill.thresholdBytes) {
    return {
      content,
      summary: summarizeToolResultContent(content),
    };
  }

  const artifactId = newEventId();
  const path = artifactPath(workdir, sessionId, artifactId);
  writeText(path, content);

  const summary = summarizeToolResultContent(content, {
    maxSummaryChars: spill.previewMaxSummaryChars,
  });
  await artifactStore.put({
    id: artifactId,
    sessionId,
    toolUseId,
    contentType: "text",
    path,
    byteCount,
    createdAt: new Date().toISOString(),
  });

  return {
    content: formatToolSummary(summary, artifactId),
    summary,
    artifactId,
  };
}
