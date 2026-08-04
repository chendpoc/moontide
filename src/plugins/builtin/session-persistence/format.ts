import type { SessionListEntry } from "./types.js";

export function formatSessionId(entry: Pick<SessionListEntry, "sessionId" | "label">): string {
  return entry.label ? `${entry.sessionId} (${entry.label})` : entry.sessionId;
}

export function formatSessionLine(entry: SessionListEntry): string {
  const id = formatSessionId(entry);
  const tag = entry.indexed ? "" : " · not indexed";
  return `${id} · ${entry.messageCount} messages${tag}`;
}

export function formatStartupHint(entry: SessionListEntry): string {
  const id = formatSessionId(entry);
  return `Last session: ${id} · resume with /resume session ${entry.sessionId}`;
}
