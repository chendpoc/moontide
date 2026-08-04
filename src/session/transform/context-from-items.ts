import type { SessionItem } from "../types.js";
import { messagesFromItems } from "./messages-from-items.js";

/** @deprecated Use messagesFromItems */
export function contextFromItems(items: readonly SessionItem[]): ReturnType<typeof messagesFromItems> {
  return messagesFromItems(items);
}
