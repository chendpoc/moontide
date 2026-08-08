import type { CompactionSave } from "@moontide/session/stores";
import type { SessionMessage } from "@moontide/session";

/** Replace covered session messages with a summary user message (immutable). */
export function applySummary(
  messages: readonly SessionMessage[],
  save: CompactionSave,
): SessionMessage[] {
  const covered = new Set(save.coversItemIds);
  const tail = messages.filter((message) => !covered.has(message.id));

  if (save.kind !== "summary" || !("text" in save.payload)) {
    return tail;
  }

  const summaryMessage: SessionMessage = {
    id: `summary-${save.id}`,
    sessionId: save.sessionId,
    turn: save.createdAtTurn,
    at: new Date().toISOString(),
    role: "user",
    content: `[Session summary — older turns compressed]\n${save.payload.text}`,
  };

  return [summaryMessage, ...tail];
}
