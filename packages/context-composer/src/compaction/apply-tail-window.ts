import type { SessionMessage } from "@moontide/session";

/** Truncate session messages to the checkpoint window (inclusive). */
export function applyTailWindow(
  messages: readonly SessionMessage[],
  lastItemId: string,
): SessionMessage[] {
  const index = messages.findIndex((message) => message.id === lastItemId);
  if (index === -1) {
    return [...messages];
  }
  return messages.slice(0, index + 1);
}
