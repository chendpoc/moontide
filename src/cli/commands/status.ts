import { collectStatusSnapshot } from "../statusline/collect.js";
import { formatStatusLineVerbose } from "../statusline/format.js";
import { reply } from "./io.js";
import type { ReplCommandContext, ReplCommandResult } from "./types.js";

export async function handleStatusCommand(ctx: ReplCommandContext): Promise<ReplCommandResult> {
  const snapshot = collectStatusSnapshot();
  reply(formatStatusLineVerbose(snapshot));
  const agentSession = ctx.getAgentSession();
  if (agentSession) {
    const log = await agentSession.session.readLog();
    reply(`session: ${agentSession.session.sessionId} · log records: ${log.length}`);
  } else {
    reply("session: (none)");
  }
  return "handled";
}
