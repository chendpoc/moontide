import type { SessionListEntry } from "./types.js";

export function formatSessionId(entry: Pick<SessionListEntry, "sessionId" | "label">): string {
  return entry.label ? `${entry.sessionId} (${entry.label})` : entry.sessionId;
}

export function formatSessionLine(entry: SessionListEntry): string {
  const id = formatSessionId(entry);
  const tag = entry.indexed ? "" : " · not indexed";
  return `${id} · ${entry.messageCount} messages${tag}`;
}

export function formatResumeCommand(sessionId: string): string {
  return `/resume session ${sessionId}`;
}

/** REPL startup hint: last saved session id, message count, and `/resume session` command. */
export function formatStartupHintLines(entry: SessionListEntry): string[] {
  const id = formatSessionId(entry);
  return [
    `Previous session: ${id} · ${entry.messageCount} messages`,
    `Resume: ${formatResumeCommand(entry.sessionId)}`,
  ];
}

/** REPL exit hint: current session id after auto-save and how to resume later. */
export function formatQuitHintLines(
  sessionId: string,
  messageCount: number,
  label?: string,
): string[] {
  const id = formatSessionId({ sessionId, label });
  return [
    `Session saved: ${id} · ${messageCount} messages`,
    `Resume later: ${formatResumeCommand(sessionId)}`,
  ];
}
