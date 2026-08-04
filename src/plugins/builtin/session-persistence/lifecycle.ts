import { writeStderrLine } from "../../../terminal/write.js";
import { formatStartupHint } from "./format.js";
import type { SessionPersistenceDeps } from "./deps.js";
import { getLatestSessionEntry, upsertSessionEntry } from "./session-index.js";

function sessionMeta(deps: SessionPersistenceDeps) {
  const agent = deps.getAgentSession();
  if (!agent) {
    return null;
  }
  const messages = agent.session.getMessages();
  if (messages.length === 0) {
    return null;
  }
  return {
    sessionId: agent.session.sessionId,
    messageCount: messages.length,
    lastTurn: messages.at(-1)?.turn ?? 1,
  };
}

/** Silent upsert of active session into index (exit / reset). */
export function autoSaveSession(deps: SessionPersistenceDeps): void {
  const meta = sessionMeta(deps);
  if (!meta) {
    return;
  }
  upsertSessionEntry(deps.workdir, meta.sessionId, {
    messageCount: meta.messageCount,
    lastTurn: meta.lastTurn,
  });
}

export function printStartupHint(workdir: string): void {
  const latest = getLatestSessionEntry(workdir);
  if (!latest) {
    return;
  }
  writeStderrLine(formatStartupHint(latest));
}
