import { toMessage } from "@moontide/shared/errors/normalize.js";
import { artifactPath } from "@moontide/session";
import { readText } from "@moontide/shared/utils/fs.js";
import { byteLengthUtf8 } from "@moontide/shared/utils/utf8.js";
import type { ToolContext } from "../../types.js";

export async function runReadArtifact(
  input: Record<string, unknown>,
  ctx: ToolContext,
): Promise<string> {
  const sessionId = ctx.sessionId?.trim();
  if (!sessionId) {
    return JSON.stringify({
      status: "error",
      error: "session_id required for read_artifact",
    });
  }

  const artifactId = String(input.artifact_id ?? "").trim();
  if (!artifactId) {
    return JSON.stringify({ status: "error", error: "artifact_id is required" });
  }

  const path = artifactPath(ctx.workdir, sessionId, artifactId);
  try {
    const content = readText(path);
    return JSON.stringify({
      status: "ok",
      artifact_id: artifactId,
      byte_count: byteLengthUtf8(content),
      content,
    });
  } catch (error) {
    return JSON.stringify({ status: "error", error: toMessage(error) });
  }
}
