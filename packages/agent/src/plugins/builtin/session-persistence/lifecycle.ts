import type { SessionLifecycleAccess } from "./deps.js";
import { loadSessionIndex, upsertSessionEntry } from "./session-index.js";

function sessionMeta(access: SessionLifecycleAccess) {
  const agent = access.getAgentSession();
  if (!agent) {
    return null;
  }
  const messages = agent.session.getMessages();
  if (messages.length === 0) {
    return null;
  }
  const label = loadSessionIndex(access.workdir).entries.find(
    (entry) => entry.sessionId === agent.session.sessionId,
  )?.label;
  return {
    sessionId: agent.session.sessionId,
    messageCount: messages.length,
    lastTurn: messages.at(-1)?.turn ?? 1,
    label,
  };
}

/** Silent upsert of active session into index (exit / reset). */
export function autoSaveSession(access: SessionLifecycleAccess): void {
  const meta = sessionMeta(access);
  if (!meta) {
    return;
  }
  upsertSessionEntry(access.workdir, meta.sessionId, {
    messageCount: meta.messageCount,
    lastTurn: meta.lastTurn,
  });
}

/** Current session metadata for CLI hint output. */
export function getActiveSessionMeta(
  access: SessionLifecycleAccess,
): ReturnType<typeof sessionMeta> {
  return sessionMeta(access);
}
