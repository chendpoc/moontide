import fs from "node:fs";

import { artifactSpillThresholdBytes, getWorkdir } from "../../config.js";
import type { ArtifactStore } from "../stores/artifact-store.js";
import { summarizeToolResultContent } from "../../session/content-map.js";
import { formatToolSummary } from "../composer/artifact/project.js";
import { artifactPath } from "../../session/paths.js";
import type { ToolResultSummary } from "../../session/types.js";
import { ensureDirForFile } from "../../storage/fs.js";
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
  ensureDirForFile(path);
  fs.writeFileSync(path, content, "utf8");

  const summary = summarizeToolResultContent(content);
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
