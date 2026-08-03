import {
  defaultCompactSystem,
  previewCompact,
} from "../../context/compact.js";
import { composeContextV1 } from "../../context/composer/compose.js";
import { SessionLogSlice } from "../../session/log-slice.js";
import { reply, formatCompactReport } from "./io.js";
import type { ParsedReplCommand, ReplCommandContext, ReplCommandResult } from "./types.js";

const NEXT_MILESTONE = "session-log compaction is not available yet (next milestone)";

export async function handleCompactCommand(
  parsed: ParsedReplCommand,
  ctx: ReplCommandContext,
): Promise<ReplCommandResult> {
  const agentSession = ctx.getAgentSession();
  if (!agentSession) {
    reply("nothing to compact — send a prompt first");
    return "handled";
  }

  const log = await agentSession.session.readLog();
  if (log.length === 0) {
    reply("nothing to compact — send a prompt first");
    return "handled";
  }

  const { arg } = parsed;

  if (arg === "auto" || arg === "summary" || (!arg && parsed.parts.length === 1)) {
    if (arg === "auto") {
      reply(NEXT_MILESTONE);
      return "handled";
    }
    if (arg === "summary") {
      reply(NEXT_MILESTONE);
      return "handled";
    }
  }

  if (arg === "preview") {
    const slice = SessionLogSlice.fromLog(log);
    const messages = slice.toMessageParams();
    const system = defaultCompactSystem();
    const { request } = composeContextV1({ turn: 0, messages, system });
    const preview = previewCompact(messages, request.system, request.tools);
    reply(
      formatCompactReport(
        "preview",
        preview.beforeTokens,
        preview.afterTokens,
        `${preview.truncatedToolResults} tool results would shrink · keep from index ${preview.keepFromIndex}`,
      ),
    );
    return "handled";
  }

  reply(NEXT_MILESTONE);
  return "handled";
}
