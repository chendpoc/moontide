import type { SessionContext, SessionItem } from "../types.js";
import { itemsFromMessages } from "./items-from-messages.js";

/** @deprecated Use itemsFromMessages */
export function itemsFromContext(context: SessionContext): SessionItem[] {
  return itemsFromMessages(context.messages);
}
