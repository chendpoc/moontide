import { compactThreshold } from "../../config.js";
import { collectStatusSnapshot } from "../statusline/collect.js";
import { renderStatusStackAsync } from "../statusline/render-stack.js";
import { reply } from "./io.js";
import type { ReplCommandContext, ReplCommandResult } from "./types.js";

export async function handleStatusCommand(ctx: ReplCommandContext): Promise<ReplCommandResult> {
  await renderStatusStackAsync();

  const agentSession = ctx.getAgentSession();
  if (agentSession) {
    const log = await agentSession.session.readItems();
    const policy = agentSession.getCompactionPolicy();
    reply(`session: ${agentSession.session.sessionId} · log records: ${log.length}`);
    reply(
      `compact auto: ${policy.autoEnabled ? "on" : "off"} · threshold ${policy.thresholdPercent}% · keep ${policy.keepTurns} turns`,
    );
    if (agentSession.getActiveCompactionSaveId()) {
      reply(`active compaction: ${agentSession.getActiveCompactionSaveId()}`);
    }
  } else {
    reply("session: (none)");
  }

  const snapshot = collectStatusSnapshot();
  if (snapshot.contextUsed !== null && snapshot.contextLimit !== null) {
    const pct = snapshot.contextPct ?? (snapshot.contextUsed / snapshot.contextLimit) * 100;
    reply(
      `context: ${snapshot.contextUsed.toLocaleString()} / ${snapshot.contextLimit.toLocaleString()} tok (${pct.toFixed(1)}%) · auto at ${compactThreshold()}%`,
    );
  }

  return "handled";
}
