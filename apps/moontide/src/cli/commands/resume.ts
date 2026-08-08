import {
  handleResumeSessionCommand,
} from "../../plugins/builtin/session-persistence/index.js";
import { createSessionPersistenceDeps } from "../session-persistence-glue.js";
import { reply } from "./io.js";
import type { ParsedReplCommand, ReplCommandContext, ReplCommandResult } from "./types.js";

export async function handleResumeCommand(
  parsed: ParsedReplCommand,
  ctx: ReplCommandContext,
): Promise<ReplCommandResult> {
  if (parsed.parts[1]?.toLowerCase() === "session") {
    return handleResumeSessionCommand(parsed, createSessionPersistenceDeps(ctx));
  }

  const checkpointId = parsed.parts[1];
  if (!checkpointId) {
    reply("usage: /resume <checkpoint-id> · /resume session <session-id> [checkpoint-id]");
    return "handled";
  }

  const agentSession = ctx.getAgentSession();
  if (!agentSession) {
    reply("no active session — send a prompt first");
    return "handled";
  }

  const ok = await agentSession.resume(checkpointId);
  if (!ok) {
    reply(`checkpoint not found: ${checkpointId}`);
    return "handled";
  }

  reply(
    `resumed from ${checkpointId} · ${agentSession.session.getMessages().length} messages visible`,
  );
  return "handled";
}
