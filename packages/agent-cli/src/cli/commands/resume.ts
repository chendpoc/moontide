import { openSessionFromIndex } from "@moontide/agent";
import { createSessionPersistenceAccess } from "../session-persistence-glue.js";
import { reply } from "./io.js";
import type { ParsedReplCommand, ReplCommandContext, ReplCommandResult } from "./types.js";

export async function handleResumeCommand(
  parsed: ParsedReplCommand,
  ctx: ReplCommandContext,
): Promise<ReplCommandResult> {
  if (parsed.parts[1]?.toLowerCase() === "session") {
    const sessionId = parsed.parts[2];
    if (!sessionId) {
      reply("usage: /resume session <session-id> [checkpoint-id]");
      return "handled";
    }

    const checkpointId = parsed.parts[3];
    const outcome = await openSessionFromIndex(
      createSessionPersistenceAccess(ctx),
      sessionId,
      checkpointId,
    );

    if (!outcome.ok) {
      if (outcome.reason === "session_not_found") {
        reply(`session not found: ${sessionId}`);
      } else {
        reply(`checkpoint not found: ${checkpointId}`);
      }
      return "handled";
    }

    if (outcome.checkpointId) {
      reply(
        `loaded session ${outcome.sessionId} · ${outcome.messageCount} messages visible · checkpoint ${outcome.checkpointId}`,
      );
      return "handled";
    }

    reply(`loaded session ${outcome.sessionId} · ${outcome.messageCount} messages visible`);
    return "handled";
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
