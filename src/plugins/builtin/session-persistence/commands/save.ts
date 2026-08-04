import { formatSessionLine } from "../format.js";
import type { ParsedReplParts, ReplCommandResult, SessionPersistenceDeps } from "../deps.js";
import { listSessions, upsertSessionEntry } from "../session-index.js";

export function handleSaveCommand(
  parsed: ParsedReplParts,
  deps: SessionPersistenceDeps,
): ReplCommandResult {
  if (parsed.arg === "list") {
    const sessions = listSessions(deps.workdir);
    if (sessions.length === 0) {
      deps.reply("no saved sessions yet");
      return "handled";
    }
    for (const entry of sessions) {
      deps.reply(formatSessionLine(entry));
    }
    return "handled";
  }

  if (parsed.arg) {
    deps.reply("usage: /save · /save list");
    return "handled";
  }

  const agent = deps.getAgentSession();
  if (!agent) {
    deps.reply("no active session — send a prompt first");
    return "handled";
  }

  const messages = agent.session.getMessages();
  if (messages.length === 0) {
    deps.reply("nothing to save — send a prompt first");
    return "handled";
  }

  const entry = upsertSessionEntry(deps.workdir, agent.session.sessionId, {
    messageCount: messages.length,
    lastTurn: messages.at(-1)?.turn ?? 1,
  });
  deps.reply(`saved ${entry.sessionId} · ${entry.messageCount} messages`);
  return "handled";
}
