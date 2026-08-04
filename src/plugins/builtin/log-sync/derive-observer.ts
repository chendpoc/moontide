import type { HookHandler } from "../../../agent/hooks/types.js";
import {
  deriveConversationFinal as deriveFinalReply,
  deriveFromSessionItem,
} from "./item-derive-handlers.js";

export { deriveFinalReply, deriveFromSessionItem };

/** Project SessionItem commits into Agent Event Log (fail-open). Sole source for conversation + trace events (C6). */
export function createAgentEventDeriveHandler(): HookHandler<"sessionItem"> {
  return ({ item }) => {
    deriveFromSessionItem(item);
  };
}
