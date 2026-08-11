import {
  formatSessionLine,
  listSessions,
  saveActiveSessionToIndex,
  type SessionLifecycleAccess,
} from "@moontide/agent";
import { reply } from "./io.js";
import type { ParsedReplCommand } from "./types.js";
import type { ReplCommandResult } from "./types.js";

export function handleSaveCommand(
  parsed: ParsedReplCommand,
  access: SessionLifecycleAccess,
): ReplCommandResult {
  if (parsed.arg === "list") {
    const sessions = listSessions(access.workdir);
    if (sessions.length === 0) {
      reply("no saved sessions yet");
      return "handled";
    }
    for (const entry of sessions) {
      reply(formatSessionLine(entry));
    }
    return "handled";
  }

  if (parsed.arg) {
    reply("usage: /save · /save list");
    return "handled";
  }

  const outcome = saveActiveSessionToIndex(access);
  if (!outcome.ok) {
    if (outcome.reason === "no_session") {
      reply("no active session — send a prompt first");
    } else {
      reply("nothing to save — send a prompt first");
    }
    return "handled";
  }

  reply(`saved ${outcome.sessionId} · ${outcome.messageCount} messages`);
  return "handled";
}
