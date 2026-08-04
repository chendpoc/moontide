import type { Message } from "../../../llm/protocol/types.js";
import { messagesFromItems } from "../../../session/transform/messages-from-items.js";
import { messagesFromContext } from "../../../session/transform/messages-from-context.js";
import type { SessionItem } from "../../../session/types.js";

export interface LogToMessagesOptions {
  /** Include only log records with turn <= this value. */
  upToTurn?: number;
}

/** @deprecated Prefer SessionTransform.toMessages or messagesFromContext on SessionContext. */
export function logToMessages(
  log: readonly SessionItem[],
  options?: LogToMessagesOptions,
): Message[] {
  return messagesFromContext({ messages: messagesFromItems(log) }, options);
}

export { messagesFromContext as logToMessagesFromContext } from "../../../session/transform/messages-from-context.js";
