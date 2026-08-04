import type { SessionMessage, SessionItem } from "../types.js";
import { itemsFromMessage } from "./items-from-message.js";

/** SessionMessage[] → SessionItem[] for persistence export. */
export function itemsFromMessages(messages: readonly SessionMessage[]): SessionItem[] {
  const items: SessionItem[] = [];
  for (const message of messages) {
    items.push(...itemsFromMessage(message));
  }
  return items;
}
