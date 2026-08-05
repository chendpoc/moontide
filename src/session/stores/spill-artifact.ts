import { artifactSpillThresholdBytes, getWorkdir, toolPreviewChars } from "../../config.js";
import type { ArtifactStore } from "./artifact-store.js";
import { summarizeToolResultContent } from "../content-map.js";
import { formatToolSummary } from "../tool-summary.js";
import { artifactPath } from "../paths.js";
import type { ToolResultSummary } from "../types.js";
import { writeText } from "../../utils/fs.js";
import { newEventId } from "../../utils/id.js";
import { byteLengthUtf8 } from "../../utils/utf8.js";

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
  workdir = getWorkdir(),
): Promise<SpilledToolResult> {
  const byteCount = byteLengthUtf8(content);
  const threshold = artifactSpillThresholdBytes();

  if (byteCount <= threshold) {
    return {
      content,
      summary: summarizeToolResultContent(content),
    };
  }

  const artifactId = newEventId();
  const path = artifactPath(workdir, sessionId, artifactId);
  writeText(path, content);

  const summary = summarizeToolResultContent(content, { maxSummaryChars: toolPreviewChars() });
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
