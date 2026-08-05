import { writeStderrLine } from "../../../terminal/write.js";
import { formatQuitHintLines, formatStartupHintLines } from "./format.js";
import type { SessionPersistenceDeps } from "./deps.js";
import { getLatestSessionEntry, loadSessionIndex, upsertSessionEntry } from "./session-index.js";

function sessionMeta(deps: SessionPersistenceDeps) {
  const agent = deps.getAgentSession();
  if (!agent) {
    return null;
  }
  const messages = agent.session.getMessages();
  if (messages.length === 0) {
    return null;
  }
  const label = loadSessionIndex(deps.workdir).entries.find(
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
  for (const line of formatStartupHintLines(latest)) {
    writeStderrLine(line);
  }
}

/** Print current session id and resume command before REPL exit (after auto-save). */
export function printQuitHint(deps: SessionPersistenceDeps): void {
  const meta = sessionMeta(deps);
  if (!meta) {
    return;
  }
  writeStderrLine("");
  for (const line of formatQuitHintLines(meta.sessionId, meta.messageCount, meta.label)) {
    writeStderrLine(line);
  }
}
